const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const BAR_WIDTH_BLOCKS = 6
const HALVES_PER_BLOCK = 2

export const formatTokens = (tokens: number): string => (tokens < 1000 ? String(tokens) : `${Math.round(tokens / 1000)}k`)

export const formatPercent = (percent: number): string => String(Math.round(percent * 10) / 10)

export const ageLabel = (elapsedMs: number): string => {
  const elapsed = Math.max(0, elapsedMs)
  if (elapsed < MINUTE_MS) return `${Math.floor(elapsed / SECOND_MS)}s ago`
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`
  return `${Math.floor(elapsed / HOUR_MS)}h ago`
}

export const barFor = (tokens: number, largest: number): string => {
  if (tokens <= 0 || largest <= 0) return ''
  const halves = Math.max(1, Math.round((tokens / largest) * BAR_WIDTH_BLOCKS * HALVES_PER_BLOCK))
  return '█'.repeat(Math.floor(halves / HALVES_PER_BLOCK)) + (halves % HALVES_PER_BLOCK === 1 ? '▌' : '')
}
