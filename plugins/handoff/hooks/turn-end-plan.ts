import { classify, respond, type Mode, type Signal } from './signals'

const BACKOFF_TOKENS = 50_000

type TurnEndInput = {
  contextTokens: number
  threshold: number
  hasFinishedTask: boolean
  isBackgroundBusy: boolean
  mode: Mode
  isUnattended: boolean
  backoffFrom: number | null
}

type TurnEndOutcome = ReturnType<typeof respond> | { kind: 'back-off' }

export const isBackedOff = ({ backoffFrom, contextTokens }: { backoffFrom: number | null; contextTokens: number }): boolean =>
  backoffFrom !== null && contextTokens < backoffFrom + BACKOFF_TOKENS

export const planTurnEnd = (input: TurnEndInput): { signal: Signal; outcome: TurnEndOutcome } => {
  const signal = classify({
    contextTokens: input.contextTokens,
    threshold: input.threshold,
    isStoppingPoint: input.hasFinishedTask,
    isBackgroundBusy: input.isBackgroundBusy,
  })
  if (signal === 'weak' && isBackedOff(input)) return { signal, outcome: { kind: 'back-off' } }
  const outcome = respond({
    mode: input.mode,
    signal,
    stoppingPoint: input.hasFinishedTask ? 'finished-task' : null,
    isBackgroundBusy: input.isBackgroundBusy,
    isUnattended: input.isUnattended,
  })
  return { signal, outcome }
}
