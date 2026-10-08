import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  bash,
  completeTurn,
  growTo200k,
  install,
  lastRecord,
  mountBand,
  runCommand,
  startSession,
  submitPerson,
} from './helpers'

const ASK = { options: { handoffMode: 'ask' } } as const
const ACT = { options: { handoffMode: 'act' } } as const

const ready = async ($: Engine, on: On) => {
  const world = install($, on)
  world.branch = 'alice/eng-1-start'
  await startSession($)
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  return world
}

const entered = (world: Awaited<ReturnType<typeof ready>>) => world.effects.filter(effect => effect.startsWith('entered:'))

test('It reports an unreadable session id as a failed handoff and leaves the session unchanged', async ($, on) => {
  const world = install($, on)
  world.sessionIdDenials = 1
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects).not.toContain('clear')
  expect(world.effects).toContain('toast:No handoff was written. This session is unchanged.')
  expect(lastRecord(world).trigger_values.reason).toBe('handoff_failed')
})

test('It puts a held prompt back when the session id cannot be read', ACT, async ($, on) => {
  const world = await ready($, on)
  world.sessionIdDenials = 1
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  expect(world.effects).toContain('fill:now ENG-2')
})

test('It submits the held prompt when the box cannot be read to put it back', ACT, async ($, on) => {
  const world = await ready($, on)
  world.fork = async () => ({ isAnswered: false, reason: 'nothing-to-fork' }) as never
  world.boxReadDenied = true
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  expect(entered(world)).toContain('entered:plugin:now ENG-2')
  expect(world.debugLines.join('\n')).toContain('could not refill the prompt box')
})

test('It reports a prompt it cannot submit back instead of crashing', ACT, async ($, on) => {
  const world = await ready($, on)
  world.fork = async () => ({ isAnswered: false, reason: 'nothing-to-fork' }) as never
  world.fillRefusal = 'no_composer'
  await submitPerson($, 'now ENG-2')
  world.submitThrows = true
  await world.clock.settle()
  expect(world.debugLines.join('\n')).toContain('could not restore the held prompt')
})

test('It finishes the handoff and frees the claim when the resend throws', ACT, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  world.submitThrows = true
  await world.clock.settle()
  expect(world.debugLines.join('\n')).toContain('handoff failed after the clear')
  world.submitThrows = false
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'fork')).toHaveLength(1)
})

test('It treats an unreadable git branch as no branch', async ($, on) => {
  const world = install($, on)
  world.gitThrows = true
  await startSession($)
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2')
  expect(world.records.filter(record => record.trigger_values.point === 'prompt')).toHaveLength(0)
})

test('It sends the held prompt on when the box cannot be read to refill it', ASK, async ($, on) => {
  const world = await ready($, on)
  world.boxReadDenied = true
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  expect(entered(world)).toContain('entered:plugin:now ENG-2')
  expect(world.debugLines.join('\n')).toContain('could not refill the prompt box')
})

test('It leaves a hold that Enter already released when the box would not take the prompt', ASK, async ($, on) => {
  const world = await ready($, on)
  world.fillRefusal = 'dialog'
  await submitPerson($, 'now ENG-2')
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  expect(entered(world).filter(effect => effect.includes('now ENG-2'))).toEqual(['entered:composer:now ENG-2'])
})

test('It reports a box it cannot read when Send here empties it', ASK, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  const band = await mountBand($)
  world.boxReadDenied = true
  await band.press({ key: 'send-here' })
  await world.clock.settle()
  expect(world.debugLines.join('\n')).toContain('could not empty the prompt box')
  expect(entered(world)).toContain('entered:plugin:now ENG-2')
})

test('It sends the held prompt once when Send here is pressed twice', ASK, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  const band = await mountBand($)
  await Promise.all([band.press({ key: 'send-here' }), band.press({ key: 'send-here' })])
  await world.clock.settle()
  expect(entered(world).filter(effect => effect.startsWith('entered:plugin:'))).toEqual(['entered:plugin:now ENG-2'])
  expect(world.records.filter(record => record.trigger_values.reason === 'send_here')).toHaveLength(1)
})

test('It sends the held prompt here when /handoff claims the handoff first', ASK, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  const band = await mountBand($)
  await Promise.all([band.press({ key: 'handoff-send' }), runCommand($, 'handoff')])
  await world.clock.settle()
  expect(entered(world)).toContain('entered:plugin:now ENG-2')
  expect(world.effects.filter(effect => effect === 'fork')).toHaveLength(1)
})

test('It reports a send that throws instead of crashing', ASK, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  const band = await mountBand($)
  await band.press({ key: 'send-here' })
  world.submitThrows = true
  await world.clock.settle()
  expect(world.debugLines.join('\n')).toContain('background work failed')
})
