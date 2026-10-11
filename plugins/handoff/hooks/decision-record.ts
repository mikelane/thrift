import type { DecisionReason } from './decision-reasons'
import type { NoteDelivery } from './handoff-note'
import type { GroupDelivery } from './held-delivery'
import type { HeldPromptGroup, SessionState } from './session-state'
import type { Mode, Signal } from './signals'

export type { DecisionReason }

// Who ran the clear that a `cleared` record follows: the person's own /clear during the wait, or the handoff's.
export type ClearedBy = 'person' | 'handoff'

export type DecisionAction = 'none' | 'advised' | 'cleared' | 'compacted' | 'untested_engine'

export type TriggerValues = {
  point: 'turn-end' | 'prompt' | 'command' | 'button' | 'session-start'
  signal: Signal
  context_tokens: number
  threshold: number
  is_background_busy: boolean
  setting: Mode
  cache_read_tokens: number
  reason?: DecisionReason
  note?: NoteDelivery
  held_groups?: number
  held_unattended?: boolean
  handoff_unattended?: boolean
  held_other_delivery?: GroupDelivery
  held_restore?: GroupDelivery
  cleared_by?: ClearedBy
  compacted_before_clear?: true
}

type HeldGroupFields = Required<Pick<TriggerValues, 'held_groups' | 'held_unattended'>>

export type HeldRecordFields = HeldGroupFields &
  Pick<TriggerValues, 'handoff_unattended' | 'held_other_delivery' | 'held_restore'>

export const heldGroupFields = (groups: readonly HeldPromptGroup[]): HeldGroupFields => ({
  held_groups: groups.length,
  held_unattended: groups.some(group => group.isUnattended),
})

type RecordInput = {
  now: number
  sessionId: string
  action: DecisionAction
  engineVersion: string
  effectiveMode: Mode
  triggerValues: TriggerValues
}

export type Trigger = {
  point: TriggerValues['point']
  signal: Signal
  isBusy: boolean
  contextTokens: number
  cacheReadTokens: number
  effectiveMode: Mode
}

export type Evaluation = Trigger & {
  action: DecisionAction
  reason?: DecisionReason
  note?: NoteDelivery
  clearedBy?: ClearedBy
  compactedBeforeClear?: boolean
  heldFields?: HeldRecordFields
  sessionId?: string
}

export type HandoffRequest = {
  trigger: Trigger
  heldPrompt?: string
  // The origin kind of heldPrompt; the composer when absent, as for a prompt held in the box.
  heldPromptOrigin?: string
  isUnattended: boolean
}

// What a handoff delivers once its held prompts are taken: one group per origin, each following its own flag.
export type SettledHandoff = {
  trigger: Trigger
  isUnattended: boolean
  heldGroups: HeldPromptGroup[]
  hasCompactedBeforeClear?: boolean
}

export type RecordSessionFields = Pick<
  SessionState,
  'mode' | 'setting' | 'threshold' | 'engineVersion' | 'contextTokens' | 'cacheReadTokens'
>

// What a record reads from the session when it is written. The mode and sizes come from the evaluation's snapshot.
export type RecordStateFields = Pick<SessionState, 'setting' | 'threshold' | 'engineVersion'>

export const snapshotTrigger = (state: RecordSessionFields, point: Trigger['point'], signal: Signal, isBusy: boolean): Trigger => ({
  point,
  signal,
  isBusy,
  contextTokens: state.contextTokens,
  cacheReadTokens: state.cacheReadTokens,
  effectiveMode: state.mode,
})

// umask only applies when the file is created, so a log that already exists is made owner-only by the chmod. `mkdir -p --`
// works on BSD and GNU alike. chmod takes no `--`: BSD chmod (macOS) reads it as a file operand, sets the mode, then fails on it
// and exits 1, while GNU chmod accepts it. The file is always absolute (see isUsableThriftHome), so it cannot read as an option.
export const LOG_WRITER = ['sh', '-c', 'umask 077 && mkdir -p -- "$1" && cat >> "$2" && chmod 600 "$2"', 'sh'] as const

// A person asked for these, so the plugin acted on their request whatever mode it ran in.
const isPersonAction = (point: TriggerValues['point']): boolean => point === 'command' || point === 'button'

export const decisionRecord = ({ now, sessionId, action, engineVersion, effectiveMode, triggerValues }: RecordInput) => ({
  ts: new Date(now).toISOString(),
  session_id: sessionId,
  component: 'handoff',
  mode: action === 'none' && effectiveMode === 'off' && !isPersonAction(triggerValues.point) ? 'shadow' : 'active',
  action,
  engine_version: engineVersion,
  trigger_values: { ...triggerValues, effective_mode: effectiveMode },
})

export type DecisionRecord = ReturnType<typeof decisionRecord>

export const recordFromEvaluation = (
  state: RecordStateFields,
  evaluation: Evaluation,
  now: number,
  sessionId: string,
): DecisionRecord => {
  const { action, point, signal, isBusy, contextTokens, cacheReadTokens, effectiveMode, reason, note, clearedBy, compactedBeforeClear, heldFields } = evaluation
  const compactedFields: Pick<TriggerValues, 'compacted_before_clear'> = compactedBeforeClear ? { compacted_before_clear: true } : {}
  return decisionRecord({
    now,
    sessionId,
    action,
    engineVersion: state.engineVersion,
    effectiveMode,
    triggerValues: {
      point,
      signal,
      context_tokens: contextTokens,
      threshold: state.threshold,
      is_background_busy: isBusy,
      setting: state.setting,
      cache_read_tokens: cacheReadTokens,
      ...(reason ? { reason } : {}),
      ...(note ? { note } : {}),
      ...(clearedBy ? { cleared_by: clearedBy } : {}),
      ...compactedFields,
      ...heldFields,
    },
  })
}

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
