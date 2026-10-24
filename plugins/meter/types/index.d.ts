export type RateLimitReading = { kind: string; percentUsed: number; resetsAt?: string }

export type HeadlineReading = {
  contextTokens?: number
  contextWindow: number
  rateLimits: RateLimitReading[]
  costUsd?: number
}

export type NamedTokens = { name: string; tokens: number }

export type BreakdownReading = {
  takenAt: number
  compactsAt?: number
  cacheHitPercent: number | null
  topRows: NamedTokens[]
  mcpServers: NamedTokens[]
}

export type MeterReading = {
  headline: HeadlineReading | null
  breakdown: BreakdownReading | null
  isStale: boolean
}

declare module 'claude-code' {
  interface PluginState {
    meter: { reading: Shaped<MeterReading> }
  }
}
