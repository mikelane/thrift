import type { Engine, MockClock } from 'claude-code/testing'
import type { AgentInfo, ModelForkResult, On, SessionCompactResult, SessionVersion, TurnUsage } from 'claude-code'

export type LogRecord = {
  ts: string
  session_id: string
  component: string
  mode: string
  action: string
  engine_version: string
  trigger_values: Record<string, unknown>
}

type Box = { text: string; cursor: number }

export type World = {
  clock: MockClock
  effects: string[]
  records: LogRecord[]
  logTargets: string[][]
  logArgv: string[][]
  debugLines: string[]
  sessionId: string
  nextSessionId: string
  contextTokens: number | undefined
  version: SessionVersion
  versionThrows: boolean
  branch: string | null
  gitCalls: number
  agents: AgentInfo[]
  agentListThrows: boolean
  // One-shot: runs inside the next agent.list call, so a test can act while the plugin awaits it.
  onAgentList: (() => Promise<void>) | undefined
  // Runs inside each write of the band's offer, so a test can act while the plugin awaits that write.
  onOfferWrite: ((value: unknown) => Promise<void>) | undefined
  // Runs inside each prompt.fill, before it changes the box, so a test can hold the fill while the plugin awaits it.
  onFill: (() => Promise<void>) | undefined
  // Runs when a clear is issued, before it ends the session: what the engine ran ahead of it, in the order it ran.
  onClearIssued: (() => Promise<void>) | undefined
  // Runs after a clear ended the session, before the clear's run returns: what the engine ran next, in the fresh session.
  onClearEnded: (() => Promise<void>) | undefined
  onCommandRegistered: (() => Promise<void>) | undefined
  // The origin kind and name of every clear that reached the mock, so a test can see whose clear ran.
  clearOrigins: string[]
  // A hook beneath the plugin answers a person's /clear in its place: no clear runs and no session ends.
  answersPersonClear: boolean
  box: Box
  // True while a submitHooks callback runs: a prompt that arrives then is typed after what the plugin just put in the box.
  isRunningSubmitHook: boolean
  fillRefusal: 'no_composer' | 'dialog' | undefined
  // The box shows its text, but a dialog is up: a fill is refused while a read still answers.
  isFillRefusedOverText: boolean
  fork: () => Promise<ModelForkResult>
  compact: () => Promise<SessionCompactResult>
  clearThrows: boolean
  appendDenied: boolean
  forkPrompts: string[]
  registerThrows: boolean
  logWrite: 'ok' | 'exit' | 'throw'
  stateSetThrows: boolean
  offerWrites: unknown[]
  usageDenied: boolean
  boxReadDenied: boolean
  sessionIdDenials: number
  submitThrows: boolean
  submitDropped: boolean
  // One-shot callbacks, one per upcoming prompt.submit in order; an undefined entry lets that submit pass untouched.
  submitHooks: Array<(() => void) | undefined>
  gitThrows: boolean
  gitFailure: boolean
  step: { usage: TurnUsage | null; advisorCalls: number }
  toolResult: unknown
  toolMode: 'ok' | 'error' | 'deny'
  appended: string[]
}

const LOG_RECORD_STRINGS = ['ts', 'session_id', 'component', 'mode', 'action', 'engine_version'] as const

const isLogRecord = (value: unknown): value is LogRecord =>
  typeof value === 'object' &&
  value !== null &&
  LOG_RECORD_STRINGS.every(key => typeof Reflect.get(value, key) === 'string') &&
  typeof Reflect.get(value, 'trigger_values') === 'object' &&
  Reflect.get(value, 'trigger_values') !== null

const parseLogRecord = (line: string): LogRecord => {
  const parsed: unknown = JSON.parse(line)
  if (!isLogRecord(parsed)) throw new Error(`not a decision record: ${line}`)
  return parsed
}

const ok = <T,>(value: T) => ({ value })

const noUsage = { startedAt: 0, rateLimits: [] }

export const installSessionMocks = (on: On, world: World) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => {
    if (world.sessionIdDenials > 0) {
      world.sessionIdDenials -= 1
      return { deny: 'no session id' }
    }
    return ok(world.sessionId)
  })
  on('session.usage', () => (world.usageDenied ? { deny: 'no usage' } : ok({ ...noUsage, context: { tokens: world.contextTokens, window: 1_000_000 } })))
  on('session.version', () => {
    if (world.versionThrows) throw new Error('no version')
    return ok(world.version)
  })
  on('session.compact', async () => {
    world.effects.push('compact')
    return world.compact()
  })
  on('session.append', (_$, e, next) => {
    const first = e.message.content[0]
    world.effects.push('append')
    if (world.appendDenied) return { deny: 'refused' }
    world.appended.push(first?.type === 'text' ? String(first.text) : '')
    return next(e)
  })
}

export const installModelMocks = (on: On, world: World) => {
  on('model.fork', async (_$, e) => {
    world.effects.push('fork')
    world.forkPrompts.push(e.prompt)
    return ok(await world.fork())
  })
  on('agent.list', async () => {
    await world.onAgentList?.()
    if (world.agentListThrows) throw new Error('agent list failed')
    return ok(world.agents)
  })
}

export const installPromptMocks = (on: On, world: World) => {
  // A session with no composer, or one the plugin may not fill, shows no text to read.
  on('prompt.read', () => {
    if (world.boxReadDenied) return { deny: 'no box' }
    return ok(world.fillRefusal === undefined ? world.box : { text: '', cursor: 0 })
  })
  on('prompt.fill', async (_$, e) => {
    await world.onFill?.()
    if (world.isFillRefusedOverText) return { isFilled: false, refusal: 'dialog' }
    if (world.fillRefusal !== undefined) return { isFilled: false, refusal: world.fillRefusal }
    world.effects.push(`fill:${e.text}`)
    world.box = { text: e.text, cursor: e.text.length }
    return { isFilled: true }
  })
  on('prompt.submit', (_$, e) => {
    world.isRunningSubmitHook = true
    world.submitHooks.shift()?.()
    world.isRunningSubmitHook = false
    if (world.submitThrows) throw new Error('submit refused')
    if (world.submitDropped) return { drop: 'refused by another hook' }
    world.effects.push(`entered:${e.origin.kind}${'asUser' in e.origin && e.origin.asUser ? '+asUser' : ''}:${e.text}`)
    return { text: e.text }
  })
}

export const installCommandMocks = ($: Engine, on: On, world: World) => {
  on('command.register', async (_$, e) => {
    if (world.registerThrows) throw new Error('register refused')
    world.effects.push(`register:${e.name}`)
    await world.onCommandRegistered?.()
    return ok({ command: e.name })
  })
  on('command.run', async (_$, e) => {
    if (e.command !== 'clear') return { text: `ran ${e.command}` }
    if (world.clearThrows) throw new Error('clear refused')
    if (world.answersPersonClear && e.origin.kind === 'composer') return { text: 'not now' }
    world.effects.push('clear')
    world.clearOrigins.push('name' in e.origin ? `${e.origin.kind}:${e.origin.name}` : e.origin.kind)
    await world.onClearIssued?.()
    const ended = world.sessionId
    world.sessionId = world.nextSessionId
    await $.session.end({ reason: 'clear', sessionId: ended, resume: { id: ended } })
    await world.onClearEnded?.()
    // Core names the run it made; an answer in a command's place carries no ref.
    return { ref: 1 }
  })
}

export const installUiMocks = (on: On, world: World) => {
  on('ui.toast', (_$, e) => {
    world.effects.push(`toast:${e.text}`)
    return ok(undefined)
  })
  on('ui.log', (_$, e) => {
    world.effects.push(e.to === 'debug' ? `debug:${e.text}` : `log:${e.text}`)
    if (e.to === 'debug') world.debugLines.push(e.text)
    return ok(undefined)
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine band'] }))
}

export const installProcessMocks = (on: On, world: World) => {
  on('process.run', (_$, e) => {
    const [program, ...args] = e.argv
    const finished = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    if (program === 'git') world.gitCalls += 1
    if (program === 'git' && world.gitThrows) throw new Error('git failed')
    if (program === 'git') return ok({ ...finished, exitCode: world.branch === null || world.gitFailure ? 128 : 0, stdout: `${world.branch ?? ''}\n` })
    if (world.logWrite === 'throw') throw new Error('spawn failed')
    world.logTargets.push(args.slice(3))
    world.logArgv.push([...e.argv])
    if (world.logWrite === 'exit') return ok({ ...finished, exitCode: 1, stderr: 'disk full' })
    world.records.push(parseLogRecord(e.init?.stdin ?? '{}'))
    return ok(finished)
  })
}

export const installTurnMocks = (on: On, world: World) => {
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      serverToolUses: Array.from({ length: world.step.advisorCalls }, (_, index) => ({
        id: `srv${index}`,
        name: 'advisor',
        input: {},
        startedAt: 0,
        endedAt: 1,
      })),
      stopReason: 'end_turn' as const,
      usage: world.step.usage,
    }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
}

export const installStateMocks = (on: On, world: World) => {
  on('state.set', async (_$, e, next) => {
    if (world.stateSetThrows) return { deny: 'cannot write' }
    if (e.key === 'offer') {
      world.offerWrites.push(e.value)
      await world.onOfferWrite?.(e.value)
    }
    return next(e)
  })
}

export const installToolMocks = (on: On, world: World) => {
  on('tool.call', (_$, e) => {
    if (world.toolMode === 'deny') return { deny: 'blocked' }
    if (world.toolMode === 'error') return { isError: true as const, result: 'failed', text: 'failed' }
    return { result: world.toolResult, text: `ran ${e.tool}` }
  })
}
