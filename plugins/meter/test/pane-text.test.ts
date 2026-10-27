import { expect, test } from 'claude-code/testing'

import type { BreakdownReading, HeadlineReading } from '../types'
import {
  contextDetailText,
  contextGaugeText,
  contextRowText,
  costRowText,
  headerLine,
  mcpServersRowText,
  topContextRowTexts,
  windowRowTexts,
} from '../hooks/pane-text'
import type { WindowView } from '../hooks/window-view'

const headline = (contextTokens: number | undefined, extra: Partial<HeadlineReading> = {}): HeadlineReading => ({
  contextTokens,
  contextWindow: 200000,
  rateLimits: [],
  ...extra,
})

const breakdown = (extra: Partial<BreakdownReading> = {}): BreakdownReading => ({
  takenAt: 0,
  cacheHitPercent: 96,
  topRows: [],
  mcpServers: [],
  ...extra,
})

const gauge = (filled: string, markerAt?: number): string => {
  const cells = [...filled.padEnd(25, '░')]
  if (markerAt !== undefined) cells[markerAt] = '│'
  return cells.join('')
}

test('It right-aligns the second part to 30 columns in headerLine', () => {
  expect(headerLine('◔ CONTEXT', '149k / 1M')).toBe('◔ CONTEXT            149k / 1M')
})

test('It pads to exactly 30 columns in headerLine when the parts leave a two-space gap', () => {
  expect(headerLine('A', 'b'.repeat(27))).toBe(`A  ${'b'.repeat(27)}`)
})

test('It keeps two spaces between the parts in headerLine when they overflow', () => {
  expect(headerLine('◔ CONTEXT', 'waiting for first response')).toBe('◔ CONTEXT  waiting for first response')
})

test('It draws tokens and window colored by the threshold fill in contextRowText', () => {
  expect(contextRowText(headline(142000), 167000, 'unicode')).toEqual({
    text: '◔ CONTEXT          142k / 200k',
    color: 'warning',
  })
})

test('It draws the million window as 1M in contextRowText', () => {
  expect(contextRowText(headline(149000, { contextWindow: 1000000 }), 967000, 'unicode').text).toBe(
    '◔ CONTEXT            149k / 1M',
  )
})

test('It colors by the window in contextRowText when no threshold is cached', () => {
  expect(contextRowText(headline(150000), undefined, 'unicode').color).toBe('warning')
})

test('It draws red in contextRowText over the window', () => {
  expect(contextRowText(headline(210000), undefined, 'unicode').color).toBe('error')
})

test('It draws green in contextRowText well under the threshold', () => {
  expect(contextRowText(headline(20000), undefined, 'unicode').color).toBe('success')
})

test('It waits uncolored in contextRowText when the context has no tokens', () => {
  expect(contextRowText(headline(undefined), undefined, 'unicode')).toEqual({
    text: '◔ CONTEXT  waiting for first response',
  })
})

test('It waits in contextRowText when the tokens are 0', () => {
  expect(contextRowText(headline(0), 167000, 'unicode')).toEqual({ text: '◔ CONTEXT  waiting for first response' })
})

test('It draws the nerd glyph in contextRowText', () => {
  expect(contextRowText(headline(1000), undefined, 'nerd').text).toStartWith('\u{F1C0} CONTEXT')
})

test('It fills to the threshold share and appends the percent in contextGaugeText', () => {
  expect(contextGaugeText(headline(149000, { contextWindow: 1000000 }), 967000)).toEqual({
    text: `${gauge('████')}  15%`,
    color: 'success',
  })
})

test('It colors the gauge by the context band in contextGaugeText', () => {
  expect(contextGaugeText(headline(142000), 167000)?.color).toBe('warning')
})

test('It keeps one half cell in contextGaugeText for a sliver of context', () => {
  expect(contextGaugeText(headline(1), undefined)?.text).toBe(`${gauge('▌')}  0%`)
})

test('It fills the whole gauge in contextGaugeText over the window', () => {
  expect(contextGaugeText(headline(210000), undefined)).toEqual({ text: `${'█'.repeat(25)}  105%`, color: 'error' })
})

test('It returns undefined from contextGaugeText when the context has no tokens', () => {
  expect(contextGaugeText(headline(undefined), undefined)).toBeUndefined()
})

test('It returns undefined from contextGaugeText when the tokens are 0', () => {
  expect(contextGaugeText(headline(0), 167000)).toBeUndefined()
})

test('It joins compacts and cache in contextDetailText', () => {
  expect(contextDetailText(breakdown({ compactsAt: 967000 }))).toBe('compacts 967k · cache 96%')
})

test('It leaves out compacts in contextDetailText when auto-compact is off', () => {
  expect(contextDetailText(breakdown())).toBe('cache 96%')
})

test('It reads cache with a dash in contextDetailText when no figure exists', () => {
  expect(contextDetailText(breakdown({ cacheHitPercent: null }))).toBe('cache —')
})

test('It reads cache with a dash in contextDetailText before any breakdown', () => {
  expect(contextDetailText(null)).toBe('cache —')
})

test('It draws the cost to cents as an API-rate estimate in costRowText', () => {
  expect(costRowText(headline(1, { costUsd: 79.9 }), 'unicode')).toBe('¢ COST     $79.90 at API rates')
})

test('It draws a cost of zero in costRowText when the ledger reports one', () => {
  expect(costRowText(headline(1, { costUsd: 0 }), 'unicode')).toBe('¢ COST      $0.00 at API rates')
})

test('It never says this session in costRowText', () => {
  expect(costRowText(headline(1, { costUsd: 4.8213 }), 'unicode')).not.toContain('this session')
})

test('It returns undefined from costRowText when usage carries no cost', () => {
  expect(costRowText(headline(1), 'unicode')).toBeUndefined()
})

const paced: WindowView = {
  state: 'paced',
  label: '5-HOUR',
  slot: 'fiveHour',
  percentText: '7',
  percentUsed: 7,
  elapsedShare: 0.18,
  paceText: '0.39',
  color: 'success',
  resetsLabel: 'Tue 2:10am',
}

test('It draws header, gauge with the marker and reset line in windowRowTexts', () => {
  expect(windowRowTexts(paced, 'unicode')).toEqual([
    { text: headerLine('◷ 5-HOUR', '7% · 0.39×'), color: 'success' },
    { text: gauge('██', 5), color: 'success' },
    { text: 'resets Tue 2:10am', dim: true },
  ])
})

test('It adds the projection after the reset in windowRowTexts', () => {
  const [, , detail] = windowRowTexts({ ...paced, projection: 'Wed 2:25pm', color: 'error' }, 'unicode')
  expect(detail?.text).toBe('resets Tue 2:10am · hits 100% Wed 2:25pm')
})

test('It draws the marker over the fill in windowRowTexts when usage passes the elapsed share', () => {
  const [, gaugeRow] = windowRowTexts({ ...paced, percentText: '50', percentUsed: 50 }, 'unicode')
  expect(gaugeRow?.text).toBe('█████│' + '██████' + '▌' + '░'.repeat(12))
})

test('It draws the weekly glyph in windowRowTexts', () => {
  const [first] = windowRowTexts({ ...paced, label: 'WEEKLY', slot: 'weekly' }, 'nerd')
  expect(first?.text).toStartWith('\u{F073} WEEKLY')
})

test('It draws too early with a markerless gauge and no color in windowRowTexts', () => {
  expect(
    windowRowTexts({ state: 'too-early', label: '5-HOUR', slot: 'fiveHour', percentText: '10', percentUsed: 10 }, 'unicode'),
  ).toEqual([{ text: headerLine('◷ 5-HOUR', '10%') }, { text: gauge('██▌') }, { text: 'too early', dim: true }])
})

test('It draws a plain window with only header and gauge in windowRowTexts', () => {
  expect(
    windowRowTexts({ state: 'plain', label: '5-HOUR', slot: 'fiveHour', percentText: '30', percentUsed: 30 }, 'unicode'),
  ).toEqual([{ text: headerLine('◷ 5-HOUR', '30%') }, { text: gauge('███████▌') }])
})

test('It draws a spend limit without a glyph and in red in windowRowTexts at its limit', () => {
  const [header, gaugeRow] = windowRowTexts(
    { state: 'plain', label: 'SPEND LIMIT', percentText: '104.5', percentUsed: 104.5, color: 'error' },
    'unicode',
  )
  expect(header).toEqual({ text: headerLine('SPEND LIMIT', '104.5%'), color: 'error' })
  expect(gaugeRow).toEqual({ text: '█'.repeat(25), color: 'error' })
})

test('It draws limit reached as a full red gauge with its reset time in windowRowTexts', () => {
  expect(
    windowRowTexts(
      { state: 'limit-reached', label: '5-HOUR', slot: 'fiveHour', percentText: '100', percentUsed: 100, color: 'error', resetsLabel: '9:40am' },
      'unicode',
    ),
  ).toEqual([
    { text: headerLine('◷ 5-HOUR', '100%'), color: 'error' },
    { text: '█'.repeat(25), color: 'error' },
    { text: '✕ limit reached · resets 9:40am', color: 'error' },
  ])
})

test('It draws limit reached with the nerd glyph and no reset time in windowRowTexts', () => {
  const [, , detail] = windowRowTexts(
    { state: 'limit-reached', label: '5-HOUR', slot: 'fiveHour', percentText: '100', percentUsed: 100, color: 'error' },
    'nerd',
  )
  expect(detail?.text).toBe('\u{F05E} limit reached')
})

test('It aligns names, tokens and bars in topContextRowTexts', () => {
  expect(
    topContextRowTexts([
      { name: 'Messages', tokens: 88000 },
      { name: 'MCP tools', tokens: 21000 },
      { name: 'Custom agents', tokens: 14000 },
      { name: 'Skills', tokens: 8000 },
      { name: 'Memory files', tokens: 6000 },
    ]),
  ).toEqual([
    'Messages       88k ━━━━━━━━━━',
    'MCP tools      21k ━━',
    'Custom agents  14k ━━',
    'Skills          8k ━',
    'Memory files    6k ━',
  ])
})

test('It draws no bar in topContextRowTexts for a row with 0 tokens', () => {
  expect(topContextRowTexts([{ name: 'Messages', tokens: 5000 }, { name: 'Skills', tokens: 0 }])).toEqual([
    'Messages   5k ━━━━━━━━━━',
    'Skills      0',
  ])
})

test('It returns nothing from topContextRowTexts when no category is used', () => {
  expect(topContextRowTexts([])).toEqual([])
})

test('It prefixes the glyph in mcpServersRowText', () => {
  expect(mcpServersRowText([{ name: 'github', tokens: 9000 }, { name: 'ha', tokens: 6000 }], 'unicode')).toBe(
    '⬡ mcp servers: github 9k, ha 6k',
  )
})

test('It draws the nerd glyph first in mcpServersRowText', () => {
  expect(mcpServersRowText([{ name: 'github', tokens: 3000 }], 'nerd')).toBe('\u{F1E6} mcp servers: github 3k')
})

test('It returns undefined from mcpServersRowText when no server is loaded', () => {
  expect(mcpServersRowText([], 'unicode')).toBeUndefined()
})
