import { expect, test } from 'claude-code/testing'

import { completeTurn, growTo200k, install, lastRecord, runCommand, runStep, startSession, usageOf } from './helpers'

const DEV_BUILD = { version: '2.1.295-dev.20260920.t1.sha1', base: '2.1.295-dev' }

const ASK = { options: { handoffMode: 'ask' } } as const
const ACT = { options: { handoffMode: 'act' } } as const

test('It records a turn before session.start as shadow though the setting is act', ACT, async ($, on) => {
  const world = install($, on)
  await growTo200k($, world)
  await completeTurn($)
  expect(lastRecord(world)).toMatchObject({ mode: 'shadow', action: 'none', trigger_values: { setting: 'act', signal: 'weak' } })
})

test('It logs a shadow record with no signal for a turn under the threshold in off mode', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runStep($, world, { usage: usageOf(1_000, 0, 49_000) })
  await completeTurn($)
  expect(world.records).toHaveLength(1)
  expect(lastRecord(world)).toMatchObject({ mode: 'shadow', action: 'none', trigger_values: { signal: 'none' } })
})

test('It returns the turn result unchanged from turn.complete', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runStep($, world, { usage: usageOf(1_000, 0, 49_000) })
  expect(await completeTurn($)).toEqual({ text: 'done' })
})

test('It names the component, session, engine version, and time in every record', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await completeTurn($)
  expect(lastRecord(world)).toMatchObject({
    ts: '2026-10-08T20:00:00.000Z',
    session_id: 'old-session',
    component: 'handoff',
    engine_version: '2.1.295',
  })
})

test('It logs the point, setting, effective mode, threshold, context size, and cache read tokens as scalars', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runStep($, world, { usage: usageOf(1_000, 0, 49_000) })
  await completeTurn($, { usage: usageOf(5, 5, 33_000) })
  expect(lastRecord(world).trigger_values).toEqual({
    point: 'turn-end',
    signal: 'none',
    context_tokens: 50_000,
    threshold: 150_000,
    is_background_busy: false,
    setting: 'off',
    effective_mode: 'off',
    cache_read_tokens: 33_000,
  })
})

test('It writes the log under THRIFT_HOME when it is set', async ($, on) => {
  const world = install($, on, { thriftHome: '/data/thrift' })
  await startSession($)
  await completeTurn($)
  expect(world.logTargets).toEqual([['/data/thrift', '/data/thrift/decisions.jsonl']])
})

const WRITER = ['sh', '-c', 'umask 077 && mkdir -p -- "$1" && cat >> "$2" && chmod 600 "$2"', 'sh']
const DEFAULT_ARGV = [[...WRITER, '/home/u/.claude/thrift', '/home/u/.claude/thrift/decisions.jsonl']]
const DEFAULT_USED = 'handoff: THRIFT_HOME is not an absolute path, so the default log location is used'
const HOME_NEEDED = 'handoff: THRIFT_HOME is not an absolute path, so HOME is needed for a log location, and it is not set'
const NO_LOCATION = 'handoff: no log location: neither THRIFT_HOME nor HOME is set'

// The debug lines are the ones about the log location; each names THRIFT_HOME.
const thriftHomeCases = [
  { name: 'absolute', thriftHome: '/data/thrift', home: '/home/u', argv: [[...WRITER, '/data/thrift', '/data/thrift/decisions.jsonl']], debug: [] },
  { name: 'relative', thriftHome: 'relative/dir', home: '/home/u', argv: DEFAULT_ARGV, debug: [DEFAULT_USED] },
  { name: 'dot-relative', thriftHome: './thrift', home: '/home/u', argv: DEFAULT_ARGV, debug: [DEFAULT_USED] },
  { name: 'under ~', thriftHome: '~/thrift', home: '/home/u', argv: DEFAULT_ARGV, debug: [DEFAULT_USED] },
  { name: 'empty', thriftHome: '', home: '/home/u', argv: DEFAULT_ARGV, debug: [] },
  { name: 'the root', thriftHome: '/', home: '/home/u', argv: [[...WRITER, '/', '/decisions.jsonl']], debug: [] },
  { name: 'relative with HOME unset', thriftHome: 'relative/dir', home: null, argv: [], debug: [HOME_NEEDED] },
  { name: 'under ~ with HOME unset', thriftHome: '~/thrift', home: null, argv: [], debug: [HOME_NEEDED] },
  { name: 'empty with HOME unset', thriftHome: '', home: null, argv: [], debug: [NO_LOCATION] },
  { name: 'absolute with HOME unset', thriftHome: '/data/thrift', home: null, argv: [[...WRITER, '/data/thrift', '/data/thrift/decisions.jsonl']], debug: [] },
] as const

for (const c of thriftHomeCases) {
  test(`It returns the exact writer argv and log-location debug lines when THRIFT_HOME is ${c.name}`, async ($, on) => {
    const world = install($, on, { home: c.home, thriftHome: c.thriftHome })
    await startSession($)
    await completeTurn($)
    expect([world.logArgv, world.debugLines.filter(line => line.includes('THRIFT_HOME'))]).toEqual([c.argv, c.debug])
  })
}

test('It writes the log under the home directory when THRIFT_HOME is unset', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await completeTurn($)
  expect([world.logArgv, world.debugLines.filter(line => line.includes('THRIFT_HOME'))]).toEqual([DEFAULT_ARGV, []])
})

test('It skips the log and finishes the turn when neither THRIFT_HOME nor HOME is set', async ($, on) => {
  const world = install($, on, { home: null })
  await startSession($)
  expect(await completeTurn($)).toEqual({ text: 'done' })
  expect([world.records, world.logArgv, world.debugLines.filter(line => line.includes('THRIFT_HOME'))]).toEqual([[], [], [NO_LOCATION]])
})

test('It sends a failed log write to the debug log and finishes the turn', async ($, on) => {
  const world = install($, on)
  world.logWrite = 'exit'
  await startSession($)
  expect(await completeTurn($)).toEqual({ text: 'done' })
  expect(world.debugLines.join('\n')).toContain('disk full')
})

test('It sends a log write that throws to the debug log and finishes the turn', async ($, on) => {
  const world = install($, on)
  world.logWrite = 'throw'
  await startSession($)
  expect(await completeTurn($)).toEqual({ text: 'done' })
  expect(world.debugLines.join('\n')).toContain('log write failed')
})

test('It measures context from input, cache creation, and cache read tokens of the step', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runStep($, world, { usage: usageOf(10, 20, 170) })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.context_tokens).toBe(200)
})

test('It divides a step with one advisor call by two', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runStep($, world, { usage: usageOf(10, 20, 170), advisorCalls: 1 })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.context_tokens).toBe(100)
})

test('It takes the smaller of the reported size and the step size', async ($, on) => {
  const world = install($, on)
  world.contextTokens = 150
  await startSession($)
  await runStep($, world, { usage: usageOf(10, 20, 170) })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.context_tokens).toBe(150)
})

test('It ignores the step of a subagent', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runStep($, world, { usage: usageOf(10, 20, 170), agentId: 'sub-1' })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.context_tokens).toBe(0)
})

test('It ignores a step that carries no usage', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runStep($, world, { usage: null })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.context_tokens).toBe(0)
})

test('It records a weak signal as a shadow record over the threshold in off mode', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runStep($, world, { usage: usageOf(1_000, 0, 199_000) })
  await completeTurn($)
  expect(lastRecord(world)).toMatchObject({ mode: 'shadow', action: 'none', trigger_values: { signal: 'weak' } })
})

test('It does not evaluate the end of a subagent turn', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await completeTurn($, { agentId: 'sub-1' })
  expect(world.records).toHaveLength(0)
})

test('It does not evaluate a turn that did not end in an answer', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await completeTurn($, { reason: 'aborted' })
  expect(world.records).toHaveLength(0)
})

test('It only logs under -p even when act is set', ACT, async ($, on) => {
  const world = install($, on)
  await startSession($, false)
  await runStep($, world, { usage: usageOf(1_000, 0, 199_000) })
  await completeTurn($)
  expect(lastRecord(world)).toMatchObject({ mode: 'shadow', action: 'none', trigger_values: { setting: 'act', signal: 'weak' } })
  expect(world.effects).not.toContain('compact')
})

test('It records a non-trigger turn as active in an interactive session on a tested build when act is set', ACT, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runStep($, world, { usage: usageOf(1_000, 0, 49_000) })
  await completeTurn($)
  expect(lastRecord(world)).toMatchObject({ mode: 'active', action: 'none', trigger_values: { setting: 'act', signal: 'none' } })
})

const untestedBuilds = [
  ['a development build', DEV_BUILD],
  ['a build with no base', { version: 'custom' }],
] as const

for (const [name, version] of untestedBuilds) {
  test(`It logs untested_engine once and shows no toast or transcript line on ${name}`, ACT, async ($, on) => {
    const world = install($, on)
    world.version = version
    await startSession($)
    expect(world.records.map(record => record.action)).toEqual(['untested_engine'])
    expect(world.effects.filter(effect => effect.startsWith('toast:') || effect.startsWith('log:'))).toEqual([])
  })

  test(`It treats act as off on ${name}`, ACT, async ($, on) => {
    const world = install($, on)
    world.version = version
    await startSession($)
    await runStep($, world, { usage: usageOf(1_000, 0, 199_000) })
    await completeTurn($)
    expect(world.effects).not.toContain('compact')
    expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { setting: 'act', signal: 'weak' } })
  })

  test(`It records a non-trigger turn as shadow on ${name} though the setting is act`, ACT, async ($, on) => {
    const world = install($, on)
    world.version = version
    await startSession($)
    await runStep($, world, { usage: usageOf(1_000, 0, 199_000) })
    await completeTurn($)
    expect(lastRecord(world)).toMatchObject({ mode: 'shadow', action: 'none', trigger_values: { setting: 'act' } })
  })
}

test('It runs a release build newer than any pinned build in the ask mode with no untested_engine record', ASK, async ($, on) => {
  const world = install($, on)
  world.version = { version: '2.1.311', base: '2.1.311' }
  await startSession($)
  expect(world.records).toEqual([])
  expect(world.effects.filter(effect => effect.startsWith('toast:') || effect.startsWith('log:'))).toEqual([])
})

test('It runs a release build newer than any pinned build in the act mode', ACT, async ($, on) => {
  const world = install($, on)
  world.version = { version: '3.0.0', base: '3.0.0' }
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { setting: 'act', effective_mode: 'act' } })
})

test('It shows no toast or transcript line on a development build in a session with no prompt', ACT, async ($, on) => {
  const world = install($, on)
  world.version = DEV_BUILD
  await startSession($, false)
  expect(world.effects.filter(effect => effect.startsWith('toast:') || effect.startsWith('log:'))).toEqual([])
})

test('It writes no untested_engine record on a release build in a session with no prompt', ACT, async ($, on) => {
  const world = install($, on)
  world.version = { version: '2.1.311', base: '2.1.311' }
  await startSession($, false)
  expect(world.records).toEqual([])
})

test('It registers no /handoff command in a session with no prompt', ACT, async ($, on) => {
  const world = install($, on)
  world.version = DEV_BUILD
  await startSession($, false)
  expect(world.effects).not.toContain('register:handoff')
})

test('It records the version string when the base is missing', ACT, async ($, on) => {
  const world = install($, on)
  world.version = { version: 'custom-build' }
  await startSession($)
  expect(lastRecord(world).engine_version).toBe('custom-build')
})

test('It logs untested_engine without a toast when the mode is off', async ($, on) => {
  const world = install($, on)
  world.version = DEV_BUILD
  await startSession($)
  expect(world.records.map(record => record.action)).toEqual(['untested_engine'])
  expect(world.effects.filter(effect => effect.startsWith('toast:'))).toEqual([])
})

test('It records untested_engine at the session-start point', async ($, on) => {
  const world = install($, on)
  world.version = DEV_BUILD
  await startSession($)
  expect(lastRecord(world)).toMatchObject({ action: 'untested_engine', trigger_values: { point: 'session-start' } })
})

test('It logs nothing at session start on a tested build', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  expect(world.records).toEqual([])
})

test('It still starts the session when the version cannot be read', ACT, async ($, on) => {
  const world = install($, on)
  world.versionThrows = true
  expect(await startSession($)).toEqual({ cwd: '/work' })
  expect(lastRecord(world)).toMatchObject({ action: 'untested_engine', engine_version: 'unknown', trigger_values: { setting: 'act', effective_mode: 'off' } })
  expect(world.effects.filter(effect => effect.startsWith('toast:') || effect.startsWith('log:'))).toEqual([])
})

test('It records effective_mode off and setting act for /handoff before session.start', ACT, async ($, on) => {
  const world = install($, on)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { point: 'command', setting: 'act', effective_mode: 'off' } })
})

test('It records effective_mode off and setting act for /handoff under -p', ACT, async ($, on) => {
  const world = install($, on)
  await startSession($, false)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { point: 'command', setting: 'act', effective_mode: 'off' } })
})

test('It records effective_mode off and setting act for /handoff on an untested build', ACT, async ($, on) => {
  const world = install($, on)
  world.version = DEV_BUILD
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { point: 'command', setting: 'act', effective_mode: 'off' } })
})

test('It records effective_mode off and setting act on the untested_engine record', ACT, async ($, on) => {
  const world = install($, on)
  world.version = DEV_BUILD
  await startSession($)
  expect(lastRecord(world)).toMatchObject({ action: 'untested_engine', trigger_values: { setting: 'act', effective_mode: 'off' } })
})

test('It records effective_mode act on a /handoff cleared record on a tested interactive build', ACT, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { setting: 'act', effective_mode: 'act' } })
})

test('It records effective_mode ask on an advised record on a tested interactive build', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  expect(lastRecord(world)).toMatchObject({ action: 'advised', trigger_values: { setting: 'ask', effective_mode: 'ask' } })
})

test('It records effective_mode act on a none record on a tested interactive build', ACT, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runStep($, world, { usage: usageOf(1_000, 0, 49_000) })
  await completeTurn($)
  expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { setting: 'act', effective_mode: 'act' } })
})
