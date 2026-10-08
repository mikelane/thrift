import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  Register,
  RenderInput,
  ToolCallInput,
  ToolCallResult,
  PromptSubmitInput,
  TurnCompleteInput,
} from 'claude-code'

import type { Offer } from '../types'
import { BAND_HINT, BUTTON_LABELS, bandMessage } from './band-text'
import { decisionRecord, LOG_WRITER, logLocation, type DecisionAction, type TriggerValues } from './decision-record'
import { isUntestedEngine } from './engine-version'
import { HANDOFF_PROMPT, handoffMessage, joinPrompts, resumeCommand } from './handoff-note'
import { createState, resetForNewSession, type SessionState } from './session-state'
import {
  asMode,
  asThreshold,
  bandButtons,
  branchTicketPrefix,
  classify,
  contextFromStep,
  finishesTask,
  hasTicketShapedToken,
  namesNewWork,
  respond,
  ticketUrlPrefixes,
  workRefs,
  type Button,
  type Signal,
} from './signals'
import { fieldOf, notifiedTaskId, validTaskId } from './tasks'

const BACKOFF_TOKENS = 50_000
const PERSON_ORIGINS = new Set(['composer', 'bridge', 'sdk', 'scheduled-trigger'])
const BUSY_AGENT_STATUSES = new Set(['pending', 'running', 'waiting'])
const WRITING_TOAST = 'Writing a handoff for a fresh session...'
const HANDING_OFF_FIRST = 'handoff: handing off first. Your prompt will be sent in the fresh session.'
const HELD_PROMPT = 'handoff: held your prompt. Choose below, or press Enter again to send it here.'
const ALREADY_PENDING = 'A handoff or compaction is already in progress.'

const offerAtom = atom({ plugin: 'handoff', key: 'offer' } as const, null)

type Trigger = {
  point: TriggerValues['point']
  signal: Signal
  isBusy: boolean
  contextTokens: number
  cacheReadTokens: number
}

type Evaluation = Trigger & {
  action: DecisionAction
  reason?: string
  sessionId?: string
}

type HandoffRequest = {
  trigger: Trigger
  heldPrompt?: string
  isUnattended: boolean
}

const snapshot = (state: SessionState, point: Trigger['point'], signal: Signal, isBusy: boolean): Trigger => ({
  point,
  signal,
  isBusy,
  contextTokens: state.contextTokens,
  cacheReadTokens: state.cacheReadTokens,
})

const debug = ($: EngineInterface, line: string) => $.ui.log(`handoff: ${line}`, { to: 'debug' })

const writeRecord = async ($: EngineInterface, state: SessionState, evaluation: Evaluation) => {
  const { action, point, signal, isBusy, contextTokens, cacheReadTokens, reason, sessionId } = evaluation
  try {
    const [now, id, thriftHome, home] = await Promise.all([
      $.clock.now(),
      sessionId ?? $.session.id(),
      $.env.get('THRIFT_HOME'),
      $.env.get('HOME'),
    ])
    const location = logLocation(thriftHome, home)
    if (location === null) return debug($, 'no log location: neither THRIFT_HOME nor HOME is set')
    const record = decisionRecord({
      now,
      sessionId: id,
      action,
      engineVersion: state.engineVersion,
      triggerValues: {
        point,
        signal,
        context_tokens: contextTokens,
        threshold: state.threshold,
        is_background_busy: isBusy,
        setting: state.setting,
        cache_read_tokens: cacheReadTokens,
        ...(reason ? { reason } : {}),
      },
    })
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
  } catch {
    return true
  }
}

const readVersion = async ($: EngineInterface) => {
  try {
    const { version, base } = await $.session.version()
    return { engineVersion: base ?? version, base }
  } catch {
    return { engineVersion: 'unknown', base: undefined }
  }
}

const reportedContext = async ($: EngineInterface): Promise<number | undefined> => {
  try {
    return (await $.session.usage()).context.tokens
  } catch {
    return undefined
  }
}

const noteToolCall = (state: SessionState, e: ToolCallInput, ran: ToolCallResult) => {
  const succeeded = ran.deny === undefined && ran.isError !== true
  if (e.tool === 'Bash') {
    const started = validTaskId(fieldOf(ran.result, 'backgroundTaskId'))
    if (started !== null) state.backgroundTasks.add(started)
    else if (succeeded && finishesTask(e.command)) state.hasFinishedTask = true
  } else if (e.tool === 'Monitor') {
    const started = validTaskId(fieldOf(ran.result, 'taskId'))
    if (started !== null) state.backgroundTasks.add(started)
  } else if (e.tool === 'TaskStop' || String(e.tool) === 'KillShell') {
    const input: Readonly<Record<string, unknown>> = e
    const stopped = validTaskId(input.task_id ?? input.shell_id)
    if (stopped !== null) state.backgroundTasks.delete(stopped)
  }
}

const isBackedOff = (state: SessionState) =>
  state.backoffFrom !== null && state.contextTokens < state.backoffFrom + BACKOFF_TOKENS

const runCompaction = async ($: EngineInterface, state: SessionState, trigger: Trigger) => {
  const sizeBefore = state.contextTokens
  try {
    const result = await $.session.compact()
    if (result.skip !== undefined) {
      state.backoffFrom = sizeBefore
      await writeRecord($, state, { ...trigger, action: 'none', reason: 'compaction_vetoed' })
    } else {
      await writeRecord($, state, { ...trigger, action: 'compacted' })
      state.backoffFrom = result.tokensAfter ?? sizeBefore
      state.contextTokens = result.tokensAfter ?? sizeBefore
    }
  } catch (error) {
    state.backoffFrom = sizeBefore
    debug($, `compaction failed: ${String(error)}`)
    await writeRecord($, state, { ...trigger, action: 'none', reason: 'compaction_failed' })
  } finally {
    state.pending = null
  }
}

const scheduleCompaction = ($: EngineInterface, state: SessionState, trigger: Trigger) => {
  state.pending = 'compact'
  $.clock.after(0, () => {
    void logFailure($, runCompaction($, state, trigger))
  })
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

const logFailure = ($: EngineInterface, work: Promise<unknown>) =>
  work.catch(error => debug($, `background work failed: ${String(error)}`))

const refillBox = async ($: EngineInterface, text: string): Promise<boolean> => {
  try {
    const draft = (await $.prompt.read()).text
    if (draft.includes(text)) return true
    const filled = await $.prompt.fill({ text: draft === '' ? text : `${text}\n${draft}`, mode: 'replace' })
    return filled.isFilled
  } catch (error) {
    debug($, `could not refill the prompt box: ${String(error)}`)
    return false
  }
}

const restorePrompt = async ($: EngineInterface, text: string, isUnattended: boolean) => {
  if (!isUnattended && (await refillBox($, text))) return
  try {
    await $.prompt.submit({ text })
  } catch (error) {
    debug($, `could not restore the held prompt: ${String(error)}`)
  }
}

const abandonHandoff = async (
  $: EngineInterface,
  state: SessionState,
  request: HandoffRequest,
  reason: string,
  message: string,
) => {
  $.ui.toast(message)
  await writeRecord($, state, { ...request.trigger, action: 'none', reason })
  if (request.heldPrompt !== undefined) await restorePrompt($, request.heldPrompt, request.isUnattended)
}

const writeNote = async ($: EngineInterface): Promise<string | null> => {
  try {
    const answer = await $.model.fork({ prompt: HANDOFF_PROMPT })
    return answer.isAnswered && answer.text.trim() !== '' ? answer.text.trim() : null
  } catch {
    return null
  }
}

const compactBeforeClearing = async ($: EngineInterface, state: SessionState, trigger: Trigger) => {
  try {
    const result = await $.session.compact()
    if (result.skip !== undefined) await writeRecord($, state, { ...trigger, action: 'none', reason: 'compaction_vetoed' })
  } catch (error) {
    debug($, `compaction before the clear failed: ${String(error)}`)
    await writeRecord($, state, { ...trigger, action: 'none', reason: 'compaction_failed' })
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
    return appended.deny === undefined
  } catch (error) {
    debug($, `append failed: ${String(error)}`)
    return false
  }
}

const continueInFreshSession = async (
  $: EngineInterface,
  state: SessionState,
  request: HandoffRequest,
  oldId: string,
  note: string,
) => {
  await registerHandoffCommand($)
  const message = handoffMessage(oldId, note)
  const isStored = await appendNote($, message)
  const resume = resumeCommand(oldId)
  $.ui.log(`handoff: the previous session is ${oldId}. Reopen it with ${resume}`)
  $.ui.toast(`Handoff written. Reopen ${oldId} with ${resume}`)
  await writeRecord($, state, { ...request.trigger, action: 'cleared', sessionId: oldId })
  if (request.heldPrompt !== undefined) await inspectPrompt($, state, request.heldPrompt)
  const prompt = isStored ? request.heldPrompt : joinPrompts(message, request.heldPrompt)
  if (prompt !== undefined) await $.prompt.submit({ text: prompt })
}

const prepareHandoff = async ($: EngineInterface, state: SessionState, request: HandoffRequest) => {
  try {
    await takeDownBand($, state)
    $.ui.toast(WRITING_TOAST)
    const oldId = await $.session.id()
    const note = await writeNote($)
    if (note === null) {
      await abandonHandoff($, state, request, 'no_handoff_written', 'No handoff was written. This session is unchanged.')
      return null
    }
    if (state.compactBeforeClear) await compactBeforeClearing($, state, request.trigger)
    return { oldId, note }
  } catch (error) {
    debug($, `handoff failed before the clear: ${String(error)}`)
    await abandonHandoff($, state, request, 'handoff_failed', 'No handoff was written. This session is unchanged.')
    return null
  }
}

const runHandoff = async ($: EngineInterface, state: SessionState, request: HandoffRequest) => {
  try {
    const prepared = await prepareHandoff($, state, request)
    if (prepared === null) return
    if (!(await clearSession($))) {
      return await abandonHandoff(
        $,
        state,
        request,
        'clear_failed',
        'The handoff was written but /clear failed. This session is unchanged.',
      )
    }
    await continueInFreshSession($, state, request, prepared.oldId, prepared.note)
  } catch (error) {
    debug($, `handoff failed after the clear: ${String(error)}`)
  } finally {
    state.pending = null
  }
}

const scheduleHandoff = ($: EngineInterface, state: SessionState, request: HandoffRequest) => {
  state.pending = 'handoff'
  $.clock.after(0, () => {
    void logFailure($, runHandoff($, state, request))
  })
}

const evaluateTurnEnd = async (
  $: EngineInterface,
  state: SessionState,
  e: TurnCompleteInput,
  hasFinishedTask: boolean,
) => {
  if (state.pending !== null) return
  state.cacheReadTokens = e.usage?.cache_read_input_tokens ?? 0
  const isBusy = await isBackgroundBusy($, state)
  const signal = classify({
    contextTokens: state.contextTokens,
    threshold: state.threshold,
    isStoppingPoint: hasFinishedTask,
    isBackgroundBusy: isBusy,
  })
  const trigger = snapshot(state, 'turn-end', signal, isBusy)
  const response = respond({
    mode: state.mode,
    signal,
    stoppingPoint: hasFinishedTask ? 'finished-task' : null,
    isBackgroundBusy: isBusy,
    isUnattended: state.isTurnUnattended,
  })
  if (signal === 'weak' && isBackedOff(state)) {
    await takeDownBand($, state)
    return writeRecord($, state, { ...trigger, action: 'none', reason: 'backoff' })
  }
  if (response.kind === 'advise') return offerBand($, state, trigger, response.holdsPrompt)
  await takeDownBand($, state)
  if (response.kind === 'compact') return scheduleCompaction($, state, trigger)
  if (response.kind === 'handoff') return scheduleHandoff($, state, { trigger, isUnattended: state.isTurnUnattended })
  return writeRecord($, state, { ...trigger, action: 'none' })
}

const readBranch = async ($: EngineInterface): Promise<string> => {
  try {
    const ran = await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: 5000 })
    return ran.exitCode === 0 ? ran.stdout.trim() : ''
  } catch {
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
    if ((await $.prompt.read()).text === text) await $.prompt.fill({ text: '', mode: 'replace' })
  } catch (error) {
    debug($, `could not empty the prompt box: ${String(error)}`)
  }
}

const refillHeldPrompt = async ($: EngineInterface, state: SessionState, text: string) => {
  if (await refillBox($, text)) return
  if (state.heldPrompt !== text) return
  state.heldPrompt = null
  await takeDownBand($, state)
  await $.prompt.submit({ text })
}

const holdPrompt = async ($: EngineInterface, state: SessionState, text: string, trigger: Trigger) => {
  state.heldPrompt = text
  $.clock.after(0, () => {
    void logFailure($, refillHeldPrompt($, state, text))
  })
  await offerBand($, state, trigger, true)
  return { drop: HELD_PROMPT }
}

const decidePrompt = async ($: EngineInterface, state: SessionState, e: PromptSubmitInput) => {
  const isUnattended = e.origin.kind === 'scheduled-trigger'
  if (state.heldPrompt !== null) {
    state.heldPrompt = null
    await takeDownBand($, state)
  }
  state.isTurnUnattended = isUnattended
  const isNewWork = await inspectPrompt($, state, e.text)
  const canHold =
    isNewWork &&
    state.pending === null &&
    e.turnId === undefined &&
    (e.attachments?.length ?? 0) === 0 &&
    (e.context?.length ?? 0) === 0
  if (!canHold) return null
  const isBusy = await isBackgroundBusy($, state)
  const signal = classify({
    contextTokens: state.contextTokens,
    threshold: state.threshold,
    isStoppingPoint: true,
    isBackgroundBusy: isBusy,
  })
  const trigger = snapshot(state, 'prompt', signal, isBusy)
  const response = respond({ mode: state.mode, signal, stoppingPoint: 'new-work', isBackgroundBusy: isBusy, isUnattended })
  if (response.kind === 'handoff') {
    scheduleHandoff($, state, { trigger, heldPrompt: e.text, isUnattended })
    return { drop: HANDING_OFF_FIRST }
  }
  if (response.kind === 'advise' && response.holdsPrompt) return holdPrompt($, state, e.text, trigger)
  await writeRecord($, state, { ...trigger, action: 'none' })
  return null
}

const pressHeldPromptButton = async ($: EngineInterface, state: SessionState, trigger: Trigger, button: Button) => {
  const held = state.heldPrompt
  if (held === null) return
  state.heldPrompt = null
  await takeDownBand($, state)
  await emptyBoxIfHolding($, held)
  if (button === 'handoff-send') return scheduleHandoff($, state, { trigger, heldPrompt: held, isUnattended: false })
  await writeRecord($, state, { ...trigger, action: 'none', reason: 'send_here' })
  $.clock.after(0, () => {
    void logFailure($, $.prompt.submit({ text: held }))
  })
}

const pressButton = async ($: EngineInterface, state: SessionState, offer: Offer, button: Button) => {
  if (state.pending !== null) return
  const trigger = snapshot(state, 'button', offer.signal, offer.isBusy)
  if (button === 'handoff-send' || button === 'send-here') return pressHeldPromptButton($, state, trigger, button)
  if (button === 'compact') scheduleCompaction($, state, trigger)
  else if (button !== 'not-now') scheduleHandoff($, state, { trigger, isUnattended: false })
  else state.backoffFrom = state.contextTokens
  await takeDownBand($, state)
  if (button === 'not-now') await writeRecord($, state, { ...trigger, action: 'none', reason: 'not_now' })
}

const drawBand = ($: EngineInterface, state: SessionState, e: RenderInput<'AbovePrompt'>, offer: Offer) => {
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      <Text>{bandMessage(offer)}</Text>
      <Box columnGap={1}>
        {bandButtons(offer).map(button => (
          <Button key={button} label={BUTTON_LABELS[button]} onPress={() => pressButton($, state, offer, button)} />
        ))}
      </Box>
      <Text dimColor>{BAND_HINT}</Text>
    </Box>
  )
}

const startHandoffCommand = async ($: EngineInterface, state: SessionState) => {
  if (state.pending !== null) return { text: ALREADY_PENDING }
  const trigger = snapshot(state, 'command', 'none', await isBackgroundBusy($, state))
  scheduleHandoff($, state, { trigger, isUnattended: false })
  return { text: WRITING_TOAST }
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
    const { engineVersion, base } = await readVersion($)
    const isUntested = isUntestedEngine(base)
    state.engineVersion = engineVersion
    state.mode = e.isInteractive && !isUntested ? setting : 'off'
    if (e.isInteractive) await registerHandoffCommand($)
    if (isUntested) {
      if (setting !== 'off') $.ui.toast(`handoff: untested on Claude Code ${engineVersion}; logging only`)
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

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined) noteToolCall(state, e, ran)
    return ran
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const finishedTaskId = e.origin.kind === 'task-notification' ? notifiedTaskId(e.text) : null
    if (finishedTaskId !== null) state.backgroundTasks.delete(finishedTaskId)
    const dropped = PERSON_ORIGINS.has(e.origin.kind) ? await decidePrompt($, state, e) : null
    return dropped ?? next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const hasFinishedTask = state.hasFinishedTask
    state.hasFinishedTask = false
    if (e.agentId === undefined && e.reason === 'answer') await evaluateTurnEnd($, state, e, hasFinishedTask)
    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const offer = await read($, offerAtom)
    return e.props.hasSurvey || offer === null ? next(e) : drawBand($, state, e, offer)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'handoff' }, $ => startHandoffCommand($, state)).catch(() => ({
    text: 'handoff: could not start a handoff.',
  }))

  on('session.end', async ($, e, next) => {
    await takeDownBand($, state)
    resetForNewSession(state)
    if (e.reason === 'clear') {
      $.clock.after(0, () => {
        void logFailure($, registerHandoffCommand($))
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}
