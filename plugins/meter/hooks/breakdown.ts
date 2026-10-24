import type { ContextCategory, ContextMcpTool, SessionContextBreakdown } from 'claude-code'

import type { BreakdownReading, NamedTokens } from '../types'
import { cacheHitPercent } from './context'
import { formatTokens } from './format'

const TOP_ROWS = 5
const TOP_SERVERS = 2

const byTokensThenName = (a: NamedTokens, b: NamedTokens): number => {
  if (a.tokens !== b.tokens) return b.tokens - a.tokens
  if (a.name === b.name) return 0
  return a.name < b.name ? -1 : 1
}

export const topCategories = (categories: readonly ContextCategory[]): NamedTokens[] =>
  categories
    .filter(category => category.kind === 'used')
    .map(({ name, tokens }) => ({ name, tokens }))
    .sort(byTokensThenName)
    .slice(0, TOP_ROWS)

export const mcpServerTotals = (tools: readonly ContextMcpTool[]): NamedTokens[] => {
  const totals = new Map<string, number>()
  for (const { serverName, tokens, isLoaded } of tools) {
    if (isLoaded) totals.set(serverName, (totals.get(serverName) ?? 0) + tokens)
  }
  return [...totals].map(([name, tokens]) => ({ name, tokens })).sort(byTokensThenName).slice(0, TOP_SERVERS)
}

export const mcpServersLine = (servers: readonly NamedTokens[]): string | undefined =>
  servers.length === 0 ? undefined : `mcp servers: ${servers.map(({ name, tokens }) => `${name} ${formatTokens(tokens)}`).join(', ')}`

export const snapshotBreakdown = (breakdown: SessionContextBreakdown, takenAt: number): BreakdownReading => ({
  takenAt,
  compactsAt: breakdown.isAutoCompactEnabled ? breakdown.autoCompactThreshold : undefined,
  cacheHitPercent: cacheHitPercent(breakdown.apiUsage),
  topRows: topCategories(breakdown.categories),
  mcpServers: mcpServerTotals(breakdown.mcpTools),
})
