import { expect, test } from 'claude-code/testing'

import { DECISION_REASONS } from '../hooks/decision-reasons'
import { driftExitCode, findReasonDrift, formatDriftMessages, parseReadmeReasons } from '../hooks/readme-reasons'

const reasonRow = (cell: string) => `| \`trigger_values.reason\` | ${cell} |`
const backticked = (values: readonly string[]) => values.map(value => `\`${value}\``).join(', ')

const NO_ROW = 'The README has no table row whose first cell is `trigger_values.reason`. Add one that lists every value in DECISION_REASONS.'
const rowsError = (count: number) =>
  `The README has ${count} table rows whose first cell is \`trigger_values.reason\`. Keep one and delete the others.`
const missingFromReadme = (reason: string) =>
  `"${reason}" is in DECISION_REASONS but not in the README's trigger_values.reason row. Add it to the row, or remove it from DECISION_REASONS.`
const missingFromUnion = (reason: string) =>
  `"${reason}" is in the README's trigger_values.reason row but not in DECISION_REASONS. Remove it from the row, or add it to DECISION_REASONS.`

const cases: { name: string; readme: string; expected: string[] }[] = [
  { name: 'plain backticked values', readme: reasonRow('`backoff`, `not_now`, or `send_here`'), expected: ['backoff', 'not_now', 'send_here'] },
  {
    name: 'a value followed by parenthesized text',
    readme: reasonRow('`session_ended` (the session ended), `band_failed`'),
    expected: ['session_ended', 'band_failed'],
  },
  {
    name: 'the values around backticks inside parentheses',
    readme: reasonRow('`session_ended` (you did not type `/clear`) or `backoff`'),
    expected: ['session_ended', 'backoff'],
  },
  {
    name: 'only the values after the colon, not a backticked word in the lead-in',
    readme: reasonRow('Present when it explains a `none`: `backoff`, `not_now`'),
    expected: ['backoff', 'not_now'],
  },
  {
    name: 'the values around nested parentheses',
    readme: reasonRow('`a` (outer (inner `x`) `y`) and `b`'),
    expected: ['a', 'b'],
  },
  {
    name: 'only the reason row values when a held_groups row names reasons in backticks',
    readme: ['| `trigger_values.held_groups` | on reason `first_read` |', reasonRow('`backoff`')].join('\n'),
    expected: ['backoff'],
  },
  {
    name: 'only the second cell of the reason row',
    readme: '| `trigger_values.reason` | `backoff` | `extra_column` |',
    expected: ['backoff'],
  },
  { name: 'the values in README order', readme: reasonRow('`z`, `a`, `m`'), expected: ['z', 'a', 'm'] },
  { name: 'an empty list when the reason row has no value cell', readme: '| `trigger_values.reason`', expected: [] },
  { name: 'an empty list when the value cell has no backticked values', readme: reasonRow('none yet'), expected: [] },
]

for (const { name, readme, expected } of cases) {
  test(`It returns ${name}`, () => {
    expect(parseReadmeReasons(readme)).toEqual(expected)
  })
}

const noRowCases: { name: string; readme: string }[] = [
  { name: 'is empty', readme: '' },
  { name: 'is prose with no table', readme: 'trigger_values.reason lists `backoff`.' },
  { name: 'has only other rows', readme: '| `trigger_values.point` | `turn-end` |' },
  { name: 'names the key outside the first cell', readme: '| `point` | `trigger_values.reason` |' },
  { name: 'names the key without backticks', readme: '| trigger_values.reason | `backoff` |' },
]

for (const { name, readme } of noRowCases) {
  test(`It throws the missing-row error when the README ${name}`, () => {
    expect(() => parseReadmeReasons(readme)).toThrow(NO_ROW)
  })
}

const extraRowCases: { count: number; readme: string }[] = [
  { count: 2, readme: [reasonRow('`backoff`'), reasonRow('`not_now`')].join('\n') },
  { count: 3, readme: [reasonRow('`backoff`'), reasonRow('`not_now`'), reasonRow('`send_here`')].join('\n') },
]

for (const { count, readme } of extraRowCases) {
  test(`It throws an error naming ${count} rows when the README has ${count} reason rows`, () => {
    expect(() => parseReadmeReasons(readme)).toThrow(rowsError(count))
  })
}

const driftCases: { name: string; union: string[]; readme: string[]; expected: ReturnType<typeof findReasonDrift> }[] = [
  { name: 'no drift when the two match', union: ['a', 'b'], readme: ['a', 'b'], expected: { missingFromReadme: [], missingFromUnion: [] } },
  { name: 'no drift when the two match in another order', union: ['a', 'b'], readme: ['b', 'a'], expected: { missingFromReadme: [], missingFromUnion: [] } },
  { name: 'a union member the README lacks', union: ['a', 'b'], readme: ['a'], expected: { missingFromReadme: ['b'], missingFromUnion: [] } },
  { name: 'a README value the union lacks', union: ['a'], readme: ['a', 'x'], expected: { missingFromReadme: [], missingFromUnion: ['x'] } },
  { name: 'drift in both directions at once', union: ['a', 'b'], readme: ['b', 'x'], expected: { missingFromReadme: ['a'], missingFromUnion: ['x'] } },
  { name: 'a README value listed twice only once', union: ['a'], readme: ['a', 'a', 'x', 'x'], expected: { missingFromReadme: [], missingFromUnion: ['x'] } },
  { name: 'a union member listed twice only once', union: ['a', 'b', 'b'], readme: ['a'], expected: { missingFromReadme: ['b'], missingFromUnion: [] } },
  { name: 'every member when the README lists none', union: ['a', 'b'], readme: [], expected: { missingFromReadme: ['a', 'b'], missingFromUnion: [] } },
]

for (const { name, union, readme, expected } of driftCases) {
  test(`It returns ${name}`, () => {
    expect(findReasonDrift(union, readme)).toEqual(expected)
  })
}

test('It keeps the values after an escaped pipe inside the cell', () => {
  expect(parseReadmeReasons(reasonRow('x: `backoff` (a \\| b), `not_now`'))).toEqual(['backoff', 'not_now'])
})

test('It reads a value that follows an escaped pipe and is missing from DECISION_REASONS', () => {
  const documented = parseReadmeReasons(reasonRow('x: `backoff` (a \\| b), `bogus_reason`'))
  expect(findReasonDrift(['backoff'], documented).missingFromUnion).toEqual(['bogus_reason'])
})

const exitCodeCases: { name: string; messages: string[]; expected: number }[] = [
  { name: 'no drift messages', messages: [], expected: 0 },
  { name: 'one drift message', messages: ['a'], expected: 1 },
  { name: 'several drift messages', messages: ['a', 'b', 'c'], expected: 1 },
]

for (const { name, messages, expected } of exitCodeCases) {
  test(`It returns exit code ${expected} for ${name}`, () => {
    expect(driftExitCode(messages)).toBe(expected)
  })
}

test('It returns no messages when nothing drifted', () => {
  expect(formatDriftMessages({ missingFromReadme: [], missingFromUnion: [] })).toEqual([])
})

test('It returns one message per value missing from the README', () => {
  expect(formatDriftMessages({ missingFromReadme: ['a', 'b'], missingFromUnion: [] })).toEqual([missingFromReadme('a'), missingFromReadme('b')])
})

test('It returns one message per value missing from the union', () => {
  expect(formatDriftMessages({ missingFromReadme: [], missingFromUnion: ['x'] })).toEqual([missingFromUnion('x')])
})

test('It returns the README-side messages before the union-side ones', () => {
  expect(formatDriftMessages({ missingFromReadme: ['a'], missingFromUnion: ['x'] })).toEqual([missingFromReadme('a'), missingFromUnion('x')])
})

test('It returns DECISION_REASONS with no value listed twice', () => {
  expect(new Set(DECISION_REASONS).size).toBe(DECISION_REASONS.length)
})

test('It returns a message naming a DECISION_REASONS value that the README row drops', () => {
  const [dropped = '', ...kept] = DECISION_REASONS
  const readme = reasonRow(`Present when it explains a \`none\`: ${backticked(kept)}`)
  expect(formatDriftMessages(findReasonDrift(DECISION_REASONS, parseReadmeReasons(readme)))).toEqual([missingFromReadme(dropped)])
})

test('It returns a message naming a README row value that DECISION_REASONS lacks', () => {
  const readme = reasonRow(`Present when it explains a \`none\`: ${backticked([...DECISION_REASONS, 'not_a_reason'])}`)
  expect(formatDriftMessages(findReasonDrift(DECISION_REASONS, parseReadmeReasons(readme)))).toEqual([missingFromUnion('not_a_reason')])
})

test('It returns no messages when the README row lists every DECISION_REASONS value', () => {
  const readme = reasonRow(`Present when it explains a \`none\`: ${backticked([...DECISION_REASONS].reverse())}`)
  expect(formatDriftMessages(findReasonDrift(DECISION_REASONS, parseReadmeReasons(readme)))).toEqual([])
})
