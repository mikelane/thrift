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

import {
  installCommandMocks,
  installModelMocks,
  installProcessMocks,
  installPromptMocks,
  installSessionMocks,
  installStateMocks,
  installToolMocks,
  installTurnMocks,
  installUiMocks,
} from './mocks'

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

type Environment = { home?: string | null; thriftHome?: string; hasClock?: boolean }

const defaultWorld = (clock: MockClock): World => ({
  clock,
  effects: [],
  records: [],
  logTargets: [],
  logArgv: [],
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
  onAgentList: undefined,
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
  offerWrites: [],
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
})

export const install = ($: Engine, on: On, { home = '/home/u', thriftHome }: Environment = {}): World => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 8, 20, 0, 0) })
  mock.env(on, {
    ...(home === null ? {} : { HOME: home }),
    ...(thriftHome === undefined ? {} : { THRIFT_HOME: thriftHome }),
  })
  const world = defaultWorld(clock)
  installSessionMocks(on, world)
  installModelMocks(on, world)
  installPromptMocks(on, world)
  installCommandMocks($, on, world)
  installUiMocks(on, world)
  installProcessMocks(on, world)
  installTurnMocks(on, world)
  installStateMocks(on, world)
  installToolMocks(on, world)
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

export const startTurn = ($: Engine, text = 'work') => $.turn.start({ text, turnId: 't1' })

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

export const holdFork = (world: World) => {
  const pendingFork: { release: (result: ModelForkResult) => void } = { release: () => undefined }
  world.fork = () =>
    new Promise<ModelForkResult>(resolve => {
      pendingFork.release = resolve
    })
  return pendingFork
}

// A /handoff whose note is still being written; the returned callbacks finish or fail the write.
export const writingTheNote = async ($: Engine, on: On) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  const finishWith = async (result: ModelForkResult) => {
    fork.release(result)
    await world.clock.settle()
  }
  return { world, finishNote: () => finishWith(answered('The handoff note.')), failNote: () => finishWith({ isAnswered: false, reason: 'nothing-to-fork' }) }
}
