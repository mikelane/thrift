import type { BreakdownReading, HeadlineReading, NamedTokens } from '../types'
import { mcpServersLine } from './breakdown'
import { contextBand, contextFill, fillPercent } from './context'
import { barFor, formatTokens } from './format'
import { GAUGE_WIDTH, gaugeFor } from './gauge'
import { labelled } from './glyphs'
import type { GlyphSet } from './glyphs'
import type { BandColor } from './pace'
import type { WindowView } from './window-view'

const SEPARATOR = ' · '
const TOKEN_COLUMN_WIDTH = 4
const GAUGE_PERCENT_GAP = '  '
const TWO_DIGIT_PERCENT_WIDTH = '15%'.length
const HEADER_WIDTH = GAUGE_WIDTH + GAUGE_PERCENT_GAP.length + TWO_DIGIT_PERCENT_WIDTH
const MIN_HEADER_GAP = 2
const PERCENT_SHARE = 100

type RowText = { text: string; color?: BandColor; dim?: true }

export const headerLine = (left: string, right: string): string =>
  left + ' '.repeat(Math.max(MIN_HEADER_GAP, HEADER_WIDTH - left.length - right.length)) + right

export const contextRowText = (headline: HeadlineReading, compactsAt: number | undefined, set: GlyphSet): RowText => {
  const label = labelled(set, 'context', 'CONTEXT')
  const { contextTokens, contextWindow } = headline
  if (!contextTokens) return { text: headerLine(label, 'waiting for first response') }
  return {
    text: headerLine(label, `${formatTokens(contextTokens)} / ${formatTokens(contextWindow)}`),
    color: contextBand(contextFill(contextTokens, contextWindow, compactsAt)),
  }
}

export const contextGaugeText = (headline: HeadlineReading, compactsAt: number | undefined): RowText | undefined => {
  const { contextTokens, contextWindow } = headline
  if (!contextTokens) return undefined
  const fill = contextFill(contextTokens, contextWindow, compactsAt)
  return {
    text: `${gaugeFor(fill, { minimumHalfCells: 1 })}${GAUGE_PERCENT_GAP}${fillPercent(fill)}%`,
    color: contextBand(fill),
  }
}

export const contextDetailText = (breakdown: BreakdownReading | null): string => {
  const cache = `cache ${breakdown?.cacheHitPercent == null ? '—' : `${breakdown.cacheHitPercent}%`}`
  const compactsAt = breakdown?.compactsAt
  return compactsAt === undefined ? cache : [`compacts ${formatTokens(compactsAt)}`, cache].join(SEPARATOR)
}

export const costRowText = (headline: HeadlineReading, set: GlyphSet): string | undefined =>
  headline.costUsd === undefined ? undefined : headerLine(labelled(set, 'cost', 'COST'), `$${headline.costUsd.toFixed(2)} at API rates`)

type PacedView = Extract<WindowView, { state: 'paced' }>

const headerRight = (view: WindowView): string =>
  view.state === 'paced' ? `${view.percentText}%${SEPARATOR}${view.paceText}×` : `${view.percentText}%`

const gaugeText = (view: WindowView): string => {
  const share = view.percentUsed / PERCENT_SHARE
  return view.state === 'paced' ? gaugeFor(share, { markerShare: view.elapsedShare }) : gaugeFor(share)
}

const pacedDetailText = (view: PacedView): string => {
  const projection = view.projection === undefined ? '' : `${SEPARATOR}hits 100% ${view.projection}`
  return `resets ${view.resetsLabel}${projection}`
}

const detailRow = (view: WindowView, set: GlyphSet): RowText | undefined => {
  // No default: every case returns, so tsc refuses a new state this switch does not draw.
  switch (view.state) {
    case 'paced':
      return { text: pacedDetailText(view), dim: true }
    case 'too-early':
      return { text: 'too early', dim: true }
    case 'limit-reached': {
      const reset = view.resetsLabel === undefined ? '' : `${SEPARATOR}resets ${view.resetsLabel}`
      return { text: `${labelled(set, 'limitReached', 'limit reached')}${reset}`, color: view.color }
    }
    case 'plain':
      return undefined
  }
}

export const windowRowTexts = (view: WindowView, set: GlyphSet): RowText[] => {
  const label = view.slot ? labelled(set, view.slot, view.label) : view.label
  const color = view.state === 'too-early' ? undefined : view.color
  const colored = (text: string): RowText => (color ? { text, color } : { text })
  const detail = detailRow(view, set)
  return [colored(headerLine(label, headerRight(view))), colored(gaugeText(view)), ...(detail ? [detail] : [])]
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
