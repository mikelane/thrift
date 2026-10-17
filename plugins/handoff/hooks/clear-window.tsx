import type { EngineInterface } from 'claude-code'

import type { BandState } from '../types'
import { WAITING, WAITING_STATUS } from './band-text'
import type { ClearedBy, DecisionReason, HandoffRequest, SettledHandoff, Trigger } from './decision-record'
import { debug } from './engine-log'
import { isBackgroundBusy } from './background-busy'
import { busyRefusalMessage, clearFailedMessage, sessionEndedMessage } from './handoff-note'
import { writeRecord } from './record-writer'
import { beginOwnClear, preClearOutcome, waitForTurnEnd, type PreClearOutcome, type SessionState } from './session-state'
import { busyRefusalTrigger } from './signals'
import { waitStartedLine } from './wait-started-line'

type RedrawBand = (band: BandState) => Promise<void>
export type AbandonHandoff = (settledHandoff: SettledHandoff, reason: DecisionReason, message: string, sessionId: string) => Promise<void>

// Who ran the clear for each outcome that reaches it; a new outcome fails to compile until it is mapped here.
export const CLEARED_BY = {
  clear: 'handoff',
  deliver_to_person_clear: 'person',
} as const satisfies Record<Exclude<PreClearOutcome, 'abandon_session_ended' | 'abandon_busy'>, ClearedBy>

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

// Whether the session was compacted: a vetoed or failed compaction leaves it as it was.
export async function compactBeforeClearing(
  $: EngineInterface,
  state: SessionState,
  trigger: Trigger,
  sessionId: string,
): Promise<boolean> {
  try {
    const compaction = await $.session.compact()
    if (compaction.skip === undefined) return true
    await writeRecord($, state, { ...trigger, action: 'none', reason: 'compaction_vetoed', sessionId })
  } catch (error) {
    debug($, `compaction before the clear failed: ${String(error)}`)
    await writeRecord($, state, { ...trigger, action: 'none', reason: 'compaction_failed', sessionId })
  }
  return false
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
      hasCompactedBeforeClear = await compactBeforeClearing($, state, request.trigger, oldId)
      continue
    }
    if (!mustRefuseWhenBusy) break
    isBusy = await isBackgroundBusy($, state)
    if (!state.isTurnRunning) break
  }
  const outcome = preClearOutcome(state.sessionEndBeforeClear, isBusy)
  const clearWindow = { outcome, hasCompactedBeforeClear, hasTurnAfterNote: state.hasTurnAfterNote }
  if (outcome !== 'clear') return { ...clearWindow, clearing: null }
  beginOwnClear(state)
  return { ...clearWindow, clearing: clearSession($) }
}

export type AbandonCause = 'session_ended' | 'busy' | 'clear_failed'

// Abandons a handoff after the wait: the session ended, background work was running, or the clear failed.
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
    default: {
      const unhandled: never = cause
      return unhandled
    }
  }
}
