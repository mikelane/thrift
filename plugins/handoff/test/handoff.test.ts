import { expect, test } from 'claude-code/testing'

import { completeTurn, growTo200k, install, lastRecord, runCommand, runStep, startSession, usageOf } from './helpers'

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

test('It runs the log writer with the directory and file as separate arguments', async ($, on) => {
  const world = install($, on, { thriftHome: '/data/thrift' })
  await startSession($)
  await completeTurn($)
  expect(world.logArgv).toEqual([
    ['sh', '-c', 'umask 077 && mkdir -p -- "$1" && cat >> "$2" && chmod 600 -- "$2"', 'sh', '/data/thrift', '/data/thrift/decisions.jsonl'],
  ])
})

for (const thriftHome of ['relative/dir', '~/thrift', './thrift']) {
  test(`It writes the log under the home directory when THRIFT_HOME is ${thriftHome}, which is not absolute`, async ($, on) => {
    const world = install($, on, { thriftHome })
    await startSession($)
    await completeTurn($)
    expect(world.logTargets).toEqual([['/home/u/.claude/thrift', '/home/u/.claude/thrift/decisions.jsonl']])
  })

  test(`It writes a debug line without the path when THRIFT_HOME is ${thriftHome}`, async ($, on) => {
    const world = install($, on, { thriftHome })
    await startSession($)
    await completeTurn($)
    expect(world.debugLines).toContain('handoff: THRIFT_HOME is not an absolute path, so the default log location is used')
  })
}

test('It writes no THRIFT_HOME debug line when THRIFT_HOME is absolute', async ($, on) => {
  const world = install($, on, { thriftHome: '/data/thrift' })
  await startSession($)
  await completeTurn($)
  expect(world.debugLines.filter(line => line.includes('THRIFT_HOME'))).toEqual([])
})

test('It writes the log under the home directory when THRIFT_HOME is unset', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await completeTurn($)
  expect(world.logTargets).toEqual([['/home/u/.claude/thrift', '/home/u/.claude/thrift/decisions.jsonl']])
})

test('It skips the log and finishes the turn when neither THRIFT_HOME nor HOME is set', async ($, on) => {
  const world = install($, on, { home: null })
  await startSession($)
  expect(await completeTurn($)).toEqual({ text: 'done' })
  expect(world.records).toHaveLength(0)
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
  ['a newer release', { version: '2.1.296', base: '2.1.296' }],
  ['a development build', { version: '2.1.295-dev.20260920.t1.sha1', base: '2.1.295-dev' }],
  ['a build with no base', { version: 'custom' }],
] as const

for (const [name, version] of untestedBuilds) {
  test(`It logs untested_engine once and shows one toast on ${name}`, ACT, async ($, on) => {
    const world = install($, on)
    world.version = version
    await startSession($)
    expect(world.records.map(record => record.action)).toEqual(['untested_engine'])
    expect(world.effects.filter(effect => effect.startsWith('toast:Untested on Claude Code'))).toHaveLength(1)
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

test('It names the base version in the untested toast', ACT, async ($, on) => {
  const world = install($, on)
  world.version = { version: '2.1.296', base: '2.1.296' }
  await startSession($)
  expect(world.effects).toContain('toast:Untested on Claude Code 2.1.296, so it only logs this session. /handoff still works.')
})

test('It records the version string when the base is missing', ACT, async ($, on) => {
  const world = install($, on)
  world.version = { version: 'custom-build' }
  await startSession($)
  expect(lastRecord(world).engine_version).toBe('custom-build')
})

test('It logs untested_engine without a toast when the mode is off', async ($, on) => {
  const world = install($, on)
  world.version = { version: '2.1.296', base: '2.1.296' }
  await startSession($)
  expect(world.records.map(record => record.action)).toEqual(['untested_engine'])
  expect(world.effects.filter(effect => effect.startsWith('toast:'))).toEqual([])
})

test('It records untested_engine at the session-start point', async ($, on) => {
  const world = install($, on)
  world.version = { version: '2.1.296', base: '2.1.296' }
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
  expect(lastRecord(world)).toMatchObject({ action: 'untested_engine', engine_version: 'unknown' })
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
  world.version = { version: '2.1.296', base: '2.1.296' }
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { point: 'command', setting: 'act', effective_mode: 'off' } })
})

test('It records effective_mode off and setting act on the untested_engine record', ACT, async ($, on) => {
  const world = install($, on)
  world.version = { version: '2.1.296', base: '2.1.296' }
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
