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
  LOG_WRITER,
  logLocation,
  recordFromEvaluation,
  snapshot,
  type DecisionReason,
  type Evaluation,
  type HandoffRequest,
  type SettledHandoff,
  type Trigger,
} from './decision-record'
import { isUntestedEngine } from './engine-version'
import {
  FINAL_MESSAGES,
  HANDOFF_PROMPT,
  handedOffMessage,
  handoffMessage,
  groupHeldPrompts,
  holdsPrompt,
  joinPrompts,
  noteInBoxMessage,
  noteNotCarriedMessage,
  groupJoiningNote,
  groupsLeftToSend,
  withoutPrompt,
  type Carried,
  type NoteDelivery,
} from './handoff-note'
import { worstDelivery } from './held-delivery'
import {
  canHoldPrompt,
  carriesExtras,
  planPromptDuringHandoff,
  isPersonOrigin,
  isUnattendedOrigin,
  planNewWorkPrompt,
} from './prompt-plan'
import {
  addHeldPrompt,
  beginHandoffHold,
  beginBeforeClear,
  beginOwnClear,
  beginNoteWindow,
  claim,
  createState,
  preClearOutcome,
  endHandoff,
  endMainTurn,
  isCarriedByHandoff,
  isHoldingForHandoff,
  noteCacheReads,
  recordSessionEnd,
  releaseCarried,
  releaseCarriedGroup,
  releaseTurnEndWaiter,
  resetForNewSession,
  startMainTurn,
  takeHeldPrompts,
  waitForTurnEnd,
  type ButtonPress,
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
  type Signal,
} from './signals'
import { notifiedTaskId } from './tasks'
import { noteToolCall } from './tool-call-tracking'
import { planTurnEnd } from './turn-end-plan'
import { branchTicketPrefix, hasTicketShapedToken, namesNewWork, ticketUrlPrefixes, workRefs } from './work-refs'

const BRANCH_READ_TIMEOUT_MS = 5000
const BUSY_AGENT_STATUSES = new Set(['pending', 'running', 'waiting'])
const WRITING_COMMAND_REPLY = 'Writing a handoff for a fresh session...'
const HANDING_OFF_FIRST = 'Handing off first. Your prompt will be sent in the fresh session.'
const HELD_PROMPT = 'Held your prompt. Choose below, or press Enter again to send it here.'
const SESSION_ENDED = 'The session ended before the handoff could clear, so it stopped. No note was carried over.'
const PRESS_WAITS_FOR_TURN = 'This turn is still running, so your choice will run when it ends.'
const BUSY_REFUSAL =
  'Background work started, and a handoff would cut it off. Nothing was cleared. Type /handoff to hand off anyway.'
const HELD_FOR_HANDOFF = 'A handoff is in progress. Your prompt is held and will be sent when it finishes, or put back if it fails.'
const REPEAT_NOT_ADDED = 'The handoff already carries this prompt, so this repeat was not added.'
const REFUSED_DURING_HANDOFF =
  'A handoff is in progress, and a prompt with attachments or context cannot be held. Its text is put back where possible. Send it again after the handoff.'
const REFUSED_TOAST = "Not held: a prompt with attachments or context can't wait for a handoff. Send it again after."
const PROMPT_NOT_HELD = 'That prompt is no longer held, so there is nothing to send.'
const ALREADY_PENDING = 'A handoff or compaction is already in progress.'
const UNSENT_PROMPT = 'Your prompt could not be sent or put back in the box. Here it is:'

const offerAtom = atom({ plugin: 'handoff', key: 'offer' } as const, null)

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
    if (location === null) return debug($, 'no log location: neither THRIFT_HOME nor HOME is set')
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
  if (!claim(state, 'compact')) return false
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

const offerBand = async ($: EngineInterface, state: SessionState, trigger: Trigger, heldPrompt: boolean) => {
  const offer: Offer = {
    signal: trigger.signal === 'strong' ? 'strong' : 'weak',
    contextTokens: trigger.contextTokens,
    heldPrompt,
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

const refillBox = async ($: EngineInterface, text: string): Promise<boolean> => {
  try {
    const draft = (await $.prompt.read()).text
    if (holdsPrompt(draft, text)) return true
    const filled = await $.prompt.fill({ text: draft === '' ? text : `${text}\n${draft}`, mode: 'replace' })
    return filled.isFilled
  } catch (error) {
    debug($, `could not refill the prompt box: ${String(error)}`)
    return false
  }
}

const keepInTranscript = ($: EngineInterface, text: string) => $.ui.log(`${UNSENT_PROMPT}\n${text}`)

// A hook beneath the plugin that refuses the prompt makes submit resolve with { drop } instead of rejecting.
const submitEntered = async ($: EngineInterface, text: string, failureLabel: string): Promise<boolean> => {
  try {
    const result = await $.prompt.submit({ text })
    if (result.drop === undefined) return true
    debug($, `${failureLabel}: ${result.drop}`)
    return false
  } catch (error) {
    debug($, `${failureLabel}: ${String(error)}`)
    return false
  }
}

const submitOrKeepInTranscript = async ($: EngineInterface, text: string): Promise<Carried> => {
  if (await submitEntered($, text, 'could not restore the held prompt')) return 'submitted'
  keepInTranscript($, text)
  return 'not_carried'
}

const restorePrompt = async ($: EngineInterface, text: string, isUnattended: boolean): Promise<Carried> => {
  if (!isUnattended && (await refillBox($, text))) return 'in_box'
  return submitOrKeepInTranscript($, text)
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

const restoreHeldGroups = async ($: EngineInterface, state: SessionState, settledHandoff: SettledHandoff): Promise<Carried[]> => {
  const restores: Carried[] = []
  for (const group of settledHandoff.heldGroups) {
    restores.push(await restorePrompt($, group.text, group.isUnattended))
    releaseCarriedGroup(state, group, settledHandoff.isUnattended)
  }
  return restores
}

const abandonHandoff = async (
  $: EngineInterface,
  state: SessionState,
  settledHandoff: SettledHandoff,
  reason: DecisionReason,
  message: string,
  sessionId?: string,
) => {
  await takeDownBand($, state)
  announce($, message)
  const recordedSessionId = sessionId ?? (await readSessionId($))
  // SAFETY: the record is written after restoreHeldGroups returns, so a throw inside it would lose the record. refillBox and
  // submitEntered catch their own failures, and keepInTranscript and releaseCarriedGroup make no async calls, so no test
  // can make the loop throw. Any call added to the loop must not throw either.
  const restores = await restoreHeldGroups($, state, settledHandoff)
  await writeRecord($, state, {
    ...settledHandoff.trigger,
    action: 'none',
    reason,
    heldFields: {
      ...heldGroupFields(settledHandoff.heldGroups),
      handoff_unattended: settledHandoff.isUnattended,
      held_restore: worstDelivery(restores),
    },
    sessionId: recordedSessionId,
  })
}

const writeNote = async ($: EngineInterface): Promise<string | null> => {
  try {
    const answer = await $.model.fork({ prompt: HANDOFF_PROMPT })
    return answer.isAnswered && answer.text.trim() !== '' ? answer.text.trim() : null
  } catch (error) {
    debug($, `could not write the handoff note: ${String(error)}`)
    return null
  }
}

const compactBeforeClearing = async ($: EngineInterface, state: SessionState, trigger: Trigger, sessionId: string) => {
  try {
    const compaction = await $.session.compact()
    if (compaction.skip !== undefined) {
      await writeRecord($, state, { ...trigger, action: 'none', reason: 'compaction_vetoed', sessionId })
    }
  } catch (error) {
    debug($, `compaction before the clear failed: ${String(error)}`)
    await writeRecord($, state, { ...trigger, action: 'none', reason: 'compaction_failed', sessionId })
  }
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

const sendOrKeepInBox = async ($: EngineInterface, text: string, isUnattended: boolean): Promise<Carried> => {
  if (await submitEntered($, text, 'could not send the prompt')) return 'submitted'
  if (!isUnattended && (await refillBox($, text))) return 'in_box'
  keepInTranscript($, text)
  return 'not_carried'
}

const announce = ($: EngineInterface, message: string) => {
  $.ui.log(message)
  $.ui.toast(message)
}

// The note rides with the prompts that follow the handoff's own origin; the other group is sent after it.
const deliverNote = async ($: EngineInterface, settledHandoff: SettledHandoff, message: string): Promise<NoteDelivery> => {
  if (await appendNote($, message)) return 'appended'
  const sameOriginGroup = groupJoiningNote(settledHandoff.heldGroups, settledHandoff.isUnattended)
  return sendOrKeepInBox($, joinPrompts(message, sameOriginGroup?.text), settledHandoff.isUnattended)
}

const sendHeldGroups = async (
  $: EngineInterface,
  state: SessionState,
  groups: readonly HeldPromptGroup[],
  handoffIsUnattended: boolean,
): Promise<Carried[]> => {
  const deliveries: Carried[] = []
  for (const group of groups) {
    deliveries.push(await sendOrKeepInBox($, group.text, group.isUnattended))
    releaseCarriedGroup(state, group, handoffIsUnattended)
  }
  return deliveries
}

const continueInFreshSession = async (
  $: EngineInterface,
  state: SessionState,
  settledHandoff: SettledHandoff,
  oldId: string,
  note: string,
  hasTurnAfterNote: boolean,
) => {
  await registerHandoffCommand($)
  const noteDelivery = await deliverNote($, settledHandoff, handoffMessage(oldId, note, hasTurnAfterNote))
  // Without an appended note, deliverNote joined the carried group to the note and has now handed it over.
  if (noteDelivery !== 'appended') releaseCarried(state)
  announce($, FINAL_MESSAGES[noteDelivery](oldId))
  for (const { text } of settledHandoff.heldGroups) await inspectPrompt($, state, text)
  const groupsToSend = groupsLeftToSend(settledHandoff.heldGroups, settledHandoff.isUnattended, noteDelivery)
  // SAFETY: the record is written after sendHeldGroups returns, so a throw inside it would lose the record. submitEntered
  // and refillBox catch their own failures, and keepInTranscript and releaseCarriedGroup make no async calls, so no test
  // can make the loop throw. Any call added to the loop must not throw either.
  const deliveries = await sendHeldGroups($, state, groupsToSend, settledHandoff.isUnattended)
  await writeRecord($, state, {
    ...settledHandoff.trigger,
    action: 'cleared',
    sessionId: oldId,
    note: noteDelivery,
    heldFields: {
      ...heldGroupFields(settledHandoff.heldGroups),
      handoff_unattended: settledHandoff.isUnattended,
      held_other_delivery: worstDelivery(deliveries),
    },
  })
}

const prepareHandoff = async ($: EngineInterface, state: SessionState, request: HandoffRequest) => {
  let oldId: string | undefined
  try {
    await redrawBand($, state, WRITING)
    $.ui.toast(WRITING_STATUS)
    oldId = await $.session.id()
    beginNoteWindow(state)
    const note = await writeNote($)
    if (note === null) {
      await abandonHandoff($, state, settleHandoff(state, request), 'no_handoff_written', 'No handoff was written. This session is unchanged.', oldId)
      return null
    }
    return { oldId, note }
  } catch (error) {
    debug($, `handoff failed before the clear: ${String(error)}`)
    await abandonHandoff($, state, settleHandoff(state, request), 'handoff_failed', 'No handoff was written. This session is unchanged.', oldId)
    return null
  }
}

// A session end already decided the outcome, so the wait is no longer about a clear the handoff will issue.
const showWaitingStatus = async ($: EngineInterface, state: SessionState) => {
  if (state.sessionEndBeforeClear !== null) return
  await redrawBand($, state, WAITING)
  $.ui.toast(WAITING_STATUS)
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
    // SAFETY: no await sits between the last isTurnRunning read and the $.command.run inside clearSession. Every awaited
    // step before the clear (the waiting status, the compaction, the busy check) is followed by another pass through the
    // wait, and the loop resumes straight from waitForTurnEnd, so a turn.start cannot land in the gap. clearSession's
    // first step is the synchronous command call. Do not add an await after the loop, or move the clear behind a helper
    // that awaits first.
    const mustRefuseWhenBusy = request.trigger.point !== 'command'
    let isCompacted = !state.compactBeforeClear
    let isBusy = false
    let hasShownWaiting = false
    for (;;) {
      while (state.isTurnRunning) {
        if (!hasShownWaiting) {
          hasShownWaiting = true
          debug($, 'waiting for a running turn to end before the clear')
          await showWaitingStatus($, state)
          continue
        }
        await waitForTurnEnd(state)
        debug($, 'resumed after the wait for a running turn')
      }
      if (state.sessionEndBeforeClear !== null) break
      if (!isCompacted) {
        isCompacted = true
        await compactBeforeClearing($, state, request.trigger, prepared.oldId)
        continue
      }
      if (!mustRefuseWhenBusy) break
      isBusy = await isBackgroundBusy($, state)
      if (!state.isTurnRunning) break
    }
    const outcome = preClearOutcome(state.sessionEndBeforeClear, isBusy)
    if (outcome === 'abandon_session_ended') {
      return await abandonHandoff($, state, settleHandoff(state, request), 'session_ended', SESSION_ENDED, prepared.oldId)
    }
    if (outcome === 'abandon_busy') {
      const busySettled = { ...settleHandoff(state, request), trigger: busyRefusalTrigger(request.trigger) }
      return await abandonHandoff($, state, busySettled, 'background_busy', BUSY_REFUSAL, prepared.oldId)
    }
    const hasTurnAfterNote = state.hasTurnAfterNote
    // The person already cleared: the fresh session they made takes the note, and no second clear runs.
    let isCleared = true
    if (outcome === 'clear') {
      beginOwnClear(state)
      isCleared = await clearSession($)
    } else {
      // No clear runs here, so this await is safe; the waiting status must not outlive the wait.
      await takeDownBand($, state)
    }
    const settledHandoff = settleHandoff(state, request)
    if (!isCleared) {
      return await abandonHandoff(
        $,
        state,
        settledHandoff,
        'clear_failed',
        'The handoff was written but /clear failed. This session is unchanged.',
        prepared.oldId,
      )
    }
    await continueInFreshSession($, state, settledHandoff, prepared.oldId, prepared.note, hasTurnAfterNote)
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
  if (!claim(state, 'handoff')) return false
  state.heldPrompt = null
  beginBeforeClear(state)
  beginHandoffHold(
    state,
    request.heldPrompt === undefined ? null : { text: request.heldPrompt, isUnattended: request.isUnattended },
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
  noteCacheReads(state, e)
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
  const trigger = snapshot(state, 'turn-end', signal, isBusy)
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
  const branchPrefixes = hasTicketShapedToken(text) ? branchTicketPrefix(await readBranch($)) : []
  const prefixes = [...state.urlPrefixes, ...branchPrefixes]
  const isNewWork = namesNewWork(text, state.seenRefs, prefixes)
  for (const ref of workRefs(text, prefixes)) state.seenRefs.add(ref)
  return isNewWork
}

const emptyBoxIfHolding = async ($: EngineInterface, text: string) => {
  try {
    const remainingDraft = withoutPrompt((await $.prompt.read()).text, text)
    if (remainingDraft !== null) await $.prompt.fill({ text: remainingDraft, mode: 'replace' })
  } catch (error) {
    debug($, `could not empty the prompt box: ${String(error)}`)
  }
}

const refillHeldPrompt = async ($: EngineInterface, state: SessionState, text: string) => {
  if (state.heldPrompt !== text) return
  if (await refillBox($, text)) return
  if (state.heldPrompt !== text) return
  state.heldPrompt = null
  await takeDownBand($, state)
  await submitOrKeepInTranscript($, text)
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

const returnToBox = async ($: EngineInterface, text: string): Promise<void> => {
  if (!(await refillBox($, text))) keepInTranscript($, text)
}

// An attachment or context can't be resent, so the prompt waits in the box for the person to send it again.
const refuseDuringHandoff = ($: EngineInterface, text: string): { drop: string } => {
  debug($, 'refused a prompt with attachments or context during the handoff')
  $.ui.toast(REFUSED_TOAST)
  $.clock.after(0, () => {
    void logFailure($, returnToBox($, text))
  })
  return { drop: REFUSED_DURING_HANDOFF }
}

const holdForHandoff = ($: EngineInterface, state: SessionState, e: PromptSubmitInput): { drop: string } => {
  const heldCount = addHeldPrompt(state, { text: e.text, isUnattended: isUnattendedOrigin(e.origin.kind) })
  debug($, `held a prompt for the handoff (${heldCount} held)`)
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
  if (action === 'refuse') return refuseDuringHandoff($, e.text)
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
  })
  const trigger = snapshot(state, 'prompt', signal, isBusy)
  if (action === 'handoff') {
    const isClaimed = scheduleHandoff($, state, { trigger, heldPrompt: e.text, isUnattended })
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
    void logFailure($, sendOrKeepInBox($, heldPrompt, false))
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
  $.ui.toast(BUSY_REFUSAL)
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
  const trigger = snapshot(state, 'button', offer.signal, isBusy)
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
  const trigger = snapshot(state, 'command', 'none', await isBackgroundBusy($, state))
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

export const register: Register = (on, options) => {
  const setting = asMode(options.handoffMode)
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
      if (setting !== 'off') $.ui.toast(`Untested on Claude Code ${engineVersion}, so it only logs this session. /handoff still works.`)
      await writeRecord($, state, { ...snapshot(state, 'session-start', 'none', false), action: 'untested_engine' })
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
    const dropped = isPersonOrigin(e.origin.kind) ? await decidePrompt($, state, e) : null
    return dropped ?? next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    startMainTurn(state)
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
        noteCacheReads(state, e)
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
