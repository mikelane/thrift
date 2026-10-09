import type { Offer } from '../types'
import type { Button, Mode } from './signals'

type Settings = {
  setting: Mode
  threshold: number
  compactBeforeClear: boolean
}

export type DeferredPress = { offer: Offer; button: Button }

export type SessionState = Settings & {
  mode: Mode
  engineVersion: string
  contextTokens: number
  cacheReadTokens: number
  seenRefs: Set<string>
  urlPrefixes: Set<string>
  backgroundTasks: Set<string>
  hasFinishedTask: boolean
  isTurnUnattended: boolean
  backoffFrom: number | null
  pending: 'handoff' | 'compact' | null
  heldPrompt: string | null
  hasBand: boolean
  isTurnRunning: boolean
  deferredPress: DeferredPress | null
}

export const createState = (settings: Settings): SessionState => ({
  ...settings,
  mode: 'off',
  engineVersion: 'unknown',
  contextTokens: 0,
  cacheReadTokens: 0,
  seenRefs: new Set(),
  urlPrefixes: new Set(),
  backgroundTasks: new Set(),
  hasFinishedTask: false,
  isTurnUnattended: false,
  backoffFrom: null,
  pending: null,
  heldPrompt: null,
  hasBand: false,
  isTurnRunning: false,
  deferredPress: null,
})

export const resetForNewSession = (state: SessionState): void => {
  state.contextTokens = 0
  state.cacheReadTokens = 0
  state.seenRefs.clear()
  state.urlPrefixes.clear()
  state.backgroundTasks.clear()
  state.hasFinishedTask = false
  state.isTurnUnattended = false
  state.backoffFrom = null
  state.heldPrompt = null
  state.isTurnRunning = false
  state.deferredPress = null
}
