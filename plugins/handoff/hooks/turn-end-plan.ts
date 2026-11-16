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
  floorTokens: number
}

type TurnEndOutcome = ReturnType<typeof respond> | { kind: 'back-off' } | { kind: 'floor-above-threshold' }

export const isBackedOff = ({ backoffFrom, contextTokens }: { backoffFrom: number | null; contextTokens: number }): boolean =>
  backoffFrom !== null && contextTokens < backoffFrom + BACKOFF_TOKENS

// A floor of 0 means no measurement yet. With a known floor at or above the threshold, a compaction lands back above it.
export const isFloorAboveThreshold = ({ floorTokens, threshold }: { floorTokens: number; threshold: number }): boolean =>
  floorTokens > 0 && floorTokens >= threshold

export const planTurnEnd = (input: TurnEndInput): { signal: Signal; outcome: TurnEndOutcome } => {
  const signal = classify({
    contextTokens: input.contextTokens,
    threshold: input.threshold,
    isStoppingPoint: input.hasFinishedTask,
    isBackgroundBusy: input.isBackgroundBusy,
  })
  if (signal === 'weak' && isBackedOff(input)) return { signal, outcome: { kind: 'back-off' } }
  if (signal === 'weak' && isFloorAboveThreshold(input)) return { signal, outcome: { kind: 'floor-above-threshold' } }
  const outcome = respond({
    mode: input.mode,
    signal,
    stoppingPoint: input.hasFinishedTask ? 'finished-task' : null,
    isBackgroundBusy: input.isBackgroundBusy,
    isUnattended: input.isUnattended,
  })
  return { signal, outcome }
}
