import { expect, test } from 'claude-code/testing'

import { clockLabel } from '../hooks/clock-label'

const MINUTE = 60_000
const TUESDAY_NINE = Date.UTC(2026, 9, 20, 9, 0)

const cases = [
  ['today in the afternoon', TUESDAY_NINE + 435 * MINUTE, 0, '4:15pm'],
  ['today in the morning', TUESDAY_NINE + 30 * MINUTE, 0, '9:30am'],
  ['just after midnight today', Date.UTC(2026, 9, 20, 0, 5), 0, '12:05am'],
  ['noon today', Date.UTC(2026, 9, 20, 12, 0), 0, '12:00pm'],
  ['another day', Date.UTC(2026, 9, 24, 9, 0), 0, 'Sat 9:00am'],
  ['tomorrow afternoon', Date.UTC(2026, 9, 21, 14, 25), 0, 'Wed 2:25pm'],
  ['29h24.5m later, half a minute rounding up', TUESDAY_NINE + 29 * 60 * MINUTE + 24.5 * MINUTE, 0, 'Wed 2:25pm'],
  ['29h24m29s later, rounding down', TUESDAY_NINE + 29 * 60 * MINUTE + 24 * MINUTE + 29_000, 0, 'Wed 2:24pm'],
  ['a rounding that crosses into the next hour', Date.UTC(2026, 9, 20, 10, 59, 45), 0, '11:00am'],
  ['a UTC offset of -420 minutes', Date.UTC(2026, 9, 20, 23, 0), -420, '4:00pm'],
  ['a UTC offset that moves the date', Date.UTC(2026, 9, 21, 2, 0), -420, '7:00pm'],
  ['a positive UTC offset on the same day', Date.UTC(2026, 9, 20, 9, 0), 540, '6:00pm'],
  ['the same instant as now', TUESDAY_NINE, 0, '9:00am'],
] as const

for (const [name, target, offset, expected] of cases) {
  test(`It returns ${expected} from clockLabel for ${name}`, () => {
    expect(clockLabel(target, TUESDAY_NINE, offset)).toBe(expected)
  })
}

test('It returns the day name when the local date differs only by the offset in clockLabel', () => {
  const now = Date.UTC(2026, 9, 20, 5, 0)
  expect(clockLabel(Date.UTC(2026, 9, 20, 12, 0), now, -420)).toBe('Tue 5:00am')
})

test('It returns the Sunday name from clockLabel', () => {
  expect(clockLabel(Date.UTC(2026, 9, 25, 9, 0), TUESDAY_NINE, 0)).toBe('Sun 9:00am')
})
