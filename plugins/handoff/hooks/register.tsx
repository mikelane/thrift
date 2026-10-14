import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  RenderInput,
  PromptSubmitInput,
  TurnCompleteInput,
} from 'claude-code'

import type { BandState, Offer, Writing } from '../types'
import {
  BUTTON_LABELS,
  WAITING,
  WAITING_STATUS,
  WRITING,
  WRITING_STATUS,
  bandControls,
  bandHint,
  bandMessage,
  clearsSession,
  isSameOffer,
  isWriting,
  offerWithBusyState,
  statusText,
} from './band-text'
import {
  heldGroupFields,
  isUsableThriftHome,
  LOG_WRITER,
  logLocation,
  recordFromEvaluation,
  snapshotTrigger,
  type ClearedBy,
  type DecisionReason,
  type Evaluation,
  type HandoffRequest,
  type SettledHandoff,
  type Trigger,
} from './decision-record'
import { isUntestedEngine } from './engine-version'
import { noteOutcome, type ForkReason, type NoteOutcome } from './fork-outcome'
import {
  FINAL_MESSAGES,
  NO_HANDOFF_MESSAGE,
  busyRefusalMessage,
  clearFailedMessage,
  noHandoffMessage,
  sessionEndedMessage,
  HANDOFF_PROMPT,
  handoffMessage,
  groupHeldPrompts,
  holdsPrompt,
  joinPrompts,
  groupJoiningNote,
  groupsLeftToSend,
  withoutPrompt,
  boxCopiesOf,
  boxCopyOf,
  withoutBoxCopy,
  type Carried,
  type NoteDelivery,
} from './handoff-note'
import { worstDelivery } from './held-delivery'
import {
  canHoldPrompt,
  carriesExtras,
  planPromptDuringHandoff,
  isPersonOrigin,
  isComposerOrigin,
  isUnattendedOrigin,
  noteOrigin,
  planNewWorkPrompt,
  senderLabel,
} from './prompt-plan'
import {
  addHeldPrompt,
  beginSending,
  removeResubmittedPrompt,
  beginHandoffHold,
  beginBeforeClear,
  beginOwnClear,
  beginNoteWindow,
  claimPending,
  createState,
  preClearOutcome,
  type PreClearOutcome,
  endHandoff,
  endMainTurn,
  isCarriedByHandoff,
  isHoldingForHandoff,
  noteCacheReads,
  recordSessionEnd,
  releaseCarried,
  queueResubmittedPrompt,
  refusedPromptPlacement,
  releaseCarriedGroup,
  releaseTurnEndWaiter,
  resetForNewSession,
  startMainTurn,
  takeHeldPrompts,
  isCollectingHeldPrompts,
  takeLateArrivalsOrEndSending,
  waitForTurnEnd,
  type BoxPlacement,
  type ButtonPress,
  type HeldPrompt,
  type HeldPromptGroup,
  type SessionState,
} from './session-state'
import {
  asMode,
  asThreshold,
  bandButtons,
  busyRefusalTrigger,
  contextFromStep,
  type Button,
} from './signals'
import { notifiedTaskId } from './tasks'
import { noteToolCall } from './tool-call-tracking'
import { planTurnEnd } from './turn-end-plan'
import { branchTicketPrefixes, hasTicketShapedToken, namesNewWork, ticketUrlPrefixes, workRefs } from './work-refs'

const BRANCH_READ_TIMEOUT_MS = 5000
const BUSY_AGENT_STATUSES = new Set(['pending', 'running', 'waiting'])
const WRITING_COMMAND_REPLY = 'Writing a handoff for a fresh session...'
const HANDING_OFF_FIRST = 'Handing off first. Your prompt will be sent in the fresh session.'
const HELD_PROMPT = 'Held your prompt. Choose below, or press Enter again to send it here.'
const PRESS_WAITS_FOR_TURN = 'This turn is still running, so your choice will run when it ends.'
const HELD_FOR_HANDOFF = "A handoff is in progress, so your prompt is held. It is sent when the handoff ends, or, if the handoff fails and a person sent it, put in this terminal's prompt box. If that can't be done, it is kept another way, at worst in the transcript."
const REPEAT_NOT_ADDED = 'The handoff already carries this prompt, so this repeat was not added.'
const REFUSED_DURING_HANDOFF =
  'A handoff is in progress, and a prompt with attachments or context cannot be held. Send it again after the handoff.'
const REFUSED_TOAST = "Not held: a prompt with attachments or context can't wait for a handoff. Send it again after."
const keptRefusedPrompt = (kind: string, text: string): string =>
  `A prompt from ${senderLabel(kind)} had attachments or context, so it could not be held during the handoff and did not run. Its attachments and context were not kept. Its text, to send again after the handoff:\n${text}`
const PROMPT_NOT_HELD = 'That prompt is no longer held, so there is nothing to send.'
const ALREADY_PENDING = 'A handoff or compaction is already in progress.'
const UNSENT_PROMPT = 'Your prompt could not be sent or put in the prompt box. Here it is:'
const UNSENT_NOTE = 'The handoff note could not be sent or put in the prompt box. Here it is:'
const UNSENT_UNATTENDED_NOTE = 'The handoff note could not be sent, so here it is:'
const UNSENT_OTHER_PROMPT = 'A prompt could not be sent, so here it is:'
const UNSENT_NOTE_AND_OTHER_PROMPT = 'The handoff note and a prompt could not be sent, so here they are:'

// /handoff is registered only when a person is at the prompt, so only then is it there to mention.
const untestedEngineNotice = (engineVersion: string, isInteractive: boolean): string =>
  `Untested on Claude Code ${engineVersion}, so this session only logs decisions.${isInteractive ? ' /handoff still works.' : ''}`

// The shape names the Offer fields, so a reload finds an offer an older version wrote (heldPrompt, not hasHeldPrompt) absent.
const offerAtom = atom({ plugin: 'handoff', key: 'offer' } as const, null, { shape: 'offer-has-held-prompt' })

const debug = ($: EngineInterface, line: string) => $.ui.log(`handoff: ${line}`, { to: 'debug' })

const writeRecord = async ($: EngineInterface, state: SessionState, evaluation: Evaluation) => {
  try {
    const [now, id, thriftHome, home] = await Promise.all([
      $.clock.now(),
      evaluation.sessionId ?? $.session.id(),
      $.env.get('THRIFT_HOME'),
      $.env.get('HOME'),
    ])
    const location = logLocation(thriftHome, home)
    const isThriftHomeIgnored = Boolean(thriftHome) && !isUsableThriftHome(thriftHome)
    if (isThriftHomeIgnored) {
      debug($, `THRIFT_HOME is not an absolute path, so ${location === null ? 'HOME is needed for a log location, and it is not set' : 'the default log location is used'}`)
    }
    if (location === null) return isThriftHomeIgnored ? undefined : debug($, 'no log location: neither THRIFT_HOME nor HOME is set')
    const record = recordFromEvaluation(state, evaluation, now, id)
    const ran = await $.process.run([...LOG_WRITER, location.dir, location.file], {
      stdin: `${JSON.stringify(record)}\n`,
    })
    if (ran.exitCode !== 0) debug($, `log write failed: ${ran.stderr.trim()}`)
  } catch (error) {
    debug($, `log write failed: ${String(error)}`)
  }
}

const isBackgroundBusy = async ($: EngineInterface, state: SessionState): Promise<boolean> => {
  if (state.backgroundTasks.size > 0) return true
  try {
    return (await $.agent.list()).some(agent => BUSY_AGENT_STATUSES.has(agent.status))
  } catch (error) {
    debug($, `could not list agents, treating background work as busy: ${String(error)}`)
    return true
  }
}

const readVersion = async ($: EngineInterface) => {
  try {
    const { version, base } = await $.session.version()
    return { engineVersion: base ?? version, base }
  } catch (error) {
    debug($, `could not read the engine version: ${String(error)}`)
    return { engineVersion: 'unknown', base: undefined }
  }
}

const reportedContext = async ($: EngineInterface): Promise<number | undefined> => {
  try {
    return (await $.session.usage()).context.tokens
  } catch (error) {
    debug($, `could not read session usage: ${String(error)}`)
    return undefined
  }
}

const runCompaction = async ($: EngineInterface, state: SessionState, trigger: Trigger) => {
  const sizeBefore = state.contextTokens
  try {
    const compaction = await $.session.compact()
    if (compaction.skip !== undefined) {
      state.backoffFrom = sizeBefore
      await writeRecord($, state, { ...trigger, action: 'none', reason: 'compaction_vetoed' })
    } else {
      await writeRecord($, state, { ...trigger, action: 'compacted' })
      state.backoffFrom = compaction.tokensAfter ?? sizeBefore
      state.contextTokens = compaction.tokensAfter ?? sizeBefore
    }
  } catch (error) {
    state.backoffFrom = sizeBefore
    debug($, `compaction failed: ${String(error)}`)
    await writeRecord($, state, { ...trigger, action: 'none', reason: 'compaction_failed' })
  } finally {
    state.pending = null
  }
}

const scheduleCompaction = ($: EngineInterface, state: SessionState, trigger: Trigger): boolean => {
  if (!claimPending(state, 'compact')) return false
  $.clock.after(0, () => {
    void logFailure($, runCompaction($, state, trigger))
  })
  return true
}

const takeDownBand = async ($: EngineInterface, state: SessionState) => {
  if (!state.hasBand) return
  try {
    await update($, offerAtom, () => null)
    state.hasBand = false
  } catch (error) {
    debug($, `could not take down the band: ${String(error)}`)
  }
}

// The offer atom outlives a reload but `state.hasBand` does not, so a band left up would stick.
const takeDownBandFromBeforeReload = async ($: EngineInterface, state: SessionState) => {
  try {
    if ((await read($, offerAtom)) !== null) state.hasBand = true
  } catch (error) {
    debug($, `could not read the band: ${String(error)}`)
  }
  await takeDownBand($, state)
}

const offerBand = async ($: EngineInterface, state: SessionState, trigger: Trigger, hasHeldPrompt: boolean) => {
  const offer: Offer = {
    signal: trigger.signal === 'strong' ? 'strong' : 'weak',
    contextTokens: trigger.contextTokens,
    hasHeldPrompt,
    isBusy: trigger.isBusy,
  }
  try {
    await update($, offerAtom, () => offer)
    state.hasBand = true
    await writeRecord($, state, { ...trigger, action: 'advised' })
  } catch (error) {
    debug($, `could not show the band: ${String(error)}`)
    await writeRecord($, state, { ...trigger, action: 'none', reason: 'band_failed' })
  }
}

const registerHandoffCommand = async ($: EngineInterface) => {
  try {
    await $.command.register({
      name: 'handoff',
      description: 'Write a handoff, clear, and continue in a fresh session',
    })
  } catch (error) {
    debug($, `could not register /handoff: ${String(error)}`)
  }
}

// SAFETY: every current caller catches its own engine failures, so no test reaches this catch.
// Keep it: it is the only guard against an unhandled rejection if a future caller forgets.
const logFailure = ($: EngineInterface, work: Promise<unknown>) =>
  work.catch(error => debug($, `background work failed: ${String(error)}`))

type BoxPrompt = Pick<HeldPrompt, 'text' | 'boxText'>

// A prompt the box already holds as whole lines is not added again, so an identical prompt sent twice shows once; the box
// is for the person to review and send, and a second copy of a line they can see would only be noise to delete.
// The engine keeps a dropped prompt's text in the box, which for a group is its last prompt: that copy is replaced by the
// group's text, not left beside it.
const refillBox = async ($: EngineInterface, prompt: BoxPrompt, placement: BoxPlacement = 'before_draft'): Promise<boolean> => {
  try {
    const draft = (await $.prompt.read()).text
    if (holdsPrompt(draft, prompt.text)) return true
    const otherDraft = withoutBoxCopy(draft, prompt)
    const withDraft = placement === 'before_draft' ? `${prompt.text}\n${otherDraft}` : `${otherDraft}\n${prompt.text}`
    const filled = await $.prompt.fill({ text: otherDraft === '' ? prompt.text : withDraft, mode: 'replace' })
    if (!filled.isFilled) debug($, `the prompt box refused the prompt: ${filled.refusal ?? 'refused by a hook'}`)
    return filled.isFilled
  } catch (error) {
    debug($, `could not refill the prompt box: ${String(error)}`)
    return false
  }
}

// Once a person's prompt went into the fresh session, the text the engine kept in the box would send it a second time. Only
// that copy is taken out, as whole lines: anything else in the box is a draft the person typed since, and stays.
const emptySentPromptFromBox = async ($: EngineInterface, prompt: HeldPrompt): Promise<void> => {
  const copies = boxCopiesOf(prompt)
  if (copies.length === 0) return
  try {
    const draft = (await $.prompt.read()).text
    const remainingDraft = copies.map(copy => withoutPrompt(draft, copy)).find(remaining => remaining !== null)
    if (remainingDraft === undefined) return
    const emptied = await $.prompt.fill({ text: remainingDraft, mode: 'replace' })
    if (!emptied.isFilled) debug($, `the prompt box refused to be emptied: ${emptied.refusal ?? 'refused by a hook'}`)
  } catch (error) {
    debug($, `could not empty the prompt box: ${String(error)}`)
  }
}

const composerPrompt = (text: string): HeldPrompt => ({ text, isUnattended: false, origin: 'composer' })

// Only a prompt typed at this terminal is offered to the box. The sender of any other prompt is somewhere else, and filling
// the box could displace the draft of the person who is here.
const canUseBox = (prompt: HeldPrompt): boolean => isComposerOrigin(prompt.origin)

// A prompt that is never offered to the box is not the person's own, so it gets a notice that claims neither.
const keepInTranscript = ($: EngineInterface, prompt: HeldPrompt, notice?: string) =>
  $.ui.log(`${notice ?? (canUseBox(prompt) ? UNSENT_PROMPT : UNSENT_OTHER_PROMPT)}\n${prompt.text}`)

// A person's prompt is read by the model as the person's own words, not as a message from this plugin. A scheduled prompt
// keeps the plugin's frame: nobody typed it. The plugin's own handoff note is not the person's either, so its callers say so.
const speaksForPerson = (prompt: HeldPrompt): boolean => !prompt.isUnattended && isPersonOrigin(prompt.origin)

// The engine cannot submit a prompt under another origin: the plugin's submission arrives as origin 'plugin', which this
// plugin's prompt.submit hook does not classify. Submit resolves once the prompt's turn started or once it was queued behind
// the running turn, so a resolved submit does not mean its turn has begun. So the origin goes into a queue here and the
// turn.start hook takes it. A hook beneath the plugin that refuses the prompt makes submit resolve with { drop } instead of
// rejecting.
const submitEntered = async (
  $: EngineInterface,
  state: SessionState,
  prompt: HeldPrompt,
  failureLabel: string,
  asUser: boolean,
): Promise<boolean> => {
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

const submitOrKeepInTranscript = async ($: EngineInterface, state: SessionState, prompt: HeldPrompt): Promise<Carried> => {
  if (await submitEntered($, state, prompt, 'could not restore the held prompt', speaksForPerson(prompt))) return 'submitted'
  keepInTranscript($, prompt)
  return 'not_carried'
}

const restorePrompt = async (
  $: EngineInterface,
  state: SessionState,
  prompt: HeldPrompt,
  placement: BoxPlacement = 'before_draft',
): Promise<Carried> => {
  if (canUseBox(prompt) && (await refillBox($, prompt, placement))) return 'in_box'
  const carried = await submitOrKeepInTranscript($, state, prompt)
  if (carried === 'submitted') await emptySentPromptFromBox($, prompt)
  return carried
}

// A failed read leaves the id to writeRecord, which reads it again. If that fails too, no record is written and
// writeRecord leaves its own debug line.
const readSessionId = async ($: EngineInterface): Promise<string | undefined> => {
  try {
    return await $.session.id()
  } catch (error) {
    debug($, `could not read the session id: ${String(error)}`)
    return undefined
  }
}

// SAFETY: the record is written after restoreHeldGroups and sendHeldGroups return, so a throw inside either loop would lose
// the record. refillBox and submitEntered catch their own failures, and keepInTranscript and releaseCarriedGroup make no
// async calls, so no test can make a loop throw. Any call added to a loop must not throw either.
const restoreHeldGroups = async ($: EngineInterface, state: SessionState, settledHandoff: SettledHandoff): Promise<Carried[]> => {
  const restores: Carried[] = []
  for (const group of settledHandoff.heldGroups) {
    restores.push(await restorePrompt($, state, group))
    releaseCarriedGroup(state, group, settledHandoff.isUnattended)
  }
  return restores
}

type LateArrivals = { prompts: HeldPrompt[]; deliveries: Carried[] }

// Prompts that arrived during a delivery or a restore go back one by one in arrival order, and more may arrive while they do.
const forEachLateArrival = async (
  state: SessionState,
  carryPrompt: (prompt: HeldPrompt) => Promise<Carried>,
): Promise<LateArrivals> => {
  const prompts: HeldPrompt[] = []
  const deliveries: Carried[] = []
  for (let arrived = takeLateArrivalsOrEndSending(state); arrived.length > 0; arrived = takeLateArrivalsOrEndSending(state)) {
    for (const prompt of arrived) deliveries.push(await carryPrompt(prompt))
    prompts.push(...arrived)
  }
  return { prompts, deliveries }
}

const restoreLateArrivals = ($: EngineInterface, state: SessionState): Promise<LateArrivals> =>
  forEachLateArrival(state, prompt => restorePrompt($, state, prompt, 'after_draft'))

const abandonHandoff = async (
  $: EngineInterface,
  state: SessionState,
  settledHandoff: SettledHandoff,
  reason: DecisionReason,
  message: string,
  sessionId?: string,
  forkReason?: ForkReason,
) => {
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
    },
    sessionId: recordedSessionId,
  })
}

const writeNote = async ($: EngineInterface): Promise<NoteOutcome> => {
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

// Whether the session was compacted: a vetoed or failed compaction leaves it as it was.
const compactBeforeClearing = async (
  $: EngineInterface,
  state: SessionState,
  trigger: Trigger,
  sessionId: string,
): Promise<boolean> => {
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

const clearSession = async ($: EngineInterface): Promise<boolean> => {
  try {
    await $.command.run({ command: 'clear' })
    return true
  } catch (error) {
    debug($, `/clear failed: ${String(error)}`)
    return false
  }
}

const appendNote = async ($: EngineInterface, message: string): Promise<boolean> => {
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

type SendOptions = { placement?: BoxPlacement; notice?: string | undefined; asUser?: boolean }

const sendOrKeepInBox = async (
  $: EngineInterface,
  state: SessionState,
  prompt: HeldPrompt,
  { placement = 'before_draft', notice, asUser = speaksForPerson(prompt) }: SendOptions = {},
): Promise<Carried> => {
  if (await submitEntered($, state, prompt, 'could not send the prompt', asUser)) {
    await emptySentPromptFromBox($, prompt)
    return 'submitted'
  }
  if (canUseBox(prompt) && (await refillBox($, prompt, placement))) return 'in_box'
  keepInTranscript($, prompt, notice)
  return 'not_carried'
}

const announce = ($: EngineInterface, message: string) => {
  $.ui.log(message)
  $.ui.toast(message)
}

// A scheduled handoff's note rides with the scheduled group, both under the plugin's frame. An attended handoff's note goes alone
// and framed, then the person's prompts follow it as the person's own words.
// A note that is never offered to the box (a scheduled handoff's) gets a notice that does not say it was, and a note joined to
// a scheduled prompt names both.
const unsentNoteNotice = (note: HeldPrompt, isJoined: boolean): string => {
  if (isJoined) return UNSENT_NOTE_AND_OTHER_PROMPT
  return canUseBox(note) ? UNSENT_NOTE : UNSENT_UNATTENDED_NOTE
}

const deliverNote = async ($: EngineInterface, state: SessionState, settledHandoff: SettledHandoff, message: string): Promise<NoteDelivery> => {
  if (await appendNote($, message)) return 'appended'
  const sameOriginGroup = groupJoiningNote(settledHandoff.heldGroups, settledHandoff.isUnattended)
  const origin = sameOriginGroup?.origin ?? noteOrigin(settledHandoff.isUnattended)
  const boxCopy = sameOriginGroup === undefined ? undefined : boxCopyOf(sameOriginGroup)
  const note = {
    text: joinPrompts(message, sameOriginGroup?.text),
    isUnattended: settledHandoff.isUnattended,
    origin,
    ...(boxCopy === undefined ? {} : { boxText: boxCopy }),
  }
  return sendOrKeepInBox($, state, note, { notice: unsentNoteNotice(note, sameOriginGroup !== undefined), asUser: false })
}

const sendHeldGroups = async (
  $: EngineInterface,
  state: SessionState,
  groups: readonly HeldPromptGroup[],
  handoffIsUnattended: boolean,
  placement: BoxPlacement = 'before_draft',
): Promise<Carried[]> => {
  const deliveries: Carried[] = []
  for (const group of groups) {
    deliveries.push(await sendOrKeepInBox($, state, group, { placement }))
    releaseCarriedGroup(state, group, handoffIsUnattended)
  }
  return deliveries
}

const sendLateArrivals = ($: EngineInterface, state: SessionState): Promise<LateArrivals> =>
  forEachLateArrival(state, async prompt => {
    // Counted as seen like the held groups are before they go in, so a ticket named in a late prompt is not new work later.
    await inspectPrompt($, state, prompt.text)
    return sendOrKeepInBox($, state, prompt, { placement: 'after_draft' })
  })

const continueInFreshSession = async (
  $: EngineInterface,
  state: SessionState,
  settledHandoff: SettledHandoff,
  oldId: string,
  note: string,
  hasTurnAfterNote: boolean,
  clearedBy: ClearedBy,
) => {
  // Before the first await, so no prompt passes unheld after settleHandoff took the held ones: from here a prompt that
  // arrives is held until the note, the held prompts, and every prompt that arrived meanwhile have been delivered.
  beginSending(state)
  await registerHandoffCommand($)
  // Read once the clear has run: a turn the clear let in ahead of itself started in the old session after the last check.
  const hasLateTurn = state.hasLateTurn
  const noteDelivery = await deliverNote($, state, settledHandoff, handoffMessage(oldId, note, hasTurnAfterNote || hasLateTurn))
  // A note sent as a prompt may have taken the scheduled group along; it is released with that group, as any other is.
  if (noteDelivery !== 'appended' && groupJoiningNote(settledHandoff.heldGroups, settledHandoff.isUnattended) !== undefined) releaseCarried(state)
  announce($, FINAL_MESSAGES[noteDelivery](oldId))
  for (const { text } of settledHandoff.heldGroups) await inspectPrompt($, state, text)
  const groupsToSend = groupsLeftToSend(settledHandoff.heldGroups, settledHandoff.isUnattended, noteDelivery)
  // A note left in the box is read first, so a prompt that also lands there goes after it.
  const deliveries = await sendHeldGroups($, state, groupsToSend, settledHandoff.isUnattended, noteDelivery === 'in_box' ? 'after_draft' : 'before_draft')
  const late = await sendLateArrivals($, state)
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
    },
  })
}

const prepareHandoff = async ($: EngineInterface, state: SessionState, request: HandoffRequest) => {
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

// A session end already decided the outcome, so the wait is no longer about a clear the handoff will issue.
const showWaitingStatus = async ($: EngineInterface, state: SessionState) => {
  if (state.sessionEndBeforeClear !== null) return
  await redrawBand($, state, WAITING)
  $.ui.toast(WAITING_STATUS)
}

// Once a session end decided the outcome, no clear will run: the wait is for delivering the note or for stopping.
const WAIT_STARTED_LINES = {
  none: 'waiting for a running turn to end before the handoff goes on',
  cleared_by_person: 'waiting for a running turn to end before delivering the note',
  other: 'waiting for a running turn to end before stopping the handoff',
} as const satisfies Record<'none' | NonNullable<SessionState['sessionEndBeforeClear']>, string>

const waitStartedLine = (state: SessionState): string => WAIT_STARTED_LINES[state.sessionEndBeforeClear ?? 'none']

// Who ran the clear for each outcome that reaches it; a new outcome fails to compile until it is mapped here.
const CLEARED_BY = {
  clear: 'handoff',
  deliver_to_person_clear: 'person',
} as const satisfies Record<Exclude<PreClearOutcome, 'abandon_session_ended' | 'abandon_busy'>, ClearedBy>

type ClearWindow = {
  outcome: PreClearOutcome
  hasCompactedBeforeClear: boolean
  isBusy: boolean
  // Read in the same synchronous run that starts the clear, so a turn that the clear lets in cannot change it.
  hasTurnAfterNote: boolean
  // Set only when the outcome is 'clear': the handoff's own /clear, already started.
  clearing: Promise<boolean> | null
}

// Waits out running turns, compacts if asked, and checks for background work, then starts the clear.
// SAFETY: on the clear path, no await sits between the last isTurnRunning read and the $.command.run inside
// clearSession. Every awaited step before the clear (the waiting status, the compaction, the busy check) is followed by
// another pass through the wait, and the loop resumes straight from waitForTurnEnd, so a turn.start cannot land in the
// gap. That is why the clear starts here, in the same synchronous run as the last read, and the caller only awaits the
// promise it gets back: returning the outcome first and clearing in the caller would put an await in the gap.
// clearSession's first step is the synchronous command call. Do not add an await after the loop, or move the clear
// behind a helper that awaits first. The person-cleared branch may await in the caller: no clear runs there.
const waitForClearWindow = async (
  $: EngineInterface,
  state: SessionState,
  request: HandoffRequest,
  oldId: string,
): Promise<ClearWindow> => {
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
        await showWaitingStatus($, state)
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
  const clearWindow = { outcome, hasCompactedBeforeClear, isBusy, hasTurnAfterNote: state.hasTurnAfterNote }
  if (outcome !== 'clear') return { ...clearWindow, clearing: null }
  beginOwnClear(state)
  return { ...clearWindow, clearing: clearSession($) }
}

type AbandonCause = 'session_ended' | 'busy' | 'clear_failed'

// Abandons a handoff after the wait: the session ended, background work was running, or the clear failed.
// No clear starts here, so the no-await rule on waitForClearWindow does not apply.
const abandonAfterWait = (
  $: EngineInterface,
  state: SessionState,
  settledHandoff: SettledHandoff,
  cause: AbandonCause,
  hasCompactedBeforeClear: boolean,
  oldId: string,
): ReturnType<typeof abandonHandoff> => {
  switch (cause) {
    case 'session_ended':
      return abandonHandoff($, state, settledHandoff, 'session_ended', sessionEndedMessage(hasCompactedBeforeClear, oldId), oldId)
    case 'busy': {
      const busySettled = { ...settledHandoff, trigger: busyRefusalTrigger(settledHandoff.trigger) }
      return abandonHandoff($, state, busySettled, 'background_busy', busyRefusalMessage(hasCompactedBeforeClear), oldId)
    }
    case 'clear_failed':
      return abandonHandoff($, state, settledHandoff, 'clear_failed', clearFailedMessage(hasCompactedBeforeClear), oldId)
    default: {
      const unhandled: never = cause
      return unhandled
    }
  }
}

const runHandoff = async (
  $: EngineInterface,
  state: SessionState,
  request: HandoffRequest,
  beforeRun?: () => Promise<void>,
) => {
  try {
    // SAFETY: beforeRun is emptyBoxIfHolding, which catches its own failures, so no test can make it throw.
    // It runs inside the try so a future beforeRun that throws still releases the claim.
    await beforeRun?.()
    const prepared = await prepareHandoff($, state, request)
    if (prepared === null) return
    const { outcome, hasCompactedBeforeClear, isBusy, hasTurnAfterNote, clearing } = await waitForClearWindow($, state, request, prepared.oldId)
    const settleAfterWait = () => ({ ...settleHandoff(state, request), hasCompactedBeforeClear })
    if (outcome === 'abandon_session_ended') return await abandonAfterWait($, state, settleAfterWait(), 'session_ended', hasCompactedBeforeClear, prepared.oldId)
    if (outcome === 'abandon_busy') return await abandonAfterWait($, state, settleAfterWait(), 'busy', hasCompactedBeforeClear, prepared.oldId)
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
      return await abandonAfterWait($, state, settledHandoff, 'clear_failed', hasCompactedBeforeClear, prepared.oldId)
    }
    const clearedBy = CLEARED_BY[outcome]
    await continueInFreshSession($, state, settledHandoff, prepared.oldId, prepared.note, hasTurnAfterNote, clearedBy)
  } finally {
    endHandoff(state)
    state.pending = null
  }
}

const scheduleHandoff = (
  $: EngineInterface,
  state: SessionState,
  request: HandoffRequest,
  beforeRun?: () => Promise<void>,
): boolean => {
  if (!claimPending(state, 'handoff')) return false
  state.heldPrompt = null
  beginBeforeClear(state)
  beginHandoffHold(
    state,
    request.heldPrompt === undefined
      ? null
      : { text: request.heldPrompt, isUnattended: request.isUnattended, origin: request.heldPromptOrigin ?? 'composer' },
  )
  $.clock.after(0, () => {
    void logFailure($, runHandoff($, state, request, beforeRun))
  })
  return true
}

const evaluateTurnEnd = async (
  $: EngineInterface,
  state: SessionState,
  e: TurnCompleteInput,
  hasFinishedTask: boolean,
) => {
  if (state.pending !== null) return
  noteCacheReads(state, e.usage?.cache_read_input_tokens)
  const isBusy = await isBackgroundBusy($, state)
  const { signal, outcome } = planTurnEnd({
    contextTokens: state.contextTokens,
    threshold: state.threshold,
    hasFinishedTask,
    isBackgroundBusy: isBusy,
    mode: state.mode,
    isUnattended: state.isTurnUnattended,
    backoffFrom: state.backoffFrom,
  })
  const trigger = snapshotTrigger(state, 'turn-end', signal, isBusy)
  if (outcome.kind === 'back-off') {
    await takeDownBand($, state)
    return writeRecord($, state, { ...trigger, action: 'none', reason: 'backoff' })
  }
  if (outcome.kind === 'advise') return offerBand($, state, trigger, outcome.holdsPrompt)
  await takeDownBand($, state)
  if (outcome.kind === 'compact') return scheduleCompaction($, state, trigger)
  if (outcome.kind === 'handoff') return scheduleHandoff($, state, { trigger, isUnattended: state.isTurnUnattended })
  return writeRecord($, state, { ...trigger, action: 'none' })
}

const readBranch = async ($: EngineInterface): Promise<string> => {
  try {
    const ran = await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: BRANCH_READ_TIMEOUT_MS })
    return ran.exitCode === 0 ? ran.stdout.trim() : ''
  } catch (error) {
    debug($, `could not read the git branch: ${String(error)}`)
    return ''
  }
}

const inspectPrompt = async ($: EngineInterface, state: SessionState, text: string): Promise<boolean> => {
  for (const prefix of ticketUrlPrefixes(text)) state.urlPrefixes.add(prefix)
  const branchPrefixes = hasTicketShapedToken(text) ? branchTicketPrefixes(await readBranch($)) : []
  const prefixes = [...state.urlPrefixes, ...branchPrefixes]
  const isNewWork = namesNewWork(text, state.seenRefs, prefixes)
  for (const ref of workRefs(text, prefixes)) state.seenRefs.add(ref)
  return isNewWork
}

const emptyBoxIfHolding = async ($: EngineInterface, text: string) => {
  try {
    const remainingDraft = withoutPrompt((await $.prompt.read()).text, text)
    if (remainingDraft === null) return
    const emptied = await $.prompt.fill({ text: remainingDraft, mode: 'replace' })
    if (!emptied.isFilled) debug($, `the prompt box refused to be emptied: ${emptied.refusal ?? 'refused by a hook'}`)
  } catch (error) {
    debug($, `could not empty the prompt box: ${String(error)}`)
  }
}

const refillHeldPrompt = async ($: EngineInterface, state: SessionState, text: string) => {
  if (state.heldPrompt !== text) return
  if (await refillBox($, { text })) return
  if (state.heldPrompt !== text) return
  state.heldPrompt = null
  await takeDownBand($, state)
  await submitOrKeepInTranscript($, state, composerPrompt(text))
}

const holdPrompt = async ($: EngineInterface, state: SessionState, text: string, trigger: Trigger) => {
  state.heldPrompt = text
  $.clock.after(0, () => {
    void logFailure($, refillHeldPrompt($, state, text))
  })
  await offerBand($, state, trigger, true)
  return { drop: HELD_PROMPT }
}

// -- Prompts held while a handoff is pending. Kept together so the whole rule can move out of this file as one piece.

const returnToBox = async ($: EngineInterface, text: string, placement: BoxPlacement): Promise<void> => {
  if (!(await refillBox($, { text }, placement))) keepInTranscript($, composerPrompt(text))
}

// An attachment or context can't be resent, so the prompt is handed back instead. A person at this terminal gets it in the
// box to send again. For any other sender the box is not where they are, and filling it could displace the draft of the
// person who is: the engine has no channel back to the sender beyond the drop reason, so the text goes in the transcript.
const handBackRefused = async ($: EngineInterface, e: PromptSubmitInput, placement: BoxPlacement): Promise<void> => {
  if (isComposerOrigin(e.origin.kind)) return returnToBox($, e.text, placement)
  $.ui.log(keptRefusedPrompt(e.origin.kind, e.text))
}

// The placement is read now: by the time the clock fires, the delivery may be over.
// SAFETY: during a restore, a refused composer prompt can land in the box after a held composer prompt that arrived later,
// because the hand-back waits for clock.after(0). That takes two composer submits within one engine round trip, which a real
// session cannot produce, so no code guards it.
const refuseDuringHandoff = ($: EngineInterface, state: SessionState, e: PromptSubmitInput): { drop: string } => {
  const placement = refusedPromptPlacement(state.handoffHold)
  debug($, 'refused a prompt with attachments or context during the handoff')
  $.ui.toast(REFUSED_TOAST)
  $.clock.after(0, () => {
    void logFailure($, handBackRefused($, e, placement))
  })
  return { drop: REFUSED_DURING_HANDOFF }
}

const holdForHandoff = ($: EngineInterface, state: SessionState, e: PromptSubmitInput): { drop: string } => {
  const heldCount = addHeldPrompt(state, { text: e.text, isUnattended: isUnattendedOrigin(e.origin.kind), origin: e.origin.kind })
  debug($, `held a prompt for the handoff (${heldCount} held)`)
  // Claude Code leaves a dropped prompt's text in the box, so the next prompt would be typed after it and held as
  // "onetwo". Deferred like the other box work in a hook, because the declarations do not say whether the engine puts the
  // text back after the hook returns. Only while prompts are still collected: once the handoff took them, a restore may have
  // put the text back, and the delivery and restore paths deal with what the engine left.
  // SAFETY: a handoff that ends and a second one that starts inside this one tick would let the clear run in the second hold.
  // Both need several engine round trips, so a real session cannot produce it, and no code guards it.
  if (isComposerOrigin(e.origin.kind)) {
    $.clock.after(0, () => {
      if (isCollectingHeldPrompts(state)) void logFailure($, emptyBoxIfHolding($, e.text))
    })
  }
  return { drop: HELD_FOR_HANDOFF }
}

// Taking the held prompts ends their holding: from here a prompt that arrives belongs to the fresh session or the old one.
const settleHandoff = (state: SessionState, request: HandoffRequest): SettledHandoff => ({
  trigger: request.trigger,
  isUnattended: request.isUnattended,
  heldGroups: groupHeldPrompts(takeHeldPrompts(state)),
})

const decideDuringHandoff = ($: EngineInterface, state: SessionState, e: PromptSubmitInput): { drop: string } | undefined => {
  const action = planPromptDuringHandoff({
    isCarried: isCarriedByHandoff(state, e.text),
    isHolding: isHoldingForHandoff(state),
    hasExtras: carriesExtras(e),
  })
  // The handoff already carries this text and sends or restores it itself, so a repeat of it would run twice.
  if (action === 'drop-repeat') {
    debug($, 'dropped a repeat of the prompt the handoff carries')
    return { drop: REPEAT_NOT_ADDED }
  }
  if (action === 'refuse') return refuseDuringHandoff($, state, e)
  if (action === 'hold') return holdForHandoff($, state, e)
  return undefined
}

const decidePrompt = async ($: EngineInterface, state: SessionState, e: PromptSubmitInput) => {
  const duringHandoff = decideDuringHandoff($, state, e)
  if (duringHandoff !== undefined) return duringHandoff
  const isUnattended = isUnattendedOrigin(e.origin.kind)
  state.heldPrompt = null
  state.isTurnUnattended = isUnattended
  const isNewWork = await inspectPrompt($, state, e.text)
  const canHold = canHoldPrompt({
    isNewWork,
    hasPendingAction: state.pending !== null,
    hasTurnId: e.turnId !== undefined,
    hasExtras: carriesExtras(e),
  })
  if (!canHold) return null
  const isBusy = await isBackgroundBusy($, state)
  const { signal, action } = planNewWorkPrompt({
    contextTokens: state.contextTokens,
    threshold: state.threshold,
    isBackgroundBusy: isBusy,
    mode: state.mode,
    isUnattended,
    isFromComposer: isComposerOrigin(e.origin.kind),
  })
  const trigger = snapshotTrigger(state, 'prompt', signal, isBusy)
  if (action === 'handoff') {
    // Claude Code leaves the dropped text in the box; the handoff sends the prompt itself, so that copy is taken out first.
    const emptyBox = isComposerOrigin(e.origin.kind) ? () => emptyBoxIfHolding($, e.text) : undefined
    const isClaimed = scheduleHandoff($, state, { trigger, heldPrompt: e.text, heldPromptOrigin: e.origin.kind, isUnattended }, emptyBox)
    return isClaimed ? { drop: HANDING_OFF_FIRST } : null
  }
  if (action === 'hold') return holdPrompt($, state, e.text, trigger)
  await writeRecord($, state, { ...trigger, action: 'none' })
  return null
}

const pressHeldPromptButton = async ($: EngineInterface, state: SessionState, trigger: Trigger, button: Button) => {
  const heldPrompt = state.heldPrompt
  if (heldPrompt === null) {
    debug($, `dropped a ${button} press: no prompt is held`)
    $.ui.toast(PROMPT_NOT_HELD)
    return takeDownBand($, state)
  }
  state.heldPrompt = null
  await takeDownBand($, state)
  await emptyBoxIfHolding($, heldPrompt)
  if (button === 'handoff-send' && scheduleHandoff($, state, { trigger, heldPrompt, isUnattended: false })) return
  await writeRecord($, state, { ...trigger, action: 'none', reason: 'send_here' })
  $.clock.after(0, () => {
    void logFailure($, sendOrKeepInBox($, state, composerPrompt(heldPrompt)))
  })
}

const redrawBand = async ($: EngineInterface, state: SessionState, band: BandState) => {
  try {
    await update($, offerAtom, () => band)
    state.hasBand = true
  } catch (error) {
    debug($, `could not redraw the band: ${String(error)}`)
  }
}

// Only the band the press was made on may be redrawn: one taken down or replaced since stays as it is.
const redrawIfStillShown = async ($: EngineInterface, state: SessionState, shown: Offer, redrawn: Offer) => {
  try {
    const current = await read($, offerAtom)
    if (current !== null && isSameOffer(current, shown)) await redrawBand($, state, redrawn)
  } catch (error) {
    debug($, `could not read the band: ${String(error)}`)
  }
}

const refuseToClear = async ($: EngineInterface, state: SessionState, offer: Offer, trigger: Trigger) => {
  $.ui.toast(busyRefusalMessage(false))
  await redrawIfStillShown($, state, offer, offerWithBusyState(offer, state.contextTokens, true))
  await writeRecord($, state, { ...busyRefusalTrigger(trigger), action: 'none', reason: 'background_busy' })
}

// Busyness is read when the press runs, not taken from the offer: a shell may have started since the band was drawn.
const runPress = async ($: EngineInterface, state: SessionState, { offer, button }: ButtonPress) => {
  const isBusy = await isBackgroundBusy($, state)
  if (state.pending !== null) {
    debug($, `dropped a ${button} press: a ${state.pending} is already pending`)
    return $.ui.toast(ALREADY_PENDING)
  }
  const trigger = snapshotTrigger(state, 'button', offer.signal, isBusy)
  if (isBusy && clearsSession(button)) return refuseToClear($, state, offer, trigger)
  if (button === 'handoff-send' || button === 'send-here') return pressHeldPromptButton($, state, trigger, button)
  if (button === 'not-now') state.backoffFrom = state.contextTokens
  else if (button === 'compact') scheduleCompaction($, state, trigger)
  else return void scheduleHandoff($, state, { trigger, isUnattended: false })
  await takeDownBand($, state)
  if (button === 'not-now') await writeRecord($, state, { ...trigger, action: 'none', reason: 'not_now' })
}

// runPress awaits the busy check before it claims anything, so the press is marked in flight in the same tick:
// a second press, Not now included, is dropped until this one settles.
const claimAndRunPress = async ($: EngineInterface, state: SessionState, press: ButtonPress) => {
  state.isPressRunning = true
  try {
    await runPress($, state, press)
  } finally {
    state.isPressRunning = false
  }
}

// A press that clears or compacts made mid-turn waits, so /clear and compaction never land inside a turn. The first
// press wins; the band stays up until it runs, and it runs at the end of that turn in place of a fresh evaluation.
// Not now has no such hazard, so it runs at once.
const pressButton = async ($: EngineInterface, state: SessionState, offer: Offer, button: Button) => {
  if (state.pending !== null || state.deferredPress !== null || state.isPressRunning) {
    return debug($, `dropped a ${button} press: another press or a handoff or compaction comes first`)
  }
  if (!state.isTurnRunning || button === 'not-now') return claimAndRunPress($, state, { offer, button })
  state.deferredPress = { offer, button }
  $.ui.toast(PRESS_WAITS_FOR_TURN)
}

// A turn that ends without an answer gets no evaluation, so a band left up could still offer a handoff over work
// that started during it.
const refreshBandBusyState = async ($: EngineInterface, state: SessionState) => {
  try {
    const offer = await read($, offerAtom)
    if (offer === null || isWriting(offer)) return
    const isBusy = await isBackgroundBusy($, state)
    if (offer.isBusy !== isBusy) await redrawBand($, state, offerWithBusyState(offer, state.contextTokens, isBusy))
  } catch (error) {
    debug($, `could not read the band: ${String(error)}`)
  }
}

const drawWritingStatus = ($: EngineInterface, e: RenderInput<'AbovePrompt'>, band: Writing) => {
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="column" backgroundColor="subtle">
      <Text>{statusText(band)}</Text>
    </Box>
  )
}

const drawBand = ($: EngineInterface, state: SessionState, e: RenderInput<'AbovePrompt'>, offer: Offer) => {
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box flexDirection="column" backgroundColor="subtle">
      <Text>{bandMessage(offer)}</Text>
      <Box flexWrap="wrap" columnGap={2}>
        {bandControls(bandButtons(offer)).map(({ button, hotkey, isPrimary, isDismiss }) => (
          <Button
            key={button}
            label={BUTTON_LABELS[button]}
            hotkey={hotkey}
            plain
            {...(isPrimary ? { variant: 'primary' as const, autoFocus: true as const } : {})}
            {...(isDismiss ? { role: 'dismiss' as const } : {})}
            onPress={() => logFailure($, pressButton($, state, offer, button))}
          />
        ))}
      </Box>
      <Text dimColor>{bandHint(offer)}</Text>
    </Box>
  )
}

const startHandoffCommand = async ($: EngineInterface, state: SessionState) => {
  const trigger = snapshotTrigger(state, 'command', 'none', await isBackgroundBusy($, state))
  const heldPrompt = state.heldPrompt
  const emptyBox = heldPrompt === null ? undefined : () => emptyBoxIfHolding($, heldPrompt)
  const isClaimed = scheduleHandoff(
    $,
    state,
    { trigger, ...(heldPrompt === null ? {} : { heldPrompt }), isUnattended: false },
    emptyBox,
  )
  return { text: isClaimed ? WRITING_COMMAND_REPLY : ALREADY_PENDING }
}

// Long because every on(...) call lives here: the engine lets $ pass only to functions declared at the top of this file.
export const register: Register = (on, options) => {
  const setting = asMode(options.handoffMode)
  // SAFETY: a hot reload (a code change under --plugin-dir watch, or a setting changed in /config) runs register again, and
  // the new state starts with pending null and nothing held. A handoff already running keeps the old state and its old
  // closures. Its prompts are no longer held, so they pass through and /clear can land inside their turn. The old hooks are
  // gone too, so nothing releases a wait for a turn to end, and that handoff waits forever and never clears. Both need a
  // reload while a handoff runs, from the note being written until its prompts are delivered. No guard: carrying the state
  // across a reload would need it in an atom. After a reload, run /handoff again.
  const state = createState({
    setting,
    threshold: asThreshold(options.handoffContextTokens),
    compactBeforeClear: options.compactBeforeClear === true,
  })

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await takeDownBandFromBeforeReload($, state)
    const { engineVersion, base } = await readVersion($)
    const isUntested = isUntestedEngine(base)
    state.engineVersion = engineVersion
    state.mode = e.isInteractive && !isUntested ? setting : 'off'
    if (e.isInteractive) await registerHandoffCommand($)
    if (isUntested) {
      // In the transcript as well as the toast: a toast can be gone before a screen reader reads it.
      if (setting !== 'off') announce($, untestedEngineNotice(engineVersion, e.isInteractive))
      await writeRecord($, state, { ...snapshotTrigger(state, 'session-start', 'none', false), action: 'untested_engine' })
    }
    return started
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const step = yield* next(e)
    if (e.agentId === undefined && step.usage) {
      const reported = await reportedContext($)
      state.contextTokens = contextFromStep({
        input: step.usage.input_tokens,
        created: step.usage.cache_creation_input_tokens,
        read: step.usage.cache_read_input_tokens,
        advisorCalls: (step.serverToolUses ?? []).filter(use => use.name === 'advisor').length,
        reported,
      })
    }
    return step
  }).catch(async function* ($, e, next) {
    return yield* next(e)
  })

  // next<string> skips inferring the tool name from every MCP tool in the types file, which made tsc time grow with the connected servers.
  on('tool.call', async ($, e, next) => {
    const ran = await next<string>(e)
    if (e.agentId === undefined) noteToolCall(state, e, ran)
    return ran
  }).catch(($, e, next) => next<string>(e))

  on('prompt.submit', async ($, e, next) => {
    if (state.heldPrompt !== null && isPersonOrigin(e.origin.kind)) await takeDownBand($, state)
    const finishedTaskId = e.origin.kind === 'task-notification' ? notifiedTaskId(e.text) : null
    if (finishedTaskId !== null) state.backgroundTasks.delete(finishedTaskId)
    // Only the person origins are held or refused during a handoff. A task notification or a peer prompt passes through, in
    // every phase including the delivery, on purpose (decided on #6): it does not come from the person, so it has no place in
    // the order of their prompts.
    const dropped = isPersonOrigin(e.origin.kind) ? await decidePrompt($, state, e) : null
    return dropped ?? next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    startMainTurn(state, e.text)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    const hasFinishedTask = state.hasFinishedTask
    state.hasFinishedTask = false
    endMainTurn(state)
    const deferredPress = state.deferredPress
    state.deferredPress = null
    try {
      if (deferredPress !== null) {
        noteCacheReads(state, e.usage?.cache_read_input_tokens)
        await claimAndRunPress($, state, deferredPress)
      } else if (e.reason === 'answer') await evaluateTurnEnd($, state, e, hasFinishedTask)
      else await refreshBandBusyState($, state)
    } finally {
      // The handoff clears in a later tick: /clear inside the hook the turn is waiting on is refused.
      // SAFETY: every call in the try block catches its own engine failures (isBackgroundBusy, takeDownBand, writeRecord,
      // offerBand, refreshBandBusyState), and the toast and log calls return void, so the kit cannot make the block throw
      // and no test reaches this finally on a throw. Keep it: it is the only thing that frees a waiting handoff if a
      // future call in the block forgets to catch.
      $.clock.after(0, () => releaseTurnEndWaiter(state))
    }
    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const offer = await read($, offerAtom)
    if (e.props.hasSurvey || offer === null) return next(e)
    return isWriting(offer) ? drawWritingStatus($, e, offer) : drawBand($, state, e, offer)
  }).catch(($, e, next) => next(e))

  // SAFETY: startHandoffCommand's only await is isBackgroundBusy, which catches its own failures, so no test reaches this catch.
  // Keep it: every hook must never break a turn.
  on('command.run', { command: 'handoff' }, $ => startHandoffCommand($, state)).catch(() => ({
    text: 'Could not start a handoff.',
  }))

  on('session.end', async ($, e, next) => {
    recordSessionEnd(state, e.reason)
    await takeDownBand($, state)
    resetForNewSession(state)
    // A handoff waiting on a turn resumes in a later tick, so it never runs inside this hook.
    $.clock.after(0, () => releaseTurnEndWaiter(state))
    if (e.reason === 'clear') {
      $.clock.after(0, () => {
        void logFailure($, registerHandoffCommand($))
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}
