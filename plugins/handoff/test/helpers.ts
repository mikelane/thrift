import { mock, type Engine, type MockClock } from 'claude-code/testing'
import type {
  AgentInfo,
  ModelForkResult,
  On,
  SessionCompactResult,
  SessionVersion,
  ToolCallResult,
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
  gitCalls: number
  agents: AgentInfo[]
  agentListThrows: boolean
  box: Box
  fillRefusal: 'no_composer' | 'dialog' | undefined
  fork: () => Promise<ModelForkResult>
  compact: () => Promise<SessionCompactResult>
  clearThrows: boolean
  appendDenied: boolean
  forkPrompts: string[]
  registerThrows: boolean
  logWrite: 'ok' | 'exit' | 'throw'
  stateSetThrows: boolean
  usageDenied: boolean
  boxReadDenied: boolean
  sessionIdDenials: number
  submitThrows: boolean
  submitDropped: boolean
  // One-shot callbacks, one per upcoming prompt.submit in order; an undefined entry lets that submit pass untouched.
  submitHooks: Array<(() => void) | undefined>
  gitThrows: boolean
  gitFailure: boolean
  step:{ usage: TurnUsage | null; advisorCalls: number }
  toolResult: unknown
  toolMode: 'ok' | 'error' | 'deny'
  appended: string[]
}

export const ZERO_USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 }

export const answered = (text: string): ModelForkResult => ({ isAnswered: true, text, usage: ZERO_USAGE })

export const compacted = (tokensAfter?: number): SessionCompactResult => ({
  messages: [{ role: 'user', text: 'summary', toolUses: [] }],
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

type Environment = { home?: string | null; thriftHome?: string; hasClock?: boolean }

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
    gitCalls: 0,
    agents: [],
    agentListThrows: false,
    box: { text: '', cursor: 0 },
    fillRefusal: undefined,
    fork: async () => answered('The handoff note.'),
    compact: async () => compacted(48_000),
    clearThrows: false,
    appendDenied: false,
    forkPrompts: [],
    registerThrows: false,
    logWrite: 'ok',
    stateSetThrows: false,
    usageDenied: false,
    boxReadDenied: false,
    sessionIdDenials: 0,
    submitThrows: false,
    submitDropped: false,
    submitHooks: [],
    gitThrows: false,
    gitFailure: false,
    step: { usage: null, advisorCalls: 0 },
    toolResult: {},
    toolMode: 'ok',
    appended: [],
  }

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
  on('model.fork', async (_$, e) => {
    world.effects.push('fork')
    world.forkPrompts.push(e.prompt)
    return ok(await world.fork())
  })
  on('agent.list', () => {
    if (world.agentListThrows) throw new Error('agent list failed')
    return ok(world.agents)
  })
  on('prompt.read', () => (world.boxReadDenied ? { deny: 'no box' } : ok(world.box)))
  on('prompt.fill', (_$, e) => {
    if (world.fillRefusal !== undefined) return { isFilled: false, refusal: world.fillRefusal }
    world.effects.push(`fill:${e.text}`)
    world.box = { text: e.text, cursor: e.text.length }
    return { isFilled: true }
  })
  on('prompt.submit', (_$, e) => {
    world.submitHooks.shift()?.()
    if (world.submitThrows) throw new Error('submit refused')
    if (world.submitDropped) return { drop: 'refused by another hook' }
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
    if (program === 'git') world.gitCalls += 1
    if (program === 'git' && world.gitThrows) throw new Error('git failed')
    if (program === 'git') return ok({ ...finished, exitCode: world.branch === null || world.gitFailure ? 128 : 0, stdout: `${world.branch ?? ''}\n` })
    if (world.logWrite === 'throw') throw new Error('spawn failed')
    world.logTargets.push(args.slice(3))
    if (world.logWrite === 'exit') return ok({ ...finished, exitCode: 1, stderr: 'disk full' })
    world.records.push(parseLogRecord(e.init?.stdin ?? '{}'))
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
  on('state.set', (_$, e, next) => {
    if (world.stateSetThrows) return { deny: 'cannot write' }
    return next(e)
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine band'] }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', (_$, e) => {
    if (world.toolMode === 'deny') return { deny: 'blocked' }
    if (world.toolMode === 'error') return { isError: true as const, result: 'failed', text: 'failed' }
    return { result: world.toolResult, text: `ran ${e.tool}` }
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

export const startTurn = ($: Engine) => $.turn.start({ text: 'work', turnId: 't1' })

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

export const lastRecord = (world: World): LogRecord => {
  const record = world.records.at(-1)
  if (record === undefined) throw new Error('no decision record was written')
  return record
}

export const growTo200k = ($: Engine, world: World) => runStep($, world, { usage: usageOf(1_000, 0, 199_000) })

export const notify = ($: Engine, taskId: string) =>
  $.prompt.submit({
    text: `<task-notification><task-id>${taskId}</task-id><status>completed</status></task-notification>`,
    wait: false,
    origin: { kind: 'task-notification' },
  })

type LooseToolCall = { tool: string; [argument: string]: unknown }

// `$.tool.call`'s parameter type is a union over every built-in and MCP tool, and resolving it
// overflows the compiler once many MCP servers' types are generated (TS2589). Casting the
// function, not the input, keeps that union from ever being instantiated.
const callTool = ($: Engine, input: LooseToolCall) =>
  ($.tool.call as unknown as (input: LooseToolCall) => Promise<ToolCallResult>)(input)

type ToolRun = { result?: unknown; mode?: World['toolMode']; agentId?: string }

export const bash = (
  $: Engine,
  world: World,
  command: string,
  { result = {}, mode = 'ok', agentId }: ToolRun = {},
) => {
  world.toolResult = result
  world.toolMode = mode
  return callTool($, { tool: 'Bash', command, ...(agentId ? { agentId } : {}) })
}

export const tool = (
  $: Engine,
  world: World,
  name: string,
  input: Record<string, unknown>,
  { result = {}, mode = 'ok' }: ToolRun = {},
) => {
  world.toolResult = result
  world.toolMode = mode
  return callTool($, { tool: name, ...input })
}

export const runCommand = ($: Engine, command: string) =>
  $.command.run({
    command,
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

type BandProps = { hasSurvey?: boolean }

export const mountBand = ($: Engine, { hasSurvey = false }: BandProps = {}) =>
  $.ui.mount({
    plugin: 'handoff',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })

type PersonPrompt = {
  kind?: 'composer' | 'bridge' | 'sdk' | 'scheduled-trigger' | 'peer'
  turnId?: string
  context?: readonly string[]
  attachments?: readonly { type: 'image'; mediaType: string }[]
}

export const submitPerson = ($: Engine, text: string, { kind = 'composer', turnId, context, attachments }: PersonPrompt = {}) =>
  $.prompt.submit({
    text,
    wait: false,
    origin: { kind },
    ...(turnId ? { turnId } : {}),
    ...(context ? { context } : {}),
    ...(attachments ? { attachments } : {}),
  })

export const dropOf = (result: unknown): string | undefined =>
  typeof result === 'object' && result !== null && 'drop' in result && typeof result.drop === 'string' ? result.drop : undefined
