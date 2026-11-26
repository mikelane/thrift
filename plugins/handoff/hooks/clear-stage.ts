import type { PromptOrigin } from 'claude-code'
import type { ClearedBy } from './decision-record'
import type { SessionEndBeforeClear, SessionState } from './session-state'

export type PreClearOutcome = 'abandon_session_ended' | 'abandon_busy' | 'abandon_compaction_preempted' | 'deliver_to_person_clear' | 'clear'

// The outcomes that end in a cleared session, whoever cleared it.
type ClearingOutcome = Extract<PreClearOutcome, 'deliver_to_person_clear' | 'clear'>

// Who ran the clear for each outcome that reaches it; a new outcome fails to compile until it is mapped here.
const CLEARED_BY = {
  clear: 'handoff',
  deliver_to_person_clear: 'person',
} as const satisfies Record<ClearingOutcome, ClearedBy>

// "Person" means any clear this plugin did not issue: another plugin's or a scheduled one counts too.
export const clearedByFor = (state: Pick<SessionState, 'didForeignClearFinishFirst'>, outcome: ClearingOutcome): ClearedBy =>
  state.didForeignClearFinishFirst ? 'person' : CLEARED_BY[outcome]

// The handoff's own clear ran after a foreign one had already cleared the session.
export const hasSecondClear = (state: Pick<SessionState, 'didForeignClearFinishFirst'>, outcome: ClearingOutcome): boolean =>
  outcome === 'clear' && state.didForeignClearFinishFirst

const assertNever = (value: never): never => {
  throw new Error(`unhandled value: ${String(value)}`)
}

// A session end outranks busy work: the person's clear wins over busy by decision, and any other end abandons. A compaction that
// a turn preempted comes last: it only keeps the handoff from clearing when nothing else decided the outcome.
export const preClearOutcome = (sessionEnd: SessionEndBeforeClear | null, isBusy: boolean, isCompactionPreempted: boolean): PreClearOutcome => {
  switch (sessionEnd) {
    case 'other':
      return 'abandon_session_ended'
    case 'cleared_by_person':
      return 'deliver_to_person_clear'
    case null:
      if (isBusy) return 'abandon_busy'
      return isCompactionPreempted ? 'abandon_compaction_preempted' : 'clear'
    default:
      return assertNever(sessionEnd)
  }
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
  state.hasOwnClearReturned = false
  state.didForeignClearFinishFirst = false
  state.hasLateTurn = false
}

export const markOwnClearReturned = (state: SessionState): void => {
  state.hasOwnClearReturned = true
}

// The engine runs the clears one after another, so a foreign clear that returned before the handoff's own did ran ahead of it,
// whatever order their commands reached the hooks in. Only a clear that ran counts: the caller passes none that was answered
// in its place or threw.
export const recordForeignClearReturned = (state: SessionState, origin: PromptOrigin): void => {
  if (origin.kind === 'plugin' && origin.name === PLUGIN_NAME) return
  if (state.handoffStage === 'own_clear' && !state.hasOwnClearReturned) state.didForeignClearFinishFirst = true
}

const PLUGIN_NAME = 'handoff'

// A clear someone else started, counted from its command.run until its session end. The declarations skip only the calling
// hook on a plugin's $.command.run ("the calling hook alone"; "the plugin's others see it"), so the handoff's own clear can
// reach this plugin's command.run hook too. Its origin, which the engine stamps { kind: 'plugin', name }, tells it apart.
// Counting starts before the handoff queues its own clear: a clear already running then (its end awaits the hooks beneath
// and core) ends its session after ours is queued, and that end is not the end of ours. One seen after our clear's end runs
// behind it and is no handoff's business.
export const recordForeignClear = (state: SessionState, origin: PromptOrigin): void => {
  if (origin.kind === 'plugin' && origin.name === PLUGIN_NAME) return
  if (state.handoffStage === 'before_clear' || state.isOwnClearQueued) state.foreignClearsAhead += 1
}

// A foreign clear a hook answered in its place: it ran nothing and ends no session, so no end is owed to it.
export const forgetForeignClear = (state: SessionState): void => {
  if (state.foreignClearsAhead > 0) state.foreignClearsAhead -= 1
}

// The ends of foreign clears come first; the first end after them is the handoff's own. Any other reason ends it outright.
const attributeOwnClearStageEnd = (state: SessionState, reason: string): void => {
  if (reason === 'clear' && state.foreignClearsAhead > 0) {
    state.foreignClearsAhead -= 1
    return
  }
  state.isOwnClearQueued = false
}

// Only an end that arrives before the handoff's own clear counts. A resume outranks a person's clear: it abandons.
export const recordSessionEnd = (state: SessionState, reason: string): void => {
  if (state.handoffStage === 'own_clear') attributeOwnClearStageEnd(state, reason)
  if (state.handoffStage !== 'before_clear') return
  // A foreign clear that ended its session before ours was queued is owed nothing more.
  if (reason === 'clear' && state.foreignClearsAhead > 0) state.foreignClearsAhead -= 1
  if (state.sessionEndBeforeClear === 'other') return
  state.sessionEndBeforeClear = reason === 'clear' ? 'cleared_by_person' : 'other'
}

// A /resume that starts dispatching before the handoff queues its clear will end this session, and the clear queued after it
// would run in the resumed one (#177). The command.run hook sees the resume at dispatch, so the handoff treats it as the end
// it will cause. A resume that dispatches after the clear is queued runs behind it: only before_clear is the handoff's business.
// SAFETY: a resume that then fails or is cancelled leaves the session as it was, and the handoff is abandoned all the same.
// That costs a note, never a clear in the wrong session.
export const recordResumeDispatch = (state: SessionState): void => {
  if (state.handoffStage === 'before_clear') state.sessionEndBeforeClear = 'other'
}

// A /resume that dispatches once the handoff's clear is queued would end the session before that clear runs, and the clear
// would then run in the resumed session (#177, seen live on 2.1.332: the dispatch of a typed /handoff's resume comes with the
// clear already queued). So the resume is held and replayed after the clear returned. The handoff's own replay is let through.
export const shouldHoldResume = (state: SessionState, origin: PromptOrigin): boolean => {
  if (origin.kind === 'plugin' && origin.name === PLUGIN_NAME) return false
  return state.handoffStage === 'own_clear' && state.isOwnClearQueued && !state.hasOwnClearReturned
}

export const holdResume = (state: SessionState, args: string): void => {
  state.heldResumeArgs.push(args)
}

export const takeHeldResumes = (state: SessionState): string[] => state.heldResumeArgs.splice(0)

// Clears the replay only if it is still the current one. A newer replay stays.
export function forgetHeldResumeReplay(state: SessionState, replay: Promise<boolean>): void {
  if (state.heldResumeReplay === replay) state.heldResumeReplay = null
}

// Counts a foreign clear from the start of its command.run until it returns or throws. A note delivery must not read the
// session id while the person's clear is still switching sessions. The handoff's own clear is not counted.
export const recordForeignClearRunning = (state: SessionState, origin: PromptOrigin): void => {
  if (origin.kind === 'plugin' && origin.name === PLUGIN_NAME) return
  state.foreignClearsRunning += 1
}

// Releases the waiting deliveries once the last running foreign clear is done.
export const recordForeignClearDone = (state: SessionState, origin: PromptOrigin): void => {
  if (origin.kind === 'plugin' && origin.name === PLUGIN_NAME) return
  if (state.foreignClearsRunning > 0) state.foreignClearsRunning -= 1
  if (state.foreignClearsRunning > 0) return
  const releasers = state.foreignClearReleasers
  state.foreignClearReleasers = []
  for (const release of releasers) release()
}

// Resolves at once when no foreign clear is running.
export const whenForeignClearsSettled = (state: SessionState): Promise<void> => {
  if (state.foreignClearsRunning === 0) return Promise.resolve()
  return new Promise(resolve => {
    state.foreignClearReleasers.push(resolve)
  })
}
