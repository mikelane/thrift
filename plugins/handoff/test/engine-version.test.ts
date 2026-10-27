import { expect, test } from 'claude-code/testing'

import { isUntestedEngine } from '../hooks/engine-version'

const untestedCases = [
  ['2.1.295', false],
  ['2.1.294', false],
  ['2.0.999', false],
  ['1.99.99', false],
  ['2.1.296', false],
  ['2.1.311', false],
  ['2.2.0', false],
  ['3.0.0', false],
  ['2.1.1000', false],
  ['2.1.295-dev', true],
  ['2.1.100-dev', true],
  [undefined, true],
  ['', true],
  ['2.1', true],
  ['2.1.x', true],
  ['v2.1.295', true],
  ['2.1.295-beta', true],
  ['not a version', true],
] as const

for (const [base, expected] of untestedCases) {
  test(`It returns ${expected} from isUntestedEngine for ${JSON.stringify(base)}`, () => {
    expect(isUntestedEngine(base)).toBe(expected)
  })
}
