import type { EngineInterface } from 'claude-code'

import type { BandState } from '../types'
import { WRITING, WRITING_STATUS } from './band-text'
import { redrawBand, takeDownBand } from './band-controller'
import { CLEARED_BY, abandonAfterWait, type AbandonHandoff, waitForClearWindow } from './clear-window'
import {
  heldGroupFields,
  leftoverStripFields,
  type DecisionReason,
  type HandoffRequest,
  type SettledHandoff,
} from './decision-record'
import { announce } from './announcement'
import { debug, logFailure } from './engine-log'
import { noteOutcome, type ForkReason, type NoteOutcome } from './fork-outcome'
import { continueInFreshSession, restoreHeldGroups, restoreLateArrivals } from './handoff-delivery'
import { HANDOFF_PROMPT, NO_HANDOFF_MESSAGE, groupHeldPrompts, noHandoffMessage } from './handoff-note'
import { worstDelivery } from './held-delivery'
import { writeRecord } from './record-writer'
import {
  beginBeforeClear,
  beginHandoffHold,
  beginNoteWindow,
  beginSending,
  claimPending,
  endHandoff,
  takeHeldPrompts,
  type SessionState,
} from './session-state'

// A failed read leaves the id to writeRecord, which reads it again. If that fails too, no record is written and
// writeRecord leaves its own debug line.
async function readSessionId($: EngineInterface): Promise<string | undefined> {
  try {
    return await $.session.id()
  } catch (error) {
    debug($, `could not read the session id: ${String(error)}`)
    return undefined
  }
}

async function abandonHandoff(
  $: EngineInterface,
  state: SessionState,
  settledHandoff: SettledHandoff,
  reason: DecisionReason,
  message: string,
  sessionId?: string,
  forkReason?: ForkReason,
) {
  // Before the first await, as in continueInFreshSession: the caller took the held prompts in the same synchronous run, so a
  // prompt that arrives while they are restored is held until they, and every prompt that arrived meanwhile, are back.
  beginSending(state)
  await takeDownBand($, state)
  announce($, message)
  const recordedSessionId = sessionId ?? (await readSessionId($))
  const restores = await restoreHeldGroups($, state, settledHandoff)
  const late = await restoreLateArrivals($, state)
  await writeRecord($, state, {
    ...settledHandoff.trigger,
    action: 'none',
    reason,
    forkReason,
    compactedBeforeClear: settledHandoff.hasCompactedBeforeClear,
    heldFields: {
      ...heldGroupFields(groupHeldPrompts([...settledHandoff.heldGroups, ...late.prompts])),
      handoff_unattended: settledHandoff.isUnattended,
      held_restore: worstDelivery([...restores, ...late.deliveries]),
      ...leftoverStripFields(state.leftoverStrips),
    },
    sessionId: recordedSessionId,
  })
}

async function writeNote($: EngineInterface): Promise<NoteOutcome> {
  try {
    const answer = await $.model.fork({ prompt: HANDOFF_PROMPT })
    // nothing-to-fork already reaches the record as fork_reason; every other non-answer is explained only here.
    if (!answer.isAnswered && answer.reason !== 'nothing-to-fork') {
      const detail = answer.reason === 'api-error' ? ` (status ${String(answer.status)}, ${answer.error})` : ''
      debug($, `the fork wrote no handoff note: ${answer.reason}${detail}`)
    }
    return noteOutcome(answer)
  } catch (error) {
    debug($, `could not write the handoff note: ${String(error)}`)
    return { note: null }
  }
}

async function prepareHandoff($: EngineInterface, state: SessionState, request: HandoffRequest) {
  let oldId: string | undefined
  try {
    await redrawBand($, state, WRITING)
    $.ui.toast(WRITING_STATUS)
    // SAFETY: a session end between scheduleHandoff and this read would make oldId the new session's id. That needs a
    // /clear in the same clock.after(0) tick as /handoff, which a person typing cannot produce; SDK or bridge commands
    // sent back to back could. No guard: the note would still be delivered, but the resume line and the cleared record's
    // session_id would name the new session instead of the one the note came from.
    oldId = await $.session.id()
    beginNoteWindow(state)
    const outcome = await writeNote($)
    if (outcome.note === null) {
      await abandonHandoff($, state, settleHandoff(state, request), 'no_handoff_written', noHandoffMessage(outcome.forkReason), oldId, outcome.forkReason)
      return null
    }
    return { oldId, note: outcome.note }
  } catch (error) {
    debug($, `handoff failed before the clear: ${String(error)}`)
    await abandonHandoff($, state, settleHandoff(state, request), 'handoff_failed', NO_HANDOFF_MESSAGE, oldId)
    return null
  }
}

async function runHandoff(
  $: EngineInterface,
  state: SessionState,
  request: HandoffRequest,
  beforeRun?: () => Promise<unknown>,
) {
  try {
    // SAFETY: beforeRun is clearBoxCopyWhileHeld on the prompt path (it wraps emptyBoxIfHolding) and emptyBoxIfHolding
    // on the command path. emptyBoxIfHolding catches its own failures, so no test can make it throw.
    // It runs inside the try so a future beforeRun that throws still releases the claim.
    await beforeRun?.()
    const prepared = await prepareHandoff($, state, request)
    if (prepared === null) return
    const redraw = (band: BandState) => redrawBand($, state, band)
    const abandon: AbandonHandoff = (settled, reason, message, sessionId) => abandonHandoff($, state, settled, reason, message, sessionId)
    const { outcome, hasCompactedBeforeClear, hasTurnAfterNote, clearing } = await waitForClearWindow($, state, request, prepared.oldId, redraw)
    const settleAfterWait = () => ({ ...settleHandoff(state, request), hasCompactedBeforeClear })
    if (outcome === 'abandon_session_ended') return await abandonAfterWait(abandon, settleAfterWait(), 'session_ended', hasCompactedBeforeClear, prepared.oldId)
    if (outcome === 'abandon_busy') return await abandonAfterWait(abandon, settleAfterWait(), 'busy', hasCompactedBeforeClear, prepared.oldId)
    // The person already cleared: the fresh session they made takes the note, and no second clear runs.
    let isCleared = true
    if (clearing !== null) {
      isCleared = await clearing
    } else {
      // No clear runs here, so this await is safe; the waiting status must not outlive the wait.
      // SAFETY: a resume that lands during this await gets the note in the resumed session, as one landing during
      // registerHandoffCommand already does. Each window is one engine round trip wide. No guard.
      await takeDownBand($, state)
    }
    const settledHandoff = settleAfterWait()
    if (!isCleared) {
      return await abandonAfterWait(abandon, settledHandoff, 'clear_failed', hasCompactedBeforeClear, prepared.oldId)
    }
    const clearedBy = CLEARED_BY[outcome]
    await continueInFreshSession($, state, settledHandoff, prepared.oldId, prepared.note, hasTurnAfterNote, clearedBy)
  } finally {
    endHandoff(state)
    state.pending = null
  }
}

export function scheduleHandoff(
  $: EngineInterface,
  state: SessionState,
  request: HandoffRequest,
  beforeRun?: () => Promise<unknown>,
): boolean {
  if (!claimPending(state, 'handoff')) return false
  state.heldPrompt = null
  beginBeforeClear(state)
  beginHandoffHold(
    state,
    request.heldPrompt === undefined
      ? null
      : { text: request.heldPrompt, isUnattended: request.isUnattended, origin: request.heldPromptOrigin ?? 'composer', author: 'person' },
  )
  $.clock.after(0, () => {
    void logFailure($, runHandoff($, state, request, beforeRun))
  })
  return true
}

// Taking the held prompts ends their holding: from here a prompt that arrives belongs to the fresh session or the old one.
function settleHandoff(state: SessionState, request: HandoffRequest): SettledHandoff {
  return {
    trigger: request.trigger,
    isUnattended: request.isUnattended,
    heldGroups: groupHeldPrompts(takeHeldPrompts(state)),
  }
}
