import type { EngineInterface } from 'claude-code'

import { heldGroupFields, leftoverStripFields, type ClearedBy, type SettledHandoff } from './decision-record'
import { announce, debug, registerHandoffCommand } from './engine-log'
import {
  FINAL_MESSAGES,
  boxCopyOf,
  deliveryAfterNote,
  groupHeldPrompts,
  groupJoiningNote,
  groupsLeftToSend,
  handoffMessage,
  joinPrompts,
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
import {
  beginSending,
  queueResubmittedPrompt,
  releaseCarried,
  releaseCarriedGroup,
  removeResubmittedPrompt,
  takeLateArrivalsOrEndSending,
  type BoxPlacement,
  type HeldPrompt,
  type HeldPromptGroup,
  type SessionState,
} from './session-state'

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
async function submitEntered(
  $: EngineInterface,
  state: SessionState,
  prompt: HeldPrompt,
  failureLabel: string,
  asUser: boolean,
): Promise<boolean> {
  queueResubmittedPrompt(state, prompt)
  try {
    const result = await $.prompt.submit(asUser ? { text: prompt.text, asUser: true } : { text: prompt.text })
    if (result.drop === undefined) return true
    debug($, `${failureLabel}: ${result.drop}`)
  } catch (error) {
    debug($, `${failureLabel}: ${String(error)}`)
  }
  removeResubmittedPrompt(state, prompt)
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

async function deliverNote(
  $: EngineInterface,
  state: SessionState,
  settledHandoff: SettledHandoff,
  message: string,
): Promise<NoteDelivery> {
  if (await appendNote($, message)) return 'appended'
  const sameOriginGroup = groupJoiningNote(settledHandoff.heldGroups, settledHandoff.isUnattended)
  const origin = sameOriginGroup?.origin ?? noteOrigin(settledHandoff.isUnattended)
  // SAFETY: the joined group is a scheduled one, and only a prompt typed at the composer leaves a copy in the box, so boxCopy is
  // always undefined today and no test can tell whether it is passed on. It stays so a group that does carry one is not lost.
  const boxCopy = sameOriginGroup === undefined ? undefined : boxCopyOf(sameOriginGroup)
  const note: HeldPrompt = {
    text: joinPrompts(message, sameOriginGroup?.text),
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

export async function continueInFreshSession(
  $: EngineInterface,
  state: SessionState,
  settledHandoff: SettledHandoff,
  oldId: string,
  note: string,
  hasTurnAfterNote: boolean,
  clearedBy: ClearedBy,
): Promise<void> {
  // Before the first await, so no prompt passes unheld after settleHandoff took the held ones: from here a prompt that
  // arrives is held until the note, the held prompts, and every prompt that arrived meanwhile have been delivered.
  beginSending(state)
  await registerHandoffCommand($)
  // Read once the clear has run: a turn the clear let in ahead of itself started in the old session after the last check.
  const hasLateTurn = state.hasLateTurn
  const noteDelivery = await deliverNote($, state, settledHandoff, handoffMessage(oldId, note, hasTurnAfterNote || hasLateTurn))
  if (noteTookGroupAlong(settledHandoff.heldGroups, settledHandoff.isUnattended, noteDelivery)) releaseCarried(state)
  announce($, FINAL_MESSAGES[noteDelivery](oldId))
  for (const { text } of settledHandoff.heldGroups) await inspectPrompt($, state, text)
  const groupsToSend = groupsLeftToSend(settledHandoff.heldGroups, settledHandoff.isUnattended, noteDelivery)
  const { holdBackPerson, placement } = deliveryAfterNote(noteDelivery)
  const deliveries = await sendHeldGroups($, state, groupsToSend, settledHandoff.isUnattended, { placement, holdBackPersonGroups: holdBackPerson })
  const late = await sendLateArrivals($, state, holdBackPerson)
  await writeRecord($, state, {
    ...settledHandoff.trigger,
    action: 'cleared',
    sessionId: oldId,
    note: noteDelivery,
    clearedBy,
    compactedBeforeClear: settledHandoff.hasCompactedBeforeClear,
    lateTurn: hasLateTurn,
    heldFields: {
      ...heldGroupFields(groupHeldPrompts([...settledHandoff.heldGroups, ...late.prompts])),
      handoff_unattended: settledHandoff.isUnattended,
      held_other_delivery: worstDelivery([...deliveries, ...late.deliveries]),
      ...leftoverStripFields(state.leftoverStrips),
    },
  })
}
