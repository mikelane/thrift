import type { EngineInterface, Register, ToolCallInput, ToolCallResult, TurnCompleteInput } from 'claude-code'

import { decisionRecord, LOG_WRITER, logLocation, type DecisionAction, type TriggerValues } from './decision-record'
import { isUntestedEngine } from './engine-version'
import { createState, resetForNewSession, type SessionState } from './session-state'
import { asMode, asThreshold, classify, contextFromStep, finishesTask, respond, type Signal } from './signals'
import { fieldOf, notifiedTaskId, validTaskId } from './tasks'

const BACKOFF_TOKENS = 50_000
const BUSY_AGENT_STATUSES = new Set(['pending', 'running', 'waiting'])

type Evaluation = {
  action: DecisionAction
  point: TriggerValues['point']
  signal: Signal
  isBusy: boolean
  reason?: string
  sessionId?: string
}

const debug = ($: EngineInterface, line: string) => $.ui.log(`handoff: ${line}`, { to: 'debug' })

const writeRecord = async ($: EngineInterface, state: SessionState, evaluation: Evaluation) => {
  const { action, point, signal, isBusy, reason, sessionId } = evaluation
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
        context_tokens: state.contextTokens,
        threshold: state.threshold,
        is_background_busy: isBusy,
        setting: state.setting,
        cache_read_tokens: state.cacheReadTokens,
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

type Trigger = Pick<Evaluation, 'point' | 'signal' | 'isBusy'>

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
    void runCompaction($, state, trigger)
  })
}

const evaluateTurnEnd = async ($: EngineInterface, state: SessionState, e: TurnCompleteInput, hasFinishedTask: boolean) => {
  if (state.pending !== null) return
  state.cacheReadTokens = e.usage?.cache_read_input_tokens ?? 0
  const isBusy = await isBackgroundBusy($, state)
  const signal = classify({
    contextTokens: state.contextTokens,
    threshold: state.threshold,
    isStoppingPoint: hasFinishedTask,
    isBackgroundBusy: isBusy,
  })
  const trigger: Trigger = { point: 'turn-end', signal, isBusy }
  const response = respond({
    mode: state.mode,
    signal,
    stoppingPoint: hasFinishedTask ? 'finished-task' : null,
    isBackgroundBusy: isBusy,
    isUnattended: state.isTurnUnattended,
  })
  if (response.kind !== 'none' && signal === 'weak' && isBackedOff(state)) {
    return writeRecord($, state, { ...trigger, action: 'none', reason: 'backoff' })
  }
  if (response.kind === 'compact') return scheduleCompaction($, state, trigger)
  return writeRecord($, state, { ...trigger, action: 'none' })
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
    if (!e.isInteractive || isUntested) state.mode = 'off'
    if (isUntested) {
      if (setting !== 'off') $.ui.toast(`handoff: untested on Claude Code ${engineVersion}; logging only`)
      await writeRecord($, state, { action: 'untested_engine', point: 'session-start', signal: 'none', isBusy: false })
    }
    return started
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const step = yield* next(e)
    if (e.agentId === undefined && step.usage) {
      const reported = (await $.session.usage()).context.tokens
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
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const hasFinishedTask = state.hasFinishedTask
    state.hasFinishedTask = false
    if (e.agentId === undefined && e.reason === 'answer') await evaluateTurnEnd($, state, e, hasFinishedTask)
    return result
  }).catch(($, e, next) => next(e))

  on('session.end', ($, e, next) => {
    resetForNewSession(state)
    return next(e)
  }).catch(($, e, next) => next(e))
}
