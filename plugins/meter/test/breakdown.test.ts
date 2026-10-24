import { expect, test } from 'claude-code/testing'
import type { ContextCategory, ContextMcpTool, SessionContextBreakdown } from 'claude-code'

import { mcpServerTotals, mcpServersLine, snapshotBreakdown, topCategories } from '../hooks/breakdown'

const category = (name: string, tokens: number, kind: ContextCategory['kind'] = 'used'): ContextCategory => ({
  name,
  tokens,
  color: 'text',
  isDeferred: kind === 'deferred',
  kind,
})

const tool = (serverName: string, tokens: number, isLoaded = true): ContextMcpTool => ({
  name: `mcp__${serverName}__tool`,
  serverName,
  tokens,
  isLoaded,
})

const names = (rows: readonly { name: string }[]) => rows.map(row => row.name)

const LISTED = [
  category('System prompt', 4000),
  category('Messages', 88000),
  category('Skills', 8000),
  category('Free space', 40000, 'free'),
  category('MCP tools', 21000),
  category('Autocompact buffer', 33000, 'buffer'),
  category('Custom agents', 14000),
  category('Memory files', 6000),
]

test('It lists used categories largest first in topCategories', () => {
  expect(names(topCategories(LISTED))).toEqual(['Messages', 'MCP tools', 'Custom agents', 'Skills', 'Memory files'])
})

test('It leaves out free and buffer categories in topCategories', () => {
  expect(names(topCategories(LISTED))).not.toContain('Free space')
  expect(names(topCategories(LISTED))).not.toContain('Autocompact buffer')
})

test('It lists at most five categories in topCategories', () => {
  expect(topCategories(LISTED)).toHaveLength(5)
})

test('It leaves out a deferred category in topCategories', () => {
  expect(names(topCategories([category('MCP tools', 3000, 'deferred'), category('Messages', 10)]))).toEqual(['Messages'])
})

test('It does not match a category by its name in topCategories', () => {
  expect(names(topCategories([category('Free space', 500, 'used')]))).toEqual(['Free space'])
})

test('It orders equal categories by name in topCategories', () => {
  expect(names(topCategories([category('Skills', 8000), category('Memory files', 8000)]))).toEqual([
    'Memory files',
    'Skills',
  ])
})

test('It orders names by code point, not by locale, in topCategories', () => {
  expect(names(topCategories([category('a', 1), category('B', 1)]))).toEqual(['B', 'a'])
})

test('It keeps each name unchanged in topCategories', () => {
  expect(topCategories([category('MCP tools', 5)])).toEqual([{ name: 'MCP tools', tokens: 5 }])
})

const SERVERS = [
  tool('github', 4000),
  tool('github', 5000),
  tool('ha', 6000),
  tool('slack', 2000),
  tool('github', 5000, false),
]

test('It sums loaded tokens per server and ignores unloaded schemas in mcpServerTotals', () => {
  expect(mcpServerTotals(SERVERS)).toEqual([
    { name: 'github', tokens: 9000 },
    { name: 'ha', tokens: 6000 },
  ])
})

test('It orders equal servers by name in mcpServerTotals', () => {
  expect(mcpServerTotals([tool('zeta', 5), tool('alpha', 5), tool('mid', 5)])).toEqual([
    { name: 'alpha', tokens: 5 },
    { name: 'mid', tokens: 5 },
  ])
})

test('It returns nothing from mcpServerTotals when every tool is unloaded', () => {
  expect(mcpServerTotals([tool('github', 3000, false)])).toEqual([])
})

test('It returns nothing from mcpServerTotals when there are no tools', () => {
  expect(mcpServerTotals([])).toEqual([])
})

test('It reads mcp servers: github 9k, ha 6k from mcpServersLine', () => {
  expect(mcpServersLine(mcpServerTotals(SERVERS))).toBe('mcp servers: github 9k, ha 6k')
})

test('It reads one server from mcpServersLine', () => {
  expect(mcpServersLine([{ name: 'github', tokens: 3000 }])).toBe('mcp servers: github 3k')
})

test('It returns undefined from mcpServersLine when no server is loaded', () => {
  expect(mcpServersLine([])).toBeUndefined()
})

const breakdown = (overrides: Partial<SessionContextBreakdown> = {}): SessionContextBreakdown => ({
  categories: [category('Messages', 95000)],
  totalTokens: 95000,
  maxTokens: 200000,
  rawMaxTokens: 200000,
  autocompactSource: 'model' as SessionContextBreakdown['autocompactSource'],
  percentage: 48,
  gridRows: [],
  model: 'm',
  memoryFiles: [],
  mcpTools: [tool('github', 3000)],
  agents: [],
  isAutoCompactEnabled: true,
  autoCompactThreshold: 167000,
  apiUsage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 96000, cache_creation_input_tokens: 3000 },
  ...overrides,
})

test('It stamps the time taken in snapshotBreakdown', () => {
  expect(snapshotBreakdown(breakdown(), 1234).takenAt).toBe(1234)
})

test('It keeps the auto-compact threshold in snapshotBreakdown when auto-compact is on', () => {
  expect(snapshotBreakdown(breakdown(), 0).compactsAt).toBe(167000)
})

test('It drops the threshold in snapshotBreakdown when auto-compact is off', () => {
  expect(snapshotBreakdown(breakdown({ isAutoCompactEnabled: false }), 0).compactsAt).toBeUndefined()
})

test('It drops the threshold in snapshotBreakdown when none is reported', () => {
  expect(snapshotBreakdown(breakdown({ autoCompactThreshold: undefined }), 0).compactsAt).toBeUndefined()
})

test('It computes the cache hit in snapshotBreakdown', () => {
  expect(snapshotBreakdown(breakdown(), 0).cacheHitPercent).toBe(96)
})

test('It keeps the top rows in snapshotBreakdown', () => {
  expect(snapshotBreakdown(breakdown(), 0).topRows).toEqual([{ name: 'Messages', tokens: 95000 }])
})

test('It keeps the mcp servers in snapshotBreakdown', () => {
  expect(snapshotBreakdown(breakdown(), 0).mcpServers).toEqual([{ name: 'github', tokens: 3000 }])
})
