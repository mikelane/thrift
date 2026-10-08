import type { Mode, Signal } from './signals'

export type DecisionAction = 'none' | 'advised' | 'cleared' | 'compacted' | 'untested_engine'

export type TriggerValues = {
  point: 'turn-end' | 'prompt' | 'command' | 'button'
  signal: Signal
  context_tokens: number
  threshold: number
  is_background_busy: boolean
  setting: Mode
  cache_read_tokens: number
  reason?: string
}

type RecordInput = {
  now: number
  sessionId: string
  action: DecisionAction
  engineVersion: string
  triggerValues: TriggerValues
}

export const LOG_WRITER = ['sh', '-c', 'umask 077 && mkdir -p "$1" && cat >> "$2"', 'sh'] as const

export const decisionRecord = ({ now, sessionId, action, engineVersion, triggerValues }: RecordInput) => ({
  ts: new Date(now).toISOString(),
  session_id: sessionId,
  component: 'handoff',
  mode: action === 'none' && triggerValues.setting === 'off' && triggerValues.point !== 'command' ? 'shadow' : 'active',
  action,
  engine_version: engineVersion,
  trigger_values: triggerValues,
})

export const logLocation = (thriftHome: string | undefined, home: string | undefined) => {
  const dir = thriftHome ? thriftHome.replace(/\/+$/, '') : home ? `${home.replace(/\/+$/, '')}/.claude/thrift` : null
  return dir === null ? null : { dir, file: `${dir}/decisions.jsonl` }
}
