export type Mode = 'off' | 'ask' | 'act'
export type Signal = 'none' | 'strong' | 'weak'
type StoppingPoint = 'finished-task' | 'new-work' | null
export type Button = 'handoff' | 'handoff-send' | 'send-here' | 'compact' | 'not-now'

type Response =
  | { kind: 'none' }
  | { kind: 'handoff'; holdsPrompt: boolean }
  | { kind: 'compact' }
  | { kind: 'advise'; holdsPrompt: boolean; buttons: readonly Button[] }

const MODES: readonly Mode[] = ['off', 'ask', 'act']
const isMode = (value: unknown): value is Mode => MODES.some(mode => mode === value)

export const asMode = (value: unknown): Mode =>
  isMode(value) ? value : 'off'

const DEFAULT_THRESHOLD = 150_000
const MIN_THRESHOLD = 80_000
const MAX_THRESHOLD = 2_000_000

export const asThreshold = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, value))
    : DEFAULT_THRESHOLD

type StepSize = {
  input: number
  created: number
  read: number
  advisorCalls: number
  reported: number | undefined
}

export const contextFromStep = ({ input, created, read, advisorCalls, reported }: StepSize): number => {
  const perCall = (input + created + read) / (1 + advisorCalls)
  return Math.round(reported === undefined ? perCall : Math.min(reported, perCall))
}

export const formatTokens = (tokens: number): string => `${Math.round(tokens / 1000)}k`


type ClassifyInput = {
  contextTokens: number
  threshold: number
  isStoppingPoint: boolean
  isBackgroundBusy: boolean
}

export const classify = ({ contextTokens, threshold, isStoppingPoint, isBackgroundBusy }: ClassifyInput): Signal => {
  if (contextTokens < threshold) return 'none'
  return isStoppingPoint && !isBackgroundBusy ? 'strong' : 'weak'
}

type RespondInput = {
  mode: Mode
  signal: Signal
  stoppingPoint: StoppingPoint
  isBackgroundBusy: boolean
  isUnattended: boolean
}

const NONE: Response = { kind: 'none' }

type BandShape = { signal: Signal; heldPrompt: boolean; isBusy: boolean }

export const bandButtons = ({ signal, heldPrompt, isBusy }: BandShape): readonly Button[] => {
  if (heldPrompt) return isBusy ? ['send-here'] : ['handoff-send', 'send-here']
  if (signal === 'strong') return ['handoff', 'not-now']
  return isBusy ? ['compact', 'not-now'] : ['compact', 'handoff', 'not-now']
}

const respondToStrong = (mode: 'ask' | 'act', stoppingPoint: StoppingPoint): Response => {
  const holdsPrompt = stoppingPoint === 'new-work'
  if (mode === 'act') return { kind: 'handoff', holdsPrompt }
  const buttons = bandButtons({ signal: 'strong', heldPrompt: holdsPrompt, isBusy: false })
  return { kind: 'advise', holdsPrompt, buttons }
}

const respondToWeak = (mode: 'ask' | 'act', isBusy: boolean): Response => {
  if (mode === 'act') return { kind: 'compact' }
  return { kind: 'advise', holdsPrompt: false, buttons: bandButtons({ signal: 'weak', heldPrompt: false, isBusy }) }
}

export const respond = ({ mode, signal, stoppingPoint, isBackgroundBusy, isUnattended }: RespondInput): Response => {
  if (mode === 'off' || signal === 'none') return NONE
  if (isUnattended) return signal === 'strong' ? { kind: 'handoff', holdsPrompt: stoppingPoint === 'new-work' } : NONE
  return signal === 'strong' ? respondToStrong(mode, stoppingPoint) : respondToWeak(mode, isBackgroundBusy)
}

// The decision-time snapshot predates a busy refusal, and classify() gives a weak signal whenever work is busy.
export const busyRefusalTrigger = <T extends { isBusy: boolean; signal: Signal }>(trigger: T): T => ({
  ...trigger,
  isBusy: true,
  signal: 'weak',
})
