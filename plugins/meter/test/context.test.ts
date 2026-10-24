import { expect, test } from 'claude-code/testing'

import { cacheHitPercent, contextBand, contextFill, fillPercent } from '../hooks/context'

const bandCases = [
  [69999, 'success'],
  [70000, 'warning'],
  [90000, 'warning'],
  [90001, 'error'],
] as const

for (const [tokens, color] of bandCases) {
  test(`It returns ${color} from contextBand for ${tokens} tokens against a threshold of 100000`, () => {
    expect(contextBand(contextFill(tokens, 200000, 100000))).toBe(color)
  })
}

test('It measures against the window in contextFill when no threshold is cached', () => {
  expect(contextFill(150000, 200000, undefined)).toBe(0.75)
})

test('It returns warning from contextBand for 150000 tokens against the 200000 window', () => {
  expect(contextBand(contextFill(150000, 200000, undefined))).toBe('warning')
})

test('It measures against the threshold in contextFill when one is cached', () => {
  expect(contextFill(150000, 200000, 167000)).toBeLessThan(0.9)
})

test('It returns 90 from fillPercent for 150000 tokens against a threshold of 167000', () => {
  expect(fillPercent(contextFill(150000, 200000, 167000))).toBe(90)
})

test('It returns 105 from fillPercent for 210000 tokens against a 200000 window', () => {
  expect(fillPercent(contextFill(210000, 200000, undefined))).toBe(105)
})

test('It returns error from contextBand for 210000 tokens against a 200000 window', () => {
  expect(contextBand(contextFill(210000, 200000, undefined))).toBe('error')
})

const usage = (input: number, read: number, created: number) => ({
  input_tokens: input,
  output_tokens: 500,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: created,
})

test('It returns 96 from cacheHitPercent for input 1000, cache read 96000 and cache creation 3000', () => {
  expect(cacheHitPercent(usage(1000, 96000, 3000))).toBe(96)
})

test('It returns 0 from cacheHitPercent when nothing was read from the cache', () => {
  expect(cacheHitPercent(usage(1000, 0, 3000))).toBe(0)
})

test('It rounds to a whole percent in cacheHitPercent', () => {
  expect(cacheHitPercent(usage(1, 2, 0))).toBe(67)
})

test('It returns null from cacheHitPercent when every count is 0', () => {
  expect(cacheHitPercent(usage(0, 0, 0))).toBeNull()
})

test('It returns null from cacheHitPercent when apiUsage is null', () => {
  expect(cacheHitPercent(null)).toBeNull()
})

test('It returns null from cacheHitPercent when apiUsage is missing', () => {
  expect(cacheHitPercent(undefined)).toBeNull()
})
