import { mock, type Engine, type MockClock } from 'claude-code/testing'
import type {
  AgentInfo,
  ModelForkResult,
  On,
  SessionCompactResult,
  SessionVersion,
  TurnUsage,
} from 'claude-code'

export type LogRecord = {
  ts: string
  session_id: string
  component: string
  mode: string
  action: string
  engine_version: string
  trigger_values: Record<string, unknown>
}

export type Box = { text: string; cursor: number }

export type World = {
  clock: MockClock
  effects: string[]
  records: LogRecord[]
  logTargets: string[][]
  debugLines: string[]
  sessionId: string
  nextSessionId: string
  contextTokens: number | undefined
  version: SessionVersion
  versionThrows: boolean
  branch: string | null
  agents: AgentInfo[]
  agentListThrows: boolean
  box: Box
  fillRefusal: 'no_composer' | 'dialog' | undefined
  fork: () => Promise<ModelForkResult>
  compact: () => Promise<SessionCompactResult>
  clearThrows: boolean
  appendDenied: boolean
  registerThrows: boolean
  logWrite: 'ok' | 'exit' | 'throw'
  stateSetThrows: boolean
  step: { usage: TurnUsage | null; advisorCalls: number }
  toolResult: unknown
  toolIsError: boolean
  appended: string[]
}

export const answered = (text: string): ModelForkResult => ({
  isAnswered: true,
  text,
  usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 },
})

export const compacted = (tokensAfter?: number): SessionCompactResult => ({
  messages: [],
  tokensBefore: 200_000,
  tokensAfter,
})

export const usageOf = (input: number, created: number, read: number): TurnUsage => ({
  model: 'm',
  input_tokens: input,
  cache_creation_input_tokens: created,
  cache_read_input_tokens: read,
  output_tokens: 1,
})

const ok = <T,>(value: T) => ({ value })

const noUsage = { startedAt: 0, rateLimits: [] }

type Environment = { home?: string | null; thriftHome?: string }

export const install = ($: Engine, on: On, { home = '/home/u', thriftHome }: Environment = {}): World => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 8, 20, 0, 0) })
  mock.env(on, {
    ...(home === null ? {} : { HOME: home }),
    ...(thriftHome === undefined ? {} : { THRIFT_HOME: thriftHome }),
  })
  const world: World = {
    clock,
    effects: [],
    records: [],
    logTargets: [],
    debugLines: [],
    sessionId: 'old-session',
    nextSessionId: 'new-session',
    contextTokens: undefined,
    version: { version: '2.1.295', base: '2.1.295' },
    versionThrows: false,
    branch: null,
    agents: [],
    agentListThrows: false,
    box: { text: '', cursor: 0 },
    fillRefusal: undefined,
    fork: async () => answered('The handoff note.'),
    compact: async () => compacted(48_000),
    clearThrows: false,
    appendDenied: false,
    registerThrows: false,
    logWrite: 'ok',
    stateSetThrows: false,
    step: { usage: null, advisorCalls: 0 },
    toolResult: {},
    toolIsError: false,
    appended: [],
  }

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ok(world.sessionId))
  on('session.usage', () => ok({ ...noUsage, context: { tokens: world.contextTokens, window: 1_000_000 } }))
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
    if (world.appendDenied) return { deny: 'refused' } as never
    world.appended.push(first?.type === 'text' ? String(first.text) : '')
    return next(e)
  })
  on('model.fork', async () => {
    world.effects.push('fork')
    return ok(await world.fork())
  })
  on('agent.list', () => {
    if (world.agentListThrows) throw new Error('agent list failed')
    return ok(world.agents)
  })
  on('prompt.read', () => ok(world.box))
  on('prompt.fill', (_$, e) => {
    if (world.fillRefusal !== undefined) return { isFilled: false, refusal: world.fillRefusal }
    world.effects.push(`fill:${e.text}`)
    world.box = { text: e.text, cursor: e.text.length }
    return { isFilled: true }
  })
  on('prompt.submit', (_$, e) => {
    world.effects.push(`entered:${e.origin.kind}:${e.text}`)
    return { text: e.text }
  })
  on('command.register', (_$, e) => {
    if (world.registerThrows) throw new Error('register refused')
    world.effects.push(`register:${e.name}`)
    return ok({ command: e.name })
  })
  on('command.run', async (_$, e) => {
    if (e.command !== 'clear') return { text: `ran ${e.command}` }
    if (world.clearThrows) throw new Error('clear refused')
    world.effects.push('clear')
    const ended = world.sessionId
    world.sessionId = world.nextSessionId
    await $.session.end({ reason: 'clear', sessionId: ended, resume: { id: ended } })
    return {}
  })
  on('ui.toast', (_$, e) => {
    world.effects.push(`toast:${e.text}`)
    return ok(undefined)
  })
  on('ui.log', (_$, e) => {
    world.effects.push(e.to === 'debug' ? `debug:${e.text}` : `log:${e.text}`)
    if (e.to === 'debug') world.debugLines.push(e.text)
    return ok(undefined)
  })
  on('process.run', (_$, e) => {
    const [program, ...args] = e.argv
    const finished = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    if (program === 'git') return ok({ ...finished, exitCode: world.branch === null ? 128 : 0, stdout: `${world.branch ?? ''}\n` })
    if (world.logWrite === 'throw') throw new Error('spawn failed')
    world.logTargets.push(args.slice(3))
    if (world.logWrite === 'exit') return ok({ ...finished, exitCode: 1, stderr: 'disk full' })
    world.records.push(JSON.parse(e.init?.stdin ?? '{}') as LogRecord)
    return ok(finished)
  })
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
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', (_$, e) => {
    if (world.toolIsError) return { isError: true as const, result: 'failed', text: 'failed' }
    return { result: world.toolResult, text: `ran ${e.tool}` } as never
  })
  return world
}

export const startSession = ($: Engine, isInteractive = true) =>
  $.session.start({ cwd: '/work', surface: isInteractive ? 'terminal' : null, isInteractive })

type Step = { usage: TurnUsage | null; advisorCalls?: number; agentId?: string }

export const runStep = async ($: Engine, world: World, { usage, advisorCalls = 0, agentId }: Step) => {
  world.step = { usage, advisorCalls }
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1, ...(agentId ? { agentId } : {}) })
  let item = await stream.next()
  while (!item.done) item = await stream.next()
  return item.value
}

type Completion = { usage?: TurnUsage; reason?: 'answer' | 'aborted' | 'error'; agentId?: string }

export const completeTurn = ($: Engine, { usage, reason = 'answer', agentId }: Completion = {}) =>
  $.turn.complete({
    answer: 'done',
    durationMs: 1,
    isAborted: reason === 'aborted',
    turnId: 't1',
    reason,
    ...(usage ? { usage } : {}),
    ...(agentId ? { agentId } : {}),
  })

export const lastRecord = (world: World): LogRecord => world.records[world.records.length - 1] as LogRecord
