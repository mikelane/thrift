export type Offer = {
  signal: 'strong' | 'weak'
  contextTokens: number
  hasHeldPrompt: boolean
  isBusy: boolean
}

export type Writing = { isWriting: true; stage: 'note' | 'wait' }

export type BandState = Offer | Writing

declare module 'claude-code' {
  interface PluginState {
    handoff: { offer: Shaped<BandState | null> }
  }
}
