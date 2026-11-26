import type { HeldPrompt, SessionState } from './session-state'

// The most specific match wins: a carried prompt's text holds a fixed preface, so a short prompt queued earlier can be a word
// of it. Of the entries whose text the turn's text contains, the longest is taken, and the earliest submitted among equals.
const indexOfLongestQueuedMatch = (queue: readonly HeldPrompt[], turnText: string): number =>
  queue.reduce(
    (best, prompt, index) =>
      turnText.includes(prompt.text) && (best === -1 || prompt.text.length > (queue[best]?.text.length ?? 0)) ? index : best,
    -1,
  )

// A turn that one of the plugin's own submissions started takes that prompt's origin from the queue below.
export const startMainTurn = (state: SessionState, turnText: string): void => {
  state.isTurnRunning = true
  const matchIndex = indexOfLongestQueuedMatch(state.resubmittedPrompts, turnText)
  const resubmittedPrompt = matchIndex === -1 ? undefined : state.resubmittedPrompts.splice(matchIndex, 1)[0]
  if (resubmittedPrompt !== undefined) state.isTurnUnattended = resubmittedPrompt.isUnattended
  recordTurnStart(state)
}

// A subagent's or teammate's turn is work the note missed, whoever started it, so it counts toward both lines. It is not a
// main-thread turn: only the main thread's turn.complete clears isTurnRunning, so setting it here would hold a handoff for
// good. Nor can it be one of the plugin's own submissions, which only start main-thread turns, so it leaves the queue and
// the turn's origin alone even when its prompt quotes a queued one. Its id is kept until it ends, so a note begun while it
// runs counts it as beginNoteWindow counts a running main turn.
export const startSubagentTurn = (state: SessionState, turnId: string): void => {
  state.runningSubagentTurns.add(turnId)
  recordTurnStart(state)
}

// A subagent turn whose start this plugin did not hear (its spawn was nested in a hook) ends with nothing to remove.
// SAFETY: the set never feeds the wait for a turn, so an entry left behind costs at most a spurious turn-after-note line,
// never a held handoff.
export const endSubagentTurn = (state: SessionState, turnId: string): void => {
  state.runningSubagentTurns.delete(turnId)
}

// A turn in the session the person cleared to is not one the note missed, so it does not count.
const recordTurnStart = (state: SessionState): void => {
  if (state.sessionEndBeforeClear === null) state.hasTurnAfterNote = true
  if (state.isOwnClearQueued) state.hasLateTurn = true
}

export const endMainTurn = (state: SessionState): void => {
  state.isTurnRunning = false
}

// The engine has no origin to give a prompt the plugin submits, and submit can resolve once the prompt is queued behind the
// running turn, before its own turn starts. So the origins of the plugin's own submissions wait here in submit order, and a turn
// start takes the entry with the longest text the turn's text contains, the earliest submitted among equals: turn.start gives
// the text, which may carry a frame around what was submitted, so the match is "contains", not "equals". A turn whose text
// matches none (a task notification, a peer's message) leaves the queue alone.
// SAFETY: a turn that merely contains a queued prompt's text, such as a task notification quoting it, would take its entry,
// and a short prompt makes that likelier (the longest-match rule keeps a short entry from beating the turn's own, longer one). An entry stays until a turn takes it, so one whose text a hook beneath rewrote
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
