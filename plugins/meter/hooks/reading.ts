import type { ContextBreakdownDetail } from 'claude-code'

import type { BreakdownReading, HeadlineReading, MeterReading, RateLimitReading } from '../types'

export const BREAKDOWN_REFRESH_MS = 60_000

// $.session.usage takes no signal, so the meter stops waiting on a call after its deadline.
export const PLAIN_DEADLINE_MS = 30_000
export const SUMMARY_DEADLINE_MS = 30_000
// A full count sends one token-count request per tool and per memory file.
export const FULL_DEADLINE_MS = 180_000

const BREAKDOWN_DEADLINES_MS: Record<ContextBreakdownDetail, number> = {
  summary: SUMMARY_DEADLINE_MS,
  full: FULL_DEADLINE_MS,
}

export const deadlineFor = (call: 'plain' | ContextBreakdownDetail): number =>
  call === 'plain' ? PLAIN_DEADLINE_MS : BREAKDOWN_DEADLINES_MS[call]

export const timedOutAfter = (deadlineMs: number): Error => new Error(`timed out after ${deadlineMs / 1000}s`)

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
