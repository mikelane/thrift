import type { Offer } from '../types'
import type { Button, Mode } from './signals'

type Settings = {
  setting: Mode
  threshold: number
  compactBeforeClear: boolean
}

export type ButtonPress = { offer: Offer; button: Button }

export type HeldPrompt = { text: string; isUnattended: boolean }

// One origin's held prompts, joined into a single text.
export type HeldPromptGroup = HeldPrompt

// One field instead of two nullable ones, so a state like "prompts taken but still collecting" cannot be written.
//   holding:    the handoff is being prepared; prompts that arrive are kept, and the carried prompt is a repeat to drop.
//   delivering: the held prompts were taken; only the carried prompt's text is still watched, until it is handed back.
export type HandoffHold =
  | { phase: 'idle' }
  | { phase: 'holding'; heldPrompts: HeldPrompt[]; promptCarriedByHandoff: string | null }
  | { phase: 'delivering'; promptCarriedByHandoff: string }

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
  handoffHold: HandoffHold
  hasBand: boolean
  isTurnRunning: boolean
  isPressRunning: boolean
  deferredPress: ButtonPress | null
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
  handoffHold: { phase: 'idle' },
  hasBand: false,
  isTurnRunning: false,
  isPressRunning: false,
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
  state.isPressRunning = false
  state.deferredPress = null
}

// The prompts a handoff holds and carries survive resetForNewSession: the clear happens in the middle of the handoff.

export const isGroupOfOrigin = (group: HeldPromptGroup, isUnattended: boolean): boolean => group.isUnattended === isUnattended

// The prompt the handoff carries is the first held prompt, so it is delivered with its own origin's group.
export const beginHandoffHold = (state: SessionState, carried: HeldPrompt | null): void => {
  state.handoffHold = {
    phase: 'holding',
    heldPrompts: carried === null ? [] : [carried],
    promptCarriedByHandoff: carried === null ? null : carried.text,
  }
}

export const isHoldingForHandoff = (state: SessionState): boolean => state.handoffHold.phase === 'holding'

// Returns how many prompts are held now, or 0 when no handoff is holding and nothing was added.
export const addHeldPrompt = (state: SessionState, prompt: HeldPrompt): number => {
  const hold = state.handoffHold
  if (hold.phase !== 'holding') return 0
  hold.heldPrompts.push(prompt)
  return hold.heldPrompts.length
}

export const isCarriedByHandoff = (state: SessionState, text: string): boolean =>
  state.handoffHold.phase !== 'idle' && state.handoffHold.promptCarriedByHandoff === text

// Once taken, a prompt that arrives is no longer held: it belongs to the fresh session, or to the old one if the handoff failed.
export const takeHeldPrompts = (state: SessionState): HeldPrompt[] => {
  const hold = state.handoffHold
  if (hold.phase !== 'holding') return []
  state.handoffHold =
    hold.promptCarriedByHandoff === null
      ? { phase: 'idle' }
      : { phase: 'delivering', promptCarriedByHandoff: hold.promptCarriedByHandoff }
  return hold.heldPrompts
}

// The carried prompt is no longer a repeat to drop once it has been handed back or sent: a later copy is a new prompt.
export const releaseCarried = (state: SessionState): void => {
  if (state.handoffHold.phase === 'delivering') state.handoffHold = { phase: 'idle' }
}

// The carried prompt travels in the group that shares the handoff's origin.
export const releaseCarriedGroup = (state: SessionState, group: HeldPromptGroup, handoffIsUnattended: boolean): void => {
  if (isGroupOfOrigin(group, handoffIsUnattended)) releaseCarried(state)
}

export const endHandoffHold = (state: SessionState): void => {
  state.handoffHold = { phase: 'idle' }
}
