export type Offer = {
  signal: 'strong' | 'weak'
  contextTokens: number
  heldPrompt: boolean
  isBusy: boolean
}

// The band while the handoff note is written: a status line with no buttons.
export type Writing = { isWriting: true }

export type BandState = Offer | Writing

declare module 'claude-code' {
  interface PluginState {
    handoff: { offer: BandState | null }
  }
}
