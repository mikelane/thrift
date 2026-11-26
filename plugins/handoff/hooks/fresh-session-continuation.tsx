import type { EngineInterface } from 'claude-code'

import { announce } from './announcement'
import { registerHandoffCommand } from './command-registration'
import { CONTINUE_PROMPT, decideContinue, type ContinueFields, type SessionCheck } from './continue-decision'
import { forgetHeldResumeReplay } from './clear-stage'
import { heldGroupFields, leftoverStripFields, type ClearedBy, type SettledHandoff } from './decision-record'
import { debug } from './engine-log'
import { deliverNote, sendHeldGroups, sendLateArrivals, settlesWithin, submitEntered } from './handoff-delivery'
import { beginSending, releaseCarried } from './handoff-hold-state'
import {
  FINAL_MESSAGES,
  deliveryAfterNote,
  groupHeldPrompts,
  groupsLeftToSend,
  handoffMessage,
  noteInOtherSessionMessage,
  noteTookGroupAlong,
  type NoteDelivery,
} from './handoff-note'
import { worstDelivery } from './held-delivery'
import { inspectPrompt } from './prompt-inspection'
import { noteOrigin } from './prompt-plan'
import { writeRecord } from './record-writer'
import type { HeldPrompt, SessionState } from './session-state'
import { tryReadSessionId } from './session-id'

// A held /resume that never returns must not hold back the record, the held prompts and the continue prompt for good.
export const HELD_RESUME_REPLAY_TIMEOUT_MS = 5000

// Whether the held /resume replay moved the person. A replay that does not return in time is not known to have moved them, so
// the session id check decides.
async function hasHeldResumeMoved($: EngineInterface, state: SessionState): Promise<boolean> {
  const replay = state.heldResumeReplay
  if (replay === null) return false
  // The handoff that follows the clear takes the replay, even if it stops waiting, so a later handoff never reads a stale one.
  forgetHeldResumeReplay(state, replay)
  let hasMoved = false
  const hasSettled = await settlesWithin($, replay.then(moved => { hasMoved = moved }), HELD_RESUME_REPLAY_TIMEOUT_MS)
  if (!hasSettled) debug($, `a held /resume did not return within ${HELD_RESUME_REPLAY_TIMEOUT_MS} ms, so the session id decides whether the person moved`)
  return hasMoved
}

// A /resume queued behind the clear runs in the fresh session, so by the time the note is in, the person may be in another
// session. An id that cannot be read on either side is not taken for a move.
async function hasSessionMovedFrom($: EngineInterface, noteSessionId: string | undefined): Promise<boolean> {
  if (noteSessionId === undefined) return false
  const currentSessionId = await tryReadSessionId($, ' for the move check')
  if (currentSessionId === undefined || currentSessionId === noteSessionId) return false
  debug($, `session moved: the note went to ${noteSessionId}, and the person is now in ${currentSessionId}`)
  return true
}

// The submit runs in a clock tick, since the engine refuses one from a hook the turn may be waiting on.
// SAFETY: tryReadSessionId and submitEntered catch their own failures, so run never rejects and no test reaches the reject.
// Keep it: a run that did reject would otherwise leave the handoff waiting forever with its claim held.
function afterTick<T>($: EngineInterface, run: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    $.clock.after(0, () => {
      run().then(resolve, reject)
    })
  })
}

async function checkSession($: EngineInterface, noteSessionId: string | undefined): Promise<SessionCheck> {
  if (noteSessionId === undefined) return 'unknown'
  const currentSessionId = await tryReadSessionId($, ' for the continue check')
  if (currentSessionId === undefined) return 'unknown'
  return currentSessionId === noteSessionId ? 'same' : 'moved'
}

type ContinueContext = {
  noteSessionId: string | undefined
  noteDelivery: NoteDelivery
  hasHeldPromptStartedTurn: boolean
  clearedBy: ClearedBy
}

async function submitContinuePrompt(
  $: EngineInterface,
  state: SessionState,
  settledHandoff: SettledHandoff,
  { noteSessionId, noteDelivery, hasHeldPromptStartedTurn, clearedBy }: ContinueContext,
): Promise<ContinueFields> {
  const decide = (sessionCheck: SessionCheck, hasTurnStarted: boolean) =>
    decideContinue({
      isEnabled: state.continueAfterHandoff,
      effectiveMode: settledHandoff.trigger.effectiveMode,
      signal: settledHandoff.trigger.signal,
      noteDelivery,
      hasHeldPromptStartedTurn: hasTurnStarted,
      sessionCheck,
      clearedBy,
    })
  const beforeTick = decide('same', hasHeldPromptStartedTurn)
  if (!beforeTick.submit) return beforeTick.fields
  // The session and turn checks run inside the tick, straight before the submit: the hold on prompts has ended, so a
  // /resume, /clear, or prompt the person sends before the tick is seen here rather than overtaken by the submit.
  return afterTick($, async () => {
    const decision = decide(await checkSession($, noteSessionId), hasHeldPromptStartedTurn || state.isTurnRunning)
    if (!decision.submit) return decision.fields
    const { isUnattended } = settledHandoff
    const prompt: HeldPrompt = { text: CONTINUE_PROMPT, isUnattended, origin: noteOrigin(isUnattended), author: 'plugin' }
    const isSubmitted = await submitEntered($, state, prompt, 'could not submit the continue prompt', false)
    return isSubmitted ? { continued: 'submitted' } : { continued: 'skipped', continue_skip: 'submit_failed' }
  })
}

// What the clear that came before the delivery looked like: who ran it, and whether the handoff's own clear ran after another.
type ClearContext = { hasTurnAfterNote: boolean; clearedBy: ClearedBy; hasSecondClear: boolean }

export async function continueInFreshSession(
  $: EngineInterface,
  state: SessionState,
  settledHandoff: SettledHandoff,
  oldId: string,
  note: string,
  { hasTurnAfterNote, clearedBy, hasSecondClear }: ClearContext,
): Promise<void> {
  // Before the first await, so no prompt passes unheld after settleHandoff took the held ones: from here a prompt that
  // arrives is held until the note, the held prompts, and every prompt that arrived meanwhile have been delivered.
  beginSending(state)
  await registerHandoffCommand($)
  // Read once the clear has run: a turn the clear let in ahead of itself started in the old session after the last check.
  const hasLateTurn = state.hasLateTurn
  // The session the note is delivered to; the continue prompt and the handed-off line compare against it.
  const { noteDelivery, noteSessionId } = await deliverNote($, state, settledHandoff, handoffMessage(oldId, note, hasTurnAfterNote || hasLateTurn))
  if (noteTookGroupAlong(settledHandoff.heldGroups, settledHandoff.isUnattended, noteDelivery)) releaseCarried(state)
  // Only a note appended or submitted to a transcript is in the session whose id was read. A note in the prompt box, or one
  // that never entered, is not in that session, so there is no session to point the person at.
  const isInTranscript = noteDelivery === 'appended' || noteDelivery === 'submitted'
  // A held /resume replays right after the clear, so wait for it. If it changed the session id, the note's line must not claim
  // this session. If it failed or was cancelled, the person is still here, and the id check decides.
  const hasSessionMoved = isInTranscript && ((await hasHeldResumeMoved($, state)) || (await hasSessionMovedFrom($, noteSessionId)))
  if (hasSessionMoved && noteSessionId !== undefined) $.ui.log(noteInOtherSessionMessage(noteSessionId))
  else announce($, FINAL_MESSAGES[noteDelivery](oldId))
  for (const { text } of settledHandoff.heldGroups) await inspectPrompt($, state, text)
  const groupsToSend = groupsLeftToSend(settledHandoff.heldGroups, settledHandoff.isUnattended, noteDelivery)
  const { holdBackPerson, placement } = deliveryAfterNote(noteDelivery)
  const deliveries = await sendHeldGroups($, state, groupsToSend, settledHandoff.isUnattended, { placement, holdBackPersonGroups: holdBackPerson })
  const late = await sendLateArrivals($, state, holdBackPerson)
  const hasHeldPromptStartedTurn = [...deliveries, ...late.deliveries].includes('submitted')
  const continueFields = await submitContinuePrompt($, state, settledHandoff, { noteSessionId, noteDelivery, hasHeldPromptStartedTurn, clearedBy })
  await writeRecord($, state, {
    ...settledHandoff.trigger,
    action: 'cleared',
    ...(hasSessionMoved ? { reason: 'session_moved' as const, noteSessionId } : {}),
    sessionId: oldId,
    note: noteDelivery,
    clearedBy,
    hasSecondClear,
    compactedBeforeClear: settledHandoff.hasCompactedBeforeClear,
    lateTurn: hasLateTurn,
    continueFields,
    heldFields: {
      ...heldGroupFields(groupHeldPrompts([...settledHandoff.heldGroups, ...late.prompts])),
      handoff_unattended: settledHandoff.isUnattended,
      held_other_delivery: worstDelivery([...deliveries, ...late.deliveries]),
      ...leftoverStripFields(state.leftoverStrips),
    },
  })
}
