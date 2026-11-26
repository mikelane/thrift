import type { PromptOrigin } from 'claude-code'
import type { Offer } from '../types'
import type { Button, Mode } from './signals'

type Settings = {
  setting: Mode
  threshold: number
  compactBeforeClear: boolean
  continueAfterHandoff: boolean
}

export type ButtonPress = { offer: Offer; button: Button }

// origin is the engine's origin kind: it decides whether a prompt that cannot be sent may go in this terminal's box.
// boxText is the text the engine left in the box for a group of several prompts: the last one typed at the composer, not
// the joined text. A group with no composer prompt in it has none.
// author is required so that who wrote the words is never a default: the plugin's own words (the handoff note) keep the
// plugin's frame whatever person origin they borrow for the box, and only a person's are read as the person's.
type HeldPromptAuthor = 'person' | 'plugin'
export type HeldPrompt = { text: string; isUnattended: boolean; origin: PromptOrigin['kind']; author: HeldPromptAuthor; boxText?: string }

// One origin's held prompts, joined into a single text.
export type HeldPromptGroup = HeldPrompt

// One field instead of two nullable ones, so a state like "prompts taken but still collecting" cannot be written.
//   holding:    the handoff is being prepared; prompts that arrive are kept, and the carried prompt is a repeat to drop.
//   delivering: the held prompts were taken; only the carried prompt's text is still watched, until it is handed back.
//   sending:    the fresh session is being given the note and the held prompts; a prompt that arrives now is kept in
//               lateArrivals and delivered after them and after the prompts that arrived before it, so it cannot enter
//               ahead of them.
export type HandoffHold =
  | { phase: 'idle' }
  | { phase: 'holding'; heldPrompts: HeldPrompt[]; promptCarriedByHandoff: string | null }
  | { phase: 'delivering'; promptCarriedByHandoff: string }
  | { phase: 'sending'; promptCarriedByHandoff: string | null; lateArrivals: HeldPrompt[] }

// Where a handoff stands relative to its own /clear, so the session end that /clear causes is not taken for the person's.
//   idle:         no handoff.
//   before_clear: the note is written, awaited, or compacted; the clear has not been issued.
//   own_clear:    the handoff issued its /clear.
export type HandoffStage = 'idle' | 'before_clear' | 'own_clear'

// What ended the session before the handoff's own clear: the person's /clear, or anything else (a resume and so on).
export type SessionEndBeforeClear = 'cleared_by_person' | 'other'

export type SessionState = Settings & {
  mode: Mode
  engineVersion: string
  contextTokens: number
  cacheReadTokens: number
  seenRefs: Set<string>
  urlPrefixes: Set<string>
  backgroundTasks: Set<string>
  runningSubagentTurns: Set<string>
  hasFinishedTask: boolean
  isTurnUnattended: boolean
  resubmittedPrompts: HeldPrompt[]
  backoffFrom: number | null
  // True from a successful compaction until the first context measurement after it.
  isAwaitingPostCompactionContext: boolean
  // The first context measured after the last compaction in this session; 0 while unknown.
  floorTokens: number
  // Counts the sessions this plugin has seen; resetForNewSession bumps it. A compaction that was running across a bump belongs to the old session.
  sessionGeneration: number
  pending: 'handoff' | 'compact' | null
  heldPrompt: string | null
  handoffHold: HandoffHold
  boxLeftover: string | null
  leftoverStrips: number
  hasBand: boolean
  // The signal the band on show was raised on; a busy redraw shows weak and the redraw after it restores this.
  bandRaisedSignal: Offer['signal']
  isTurnRunning: boolean
  isPressRunning: boolean
  deferredPress: ButtonPress | null
  hasTurnAfterNote: boolean
  isOwnClearQueued: boolean
  // True once the handoff's own clear returned; a foreign clear that returned before that ran ahead of it.
  hasOwnClearReturned: boolean
  didForeignClearFinishFirst: boolean
  foreignClearsAhead: number
  hasLateTurn: boolean
  turnEndWaiter: (() => void) | null
  handoffStage: HandoffStage
  sessionEndBeforeClear: SessionEndBeforeClear | null
  // The args of each /resume held while the handoff's own clear was queued, replayed once that clear returned.
  heldResumeArgs: string[]
  // From the clear's return until the held resumes have run: resolves true when at least one replayed /resume returned
  // without throwing (the person left the fresh session), false when every one threw. Never rejects. Null when none is replaying.
  heldResumeReplay: Promise<boolean> | null
  // Clears someone else started whose command.run has not returned: the engine still names the cleared session until they do.
  foreignClearsRunning: number
  // Resolvers of the deliveries waiting for foreignClearsRunning to reach zero.
  foreignClearReleasers: Array<() => void>
}

// A reload that runs register again calls this again: see the SAFETY note at the call in register.tsx for what it
// does to a handoff in flight.
export const createState = (settings: Settings): SessionState => ({
  ...settings,
  mode: 'off',
  engineVersion: 'unknown',
  contextTokens: 0,
  cacheReadTokens: 0,
  seenRefs: new Set(),
  urlPrefixes: new Set(),
  backgroundTasks: new Set(),
  runningSubagentTurns: new Set(),
  hasFinishedTask: false,
  isTurnUnattended: false,
  resubmittedPrompts: [],
  backoffFrom: null,
  isAwaitingPostCompactionContext: false,
  floorTokens: 0,
  sessionGeneration: 0,
  pending: null,
  heldPrompt: null,
  handoffHold: { phase: 'idle' },
  boxLeftover: null,
  leftoverStrips: 0,
  hasBand: false,
  bandRaisedSignal: 'weak',
  isTurnRunning: false,
  isPressRunning: false,
  deferredPress: null,
  hasTurnAfterNote: false,
  isOwnClearQueued: false,
  hasOwnClearReturned: false,
  didForeignClearFinishFirst: false,
  foreignClearsAhead: 0,
  hasLateTurn: false,
  turnEndWaiter: null,
  handoffStage: 'idle',
  sessionEndBeforeClear: null,
  heldResumeArgs: [],
  heldResumeReplay: null,
  foreignClearsRunning: 0,
  foreignClearReleasers: [],
})

// The prompts a handoff holds and carries, and its stage, survive resetForNewSession: the clear happens in the middle of
// the handoff. The turn-end waiter is not released here: the handoff must resume after the session end hook returns.
export const resetForNewSession = (state: SessionState): void => {
  state.contextTokens = 0
  state.cacheReadTokens = 0
  state.seenRefs.clear()
  state.urlPrefixes.clear()
  state.backgroundTasks.clear()
  state.runningSubagentTurns.clear()
  state.hasFinishedTask = false
  state.isTurnUnattended = false
  state.resubmittedPrompts = []
  state.backoffFrom = null
  state.isAwaitingPostCompactionContext = false
  state.floorTokens = 0
  state.sessionGeneration += 1
  state.heldPrompt = null
  state.isTurnRunning = false
  state.isPressRunning = false
  state.deferredPress = null
}
