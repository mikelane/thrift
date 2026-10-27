import type { ReadMode } from '../types'
import type { DecisionReason } from './decision-reasons'

export type { DecisionReason }

export type Decision = 'dedupe' | 'pass' | 'override' | 'invalidate' | 'untested_engine'

export type RangeKind = 'full' | 'range' | 'subrange'

export type Savings = { grossBytes: number; stubBytes: number }

export type Evaluation = {
  decision: Decision
  reason: DecisionReason
  isSubagent: boolean
  pathHash?: string
  savings?: Savings
  lines?: number
  rangeKind?: RangeKind
  turnsSinceRead?: number
  dropped?: number
}

export type RecordContext = {
  now: number
  sessionId: string
  engineVersion: string
  setting: ReadMode
  effectiveMode: ReadMode
}

// What a record needs from the session beyond the evaluation itself.
export type RecordSetting = Pick<RecordContext, 'engineVersion' | 'setting' | 'effectiveMode'>

// umask only applies when the file is created, so a log that already exists is made owner-only by the chmod. `mkdir -p --`
// works on BSD and GNU alike. chmod takes no `--`: BSD chmod (macOS) reads it as a file operand, sets the mode, then fails on it
// and exits 1, while GNU chmod accepts it. The file is always absolute (see isUsableThriftHome), so it cannot read as an option.
export const LOG_WRITER = ['sh', '-c', 'umask 077 && mkdir -p -- "$1" && cat >> "$2" && chmod 600 "$2"', 'sh'] as const

// The plugin acts on nothing in off, so an evaluation there is a shadow record whatever the logic decided.
const actionOf = (decision: Decision, effectiveMode: ReadMode): Decision | 'none' =>
  decision === 'untested_engine' ? decision : effectiveMode === 'off' ? 'none' : decision

export type ByteFields = { bytes_saved?: number; bytes_would_save?: number; gross_bytes?: number; stub_bytes?: number }

const byteFields = (savings: Savings | undefined, effectiveMode: ReadMode): ByteFields => {
  if (savings === undefined) return {}
  const net = savings.grossBytes - savings.stubBytes
  return {
    ...(effectiveMode === 'off' ? { bytes_would_save: net } : { bytes_saved: net }),
    gross_bytes: savings.grossBytes,
    stub_bytes: savings.stubBytes,
  }
}

export const decisionRecord = ({ now, sessionId, engineVersion, setting, effectiveMode }: RecordContext, evaluation: Evaluation) => {
  const action = actionOf(evaluation.decision, effectiveMode)
  return {
    ts: new Date(now).toISOString(),
    session_id: sessionId,
    component: 'reread',
    mode: action === 'none' ? 'shadow' : 'active',
    action,
    engine_version: engineVersion,
    trigger_values: {
      decision: evaluation.decision,
      reason: evaluation.reason,
      ...byteFields(evaluation.savings, effectiveMode),
      ...(evaluation.lines === undefined ? {} : { lines: evaluation.lines }),
      ...(evaluation.rangeKind === undefined ? {} : { range_kind: evaluation.rangeKind }),
      ...(evaluation.turnsSinceRead === undefined ? {} : { turns_since_read: evaluation.turnsSinceRead }),
      is_subagent: evaluation.isSubagent,
      ...(evaluation.pathHash === undefined ? {} : { path_hash: evaluation.pathHash }),
      ...(evaluation.dropped === undefined ? {} : { dropped: evaluation.dropped }),
      effective_mode: effectiveMode,
      setting,
    },
  }
}

export type DecisionRecord = ReturnType<typeof decisionRecord>

// A relative THRIFT_HOME, or one that starts with ~, would resolve against the session's working directory, not the home.
export const isUsableThriftHome = (thriftHome: string | undefined): thriftHome is string => thriftHome?.startsWith('/') === true

export const logLocation = (
  thriftHome: string | undefined,
  home: string | undefined,
): { dir: string; file: string } | null => {
  const dir = isUsableThriftHome(thriftHome) ? thriftHome.replace(/\/+$/, '') : home ? `${home.replace(/\/+$/, '')}/.claude/thrift` : null
  // THRIFT_HOME=/ strips to nothing: the log then goes in the root directory itself, as asked.
  if (dir === '') return { dir: '/', file: '/decisions.jsonl' }
  return dir === null ? null : { dir, file: `${dir}/decisions.jsonl` }
}
