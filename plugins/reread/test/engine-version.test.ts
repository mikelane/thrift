import { expect, test } from 'claude-code/testing'

import { isUntestedEngine, TESTED_THROUGH } from '../hooks/engine-version'

const untestedCases = [
  ['2.1.311', false],
  ['2.1.310', false],
  ['2.1.1', false],
  ['2.0.999', false],
  ['1.99.99', false],
  ['2.1.312', true],
  ['2.2.0', true],
  ['3.0.0', true],
  ['2.1.1000', true],
  ['2.1.311-dev', true],
  ['2.1.100-dev', true],
  [undefined, true],
  ['', true],
  ['2.1', true],
  ['2.1.x', true],
  ['v2.1.311', true],
  ['not a version', true],
] as const

test('It names 2.1.311 as the engine the plugin was tested through', () => {
  expect(TESTED_THROUGH).toBe('2.1.311')
})

for (const [base, expected] of untestedCases) {
  test(`It returns ${expected} from isUntestedEngine for ${JSON.stringify(base)}`, () => {
    expect(isUntestedEngine(base)).toBe(expected)
  })
}
