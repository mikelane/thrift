const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const THOUSAND = 1000
const MILLION = 1_000_000
const THIN_BAR_WIDTH = 10

const formatMillions = (tokens: number): string => `${Math.round((tokens / MILLION) * 10) / 10}M`

export const formatTokens = (tokens: number): string => {
  if (tokens < THOUSAND) return String(tokens)
  const thousands = Math.round(tokens / THOUSAND)
  return thousands < THOUSAND ? `${thousands}k` : formatMillions(tokens)
}

export const formatPercent = (percent: number): string => String(Math.round(percent * 10) / 10)

export const ageLabel = (elapsedMs: number): string => {
  const elapsed = Math.max(0, elapsedMs)
  if (elapsed < MINUTE_MS) return `${Math.floor(elapsed / SECOND_MS)}s ago`
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`
  return `${Math.floor(elapsed / HOUR_MS)}h ago`
}

export const barFor = (tokens: number, largest: number): string =>
  tokens <= 0 || largest <= 0 ? '' : '━'.repeat(Math.max(1, Math.round((tokens / largest) * THIN_BAR_WIDTH)))
