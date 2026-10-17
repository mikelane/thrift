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
  leftoverStripFields,
  snapshotTrigger,
  type ClearedBy,
  type DecisionReason,
  type HandoffRequest,
  type SettledHandoff,
  type Trigger,
} from './decision-record'
import { announce, debug, logFailure, registerHandoffCommand } from './engine-log'
import {
  continueInFreshSession,
  restoreHeldGroups,
  restoreLateArrivals,
  sendOrKeepInBox,
  submitOrKeepInTranscript,
} from './handoff-delivery'
import { isBackgroundBusy } from './background-busy'
import { inspectPrompt } from './prompt-inspection'
import { writeRecord } from './record-writer'
import { decideDuringHandoff } from './handoff-hold'
import { noteBoxLeftover } from './box-leftover'
import { isUntestedEngine } from './engine-version'
import { noteOutcome, type ForkReason, type NoteOutcome } from './fork-outcome'
import {
  NO_HANDOFF_MESSAGE,
  busyRefusalMessage,
  clearFailedMessage,
  noHandoffMessage,
  sessionEndedMessage,
  HANDOFF_PROMPT,
  groupHeldPrompts,
} from './handoff-note'
import { clearBoxCopyWhileHeld, composerPrompt, emptyBoxIfHolding, refillBox } from './prompt-box'
import { worstDelivery } from './held-delivery'
import {
  canHoldPrompt,
  carriesExtras,
  isPersonOrigin,
  isComposerOrigin,
  isUnattendedOrigin,
  planNewWorkPrompt,
} from './prompt-plan'
import {
  beginSending,
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
  noteCacheReads,
  forgetForeignClear,
  recordForeignClear,
  recordSessionEnd,
  releaseTurnEndWaiter,
  resetForNewSession,
  startMainTurn,
  startSubagentTurn,
  endSubagentTurn,
  takeHeldPrompts,
  waitForTurnEnd,
  type ButtonPress,
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
import { waitStartedLine } from './wait-started-line'

const WRITING_COMMAND_REPLY = 'Writing a handoff for a fresh session...'
const HANDING_OFF_FIRST = 'Handing off first. Your prompt will be sent in the fresh session.'
const HELD_PROMPT = 'Held your prompt. Choose below, or press Enter again to send it here.'
const PRESS_WAITS_FOR_TURN = 'This turn is still running, so your choice will run when it ends.'
const PROMPT_NOT_HELD = 'That prompt is no longer held, so there is nothing to send.'
const ALREADY_PENDING = 'A handoff or compaction is already in progress.'

// /handoff is registered only when a person is at the prompt, so only then is it there to mention.
const untestedEngineNotice = (engineVersion: string, isInteractive: boolean): string =>
  `Untested on Claude Code ${engineVersion}, so this session only logs decisions.${isInteractive ? ' /handoff still works.' : ''}`

// The shape names the Offer fields, so a reload finds an offer an older version wrote (heldPrompt, not hasHeldPrompt) absent.
const offerAtom = atom({ plugin: 'handoff', key: 'offer' } as const, null, { shape: 'offer-has-held-prompt' })

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
      ...leftoverStripFields(state.leftoverStrips),
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

// Who ran the clear for each outcome that reaches it; a new outcome fails to compile until it is mapped here.
const CLEARED_BY = {
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
  const clearWindow = { outcome, hasCompactedBeforeClear, hasTurnAfterNote: state.hasTurnAfterNote }
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
  beforeRun?: () => Promise<unknown>,
) => {
  try {
    // SAFETY: beforeRun is clearBoxCopyWhileHeld on the prompt path (it wraps emptyBoxIfHolding) and emptyBoxIfHolding
    // on the command path. emptyBoxIfHolding catches its own failures, so no test can make it throw.
    // It runs inside the try so a future beforeRun that throws still releases the claim.
    await beforeRun?.()
    const prepared = await prepareHandoff($, state, request)
    if (prepared === null) return
    const { outcome, hasCompactedBeforeClear, hasTurnAfterNote, clearing } = await waitForClearWindow($, state, request, prepared.oldId)
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
  beforeRun?: () => Promise<unknown>,
): boolean => {
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

// Taking the held prompts ends their holding: from here a prompt that arrives belongs to the fresh session or the old one.
const settleHandoff = (state: SessionState, request: HandoffRequest): SettledHandoff => ({
  trigger: request.trigger,
  isUnattended: request.isUnattended,
  heldGroups: groupHeldPrompts(takeHeldPrompts(state)),
})

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
    // That clear can read the box before the text is back, as a held prompt's can, so the text is remembered as the box's
    // leftover once the hold has begun (beginHandoffHold forgets any earlier one).
    const isFromComposer = isComposerOrigin(e.origin.kind)
    const emptyBox = isFromComposer ? () => clearBoxCopyWhileHeld($, state, e.text) : undefined
    const isClaimed = scheduleHandoff($, state, { trigger, heldPrompt: e.text, heldPromptOrigin: e.origin.kind, isUnattended }, emptyBox)
    if (isClaimed && isFromComposer) noteBoxLeftover(state, e.text)
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

// Long because every on(...) call lives here. The engine follows $ into a top-level function of this file, and past an
// import only into a function declaration.
export const register: Register = (on, options) => {
  const setting = asMode(options.handoffMode)
  // SAFETY: a reload that runs register again gives the new state pending null and nothing held. On 2.1.299 a setting
  // changed in /config did so (a handoff right after one recorded context_tokens 0); /reload-plugins kept the old
  // state. A handoff already running keeps the old state and its old closures. Its prompts are no longer held, so they
  // pass through and /clear can land inside their turn. The old hooks are gone too, so nothing releases a wait for a
  // turn to end, and that handoff waits forever and never clears. Both need a reload while a handoff runs, from the
  // note being written until its prompts are delivered. No guard: carrying the state across a reload would need it in
  // an atom.
  // After a reload, run /handoff again.
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
    if (e.agentId === undefined) startMainTurn(state, e.text)
    else startSubagentTurn(state, e.turnId)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      endSubagentTurn(state, e.turnId)
      return result
    }
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

  // The handoff's own clear can reach this hook (the declarations skip only the calling hook); recordForeignClear drops it
  // by origin. The test kit skips the whole plugin instead, so only the pure tests cover the own-origin branch.
  // Counted from the note on, before next, since the clear's session end may come inside it (the kit's does). Core sets ref on a run it made; a
  // hook beneath that answers in the clear's place leaves it off, and a clear that throws ran nothing: no end is coming.
  // SAFETY: a hook beneath that calls next and then rewrites the output also leaves ref off. The end already spent the count,
  // so forgetting is a no-op, unless a second foreign clear is still pending, whose count it eats: that clear's end is then
  // taken for the handoff's, and a late turn after it goes unreported. Needs two queued clears and such a hook. No guard.
  on('command.run', { command: 'clear' }, async ($, e, next) => {
    recordForeignClear(state, e.origin)
    try {
      const clearOutput = await next(e)
      if (clearOutput.ref === undefined) forgetForeignClear(state)
      return clearOutput
    } catch (error) {
      forgetForeignClear(state)
      throw error
    }
  }).catch(($, e, next) => next(e))

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
