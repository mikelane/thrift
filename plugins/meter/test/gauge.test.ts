import { expect, test } from 'claude-code/testing'

import { GAUGE_WIDTH, fillHalfCells, gaugeFor, markerIndex } from '../hooks/gauge'

const expectedGauge = (filled: string, markerAt?: number): string => {
  const cells = [...filled.padEnd(GAUGE_WIDTH, '░')]
  if (markerAt !== undefined) cells[markerAt] = '│'
  return cells.join('')
}

test('It is 25 cells wide in GAUGE_WIDTH', () => {
  expect(GAUGE_WIDTH).toBe(25)
})

const halfCellCases = [
  [0, 0, 0],
  [0.009, 0, 0],
  [0.009, 1, 1],
  [0, 1, 1],
  [0.07, 0, 4],
  [149 / 967, 0, 8],
  [0.5, 0, 25],
  [1, 0, 50],
  [1.4, 0, 50],
  [-0.2, 0, 0],
] as const

for (const [share, minimum, expected] of halfCellCases) {
  test(`It returns ${expected} from fillHalfCells for share ${share} with minimum ${minimum}`, () => {
    expect(fillHalfCells(share, minimum)).toBe(expected)
  })
}

const markerCases = [
  [0, 0],
  [0.18, 5],
  [0.5, 13],
  [0.97, 24],
  [1, 24],
  [1.5, 24],
  [-1, 0],
] as const

for (const [share, expected] of markerCases) {
  test(`It returns cell ${expected} from markerIndex for elapsed share ${share}`, () => {
    expect(markerIndex(share)).toBe(expected)
  })
}

test('It draws only track in gaugeFor at share 0', () => {
  expect(gaugeFor(0)).toBe(expectedGauge(''))
})

test('It draws whole cells in gaugeFor at an even half-cell count', () => {
  expect(gaugeFor(0.07)).toBe(expectedGauge('██'))
})

test('It draws a half cell in gaugeFor at an odd half-cell count', () => {
  expect(gaugeFor(0.14)).toBe(expectedGauge('███▌'))
})

test('It keeps one half cell in gaugeFor under the minimum', () => {
  expect(gaugeFor(0.001, { minimumHalfCells: 1 })).toBe(expectedGauge('▌'))
})

test('It draws no fill in gaugeFor under one half cell without a minimum', () => {
  expect(gaugeFor(0.001)).toBe(expectedGauge(''))
})

test('It fills every cell in gaugeFor past 100 percent', () => {
  expect(gaugeFor(1.3)).toBe('█'.repeat(GAUGE_WIDTH))
})

test('It draws the marker in the track in gaugeFor', () => {
  expect(gaugeFor(0.07, { markerShare: 0.18 })).toBe(expectedGauge('██', 5))
})

test('It draws the marker over the fill in gaugeFor when usage reaches it', () => {
  expect(gaugeFor(0.5, { markerShare: 0.18 })).toBe('█████│' + '██████' + '▌' + '░'.repeat(12))
})

test('It clamps the marker to the first cell in gaugeFor at elapsed share 0', () => {
  expect(gaugeFor(0, { markerShare: 0 })).toBe(expectedGauge('', 0))
})

test('It clamps the marker to the last cell in gaugeFor at elapsed share 1', () => {
  expect(gaugeFor(0, { markerShare: 1 })).toBe(expectedGauge('', GAUGE_WIDTH - 1))
})

test('It draws exactly one marker in gaugeFor', () => {
  expect([...gaugeFor(0.3, { markerShare: 0.4 })].filter(cell => cell === '│')).toHaveLength(1)
})
