import { expect, test } from 'claude-code/testing'

import { completeTurn, growTo200k, install, lastRecord, runCommand, runStep, startSession, usageOf } from './helpers'

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
