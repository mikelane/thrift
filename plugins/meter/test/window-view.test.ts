import { expect, test } from 'claude-code/testing'

import { windowView } from '../hooks/window-view'

const MINUTE = 60_000
const NOW = Date.UTC(2026, 9, 20, 9, 0)
const after = (minutes: number): string => new Date(NOW + minutes * MINUTE).toISOString()
const view = (kind: string, percentUsed: number, resetsAt?: string) =>
  windowView({ kind, percentUsed, resetsAt }, NOW, 0)

test('It returns a green pace of 0.77 from windowView for 48 percent with 1h54m left of five hours', () => {
  expect(view('five_hour', 48, after(114))).toMatchObject({
    state: 'paced',
    label: '5-HOUR',
    slot: 'fiveHour',
    percentText: '48',
    elapsedPercent: 62,
    paceText: '0.77',
    color: 'success',
    resetsLabel: '10:54am',
  })
})

test('It shows no projection from windowView when pace is below 1', () => {
  expect(view('five_hour', 48, after(114)).projection).toBeUndefined()
})

test('It returns a red pace of 1.66 with a projection from windowView for 71 percent of the week', () => {
  expect(view('seven_day', 71, after(4 * 24 * 60))).toMatchObject({
    state: 'paced',
    label: 'WEEKLY',
    slot: 'weekly',
    percentText: '71',
    elapsedPercent: 43,
    paceText: '1.66',
    color: 'error',
    projection: 'Wed 2:25pm',
    resetsLabel: 'Sat 9:00am',
  })
})

test('It judges exactly 5 percent elapsed in windowView', () => {
  expect(view('five_hour', 10, after(285))).toMatchObject({ state: 'paced', paceText: '2.00', color: 'error' })
})

test('It returns too early from windowView under 5 percent elapsed', () => {
  expect(view('five_hour', 10, after(286))).toEqual({
    state: 'too-early',
    label: '5-HOUR',
    slot: 'fiveHour',
    percentText: '10',
  })
})

test('It returns a plain row from windowView when resetsAt is one minute ago', () => {
  expect(view('five_hour', 30, after(-1))).toEqual({
    state: 'plain',
    label: '5-HOUR',
    slot: 'fiveHour',
    percentText: '30',
  })
})

test('It returns a plain row from windowView when resetsAt is missing', () => {
  expect(view('five_hour', 30)).toEqual({ state: 'plain', label: '5-HOUR', slot: 'fiveHour', percentText: '30' })
})

test('It returns a plain row from windowView when resetsAt is not a date', () => {
  expect(view('seven_day', 30, 'later').state).toBe('plain')
})

test('It returns limit reached in red with its reset time from windowView at 100 percent', () => {
  expect(view('five_hour', 100, after(40))).toEqual({
    state: 'limit-reached',
    label: '5-HOUR',
    slot: 'fiveHour',
    percentText: '100',
    color: 'error',
    resetsLabel: '9:40am',
  })
})

test('It returns limit reached from windowView at 100 percent even with a pace that would be green', () => {
  expect(view('seven_day', 100, after(60)).paceText).toBeUndefined()
})

test('It returns limit reached with no reset time from windowView when resetsAt is missing', () => {
  expect(view('five_hour', 100)).toEqual({
    state: 'limit-reached',
    label: '5-HOUR',
    slot: 'fiveHour',
    percentText: '100',
    color: 'error',
  })
})

test('It returns limit reached with no reset time from windowView when resetsAt is in the past', () => {
  expect(view('seven_day', 100, after(-5)).resetsLabel).toBeUndefined()
})

test('It returns limit reached from windowView when usage is past 100 percent', () => {
  expect(view('seven_day', 103.2, after(60))).toMatchObject({ state: 'limit-reached', percentText: '103.2' })
})

const spendCases = [
  [99.9, 'uncolored', {}],
  [100, 'error', { color: 'error' }],
  [104.5, 'error', { color: 'error' }],
] as const

for (const [used, name, colorFields] of spendCases) {
  test(`It returns ${name} from windowView for a spend_limit at ${used} percent`, () => {
    expect(view('spend_limit', used, after(60))).toEqual({
      state: 'plain',
      label: 'SPEND LIMIT',
      percentText: String(used),
      ...colorFields,
    })
  })
}

test('It names an unknown window kind in capitals without a glyph slot in windowView', () => {
  expect(view('monthly_cap', 5)).toEqual({ state: 'plain', label: 'MONTHLY CAP', percentText: '5' })
})

test('It returns warning from windowView when pace is exactly 0.9 at 8.1 percent after 27 minutes', () => {
  expect(view('five_hour', 8.1, after(273)).color).toBe('warning')
})

test('It shows no projection from windowView when pace is exactly 1 at 29 percent after 87 minutes', () => {
  expect(view('five_hour', 29, after(213)).projection).toBeUndefined()
})
