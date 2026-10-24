import type { RateLimitReading } from '../types'
import { clockLabel } from './clock-label'
import { formatPercent } from './format'
import type { GlyphSlot } from './glyphs'
import {
  elapsedShare,
  formatPace,
  isTooEarly,
  paceBand,
  paceOf,
  parseResetsAt,
  projectedExhaustion,
  windowLengthMs,
} from './pace'
import type { BandColor } from './pace'

const LIMIT_PERCENT = 100

export type WindowView = {
  state: 'paced' | 'too-early' | 'limit-reached' | 'plain'
  label: string
  slot?: GlyphSlot
  percentText: string
  color?: BandColor
  elapsedPercent?: number
  paceText?: string
  projection?: string
  resetsLabel?: string
}

const labelFor = (kind: string): string => {
  if (kind === 'five_hour') return '5-HOUR'
  if (kind === 'seven_day') return 'WEEKLY'
  return kind.replace(/_/g, ' ').toUpperCase()
}

const slotFor = (kind: string): GlyphSlot | undefined => {
  if (kind === 'five_hour') return 'fiveHour'
  if (kind === 'seven_day') return 'weekly'
  return undefined
}

export const windowView = (limit: RateLimitReading, now: number, utcOffsetMinutes: number): WindowView => {
  const { kind, percentUsed } = limit
  const base = { label: labelFor(kind), slot: slotFor(kind), percentText: formatPercent(percentUsed) }
  const windowMs = windowLengthMs(kind)
  const isAtLimit = percentUsed >= LIMIT_PERCENT
  if (windowMs === undefined) {
    return isAtLimit ? { ...base, state: 'plain', color: 'error' } : { ...base, state: 'plain' }
  }
  const resetsAt = parseResetsAt(limit.resetsAt)
  const share = elapsedShare(resetsAt, now, windowMs)
  const resetsLabel = share === undefined || resetsAt === undefined ? undefined : clockLabel(resetsAt, now, utcOffsetMinutes)
  if (isAtLimit) return { ...base, state: 'limit-reached', color: 'error', resetsLabel }
  if (share === undefined || resetsLabel === undefined) return { ...base, state: 'plain' }
  if (isTooEarly(share)) return { ...base, state: 'too-early' }
  const pace = paceOf(percentUsed, share)
  const exhaustion = projectedExhaustion(now, percentUsed, share, windowMs)
  return {
    ...base,
    state: 'paced',
    color: paceBand(pace),
    elapsedPercent: Math.round(share * 100),
    paceText: formatPace(pace),
    projection: exhaustion === undefined ? undefined : clockLabel(exhaustion, now, utcOffsetMinutes),
    resetsLabel,
  }
}
