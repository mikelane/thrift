import { mock, type Engine, type MockClock } from 'claude-code/testing'
import type { ModelForkResult, On, SessionCompactResult, ToolCallResult, TurnUsage } from 'claude-code'

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
  type LogRecord,
  type World,
} from './mocks'

export type { LogRecord, World } from './mocks'

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
  isRunningSubmitHook: false,
  fillRefusal: undefined,
  isFillRefusedOverText: false,
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

// The world of the latest install, so submitPerson can leave a dropped prompt's text in its prompt box.
let installedWorld: World | undefined

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
  installedWorld = world
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

// Typed after what the box holds, unless the box already shows the prompt: pressing Enter on it again adds nothing.
const typedAfter = (held: string, text: string): string => {
  if (held === '') return text
  return `\n${held}\n`.includes(`\n${text}\n`) ? held : `${held}\n${text}`
}

// What the engine submits when a person types `text` at the composer: the whole box, so text a dropped prompt left behind is
// the start of the next prompt (Claude Code 2.1.299: `one`, then `onetwo`, then `onetwothree`).
const submittedFromBox = (held: string, text: string): string => {
  const isEnterOnBox = held === '' || text.startsWith(held) || `\n${held}\n`.includes(`\n${text}\n`)
  return isEnterOnBox ? text : `${held}${text}`
}

// Live behavior (Claude Code 2.1.299): a prompt typed at the composer and then dropped stays in the prompt box, and the person
// does not clear it. A prompt typed after the last one is typed after what stayed (a test lets the clock run between prompts
// when the person takes a moment); one that arrives while the plugin is busy putting text in the box is shown after it.
export const submitPerson = async ($: Engine, text: string, { kind = 'composer', turnId, context, attachments }: PersonPrompt = {}) => {
  const world = installedWorld
  const isArrivalMidSubmit = world?.isRunningSubmitHook === true
  const isTypedAtComposer = world !== undefined && kind === 'composer'
  const submitted = isTypedAtComposer && !isArrivalMidSubmit ? submittedFromBox(world.box.text, text) : text
  const result = await $.prompt.submit({
    text: submitted,
    wait: false,
    origin: { kind },
    ...(turnId ? { turnId } : {}),
    ...(context ? { context } : {}),
    ...(attachments ? { attachments } : {}),
  })
  if (isTypedAtComposer && dropOf(result) !== undefined) {
    const boxed = isArrivalMidSubmit ? typedAfter(world.box.text, text) : submitted
    world.box = { text: boxed, cursor: boxed.length }
  }
  return result
}

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

export const entered = (world: World) => world.effects.filter(effect => effect.startsWith('entered:'))

export const clears = (world: World) => world.effects.filter(effect => effect === 'clear')

export const buttonLabels = async (band: Awaited<ReturnType<typeof mountBand>>) =>
  (await band.findAll({ type: 'Button' })).map(button => button.props.label)
