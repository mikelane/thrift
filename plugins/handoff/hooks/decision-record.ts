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
  isUnattended: boolean
}

// What a handoff delivers once its held prompts are taken: one group per origin, each following its own flag.
export type SettledHandoff = {
  trigger: Trigger
  isUnattended: boolean
  heldGroups: HeldPromptGroup[]
  hasCompactedBeforeClear?: boolean
}

export type RecordState = Pick<
  SessionState,
  'mode' | 'setting' | 'threshold' | 'engineVersion' | 'contextTokens' | 'cacheReadTokens'
>

export const snapshot = (state: RecordState, point: Trigger['point'], signal: Signal, isBusy: boolean): Trigger => ({
  point,
  signal,
  isBusy,
  contextTokens: state.contextTokens,
  cacheReadTokens: state.cacheReadTokens,
})

export const LOG_WRITER = ['sh', '-c', 'umask 077 && mkdir -p "$1" && cat >> "$2"', 'sh'] as const

export const decisionRecord = ({ now, sessionId, action, engineVersion, effectiveMode, triggerValues }: RecordInput) => ({
  ts: new Date(now).toISOString(),
  session_id: sessionId,
  component: 'handoff',
  mode: action === 'none' && effectiveMode === 'off' && triggerValues.point !== 'command' ? 'shadow' : 'active',
  action,
  engine_version: engineVersion,
  trigger_values: { ...triggerValues, effective_mode: effectiveMode },
})

export const recordFromEvaluation = (state: RecordState, evaluation: Evaluation, now: number, sessionId: string) => {
  const { action, point, signal, isBusy, contextTokens, cacheReadTokens, reason, note, clearedBy, compactedBeforeClear, heldFields } = evaluation
  return decisionRecord({
    now,
    sessionId,
    action,
    engineVersion: state.engineVersion,
    effectiveMode: state.mode,
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
      ...(compactedBeforeClear ? { compacted_before_clear: true as const } : {}),
      ...heldFields,
    },
  })
}

export const logLocation = (
  thriftHome: string | undefined,
  home: string | undefined,
): { dir: string; file: string } | null => {
  const dir = thriftHome ? thriftHome.replace(/\/+$/, '') : home ? `${home.replace(/\/+$/, '')}/.claude/thrift` : null
  return dir === null ? null : { dir, file: `${dir}/decisions.jsonl` }
}
