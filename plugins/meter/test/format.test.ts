import { expect, test } from 'claude-code/testing'

import { ageLabel, barFor, formatPercent, formatTokens } from '../hooks/format'

const tokenCases = [
  [142000, '142k'],
  [200000, '200k'],
  [8000, '8k'],
  [1499, '1k'],
  [1500, '2k'],
  [999, '999'],
  [0, '0'],
] as const

for (const [tokens, expected] of tokenCases) {
  test(`It returns ${expected} from formatTokens for ${tokens}`, () => {
    expect(formatTokens(tokens)).toBe(expected)
  })
}

const ageCases = [
  [0, '0s ago'],
  [30_000, '30s ago'],
  [59_000, '59s ago'],
  [59_999, '59s ago'],
  [60_000, '1m ago'],
  [59 * 60_000, '59m ago'],
  [60 * 60_000, '1h ago'],
  [150 * 60_000, '2h ago'],
] as const

for (const [elapsed, expected] of ageCases) {
  test(`It returns ${expected} from ageLabel for ${elapsed} ms`, () => {
    expect(ageLabel(elapsed)).toBe(expected)
  })
}

test('It returns 0s ago from ageLabel when the clock reads before the breakdown', () => {
  expect(ageLabel(-5000)).toBe('0s ago')
})

const barCases = [
  [88000, 88000, '██████'],
  [21000, 88000, '█▌'],
  [14000, 88000, '█'],
  [8000, 88000, '▌'],
  [6000, 88000, '▌'],
  [1, 88000, '▌'],
  [0, 88000, ''],
  [5, 0, ''],
] as const

for (const [tokens, largest, expected] of barCases) {
  test(`It returns ${JSON.stringify(expected)} from barFor for ${tokens} against ${largest}`, () => {
    expect(barFor(tokens, largest)).toBe(expected)
  })
}

const percentCases = [
  [48, '48'],
  [99.9, '99.9'],
  [100, '100'],
  [104.5, '104.5'],
  [23.456, '23.5'],
  [0, '0'],
] as const

for (const [percent, expected] of percentCases) {
  test(`It returns ${expected} from formatPercent for ${percent}`, () => {
    expect(formatPercent(percent)).toBe(expected)
  })
}
