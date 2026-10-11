import { classify, respond, type Mode, type Signal } from './signals'

const PERSON_ORIGINS = new Set(['composer', 'bridge', 'sdk', 'scheduled-trigger'])

type DuringHandoffInput = { isCarried: boolean; isHolding: boolean; hasExtras: boolean }

type NewWorkInput = {
  contextTokens: number
  threshold: number
  isBackgroundBusy: boolean
  mode: Mode
  isUnattended: boolean
}

export const isPersonOrigin = (kind: string): boolean => PERSON_ORIGINS.has(kind)

export const isUnattendedOrigin = (kind: string): boolean => kind === 'scheduled-trigger'

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
  if (response.kind === 'advise' && response.holdsPrompt) return { signal, action: 'hold' }
  return { signal, action: 'none' }
}
