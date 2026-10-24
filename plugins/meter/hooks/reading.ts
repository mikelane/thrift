import type { BreakdownReading, HeadlineReading, MeterReading, RateLimitReading } from '../types'

export const BREAKDOWN_REFRESH_MS = 60_000

export const EMPTY_READING: MeterReading = { headline: null, breakdown: null, isStale: false }

type UsageFigures = {
  context: { tokens?: number; window: number }
  rateLimits: readonly RateLimitReading[]
  cost?: { usd: number }
}

export const headlineFrom = ({ context, rateLimits, cost }: UsageFigures): HeadlineReading => ({
  ...(context.tokens === undefined ? {} : { contextTokens: context.tokens }),
  contextWindow: context.window,
  rateLimits: rateLimits.map(({ kind, percentUsed, resetsAt }) => ({
    kind,
    percentUsed,
    ...(resetsAt === undefined ? {} : { resetsAt }),
  })),
  ...(cost === undefined ? {} : { costUsd: cost.usd }),
})

export const withHeadline = (reading: MeterReading, headline: HeadlineReading): MeterReading => ({
  ...reading,
  headline,
})

export const withBreakdown = (reading: MeterReading, breakdown: BreakdownReading): MeterReading => ({
  ...reading,
  breakdown,
  isStale: false,
})

export const markStale = (reading: MeterReading): MeterReading => ({ ...reading, isStale: true })

export const isBreakdownDue = (reading: MeterReading, now: number): boolean =>
  reading.breakdown === null || now - reading.breakdown.takenAt >= BREAKDOWN_REFRESH_MS
