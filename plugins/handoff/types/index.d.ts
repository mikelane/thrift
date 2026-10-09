export type Offer = {
  signal: 'strong' | 'weak'
  contextTokens: number
  heldPrompt: boolean
  isBusy: boolean
}

// The band while a handoff is in progress: a status line with no buttons.
//   note: the handoff note is being written.
//   wait: the note is written and the handoff waits for the running turn to end.
export type Writing = { isWriting: true; stage: 'note' | 'wait' }

export type BandState = Offer | Writing

declare module 'claude-code' {
  interface PluginState {
    handoff: { offer: BandState | null }
  }
}
