import type { BreakdownReading, HeadlineReading, NamedTokens } from '../types'
import { mcpServersLine } from './breakdown'
import { contextBand, contextFill, fillPercent } from './context'
import { barFor, formatTokens } from './format'
import { labelled } from './glyphs'
import type { GlyphSet } from './glyphs'
import type { BandColor } from './pace'
import type { WindowView } from './window-view'

const SEPARATOR = '  ·  '
const TOKEN_COLUMN_WIDTH = 4
const STATUS_DOT = '●'

type RowText = { text: string; color?: BandColor }

export const contextRowText = (headline: HeadlineReading, compactsAt: number | undefined, set: GlyphSet): RowText => {
  const label = labelled(set, 'context', 'CONTEXT')
  const { contextTokens, contextWindow } = headline
  if (!contextTokens) return { text: `${label}   waiting for first response` }
  const fill = contextFill(contextTokens, contextWindow, compactsAt)
  const denominator = formatTokens(compactsAt ?? contextWindow)
  return {
    text: `${label}   ${formatTokens(contextTokens)} / ${formatTokens(contextWindow)}   ${fillPercent(fill)}% of ${denominator}`,
    color: contextBand(fill),
  }
}

export const contextDetailText = (breakdown: BreakdownReading | null): string => {
  const cacheHit = `cache hit ${breakdown?.cacheHitPercent == null ? '—' : `${breakdown.cacheHitPercent}%`}`
  const compactsAt = breakdown?.compactsAt
  return compactsAt === undefined ? cacheHit : [`compacts at ${formatTokens(compactsAt)}`, cacheHit].join(SEPARATOR)
}

export const costRowText = (headline: HeadlineReading, set: GlyphSet): string | undefined =>
  headline.costUsd === undefined ? undefined : `${labelled(set, 'cost', 'COST')}   $${headline.costUsd.toFixed(2)} this session`

type PacedView = Extract<WindowView, { state: 'paced' }>

const pacedRowTexts = (view: PacedView, label: string): RowText[] => {
  const projection = view.projection === undefined ? '' : `hits 100% ${view.projection}, `
  return [
    { text: `${label}   ${view.percentText}%${SEPARATOR}${view.elapsedPercent}% of window elapsed`, color: view.color },
    { text: `pace ${view.paceText}×  ${STATUS_DOT}  ${projection}resets ${view.resetsLabel}`, color: view.color },
  ]
}

export const windowRowTexts = (view: WindowView, set: GlyphSet): RowText[] => {
  const label = view.slot ? labelled(set, view.slot, view.label) : view.label
  const percent = `${label}   ${view.percentText}%`
  // No default: every case returns, so tsc refuses a new state this switch does not draw.
  switch (view.state) {
    case 'paced':
      return pacedRowTexts(view, label)
    case 'too-early':
      return [{ text: `${percent}${SEPARATOR}too early` }]
    case 'limit-reached': {
      const reset = view.resetsLabel === undefined ? '' : `${SEPARATOR}resets ${view.resetsLabel}`
      return [{ text: `${percent}${SEPARATOR}${labelled(set, 'limitReached', 'limit reached')}${reset}`, color: view.color }]
    }
    case 'plain':
      return [view.color ? { text: percent, color: view.color } : { text: percent }]
  }
}

export const topContextRowTexts = (rows: readonly NamedTokens[]): string[] => {
  const nameWidth = Math.max(0, ...rows.map(row => row.name.length))
  const largest = Math.max(0, ...rows.map(row => row.tokens))
  return rows.map(({ name, tokens }) => {
    const figure = formatTokens(tokens).padStart(TOKEN_COLUMN_WIDTH)
    return `${name.padEnd(nameWidth)} ${figure} ${barFor(tokens, largest)}`.trimEnd()
  })
}

export const mcpServersRowText = (servers: readonly NamedTokens[], set: GlyphSet): string | undefined => {
  const line = mcpServersLine(servers)
  return line === undefined ? undefined : labelled(set, 'mcpServers', line)
}
