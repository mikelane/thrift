import { expect, test } from 'claude-code/testing'

import { TESTED_THROUGH, isUntestedEngine } from '../hooks/engine-version'

const untestedCases = [
  ['2.1.295', '2.1.295', false],
  ['2.1.294', '2.1.295', false],
  ['2.0.999', '2.1.295', false],
  ['1.99.99', '2.1.295', false],
  ['2.1.296', '2.1.295', true],
  ['2.2.0', '2.1.295', true],
  ['3.0.0', '2.1.295', true],
  ['2.1.1000', '2.1.295', true],
  ['2.1.295-dev', '2.1.295', true],
  ['2.1.100-dev', '2.1.295', true],
  [undefined, '2.1.295', true],
  ['', '2.1.295', true],
  ['2.1', '2.1.295', true],
  ['2.1.x', '2.1.295', true],
  ['v2.1.295', '2.1.295', true],
  ['2.1.295-beta', '2.1.295', true],
  ['not a version', '2.1.295', true],
] as const

for (const [base, testedThrough, expected] of untestedCases) {
  test(`It returns ${expected} from isUntestedEngine for ${JSON.stringify(base)} against ${testedThrough}`, () => {
    expect(isUntestedEngine(base, testedThrough)).toBe(expected)
  })
}

test('It compares against TESTED_THROUGH when no version is given to isUntestedEngine', () => {
  expect(isUntestedEngine(TESTED_THROUGH)).toBe(false)
})

test('It names a release version in TESTED_THROUGH', () => {
  expect(TESTED_THROUGH).toMatch(/^\d+\.\d+\.\d+$/)
})
