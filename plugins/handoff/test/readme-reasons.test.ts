import { expect, test } from 'claude-code/testing'

import { driftMessages, readmeReasons, reasonDrift } from '../hooks/readme-reasons'

const reasonRow = (cell: string) => `| \`trigger_values.reason\` | ${cell} |`

const cases: { name: string; readme: string; expected: string[] }[] = [
  { name: 'plain backticked values', readme: reasonRow('`backoff`, `not_now`, or `send_here`'), expected: ['backoff', 'not_now', 'send_here'] },
  {
    name: 'a value followed by parenthesized text',
    readme: reasonRow('`session_ended` (the session ended), `band_failed`'),
    expected: ['session_ended', 'band_failed'],
  },
  {
    name: 'backticks inside parentheses',
    readme: reasonRow('`session_ended` (you did not type `/clear`) or `backoff`'),
    expected: ['session_ended', 'backoff'],
  },
  {
    name: 'only the values after the colon, not a backticked word in the lead-in',
    readme: reasonRow('Present when it explains a `none`: `backoff`, `not_now`'),
    expected: ['backoff', 'not_now'],
  },
  {
    name: 'nested parentheses',
    readme: reasonRow('`a` (outer (inner `x`) `y`) and `b`'),
    expected: ['a', 'b'],
  },
]

for (const { name, readme, expected } of cases) {
  test(`It reads ${name} from the reason row`, () => {
    expect(readmeReasons(readme)).toEqual(expected)
  })
}

test('It ignores a held_groups row that names reasons in backticks', () => {
  const readme = ['| `trigger_values.held_groups` | on reason `handoff_failed` |', reasonRow('`backoff`')].join('\n')
  expect(readmeReasons(readme)).toEqual(['backoff'])
})

test('It reads only the second cell of the reason row', () => {
  const readme = '| `trigger_values.reason` | `backoff` | `extra_column` |'
  expect(readmeReasons(readme)).toEqual(['backoff'])
})

test('It returns the values in README order, whatever the order', () => {
  expect(readmeReasons(reasonRow('`z`, `a`, `m`'))).toEqual(['z', 'a', 'm'])
})

test('It throws when the README has more than one reason row', () => {
  const readme = [reasonRow('`backoff`'), reasonRow('`not_now`')].join('\n')
  expect(() => readmeReasons(readme)).toThrow('more than one')
})

test('It throws when the README has no reason row', () => {
  expect(() => readmeReasons('| `trigger_values.point` | `turn-end` |')).toThrow('trigger_values.reason')
})

const driftCases: { name: string; union: string[]; readme: string[]; expected: ReturnType<typeof reasonDrift> }[] = [
  { name: 'nothing when the two match', union: ['a', 'b'], readme: ['a', 'b'], expected: { missingFromReadme: [], missingFromUnion: [] } },
  { name: 'nothing when the two match in another order', union: ['a', 'b'], readme: ['b', 'a'], expected: { missingFromReadme: [], missingFromUnion: [] } },
  { name: 'a union member the README lacks', union: ['a', 'b'], readme: ['a'], expected: { missingFromReadme: ['b'], missingFromUnion: [] } },
  { name: 'a README value the union lacks', union: ['a'], readme: ['a', 'x'], expected: { missingFromReadme: [], missingFromUnion: ['x'] } },
  { name: 'both directions at once', union: ['a', 'b'], readme: ['b', 'x'], expected: { missingFromReadme: ['a'], missingFromUnion: ['x'] } },
  { name: 'a README value listed twice once', union: ['a'], readme: ['a', 'a', 'x', 'x'], expected: { missingFromReadme: [], missingFromUnion: ['x'] } },
  { name: 'every member when the README lists none', union: ['a', 'b'], readme: [], expected: { missingFromReadme: ['a', 'b'], missingFromUnion: [] } },
]

for (const { name, union, readme, expected } of driftCases) {
  test(`It reports ${name}`, () => {
    expect(reasonDrift(union, readme)).toEqual(expected)
  })
}

test('It writes no messages when nothing drifted', () => {
  expect(driftMessages({ missingFromReadme: [], missingFromUnion: [] })).toEqual([])
})

test('It writes one message per value missing from the README', () => {
  expect(driftMessages({ missingFromReadme: ['a', 'b'], missingFromUnion: [] })).toEqual([
    'DecisionReason has "a", but the README trigger_values.reason row does not list it.',
    'DecisionReason has "b", but the README trigger_values.reason row does not list it.',
  ])
})

test('It writes one message per value missing from the union', () => {
  expect(driftMessages({ missingFromReadme: [], missingFromUnion: ['x'] })).toEqual([
    'The README trigger_values.reason row lists "x", but DecisionReason does not have it.',
  ])
})

test('It writes the README-side messages before the union-side ones', () => {
  expect(driftMessages({ missingFromReadme: ['a'], missingFromUnion: ['x'] })).toHaveLength(2)
  expect(driftMessages({ missingFromReadme: ['a'], missingFromUnion: ['x'] })[0]).toContain('"a"')
})
