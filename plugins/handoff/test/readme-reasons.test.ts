import { expect, test } from 'claude-code/testing'

import { readmeReasons } from '../hooks/readme-reasons'

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

test('It throws when the README has no reason row', () => {
  expect(() => readmeReasons('| `trigger_values.point` | `turn-end` |')).toThrow('trigger_values.reason')
})
