import { expect, test } from 'claude-code/testing'

import { isUnsupportedEngine, MINIMUM_ENGINE } from '../hooks/engine-version'

const isUnsupportedEngineCases = [
  ['2.1.308', false],
  ['2.1.307', true],
  ['2.1.1', true],
  ['2.0.999', true],
  ['1.9.400', true],
  ['1.99.99', true],
  ['2.1.309', false],
  ['2.1.332', false],
  ['2.1.333', false],
  ['2.1.999', false],
  ['2.1.1000', false],
  ['2.2.0', false],
  ['3.0.0', false],
  ['2.1.308-dev', true],
  ['2.1.332-dev', true],
  ['2.1.333-dev', true],
  ['2.1.100-dev', true],
  [' 2.1.332', true],
  [undefined, true],
  ['', true],
  ['2.1', true],
  ['2.1.x', true],
  ['v2.1.311', true],
  ['not a version', true],
] as const

test('It names 2.1.308 as the oldest engine the plugin runs on', () => {
  expect(MINIMUM_ENGINE).toBe('2.1.308')
})

for (const [base, expected] of isUnsupportedEngineCases) {
  test(`It returns ${expected} from isUnsupportedEngine for ${JSON.stringify(base)}`, () => {
    expect(isUnsupportedEngine(base)).toBe(expected)
  })
}
