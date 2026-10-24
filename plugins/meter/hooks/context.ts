import type { ModelUsage } from 'claude-code'

import type { BandColor } from './pace'

const GREEN_BELOW = 0.7
const YELLOW_THROUGH = 0.9

export const contextFill = (tokens: number, window: number, threshold: number | undefined): number =>
  tokens / (threshold ?? window)

export const contextBand = (fill: number): BandColor => {
  if (fill < GREEN_BELOW) return 'success'
  return fill <= YELLOW_THROUGH ? 'warning' : 'error'
}

export const fillPercent = (fill: number): number => Math.round(fill * 100)

export const cacheHitPercent = (apiUsage: ModelUsage | null | undefined): number | null => {
  if (!apiUsage) return null
  const read = apiUsage.cache_read_input_tokens
  const total = apiUsage.input_tokens + read + apiUsage.cache_creation_input_tokens
  return total === 0 ? null : Math.round((read / total) * 100)
}
