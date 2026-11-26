import type { EngineInterface } from 'claude-code'

import type { BandState } from '../types'
import { WAITING, WAITING_STATUS } from './band-text'
import type { ClearSkipCause, DecisionReason, HandoffRequest, SettledHandoff, Trigger } from './decision-record'
import { debug } from './engine-log'
import { isBackgroundBusy } from './background-busy'
import { CLEAR_SKIPPED_MESSAGE, busyRefusalMessage, clearFailedMessage, sessionEndedMessage } from './handoff-note'
import { writeRecord } from './record-writer'
import { beginOwnClear, markOwnClearReturned, preClearOutcome, takeHeldResumes, waitForTurnEnd, type PreClearOutcome, type SessionState } from './session-state'
import { busyRefusalTrigger } from './signals'
import { waitStartedLine } from './wait-started-line'

type RedrawBand = (band: BandState) => Promise<void>
export type AbandonHandoff = (
  settledHandoff: SettledHandoff,
  reason: DecisionReason,
  message: string,
  sessionId: string,
  clearSkipCause?: ClearSkipCause,
) => Promise<void>

type ClearWindow = {
  outcome: PreClearOutcome
  hasCompactedBeforeClear: boolean
  // Read in the same synchronous run that starts the clear, so a turn that the clear lets in cannot change it.
  hasTurnAfterNote: boolean
  // Set only when the outcome is 'clear': the handoff's own /clear, already started.
  clearing: Promise<boolean> | null
}

// A session end already decided the outcome, so the wait is no longer about a clear the handoff will issue.
export async function showWaitingStatus($: EngineInterface, state: SessionState, redrawBand: RedrawBand): Promise<void> {
  if (state.sessionEndBeforeClear !== null) return
  await redrawBand(WAITING)
  $.ui.toast(WAITING_STATUS)
}

// Only a compaction that did not happen can have been preempted.
type CompactionResult = { isCompacted: true; isCompactionPreempted: false } | { isCompacted: false; isCompactionPreempted: boolean }

// Whether the session was compacted: a vetoed or failed compaction leaves it as it was. A compaction that failed while a turn
// was running was preempted by that turn: the engine refuses a compaction against a turn in flight (seen on 2.1.302 when a
// command the person typed during the wait ran the moment the turn ended). The plugin sees the turn, not who started it.
export async function compactBeforeClearing(
  $: EngineInterface,
  state: SessionState,
  trigger: Trigger,
  sessionId: string,
): Promise<CompactionResult> {
  try {
    const compaction = await $.session.compact()
    if (compaction.skip === undefined) return { isCompacted: true, isCompactionPreempted: false }
    await writeRecord($, state, { ...trigger, action: 'none', reason: 'compaction_vetoed', sessionId })
  } catch (error) {
    // Read before the first await below, so the record write cannot change it.
    const isCompactionPreempted = state.isTurnRunning
    debug($, `compaction before the clear failed: ${String(error)}`)
    // A preempted compaction ends the handoff, and the record that ends it carries compaction_failed: one record, not two.
    if (!isCompactionPreempted) await writeRecord($, state, { ...trigger, action: 'none', reason: 'compaction_failed', sessionId })
    return { isCompacted: false, isCompactionPreempted }
  }
  return { isCompacted: false, isCompactionPreempted: false }
}

export async function clearSession($: EngineInterface): Promise<boolean> {
  try {
    await $.command.run({ command: 'clear' })
    return true
  } catch (error) {
    debug($, `/clear failed: ${String(error)}`)
    return false
  }
}

// Waits out running turns, compacts if asked, and checks for background work, then starts the clear.
// SAFETY: on the clear path, no await sits between the last isTurnRunning read and the $.command.run inside
// clearSession. Every awaited step before the clear (the waiting status, the compaction, the busy check) is followed by
// another pass through the wait, and the loop resumes straight from waitForTurnEnd, so a turn.start cannot land in the
// gap. That is why the clear starts here, in the same synchronous run as the last read, and the caller only awaits the
// promise it gets back: returning the outcome first and clearing in the caller would put an await in the gap.
// clearSession's first step is the synchronous command call. Do not add an await after the loop, or move the clear
// behind a helper that awaits first. The person-cleared branch may await in the caller: no clear runs there.
export async function waitForClearWindow(
  $: EngineInterface,
  state: SessionState,
  request: HandoffRequest,
  oldId: string,
  redrawBand: RedrawBand,
): Promise<ClearWindow> {
  const mustRefuseWhenBusy = request.trigger.point !== 'command'
  let isCompacted = !state.compactBeforeClear
  let isBusy = false
  let hasShownWaiting = false
  let hasCompactedBeforeClear = false
  let isCompactionPreempted = false
  for (;;) {
    while (state.isTurnRunning) {
      if (!hasShownWaiting) {
        hasShownWaiting = true
        debug($, waitStartedLine(state))
        await showWaitingStatus($, state, redrawBand)
        continue
      }
      await waitForTurnEnd(state)
      debug($, 'resumed after the wait for a running turn')
    }
    if (state.sessionEndBeforeClear !== null) break
    if (!isCompacted) {
      isCompacted = true
      const compaction = await compactBeforeClearing($, state, request.trigger, oldId)
      hasCompactedBeforeClear = compaction.isCompacted
      isCompactionPreempted = compaction.isCompactionPreempted
      continue
    }
    if (!mustRefuseWhenBusy) break
    isBusy = await isBackgroundBusy($, state)
    if (!state.isTurnRunning) break
  }
  const outcome = preClearOutcome(state.sessionEndBeforeClear, isBusy, isCompactionPreempted)
  if (outcome === 'abandon_compaction_preempted') debug($, 'the compaction was preempted by a running turn, so the handoff skips the clear')
  const clearWindow = { outcome, hasCompactedBeforeClear, hasTurnAfterNote: state.hasTurnAfterNote }
  if (outcome !== 'clear') return { ...clearWindow, clearing: null }
  beginOwnClear(state)
  const clearing = clearSession($).then(isCleared => {
    markOwnClearReturned(state)
    replayHeldResumes($, state)
    return isCleared
  })
  return { ...clearWindow, clearing }
}

// A session id the engine could not name is no id: a replay is not taken for a move unless both ids are known.
async function readSessionIdOrUndefined($: EngineInterface): Promise<string | undefined> {
  try {
    return await $.session.id()
  } catch (error) {
    debug($, `could not read the session id around the /resume replay: ${String(error)}`)
    return undefined
  }
}

// Each /resume held while the clear was queued runs now, one after another, in a later tick: the engine refuses a command
// started inside the hook it waits on. A failed replay goes to the debug log, and the rest still run.
function replayHeldResumes($: EngineInterface, state: SessionState): void {
  const heldResumeArgs = takeHeldResumes(state)
  if (heldResumeArgs.length === 0) return
  // Set before the tick, so the delivery that follows the clear can wait for the outcome. A /resume that returns is not a move:
  // the picker a bare /resume opens can be cancelled. Only a session id that differs afterwards counts.
  state.heldResumeReplay = new Promise<boolean>(resolve => {
    $.clock.after(0, () => {
      void (async () => {
        const idBefore = await readSessionIdOrUndefined($)
        for (const resumeArgs of heldResumeArgs) {
          try {
            await $.command.run({ command: 'resume', args: resumeArgs })
          } catch (error) {
            debug($, `/resume replay failed: ${String(error)}`)
          }
        }
        const idAfter = await readSessionIdOrUndefined($)
        state.heldResumeReplay = null
        resolve(idBefore !== undefined && idAfter !== undefined && idBefore !== idAfter)
      })()
    })
  })
}

export type AbandonCause = 'session_ended' | 'busy' | 'clear_failed' | 'compaction_preempted'

// Abandons a handoff after the wait: the session ended, background work was running, a turn preempted the compaction, or the clear failed.
// No clear starts here, so the no-await rule on waitForClearWindow does not apply.
export function abandonAfterWait(
  abandon: AbandonHandoff,
  settledHandoff: SettledHandoff,
  cause: AbandonCause,
  hasCompactedBeforeClear: boolean,
  oldId: string,
): Promise<void> {
  switch (cause) {
    case 'session_ended':
      return abandon(settledHandoff, 'session_ended', sessionEndedMessage(hasCompactedBeforeClear, oldId), oldId)
    case 'busy': {
      const busySettled = { ...settledHandoff, trigger: busyRefusalTrigger(settledHandoff.trigger) }
      return abandon(busySettled, 'background_busy', busyRefusalMessage(hasCompactedBeforeClear), oldId)
    }
    case 'clear_failed':
      return abandon(settledHandoff, 'clear_failed', clearFailedMessage(hasCompactedBeforeClear), oldId)
    case 'compaction_preempted':
      return abandon(settledHandoff, 'compaction_failed', CLEAR_SKIPPED_MESSAGE, oldId, 'turn_running')
    default: {
      const unhandled: never = cause
      return unhandled
    }
  }
}
