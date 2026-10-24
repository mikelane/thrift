import { expect, test } from 'claude-code/testing'

import {
  FIVE_HOURS_MS,
  SEVEN_DAYS_MS,
  TOO_EARLY_SHARE,
  elapsedShare,
  formatPace,
  isTooEarly,
  paceBand,
  paceOf,
  parseResetsAt,
  projectedExhaustion,
  windowLengthMs,
} from '../hooks/pace'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const NOW = Date.UTC(2026, 9, 20, 9, 0)

test('It returns 5 hours from windowLengthMs for five_hour', () => {
  expect(windowLengthMs('five_hour')).toBe(FIVE_HOURS_MS)
})

test('It returns 7 days from windowLengthMs for seven_day', () => {
  expect(windowLengthMs('seven_day')).toBe(SEVEN_DAYS_MS)
})

test('It returns undefined from windowLengthMs for spend_limit', () => {
  expect(windowLengthMs('spend_limit')).toBeUndefined()
})

test('It returns the millisecond time from parseResetsAt for an ISO timestamp', () => {
  expect(parseResetsAt('2026-10-20T09:00:00Z')).toBe(NOW)
})

test('It returns undefined from parseResetsAt when the timestamp is missing', () => {
  expect(parseResetsAt(undefined)).toBeUndefined()
})

test('It returns undefined from parseResetsAt when the timestamp is not a date', () => {
  expect(parseResetsAt('soon')).toBeUndefined()
})

const shareCases = [
  ['1h54m left of five hours', NOW + 114 * MINUTE, FIVE_HOURS_MS, 0.62],
  ['a full window left', NOW + FIVE_HOURS_MS, FIVE_HOURS_MS, 0],
  ['half the window left', NOW + 2.5 * HOUR, FIVE_HOURS_MS, 0.5],
  ['more than a window left (clock skew)', NOW + FIVE_HOURS_MS + HOUR, FIVE_HOURS_MS, 0],
] as const

for (const [name, resetsAt, windowMs, expected] of shareCases) {
  test(`It returns ${expected} from elapsedShare with ${name}`, () => {
    expect(Math.round((elapsedShare(resetsAt, NOW, windowMs) ?? NaN) * 1e9) / 1e9).toBe(expected)
  })
}

test('It returns undefined from elapsedShare when resetsAt is missing', () => {
  expect(elapsedShare(undefined, NOW, FIVE_HOURS_MS)).toBeUndefined()
})

test('It returns undefined from elapsedShare when resetsAt is one minute ago', () => {
  expect(elapsedShare(NOW - MINUTE, NOW, FIVE_HOURS_MS)).toBeUndefined()
})

test('It returns undefined from elapsedShare when resetsAt is now', () => {
  expect(elapsedShare(NOW, NOW, FIVE_HOURS_MS)).toBeUndefined()
})

test('It returns exactly 0.05 from elapsedShare with 4h45m left of five hours', () => {
  expect(elapsedShare(NOW + 285 * MINUTE, NOW, FIVE_HOURS_MS)).toBe(TOO_EARLY_SHARE)
})

test('It returns false from isTooEarly at exactly 0.05', () => {
  expect(isTooEarly(0.05)).toBe(false)
})

test('It returns true from isTooEarly with 4h46m left of five hours', () => {
  expect(isTooEarly(elapsedShare(NOW + 286 * MINUTE, NOW, FIVE_HOURS_MS) ?? 1)).toBe(true)
})

test('It returns 0.77 from paceOf for 48 percent with 62 percent elapsed', () => {
  expect(formatPace(paceOf(48, 0.62))).toBe('0.77')
})

test('It returns 1.66 from paceOf for 71 percent with 3 of 7 days elapsed', () => {
  expect(formatPace(paceOf(71, 3 / 7))).toBe('1.66')
})

test('It returns 2.00 from paceOf for 10 percent with 5 percent elapsed', () => {
  expect(formatPace(paceOf(10, 0.05))).toBe('2.00')
})

test('It returns two decimals from formatPace for a whole pace', () => {
  expect(formatPace(1)).toBe('1.00')
})

test('It rounds to two decimals in formatPace', () => {
  expect(formatPace(0.776)).toBe('0.78')
})

const bandCases = [
  [0.89, 'success'],
  [0.9, 'warning'],
  [1.0, 'warning'],
  [1.1, 'warning'],
  [1.104, 'error'],
  [2, 'error'],
] as const

for (const [pace, color] of bandCases) {
  test(`It returns ${color} from paceBand for pace ${pace}`, () => {
    expect(paceBand(pace)).toBe(color)
  })
}

test('It colors a pace that rounds to 1.10 from the unrounded value in paceBand', () => {
  expect(formatPace(1.104)).toBe('1.10')
  expect(paceBand(1.104)).toBe('error')
})

test('It returns now plus 29h24.5m from projectedExhaustion for 71 percent with 3 of 7 days elapsed', () => {
  const share = elapsedShare(NOW + 4 * 24 * HOUR, NOW, SEVEN_DAYS_MS) ?? 0
  expect(Math.round((projectedExhaustion(NOW, 71, share, SEVEN_DAYS_MS) ?? NaN) / 1000)).toBe(
    Math.round((NOW + 29 * HOUR + 24.5 * MINUTE) / 1000),
  )
})

test('It returns undefined from projectedExhaustion when pace is below 1', () => {
  expect(projectedExhaustion(NOW, 48, 0.62, FIVE_HOURS_MS)).toBeUndefined()
})

test('It returns undefined from projectedExhaustion when pace is exactly 1', () => {
  expect(projectedExhaustion(NOW, 50, 0.5, FIVE_HOURS_MS)).toBeUndefined()
})
