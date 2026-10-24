export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
export const TOO_EARLY_SHARE = 0.05

const GREEN_BELOW = 0.9
const YELLOW_THROUGH = 1.1
const RATIO_TOLERANCE = 1e-9

export type BandColor = 'success' | 'warning' | 'error'

export const windowLengthMs = (kind: string): number | undefined => {
  if (kind === 'five_hour') return FIVE_HOURS_MS
  if (kind === 'seven_day') return SEVEN_DAYS_MS
  return undefined
}

export const parseResetsAt = (resetsAt: string | undefined): number | undefined => {
  if (resetsAt === undefined) return undefined
  const time = Date.parse(resetsAt)
  return Number.isNaN(time) ? undefined : time
}

export const elapsedShare = (resetsAt: number | undefined, now: number, windowMs: number): number | undefined => {
  if (resetsAt === undefined || resetsAt <= now) return undefined
  const elapsed = windowMs - (resetsAt - now)
  return Math.min(1, Math.max(0, elapsed / windowMs))
}

export const isTooEarly = (share: number): boolean => share < TOO_EARLY_SHARE

export const paceOf = (percentUsed: number, share: number): number => percentUsed / (100 * share)

export const formatPace = (pace: number): string => pace.toFixed(2)

export const paceBand = (pace: number): BandColor => {
  if (pace < GREEN_BELOW - RATIO_TOLERANCE) return 'success'
  return pace <= YELLOW_THROUGH + RATIO_TOLERANCE ? 'warning' : 'error'
}

export const projectedExhaustion = (
  now: number,
  percentUsed: number,
  share: number,
  windowMs: number,
): number | undefined => {
  if (paceOf(percentUsed, share) <= 1) return undefined
  const elapsedTime = share * windowMs
  return now + (100 - percentUsed) * (elapsedTime / percentUsed)
}
