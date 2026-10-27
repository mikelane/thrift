import { mock, type Engine, type MockClock } from 'claude-code/testing'
import type { On, SessionVersion, ToolCallResult } from 'claude-code'

export type LogRecord = {
  ts: string
  session_id: string
  component: string
  mode: string
  action: string
  engine_version: string
  trigger_values: Record<string, unknown>
}

type FileState = { text: string; mtimeMs: number }

// How the bottom Read answers: the file as text, or one of the results the plugin must not track.
export type ReadBehavior = 'text' | 'error' | 'image' | 'pdf' | 'notebook' | 'core_unchanged' | 'truncated'

export type World = {
  clock: MockClock
  files: Map<string, FileState>
  // alias path -> real path
  links: Map<string, string>
  records: LogRecord[]
  logArgv: string[][]
  debugLines: string[]
  transcriptLines: string[]
  sessionId: string
  version: SessionVersion
  versionThrows: boolean
  versionReads: number
  turns: number
  // tool_use_ids each loop's context holds, by agent id ('main' for the main loop)
  contexts: Map<string, string[]>
  deniedAgents: Set<string>
  readBehavior: ReadBehavior
  // Reads that reached the bottom, i.e. the ones the plugin let through.
  readsThatRan: string[]
  otherToolsThatRan: string[]
  // Runs inside the next Read that reaches the bottom, so a test can change the file while the tool runs.
  duringRead: (() => void) | undefined
  statThrowsFor: Set<string>
  // Paths whose stat answers a directory, and paths whose stat answers no real path.
  directories: Set<string>
  unresolvable: Set<string>
  readThrowsFor: Set<string>
  logWrite: 'ok' | 'exit' | 'throw'
  compactSkips: boolean
  turnsThrows: boolean
  messagesThrows: boolean
}

export const MAIN = 'main'

const modelText = (path: string, lines: string[], startLine: number): string => `${path}\n${lines.map((line, index) => `${startLine + index}\t${line}`).join('\n')}`

const sliceOf = (text: string, offset: number | undefined, limit: number | undefined) => {
  const all = text.split('\n')
  const start = Math.max(offset ?? 1, 1)
  const picked = all.slice(start - 1, limit === undefined ? undefined : start - 1 + limit)
  return { all, picked, start }
}

const LOG_STRINGS = ['ts', 'session_id', 'component', 'mode', 'action', 'engine_version'] as const

const parseLogRecord = (line: string): LogRecord => {
  const parsed: unknown = JSON.parse(line)
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`not a decision record: ${line}`)
  if (!LOG_STRINGS.every(key => typeof Reflect.get(parsed, key) === 'string')) throw new Error(`not a decision record: ${line}`)
  return parsed as LogRecord
}

const ok = <T,>(value: T) => ({ value })

type ReadCall = { tool_use_id: string; agentId?: string; file_path: string; offset?: number; limit?: number }

const readResult = (world: World, e: ReadCall) => {
  const real = world.links.get(e.file_path) ?? e.file_path
  const text = world.files.get(real)?.text ?? ''
  const { all, picked, start } = sliceOf(text, e.offset, e.limit)
  const behavior = world.readBehavior
  if (behavior === 'error') return { isError: true as const, result: 'File does not exist.', text: 'File does not exist.' }
  if (behavior === 'image') return { result: { type: 'image', file: { base64: 'AA==', type: 'image/png', originalSize: 1 } }, text: '[image]' }
  if (behavior === 'pdf') return { result: { type: 'pdf', file: { filePath: e.file_path, base64: 'AA==', originalSize: 1 } }, text: '[pdf]' }
  if (behavior === 'notebook') return { result: { type: 'notebook', file: { filePath: e.file_path, cells: [] } }, text: '[notebook]' }
  if (behavior === 'core_unchanged') return { result: { type: 'file_unchanged', file: { filePath: e.file_path } }, text: 'unchanged' }
  const isTruncated = behavior === 'truncated'
  const shown = isTruncated ? picked.slice(0, Math.max(1, Math.floor(picked.length / 2))) : picked
  return {
    result: {
      type: 'text',
      file: {
        filePath: e.file_path,
        content: shown.join('\n'),
        numLines: shown.length,
        startLine: start,
        totalLines: all.length,
        ...(isTruncated ? { truncatedByTokenCap: true } : {}),
      },
    },
    text: modelText(e.file_path, shown, start),
  }
}

const installToolMocks = (on: On, world: World) => {
  on('tool.call', (_$, e) => {
    if (e.tool !== 'Read') {
      world.otherToolsThatRan.push(e.tool)
      return { result: {}, text: `ran ${e.tool}` }
    }
    world.readsThatRan.push(e.tool_use_id)
    const loop = e.agentId ?? MAIN
    world.contexts.set(loop, [...(world.contexts.get(loop) ?? []), e.tool_use_id])
    world.duringRead?.()
    world.duringRead = undefined
    return readResult(world, e)
  })
}

const installFsMocks = (on: On, world: World) => {
  on('fs.stat', (_$, e) => {
    if (world.statThrowsFor.has(e.path)) throw new Error('ENOENT')
    const real = world.links.get(e.path) ?? e.path
    const file = world.files.get(real)
    if (file === undefined) throw new Error('ENOENT')
    const kind = world.directories.has(e.path) ? ('dir' as const) : ('file' as const)
    const resolved = world.unresolvable.has(e.path) ? {} : { realPath: real }
    return ok({ kind, size: file.text.length, mtimeMs: file.mtimeMs, isLink: real !== e.path, ...resolved })
  })
  on('fs.read', (_$, e) => {
    const file = world.files.get(world.links.get(e.path) ?? e.path)
    if (file === undefined || world.readThrowsFor.has(e.path)) throw new Error('cannot read')
    return ok(file.text)
  })
}

const installSessionMocks = (on: On, world: World) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ok(world.sessionId))
  on('session.turns', () => {
    if (world.turnsThrows) throw new Error('no turns')
    return ok(world.turns)
  })
  on('session.version', () => {
    world.versionReads += 1
    if (world.versionThrows) throw new Error('no version')
    return ok(world.version)
  })
  on('session.messages', (_$, e) => {
    if (world.messagesThrows) throw new Error('no messages')
    const loop = e.agentId ?? MAIN
    if (world.deniedAgents.has(loop)) return ok({ deny: `no conversation for ${loop}` })
    const ids = world.contexts.get(loop) ?? []
    return ok([{ role: 'user' as const, text: '', toolUses: [], toolResults: ids.map(id => ({ tool_use_id: id, text: '', isError: false })) }])
  })
  on('session.compact', () => (world.compactSkips ? { skip: 'vetoed' } : { messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }] }))
}

const installOutputMocks = (on: On, world: World) => {
  on('ui.log', (_$, e) => {
    if (e.to === 'debug') world.debugLines.push(e.text)
    else world.transcriptLines.push(e.text)
    return ok(undefined)
  })
  on('process.run', (_$, e) => {
    const finished = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    if (world.logWrite === 'throw') throw new Error('spawn failed')
    world.logArgv.push([...e.argv])
    if (world.logWrite === 'exit') return ok({ ...finished, exitCode: 1, stderr: 'disk full' })
    world.records.push(parseLogRecord(e.init?.stdin ?? '{}'))
    return ok(finished)
  })
}

type Environment = { home?: string | null; thriftHome?: string }

export const install = ($: Engine, on: On, { home = '/home/u', thriftHome }: Environment = {}): World => {
  void $
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 8, 20, 0, 0) })
  mock.env(on, {
    ...(home === null ? {} : { HOME: home }),
    ...(thriftHome === undefined ? {} : { THRIFT_HOME: thriftHome }),
  })
  const world: World = {
    clock,
    files: new Map(),
    links: new Map(),
    records: [],
    logArgv: [],
    debugLines: [],
    transcriptLines: [],
    sessionId: 'session-1',
    version: { version: '2.1.311', base: '2.1.311' },
    versionThrows: false,
    versionReads: 0,
    turns: 1,
    contexts: new Map(),
    deniedAgents: new Set(),
    readBehavior: 'text',
    readsThatRan: [],
    otherToolsThatRan: [],
    duringRead: undefined,
    statThrowsFor: new Set(),
    directories: new Set(),
    unresolvable: new Set(),
    readThrowsFor: new Set(),
    logWrite: 'ok',
    compactSkips: false,
    turnsThrows: false,
    messagesThrows: false,
  }
  installToolMocks(on, world)
  installFsMocks(on, world)
  installSessionMocks(on, world)
  installOutputMocks(on, world)
  return world
}

let clockTick = 1

export const putFile = (world: World, path: string, text: string): void => {
  clockTick += 1
  world.files.set(path, { text, mtimeMs: clockTick })
}

// Changes a file's content and leaves its size and mtime as they were.
export const rewriteKeepingStat = (world: World, path: string, text: string): void => {
  const file = world.files.get(path)
  if (file === undefined) throw new Error(`no file ${path}`)
  world.files.set(path, { text, mtimeMs: file.mtimeMs })
}

// `$.tool.call`'s parameter type is a union over every built-in and MCP tool, and resolving it overflows the compiler once many
// MCP servers' types are generated (TS2589). Casting the function, not the input, keeps that union from ever being instantiated.
type LooseToolCall = { tool: string; [argument: string]: unknown }

const callTool = ($: Engine, input: LooseToolCall) => ($.tool.call as unknown as (input: LooseToolCall) => Promise<ToolCallResult>)(input)

type ReadOptions = { offset?: number; limit?: number; pages?: string; allow_large?: boolean; agentId?: string }

export const read = ($: Engine, path: string, options: ReadOptions = {}) => callTool($, { tool: 'Read', file_path: path, ...options })

export const runTool = ($: Engine, tool: string, input: Record<string, unknown> = {}, agentId?: string) =>
  callTool($, { tool, ...input, ...(agentId === undefined ? {} : { agentId }) })

export const startSession = ($: Engine) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

export const endSessionWith = ($: Engine, reason: 'clear' | 'resume' | 'other', sessionId = 'session-1') =>
  $.session.end({ reason, sessionId, resume: { id: sessionId } })

type Trigger = 'manual' | 'auto' | 'plugin' | 'precompute'

export const compact = ($: Engine, trigger: Trigger, agentId?: string) =>
  $.session.compact({ trigger, messages: [{ role: 'user', text: 'work', toolUses: [] }], ...(agentId === undefined ? {} : { agentId }) })

export const lastRecord = (world: World): LogRecord => {
  const record = world.records.at(-1)
  if (record === undefined) throw new Error('no decision record was written')
  return record
}

export const triggerValues = (world: World) => lastRecord(world).trigger_values

export const isStub = (answer: ToolCallResult): boolean =>
  typeof answer.result === 'object' && answer.result !== null && Reflect.get(answer.result, 'type') === 'file_unchanged'

export const SEVEN_LINES = 'one\ntwo\nthree\nfour\nfive\nsix\nseven'
