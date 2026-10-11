import type { PromptOrigin } from 'claude-code'
import { classify, respond, type Mode, type Signal } from './signals'

const PERSON_ORIGINS = new Set(['composer', 'bridge', 'sdk', 'scheduled-trigger'])

type DuringHandoffInput = { isCarried: boolean; isHolding: boolean; hasExtras: boolean }

type NewWorkInput = {
  contextTokens: number
  threshold: number
  isBackgroundBusy: boolean
  mode: Mode
  isUnattended: boolean
  isFromComposer: boolean
}

export const isPersonOrigin = (kind: string): boolean => PERSON_ORIGINS.has(kind)

// Only the composer is typed at this terminal; the other person origins have a sender who is somewhere else.
export const isComposerOrigin = (kind: string): boolean => kind === 'composer'

export const isUnattendedOrigin = (kind: string): boolean => kind === 'scheduled-trigger'

// The origin a handoff note goes out under when no held prompt rides with it: the handoff's own sender.
export const noteOrigin = (isUnattended: boolean): PromptOrigin['kind'] => (isUnattended ? 'scheduled-trigger' : 'composer')

const SENDER_LABELS = new Map([
  ['composer', 'this terminal'],
  ['bridge', 'the bridge'],
  ['sdk', 'an SDK client'],
  ['scheduled-trigger', 'a scheduled task'],
])

// Who sent a prompt, as a reader would say it. Only the person origins are named; any other origin never reaches a message.
export const senderLabel = (kind: string): string => SENDER_LABELS.get(kind) ?? 'a sender outside this terminal'

// A held prompt comes back as text alone, so one that carries an attachment or context can't be held.
export const carriesExtras = (prompt: { attachments?: readonly unknown[]; context?: readonly unknown[] }): boolean =>
  (prompt.attachments?.length ?? 0) > 0 || (prompt.context?.length ?? 0) > 0

export const planPromptDuringHandoff = ({ isCarried, isHolding, hasExtras }: DuringHandoffInput): 'drop-repeat' | 'refuse' | 'hold' | 'proceed' => {
  if (isCarried) return 'drop-repeat'
  if (!isHolding) return 'proceed'
  return hasExtras ? 'refuse' : 'hold'
}

export const canHoldPrompt = (input: { isNewWork: boolean; hasPendingAction: boolean; hasTurnId: boolean; hasExtras: boolean }): boolean =>
  input.isNewWork && !input.hasPendingAction && !input.hasTurnId && !input.hasExtras

export const planNewWorkPrompt = (input: NewWorkInput): { signal: Signal; action: 'handoff' | 'hold' | 'none' } => {
  const signal = classify({
    contextTokens: input.contextTokens,
    threshold: input.threshold,
    isStoppingPoint: true,
    isBackgroundBusy: input.isBackgroundBusy,
  })
  const response = respond({
    mode: input.mode,
    signal,
    stoppingPoint: 'new-work',
    isBackgroundBusy: input.isBackgroundBusy,
    isUnattended: input.isUnattended,
  })
  if (response.kind === 'handoff') return { signal, action: 'handoff' }
  // Only a prompt typed at this terminal is held for the band: the sender of any other is somewhere else, and a refill
  // would put their prompt in the box of the person who is here. The turn it starts can still raise the band.
  if (response.kind === 'advise' && response.holdsPrompt && input.isFromComposer) return { signal, action: 'hold' }
  return { signal, action: 'none' }
}
