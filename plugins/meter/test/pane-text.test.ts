import { expect, test } from 'claude-code/testing'

import type { BreakdownReading, HeadlineReading } from '../types'
import {
  contextDetailText,
  contextRowText,
  costRowText,
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

test('It draws tokens, window and fill against the threshold in contextRowText', () => {
  expect(contextRowText(headline(142000), 167000, 'unicode')).toEqual({
    text: '◔ CONTEXT   142k / 200k   85% of 167k',
    color: 'warning',
  })
})

test('It draws the fill against the window in contextRowText when no threshold is cached', () => {
  expect(contextRowText(headline(150000), undefined, 'unicode')).toEqual({
    text: '◔ CONTEXT   150k / 200k   75% of 200k',
    color: 'warning',
  })
})

test('It draws 105 percent in red in contextRowText over the window', () => {
  expect(contextRowText(headline(210000), undefined, 'unicode')).toMatchObject({
    text: '◔ CONTEXT   210k / 200k   105% of 200k',
    color: 'error',
  })
})

test('It draws green in contextRowText well under the threshold', () => {
  expect(contextRowText(headline(20000), undefined, 'unicode').color).toBe('success')
})

test('It waits uncolored in contextRowText when the context has no tokens', () => {
  expect(contextRowText(headline(undefined), undefined, 'unicode')).toEqual({
    text: '◔ CONTEXT   waiting for first response',
  })
})

test('It waits in contextRowText when the tokens are 0', () => {
  expect(contextRowText(headline(0), 167000, 'unicode').text).toContain('waiting for first response')
})

test('It draws the nerd glyph in contextRowText', () => {
  expect(contextRowText(headline(1000), undefined, 'nerd').text).toStartWith('\u{F1C0} CONTEXT')
})

test('It joins compacts at and cache hit in contextDetailText', () => {
  expect(contextDetailText(breakdown({ compactsAt: 167000 }))).toBe('compacts at 167k  ·  cache hit 96%')
})

test('It leaves out compacts at in contextDetailText when auto-compact is off', () => {
  expect(contextDetailText(breakdown())).toBe('cache hit 96%')
})

test('It reads cache hit with a dash in contextDetailText when no figure exists', () => {
  expect(contextDetailText(breakdown({ cacheHitPercent: null }))).toBe('cache hit —')
})

test('It reads cache hit with a dash in contextDetailText before any breakdown', () => {
  expect(contextDetailText(null)).toBe('cache hit —')
})

test('It draws the cost to cents in costRowText', () => {
  expect(costRowText(headline(1, { costUsd: 4.8213 }), 'unicode')).toBe('¢ COST   $4.82 this session')
})

test('It draws a cost of zero in costRowText when the ledger reports one', () => {
  expect(costRowText(headline(1, { costUsd: 0 }), 'unicode')).toBe('¢ COST   $0.00 this session')
})

test('It returns undefined from costRowText when usage carries no cost', () => {
  expect(costRowText(headline(1), 'unicode')).toBeUndefined()
})

const paced: WindowView = {
  state: 'paced',
  label: '5-HOUR',
  slot: 'fiveHour',
  percentText: '48',
  elapsedPercent: 62,
  paceText: '0.77',
  color: 'success',
  resetsLabel: '4:15pm',
}

test('It draws the percent, elapsed share, pace and reset in windowRowTexts', () => {
  expect(windowRowTexts(paced, 'unicode')).toEqual([
    { text: '◷ 5-HOUR   48%  ·  62% of window elapsed', color: 'success' },
    { text: 'pace 0.77×  ●  resets 4:15pm', color: 'success' },
  ])
})

test('It draws the projection before the reset in windowRowTexts', () => {
  const [, second] = windowRowTexts(
    { ...paced, label: 'WEEKLY', slot: 'weekly', paceText: '1.66', color: 'error', projection: 'Wed 2:25pm', resetsLabel: 'Sat 9:00am' },
    'unicode',
  )
  expect(second?.text).toBe('pace 1.66×  ●  hits 100% Wed 2:25pm, resets Sat 9:00am')
})

test('It draws the weekly glyph in windowRowTexts', () => {
  const [first] = windowRowTexts({ ...paced, label: 'WEEKLY', slot: 'weekly' }, 'nerd')
  expect(first?.text).toStartWith('\u{F073} WEEKLY')
})

test('It draws too early uncolored in windowRowTexts', () => {
  expect(windowRowTexts({ state: 'too-early', label: '5-HOUR', slot: 'fiveHour', percentText: '10' }, 'unicode')).toEqual([
    { text: '◷ 5-HOUR   10%  ·  too early' },
  ])
})

test('It draws a plain window with only its percent in windowRowTexts', () => {
  expect(windowRowTexts({ state: 'plain', label: '5-HOUR', slot: 'fiveHour', percentText: '30' }, 'unicode')).toEqual([
    { text: '◷ 5-HOUR   30%' },
  ])
})

test('It draws a spend limit without a glyph and in red in windowRowTexts at its limit', () => {
  expect(windowRowTexts({ state: 'plain', label: 'SPEND LIMIT', percentText: '104.5', color: 'error' }, 'unicode')).toEqual([
    { text: 'SPEND LIMIT   104.5%', color: 'error' },
  ])
})

test('It draws limit reached with its glyph and reset time in windowRowTexts', () => {
  expect(
    windowRowTexts(
      { state: 'limit-reached', label: '5-HOUR', slot: 'fiveHour', percentText: '100', color: 'error', resetsLabel: '9:40am' },
      'unicode',
    ),
  ).toEqual([{ text: '◷ 5-HOUR   100%  ·  ✕ limit reached  ·  resets 9:40am', color: 'error' }])
})

test('It draws limit reached with the nerd glyph and no reset time in windowRowTexts', () => {
  const [first] = windowRowTexts(
    { state: 'limit-reached', label: '5-HOUR', slot: 'fiveHour', percentText: '100', color: 'error' },
    'nerd',
  )
  expect(first?.text).toBe('\u{F017} 5-HOUR   100%  ·  \u{F05E} limit reached')
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
