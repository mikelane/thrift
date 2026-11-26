import type { EngineInterface } from 'claude-code'

import { heldGroupFields, leftoverStripFields, type ClearedBy, type SettledHandoff } from './decision-record'
import { announce } from './announcement'
import { submissionTextFor } from './scheduled-preface'
import { CONTINUE_PROMPT, decideContinue, type ContinueFields, type SessionCheck } from './continue-decision'
import { registerHandoffCommand } from './command-registration'
import { debug } from './engine-log'
import { tryReadSessionId } from './session-id'
import {
  FINAL_MESSAGES,
  boxCopyOf,
  deliveryAfterNote,
  groupHeldPrompts,
  groupJoiningNote,
  groupsLeftToSend,
  handoffMessage,
  joinPrompts,
  noteInOtherSessionMessage,
  noteTookGroupAlong,
  speaksForPerson,
  type Carried,
  type NoteDelivery,
} from './handoff-note'
import { worstDelivery } from './held-delivery'
import { inspectPrompt } from './prompt-inspection'
import { canUseBox, emptySentPromptFromBox, keepInTranscript, markKeptInBox, refillBox } from './prompt-box'
import { noteOrigin } from './prompt-plan'
import { writeRecord } from './record-writer'
import type { HeldPrompt, HeldPromptGroup, SessionState } from './session-state'
import { queueResubmittedPrompt, removeResubmittedPrompt } from './turn-state'
import { forgetHeldResumeReplay, whenForeignClearsSettled } from './clear-stage'
import { beginSending, releaseCarried, releaseCarriedGroup, takeLateArrivalsOrEndSending, type BoxPlacement } from './prompt-hold-state'

const UNSENT_NOTE = 'The handoff note could not be sent or put in the prompt box. Here it is:'
const UNSENT_UNATTENDED_NOTE = 'The handoff note could not be sent, so here it is:'
// Held back by design, not by a failed send: none was tried, because the note did not enter the fresh session.
const HELD_BACK_PROMPT = 'Your prompt was held back after the handoff note, so read the note first. Here it is:'
const HELD_BACK_OTHER_PROMPT = 'A prompt was held back after the handoff note, so read the note first. Here it is:'
const UNSENT_NOTE_AND_OTHER_PROMPT = 'The handoff note and a prompt could not be sent, so here they are:'

// Declared as functions: the engine follows `$` past an import only into a function declaration, not a const arrow.

// The engine cannot submit a prompt under another origin: the plugin's submission arrives as origin 'plugin', which this
// plugin's prompt.submit hook does not classify. Submit resolves once the prompt's turn started or once it was queued behind
// the running turn, so a resolved submit does not mean its turn has begun. So the origin goes into a queue here and the
// turn.start hook takes it. A hook beneath the plugin that refuses the prompt makes submit resolve with { drop } instead of
// rejecting.
// A prompt someone else sent says where it came from; the plugin's own note and continue prompt are not carried prompts. The
// queued entry holds the text that is submitted, because the turn it starts is matched back to it by that text.
async function submitEntered(
  $: EngineInterface,
  state: SessionState,
  prompt: HeldPrompt,
  failureLabel: string,
  asUser: boolean,
): Promise<boolean> {
  const submission = { ...prompt, text: submissionTextFor(prompt, asUser) }
  queueResubmittedPrompt(state, submission)
  try {
    const result = await $.prompt.submit(asUser ? { text: submission.text, asUser: true } : { text: submission.text })
    if (result.drop === undefined) return true
    debug($, `${failureLabel}: ${result.drop}`)
  } catch (error) {
    debug($, `${failureLabel}: ${String(error)}`)
  }
  removeResubmittedPrompt(state, submission)
  return false
}

export async function submitOrKeepInTranscript($: EngineInterface, state: SessionState, prompt: HeldPrompt): Promise<Carried> {
  if (await submitEntered($, state, prompt, 'could not restore the held prompt', speaksForPerson(prompt))) return 'submitted'
  keepInTranscript($, prompt)
  return 'not_carried'
}

async function restorePrompt(
  $: EngineInterface,
  state: SessionState,
  prompt: HeldPrompt,
  placement: BoxPlacement = 'before_draft',
): Promise<Carried> {
  if (canUseBox(prompt) && (await refillBox($, prompt, placement))) return markKeptInBox(state)
  const carried = await submitOrKeepInTranscript($, state, prompt)
  if (carried === 'submitted') await emptySentPromptFromBox($, state, prompt)
  return carried
}

// SAFETY: the record is written after restoreHeldGroups and sendHeldGroups return, so a throw inside either loop would lose
// the record. refillBox and submitEntered catch their own failures, and keepInTranscript and releaseCarriedGroup make no
// async calls, so no test can make a loop throw. Any call added to a loop must not throw either.
export async function restoreHeldGroups($: EngineInterface, state: SessionState, settledHandoff: SettledHandoff): Promise<Carried[]> {
  const restores: Carried[] = []
  for (const group of settledHandoff.heldGroups) {
    restores.push(await restorePrompt($, state, group))
    releaseCarriedGroup(state, group, settledHandoff.isUnattended)
  }
  return restores
}

type LateArrivals = { prompts: HeldPrompt[]; deliveries: Carried[] }

// Prompts that arrived during a delivery or a restore go back one by one in arrival order, and more may arrive while they do.
async function forEachLateArrival(
  state: SessionState,
  carryPrompt: (prompt: HeldPrompt) => Promise<Carried>,
): Promise<LateArrivals> {
  const prompts: HeldPrompt[] = []
  const deliveries: Carried[] = []
  for (let arrived = takeLateArrivalsOrEndSending(state); arrived.length > 0; arrived = takeLateArrivalsOrEndSending(state)) {
    for (const prompt of arrived) deliveries.push(await carryPrompt(prompt))
    prompts.push(...arrived)
  }
  return { prompts, deliveries }
}

export function restoreLateArrivals($: EngineInterface, state: SessionState): Promise<LateArrivals> {
  return forEachLateArrival(state, prompt => restorePrompt($, state, prompt, 'after_draft'))
}

async function appendNote($: EngineInterface, message: string): Promise<boolean> {
  try {
    const appended = await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: message }] } })
    if (appended.deny === undefined) return true
    debug($, `append denied: ${appended.deny}`)
    return false
    // The test kit cannot make the default append reject: a throwing session.append hook is treated as a hook failure,
    // and the plugin sees a successful append. Whether the live default append can reject is unverified.
    // Keep it: without it, a rejected append skips the prompt fallback and drops the handoff note.
  } catch (error) {
    debug($, `append failed: ${String(error)}`)
    return false
  }
}

// holdBack keeps a prompt out of the fresh session: a person's prompt must not run ahead of a note that never entered it.
type SendOptions = { placement?: BoxPlacement; notice?: string | undefined; holdBack?: boolean }

export async function sendOrKeepInBox(
  $: EngineInterface,
  state: SessionState,
  prompt: HeldPrompt,
  { placement = 'before_draft', notice, holdBack = false }: SendOptions = {},
): Promise<Carried> {
  if (!holdBack && (await submitEntered($, state, prompt, 'could not send the prompt', speaksForPerson(prompt)))) {
    await emptySentPromptFromBox($, state, prompt)
    return 'submitted'
  }
  if (canUseBox(prompt) && (await refillBox($, prompt, placement))) return markKeptInBox(state)
  keepInTranscript($, prompt, holdBack ? (canUseBox(prompt) ? HELD_BACK_PROMPT : HELD_BACK_OTHER_PROMPT) : notice)
  return 'not_carried'
}

// A scheduled handoff's note rides with the scheduled group, both under the plugin's frame. An attended handoff's note goes alone
// and framed, then the person's prompts follow it as the person's own words.
// A note that is never offered to the box (a scheduled handoff's) gets a notice that does not say it was, and a note joined to
// a scheduled prompt names both.
function unsentNoteNotice(note: HeldPrompt, isJoined: boolean): string {
  if (isJoined) return UNSENT_NOTE_AND_OTHER_PROMPT
  return canUseBox(note) ? UNSENT_NOTE : UNSENT_UNATTENDED_NOTE
}

// Waits for a promise, but no longer than the timeout. Resolves to true if the promise settled in time, false if the timeout won. The timer is cancelled either way.
async function settlesWithin($: EngineInterface, wait: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: { cancel: () => void } | undefined
  const timedOut = new Promise<boolean>(resolve => {
    timer = $.clock.after(timeoutMs, () => resolve(true))
  })
  const hasTimedOut = await Promise.race([wait.then(() => false), timedOut])
  timer?.cancel()
  return !hasTimedOut
}

// A clear that never returns must not hold the note back for good.
export const FOREIGN_CLEAR_TIMEOUT_MS = 5000

// The person's /clear can still be switching to the fresh session when the handoff resumes. The engine then still reports the
// id of the cleared session, which the clear is about to empty. Wait for the clear to return, then read the id.
async function waitForForeignClearsOrTimeOut($: EngineInterface, state: SessionState): Promise<void> {
  const hasSettled = await settlesWithin($, whenForeignClearsSettled(state), FOREIGN_CLEAR_TIMEOUT_MS)
  if (!hasSettled) debug($, `a clear did not return within ${FOREIGN_CLEAR_TIMEOUT_MS} ms, so the note goes to the session the engine names now`)
}

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

type NoteDeliveryResult = { noteDelivery: NoteDelivery; noteSessionId: string | undefined }

// The session id is read straight before the append, and again straight before the prompt submit when the append is refused,
// with nothing awaited between a read and its send: a /clear or /resume queued behind the handoff's clear may run while the
// delivery registers its command or the append is refused, and the note then goes to the session the person is in.
async function deliverNote(
  $: EngineInterface,
  state: SessionState,
  settledHandoff: SettledHandoff,
  message: string,
): Promise<NoteDeliveryResult> {
  await waitForForeignClearsOrTimeOut($, state)
  const appendSessionId = await tryReadSessionId($, ' for the delivery (append)')
  if (await appendNote($, message)) return { noteDelivery: 'appended', noteSessionId: appendSessionId }
  const submitSessionId = await tryReadSessionId($, ' for the delivery (submit)')
  return { noteDelivery: await deliverNoteAsPrompt($, state, settledHandoff, message), noteSessionId: submitSessionId }
}

async function deliverNoteAsPrompt(
  $: EngineInterface,
  state: SessionState,
  settledHandoff: SettledHandoff,
  message: string,
): Promise<NoteDelivery> {
  const sameOriginGroup = groupJoiningNote(settledHandoff.heldGroups, settledHandoff.isUnattended)
  const origin = sameOriginGroup?.origin ?? noteOrigin(settledHandoff.isUnattended)
  // SAFETY: the joined group is a scheduled one, and only a prompt typed at the composer leaves a copy in the box, so boxCopy is
  // always undefined today and no test can tell whether it is passed on. It stays so a group that does carry one is not lost.
  const boxCopy = sameOriginGroup === undefined ? undefined : boxCopyOf(sameOriginGroup)
  const note: HeldPrompt = {
    text: joinPrompts(message, sameOriginGroup === undefined ? undefined : submissionTextFor(sameOriginGroup, false)),
    isUnattended: settledHandoff.isUnattended,
    origin,
    author: 'plugin',
    ...(boxCopy === undefined ? {} : { boxText: boxCopy }),
  }
  return sendOrKeepInBox($, state, note, { notice: unsentNoteNotice(note, sameOriginGroup !== undefined) })
}

async function sendHeldGroups(
  $: EngineInterface,
  state: SessionState,
  groups: readonly HeldPromptGroup[],
  handoffIsUnattended: boolean,
  { placement, holdBackPersonGroups }: { placement: BoxPlacement; holdBackPersonGroups: boolean },
): Promise<Carried[]> {
  const deliveries: Carried[] = []
  for (const group of groups) {
    deliveries.push(await sendOrKeepInBox($, state, group, { placement, holdBack: holdBackPersonGroups && speaksForPerson(group) }))
    releaseCarriedGroup(state, group, handoffIsUnattended)
  }
  return deliveries
}

function sendLateArrivals($: EngineInterface, state: SessionState, holdBackPersonPrompts: boolean): Promise<LateArrivals> {
  return forEachLateArrival(state, async prompt => {
    // Counted as seen like the held groups are before they go in, so a ticket named in a late prompt is not new work later.
    await inspectPrompt($, state, prompt.text)
    return sendOrKeepInBox($, state, prompt, { placement: 'after_draft', holdBack: holdBackPersonPrompts && speaksForPerson(prompt) })
  })
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
