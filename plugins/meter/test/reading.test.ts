import { expect, test } from 'claude-code/testing'

import type { BreakdownReading, HeadlineReading } from '../types'
import {
  BREAKDOWN_REFRESH_MS,
  EMPTY_READING,
  headlineFrom,
  isBreakdownDue,
  markStale,
  withBreakdown,
  withHeadline,
} from '../hooks/reading'

const headline: HeadlineReading = { contextTokens: 100, contextWindow: 200, rateLimits: [], costUsd: 1 }
const breakdown: BreakdownReading = { takenAt: 1000, cacheHitPercent: 90, topRows: [], mcpServers: [] }

test('It starts with nothing read and nothing stale in EMPTY_READING', () => {
  expect(EMPTY_READING).toEqual({ headline: null, breakdown: null, isStale: false })
})

test('It copies tokens, window, rate limits and cost in headlineFrom', () => {
  expect(
    headlineFrom({
      context: { tokens: 150000, window: 200000 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 48, resetsAt: '2026-10-20T10:00:00Z' }],
      cost: { usd: 4.82 },
    }),
  ).toEqual({
    contextTokens: 150000,
    contextWindow: 200000,
    rateLimits: [{ kind: 'five_hour', percentUsed: 48, resetsAt: '2026-10-20T10:00:00Z' }],
    costUsd: 4.82,
  })
})

test('It leaves out tokens and cost in headlineFrom when the usage carries none', () => {
  expect(headlineFrom({ context: { window: 200000 }, rateLimits: [] })).toEqual({
    contextWindow: 200000,
    rateLimits: [],
  })
})

test('It never copies the breakdown in headlineFrom', () => {
  const context = { window: 1, breakdown: {} }
  const copied = headlineFrom({ context, rateLimits: [] })
  expect(Object.keys(copied)).not.toContain('breakdown')
})

test('It replaces the headline and keeps the breakdown in withHeadline', () => {
  const reading = withHeadline({ headline: null, breakdown, isStale: true }, headline)
  expect(reading).toEqual({ headline, breakdown, isStale: true })
})

test('It replaces the breakdown and clears the stale marker in withBreakdown', () => {
  const reading = withBreakdown({ headline, breakdown: null, isStale: true }, breakdown)
  expect(reading).toEqual({ headline, breakdown, isStale: false })
})

test('It keeps the figures and sets the stale marker in markStale', () => {
  expect(markStale({ headline, breakdown, isStale: false })).toEqual({ headline, breakdown, isStale: true })
})

test('It is due in isBreakdownDue when no breakdown was taken', () => {
  expect(isBreakdownDue(EMPTY_READING, 5)).toBe(true)
})

const dueCases = [
  [1000 + BREAKDOWN_REFRESH_MS - 1, false],
  [1000 + BREAKDOWN_REFRESH_MS, true],
  [1000 + BREAKDOWN_REFRESH_MS + 1, true],
] as const

for (const [now, expected] of dueCases) {
  test(`It returns ${expected} from isBreakdownDue ${now - 1000} ms after the breakdown`, () => {
    expect(isBreakdownDue({ headline, breakdown, isStale: false }, now)).toBe(expected)
  })
}
