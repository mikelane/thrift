import type { EngineInterface, Register } from 'claude-code'

import { decisionRecord, LOG_WRITER, logLocation, type DecisionAction, type TriggerValues } from './decision-record'
import { isUntestedEngine } from './engine-version'
import { createState, resetForNewSession, type SessionState } from './session-state'
import { asMode, asThreshold, classify, contextFromStep, type Signal } from './signals'

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

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.reason === 'answer') {
      state.cacheReadTokens = e.usage?.cache_read_input_tokens ?? 0
      const isBusy = await isBackgroundBusy($, state)
      const signal = classify({
        contextTokens: state.contextTokens,
        threshold: state.threshold,
        isStoppingPoint: false,
        isBackgroundBusy: isBusy,
      })
      await writeRecord($, state, { action: 'none', point: 'turn-end', signal, isBusy })
    }
    return result
  }).catch(($, e, next) => next(e))

  on('session.end', ($, e, next) => {
    resetForNewSession(state)
    return next(e)
  }).catch(($, e, next) => next(e))
}
