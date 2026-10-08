export type Offer = {
  signal: 'strong' | 'weak'
  contextTokens: number
  heldPrompt: boolean
  isBusy: boolean
}

declare module 'claude-code' {
  interface PluginState {
    handoff: { offer: Offer | null }
  }
}
