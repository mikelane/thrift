import { expect, test } from 'claude-code/testing'

import {
  bash,
  compacted,
  completeTurn,
  growTo200k,
  install,
  lastRecord,
  runCommand,
  runStep,
  startSession,
  submitPerson,
  usageOf,
} from './helpers'

const registrations = (effects: readonly string[]) => effects.filter(effect => effect === 'register:handoff')

test('It registers /handoff at the start of an interactive session', async ($, on) => {
  const world = install($, on)
  await startSession($)
  expect(registrations(world.effects)).toHaveLength(1)
})

test('It registers no command under -p', async ($, on) => {
  const world = install($, on)
  await startSession($, false)
  expect(registrations(world.effects)).toHaveLength(0)
})

test('It registers /handoff again after the person runs /clear', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runCommand($, 'clear')
  await world.clock.settle()
  expect(registrations(world.effects)).toHaveLength(2)
})

test('It does not register /handoff again for other end reasons', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await $.session.end({ reason: 'other', sessionId: 'old-session', resume: { id: 'old-session' } })
  await world.clock.settle()
  expect(registrations(world.effects)).toHaveLength(1)
})

test('It carries on when registering /handoff after a clear is refused', async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.registerThrows = true
  await runCommand($, 'clear')
  await world.clock.settle()
  expect(world.debugLines.join('\n')).toContain('could not register /handoff')
})

test('It measures a step from its own usage when the session usage cannot be read', async ($, on) => {
  const world = install($, on)
  world.usageDenied = true
  await startSession($)
  await runStep($, world, { usage: usageOf(10, 20, 170) })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.context_tokens).toBe(200)
})

test('It resets the context size after a clear the person ran', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await runCommand($, 'clear')
  await completeTurn($)
  expect(lastRecord(world).trigger_values.context_tokens).toBe(0)
})

test('It forgets a finished task when the session ends before the turn does', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await bash($, world, 'git commit -m x')
  await runCommand($, 'clear')
  await growTo200k($, world)
  await completeTurn($)
  expect(lastRecord(world).trigger_values.signal).toBe('weak')
})

test('It forgets that a scheduled prompt started the turn when the session ends', { options: { handoffMode: 'ask' } }, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await submitPerson($, 'run the nightly job', { kind: 'scheduled-trigger' })
  await runCommand($, 'clear')
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  await world.clock.settle()
  expect(lastRecord(world).action).toBe('advised')
})

test('It forgets the cache read size of the old session when the session ends', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await completeTurn($, { usage: usageOf(5, 5, 33_000) })
  await runCommand($, 'clear')
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(lastRecord(world).trigger_values.cache_read_tokens).toBe(0)
})

test('It forgets the backoff of the old session when the session ends', { options: { handoffMode: 'act' } }, async ($, on) => {
  const world = install($, on)
  world.compact = async () => compacted(190_000)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  await runCommand($, 'clear')
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'compact')).toHaveLength(2)
})

test('It writes no state in off mode when no band was ever shown', async ($, on) => {
  const world = install($, on)
  world.stateSetThrows = true
  await startSession($)
  await completeTurn($)
  expect(world.debugLines.join('\n')).not.toContain('band')
})

const ACT = { options: { handoffMode: 'act' } } as const

test('It evaluates a turn as off when no session.start was seen', ACT, async ($, on) => {
  const world = install($, on)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects).not.toContain('compact')
  expect(world.effects).not.toContain('fork')
  expect(world.effects).not.toContain('clear')
  expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { signal: 'strong', setting: 'act' } })
})

test('It does not hold a prompt when no session.start was seen', ACT, async ($, on) => {
  const world = install($, on)
  world.branch = 'alice/eng-1-start'
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  const result = await submitPerson($, 'now ENG-2')
  expect(result).toMatchObject({ text: 'now ENG-2' })
})

test('It keeps the gate closed after session.start on an untested engine', ACT, async ($, on) => {
  const world = install($, on)
  world.version = { version: '9.9.9', base: '9.9.9' }
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects).not.toContain('clear')
})

test('It keeps the gate closed after session.start when the run is not interactive', ACT, async ($, on) => {
  const world = install($, on)
  await startSession($, false)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects).not.toContain('clear')
})

test('It keeps the gate closed after a clear on an untested engine', ACT, async ($, on) => {
  const world = install($, on)
  world.version = { version: '9.9.9', base: '9.9.9' }
  await startSession($)
  await runCommand($, 'clear')
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'clear')).toHaveLength(1)
  expect(world.effects).not.toContain('fork')
})

test('It opens the gate for a tested interactive session', ACT, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects).toContain('fork')
})
