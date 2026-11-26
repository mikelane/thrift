import { mock, type Engine } from 'claude-code/testing'
import type { On, SessionVersion } from 'claude-code'

export type LogRecord = {
  ts: string
  session_id: string
  component: string
  mode: string
  action: string
  engine_version: string
  trigger_values: Record<string, unknown>
}

export type FileState = { text: string; bytes: Uint8Array; mtimeMs: number }

const base64Of = (bytes: Uint8Array): string => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))

// How the bottom Read answers: the file as text, or one of the results the plugin must not track.
type ReadBehavior = 'text' | 'error' | 'image' | 'pdf' | 'notebook' | 'core_unchanged' | 'truncated'

export type World = {
  files: Map<string, FileState>
  // alias path -> real path
  links: Map<string, string>
  records: LogRecord[]
  logArgv: string[][]
  debugLines: string[]
  transcriptLines: string[]
  sessionId: string
  version: SessionVersion
  isVersionFailing: boolean
  versionReads: number
  turns: number
  // tool_use_ids each loop's context holds, by agent id ('main' for the main loop)
  contexts: Map<string, string[]>
  // The text each answered call left in the conversation, by tool_use_id: what the model read.
  resultTexts: Map<string, string>
  // Results the conversation holds as an error, as when a plugin above withheld or refused the answer.
  errorResults: Set<string>
  deniedAgents: Set<string>
  readBehavior: ReadBehavior
  // Reads that reached the bottom, i.e. the ones the plugin let through.
  readsThatRan: string[]
  otherToolsThatRan: string[]
  // Runs inside the next Read that reaches the bottom, so a test can change the file while the tool runs.
  duringRead: (() => void) | undefined
  // Runs at the next fs.read, before it answers, so a test can change the file between the plugin's stat and its read.
  beforeFsRead: (() => void) | undefined
  statThrowsFor: Set<string>
  // Paths whose stat answers a directory, and paths whose stat answers no real path.
  directories: Set<string>
  unresolvable: Set<string>
  readThrowsFor: Set<string>
  logWrite: 'ok' | 'exit' | 'throw'
  isCompactVetoed: boolean
  isTurnsFailing: boolean
  isMessagesFailing: boolean
}

export const MAIN = 'main'

const modelText = (path: string, lines: string[], startLine: number): string => `${path}\n${lines.map((line, index) => `${startLine + index}\t${line}`).join('\n')}`

const sliceOf = (text: string, offset: number | undefined, limit: number | undefined) => {
  const all = text.split('\n')
  const start = Math.max(offset ?? 1, 1)
  // Read reads to the end for a limit of zero or less, as with none (2.1.311).
  const picked = all.slice(start - 1, limit === undefined || limit <= 0 ? undefined : start - 1 + limit)
  return { all, picked, start }
}

const LOG_STRINGS = ['ts', 'session_id', 'component', 'mode', 'action', 'engine_version'] as const

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isLogRecord = (value: unknown): value is LogRecord =>
  isPlainObject(value) && LOG_STRINGS.every(key => typeof value[key] === 'string') && isPlainObject(value.trigger_values)

const parseLogRecord = (line: string): LogRecord => {
  const parsed: unknown = JSON.parse(line)
  if (!isLogRecord(parsed)) throw new Error(`not a decision record: ${line}`)
  return parsed
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
    const answer = readResult(world, e)
    world.resultTexts.set(e.tool_use_id, answer.text)
    return answer
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
    world.beforeFsRead?.()
    world.beforeFsRead = undefined
    const file = world.files.get(world.links.get(e.path) ?? e.path)
    if (file === undefined || world.readThrowsFor.has(e.path)) throw new Error('cannot read')
    // The engine answers bytes as base64, and text as the file decoded as UTF-8.
    if (e.as === 'bytes') return ok({ base64: base64Of(file.bytes) })
    return ok(file.text)
  })
}

const installSessionMocks = (on: On, world: World) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ok(world.sessionId))
  on('session.turns', () => {
    if (world.isTurnsFailing) throw new Error('no turns')
    return ok(world.turns)
  })
  on('session.version', () => {
    world.versionReads += 1
    if (world.isVersionFailing) throw new Error('no version')
    return ok(world.version)
  })
  on('session.messages', (_$, e) => {
    if (world.isMessagesFailing) throw new Error('no messages')
    const loop = e.agentId ?? MAIN
    if (world.deniedAgents.has(loop)) return ok({ deny: `no conversation for ${loop}` })
    const ids = world.contexts.get(loop) ?? []
    return ok([{ role: 'user' as const, text: '', toolUses: [], toolResults: ids.map(id => ({ tool_use_id: id, text: world.resultTexts.get(id) ?? '', isError: world.errorResults.has(id) })) }])
  })
  on('session.compact', () => (world.isCompactVetoed ? { skip: 'vetoed' } : { messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }] }))
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
  mock.clock(on, { now: Date.UTC(2026, 9, 8, 20, 0, 0) })
  mock.env(on, {
    ...(home === null ? {} : { HOME: home }),
    ...(thriftHome === undefined ? {} : { THRIFT_HOME: thriftHome }),
  })
  const world: World = {
    files: new Map(),
    links: new Map(),
    records: [],
    logArgv: [],
    debugLines: [],
    transcriptLines: [],
    sessionId: 'session-1',
    version: { version: '2.1.311', base: '2.1.311' },
    isVersionFailing: false,
    versionReads: 0,
    turns: 1,
    contexts: new Map(),
    resultTexts: new Map(),
    errorResults: new Set(),
    deniedAgents: new Set(),
    readBehavior: 'text',
    readsThatRan: [],
    otherToolsThatRan: [],
    duringRead: undefined,
    beforeFsRead: undefined,
    statThrowsFor: new Set(),
    directories: new Set(),
    unresolvable: new Set(),
    readThrowsFor: new Set(),
    logWrite: 'ok',
    isCompactVetoed: false,
    isTurnsFailing: false,
    isMessagesFailing: false,
  }
  installToolMocks(on, world)
  installFsMocks(on, world)
  installSessionMocks(on, world)
  installOutputMocks(on, world)
  return world
}
