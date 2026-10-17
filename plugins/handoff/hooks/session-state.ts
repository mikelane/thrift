import type { PromptOrigin } from 'claude-code'
import type { Offer } from '../types'
import type { Button, Mode } from './signals'

type Settings = {
  setting: Mode
  threshold: number
  compactBeforeClear: boolean
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

export type PreClearOutcome = 'abandon_session_ended' | 'abandon_busy' | 'deliver_to_person_clear' | 'clear'

const assertNever = (value: never): never => {
  throw new Error(`unhandled value: ${String(value)}`)
}

// A session end outranks busy work: the person's clear wins over busy by decision, and any other end abandons.
export const preClearOutcome = (sessionEnd: SessionEndBeforeClear | null, isBusy: boolean): PreClearOutcome => {
  switch (sessionEnd) {
    case 'other':
      return 'abandon_session_ended'
    case 'cleared_by_person':
      return 'deliver_to_person_clear'
    case null:
      return isBusy ? 'abandon_busy' : 'clear'
    default:
      return assertNever(sessionEnd)
  }
}

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
  pending: 'handoff' | 'compact' | null
  heldPrompt: string | null
  handoffHold: HandoffHold
  hasBand: boolean
  isTurnRunning: boolean
  isPressRunning: boolean
  deferredPress: ButtonPress | null
  hasTurnAfterNote: boolean
  isOwnClearQueued: boolean
  hasLateTurn: boolean
  turnEndWaiter: (() => void) | null
  handoffStage: HandoffStage
  sessionEndBeforeClear: SessionEndBeforeClear | null
}

// A hot reload calls this again: see the SAFETY note at the call in register.tsx for what it does to a handoff in flight.
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
  pending: null,
  heldPrompt: null,
  handoffHold: { phase: 'idle' },
  hasBand: false,
  isTurnRunning: false,
  isPressRunning: false,
  deferredPress: null,
  hasTurnAfterNote: false,
  isOwnClearQueued: false,
  hasLateTurn: false,
  turnEndWaiter: null,
  handoffStage: 'idle',
  sessionEndBeforeClear: null,
})

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
  state.heldPrompt = null
  state.isTurnRunning = false
  state.isPressRunning = false
  state.deferredPress = null
}

// The prompts a handoff holds and carries, and its stage, survive resetForNewSession: the clear happens in the middle of
// the handoff. The turn-end waiter is not released here: the handoff must resume after the session end hook returns.

export const isGroupOfOrigin = (group: HeldPromptGroup, isUnattended: boolean): boolean => group.isUnattended === isUnattended

// The prompt the handoff carries is the first held prompt, so it is delivered with its own origin's group.
export const beginHandoffHold = (state: SessionState, carried: HeldPrompt | null): void => {
  state.handoffHold = {
    phase: 'holding',
    heldPrompts: carried === null ? [] : [carried],
    promptCarriedByHandoff: carried === null ? null : carried.text,
  }
}

// True only while prompts are still being collected, before the handoff takes them to deliver or put back.
export const isCollectingHeldPrompts = (state: SessionState): boolean => state.handoffHold.phase === 'holding'

export const isHoldingForHandoff = (state: SessionState): boolean =>
  state.handoffHold.phase === 'holding' || state.handoffHold.phase === 'sending'

// Returns how many prompts are held now, or 0 when no handoff is holding and nothing was added.
export const addHeldPrompt = (state: SessionState, prompt: HeldPrompt): number => {
  const hold = state.handoffHold
  if (hold.phase === 'holding') {
    hold.heldPrompts.push(prompt)
    return hold.heldPrompts.length
  }
  if (hold.phase === 'sending') {
    hold.lateArrivals.push(prompt)
    return hold.lateArrivals.length
  }
  return 0
}

// before_draft puts the prompt ahead of whatever the box holds. after_draft puts it behind, so prompts that reach the box
// one after another keep their order.
export type BoxPlacement = 'before_draft' | 'after_draft'

// A prompt refused while the held ones are being put back comes after them in the box, as a held late arrival does.
export const refusedPromptPlacement = (hold: HandoffHold): BoxPlacement => (hold.phase === 'sending' ? 'after_draft' : 'before_draft')

export const isCarriedByHandoff = (state: SessionState, text: string): boolean =>
  state.handoffHold.phase !== 'idle' && state.handoffHold.promptCarriedByHandoff === text

// Once taken, a prompt that arrives is no longer held, until beginSending holds again: a handoff that goes on to the fresh
// session calls it before any await, and one that failed leaves later prompts to the old session.
export const takeHeldPrompts = (state: SessionState): HeldPrompt[] => {
  const hold = state.handoffHold
  if (hold.phase !== 'holding') return []
  state.handoffHold =
    hold.promptCarriedByHandoff === null
      ? { phase: 'idle' }
      : { phase: 'delivering', promptCarriedByHandoff: hold.promptCarriedByHandoff }
  return hold.heldPrompts
}

// Called at the top of the delivery, with no await since the held prompts were taken, so no prompt slips through unheld
// between the two. Holding stays on until takeLateArrivalsOrEndSending finds nothing left.
export const beginSending = (state: SessionState): void => {
  const hold = state.handoffHold
  state.handoffHold = {
    phase: 'sending',
    promptCarriedByHandoff: hold.phase === 'idle' ? null : hold.promptCarriedByHandoff,
    lateArrivals: [],
  }
}

// Prompts that arrived while sending, oldest first. Finding none ends the sending in the same synchronous run, so a prompt
// cannot land between the empty check and the end of the hold and be left unsent.
export const takeLateArrivalsOrEndSending = (state: SessionState): HeldPrompt[] => {
  const hold = state.handoffHold
  if (hold.phase !== 'sending') return []
  if (hold.lateArrivals.length === 0) {
    state.handoffHold = { phase: 'idle' }
    return []
  }
  return hold.lateArrivals.splice(0)
}

// The carried prompt is no longer a repeat to drop once it has been handed back or sent: a later copy is a new prompt.
export const releaseCarried = (state: SessionState): void => {
  const hold = state.handoffHold
  if (hold.phase === 'delivering') state.handoffHold = { phase: 'idle' }
  if (hold.phase === 'sending') hold.promptCarriedByHandoff = null
}

// The carried prompt travels in the group that shares the handoff's origin.
export const releaseCarriedGroup = (state: SessionState, group: HeldPromptGroup, handoffIsUnattended: boolean): void => {
  if (isGroupOfOrigin(group, handoffIsUnattended)) releaseCarried(state)
}

// Ends both the hold on prompts and the stage, so the session end after this point is no handoff's business.
export const endHandoff = (state: SessionState): void => {
  state.handoffHold = { phase: 'idle' }
  state.handoffStage = 'idle'
  state.isOwnClearQueued = false
  state.hasLateTurn = false
}

export const beginBeforeClear = (state: SessionState): void => {
  state.handoffStage = 'before_clear'
  state.sessionEndBeforeClear = null
}

// $.command.run('/clear') only queues the command: a prompt the engine queued earlier runs first, in the old session.
// So the clear is queued from here until the session end it causes, and a turn that starts in between is a late turn.
export const beginOwnClear = (state: SessionState): void => {
  state.handoffStage = 'own_clear'
  state.isOwnClearQueued = true
  state.hasLateTurn = false
}

// Only an end that arrives before the handoff's own clear counts. A resume outranks a person's clear: it abandons.
export const recordSessionEnd = (state: SessionState, reason: string): void => {
  if (state.handoffStage === 'own_clear') state.isOwnClearQueued = false
  if (state.handoffStage !== 'before_clear') return
  if (state.sessionEndBeforeClear === 'other') return
  state.sessionEndBeforeClear = reason === 'clear' ? 'cleared_by_person' : 'other'
}

// A turn that one of the plugin's own submissions started takes that prompt's origin from the queue below.
export const startMainTurn = (state: SessionState, turnText: string): void => {
  state.isTurnRunning = true
  const matchIndex = state.resubmittedPrompts.findIndex(prompt => turnText.includes(prompt.text))
  const resubmittedPrompt = matchIndex === -1 ? undefined : state.resubmittedPrompts.splice(matchIndex, 1)[0]
  if (resubmittedPrompt !== undefined) state.isTurnUnattended = resubmittedPrompt.isUnattended
  noteTurnStarted(state)
}

// A subagent's or teammate's turn is work the note missed, whoever started it, so it counts toward both lines. It is not a
// main-thread turn: only the main thread's turn.complete clears isTurnRunning, so setting it here would hold a handoff for
// good. Nor can it be one of the plugin's own submissions, which only start main-thread turns, so it leaves the queue and
// the turn's origin alone even when its prompt quotes a queued one. Its id is kept until it ends, so a note begun while it
// runs counts it as beginNoteWindow counts a running main turn.
export const startSubagentTurn = (state: SessionState, turnId: string): void => {
  state.runningSubagentTurns.add(turnId)
  noteTurnStarted(state)
}

// A subagent turn whose start this plugin did not hear (its spawn was nested in a hook) ends with nothing to remove.
// SAFETY: the set never feeds the wait for a turn, so an entry left behind costs at most a spurious turn-after-note line,
// never a held handoff.
export const endSubagentTurn = (state: SessionState, turnId: string): void => {
  state.runningSubagentTurns.delete(turnId)
}

// A turn in the session the person cleared to is not one the note missed, so it does not count.
const noteTurnStarted = (state: SessionState): void => {
  if (state.sessionEndBeforeClear === null) state.hasTurnAfterNote = true
  if (state.isOwnClearQueued) state.hasLateTurn = true
}

export const endMainTurn = (state: SessionState): void => {
  state.isTurnRunning = false
}

// The engine has no origin to give a prompt the plugin submits, and submit can resolve once the prompt is queued behind the
// running turn, before its own turn starts. So the origins of the plugin's own submissions wait here in submit order, and a turn start takes the first
// whose text the turn's text contains: turn.start gives the text, which may carry a frame around what was submitted, so the
// match is "contains", not "equals". A turn whose text matches none (a task notification, a peer's message) leaves the queue
// alone.
// SAFETY: a turn that merely contains a queued prompt's text, such as a task notification quoting it, would take its entry,
// and a short prompt makes that likelier. An entry stays until a turn takes it, so one whose text a hook beneath rewrote
// waits for such a turn. Either needs a turn quoting a resubmitted prompt, which is not a case worth a guard. The cost,
// outside off, is one turn end judged as the wrong kind of sender: a person asked where a scheduled turn would act, or a scheduled turn's
// rule applied to a person's turn, so a strong signal hands off without asking and a weak one shows no band.
// An empty text is not queued: every turn's text contains it, so it would take the first turn that starts.
export const queueResubmittedPrompt = (state: SessionState, prompt: HeldPrompt): void => {
  if (prompt.text === '') return
  state.resubmittedPrompts.push(prompt)
}

// A prompt that did not enter starts no turn, so its place in the queue goes.
export const removeResubmittedPrompt = (state: SessionState, prompt: HeldPrompt): void => {
  const index = state.resubmittedPrompts.indexOf(prompt)
  if (index !== -1) state.resubmittedPrompts.splice(index, 1)
}

// The note's fork sees the conversation only up to here, so a turn already running now, a subagent's included, is missing
// from the note too.
export const beginNoteWindow = (state: SessionState): void => {
  state.hasTurnAfterNote = state.isTurnRunning || state.runningSubagentTurns.size > 0
}

// Resolves when the turn-end waiter is released. The caller re-checks isTurnRunning after each wake-up.
// SAFETY: a single waiter slot is enough. claimPending(state, 'handoff') admits one handoff at a time, and only that
// handoff's loop waits, so a second waiter can never overwrite the first and leave it hanging.
export const waitForTurnEnd = (state: SessionState): Promise<void> =>
  new Promise(resolve => {
    state.turnEndWaiter = resolve
  })

export const releaseTurnEndWaiter = (state: SessionState): void => {
  const waiter = state.turnEndWaiter
  state.turnEndWaiter = null
  waiter?.()
}

export const claimPending = (state: SessionState, kind: NonNullable<SessionState['pending']>): boolean => {
  if (state.pending !== null) return false
  state.pending = kind
  return true
}

export const noteCacheReads = (state: SessionState, cacheReadTokens: number | undefined): void => {
  state.cacheReadTokens = cacheReadTokens ?? 0
}
