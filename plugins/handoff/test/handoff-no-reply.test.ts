import { expect, test } from 'claude-code/testing'

import { NO_HANDOFF_MESSAGE, NO_REPLY_MESSAGE } from '../hooks/handoff-note'
import { install, lastRecord, runCommand, startSession, ZERO_USAGE } from './helpers'

test('It says the session has no reply yet when /handoff finds nothing to fork', async ($, on) => {
  const world = install($, on)
  world.fork = async () => ({ isAnswered: false, reason: 'nothing-to-fork' })
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects).toContain(`toast:${NO_REPLY_MESSAGE}`)
  expect(world.effects).toContain(`log:${NO_REPLY_MESSAGE}`)
  expect(world.effects).not.toContain('clear')
})

test('It records nothing-to-fork as the fork reason on the no_handoff_written record', async ($, on) => {
  const world = install($, on)
  world.fork = async () => ({ isAnswered: false, reason: 'nothing-to-fork' })
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({
    action: 'none',
    trigger_values: { reason: 'no_handoff_written', fork_reason: 'nothing-to-fork' },
  })
})

test('It keeps the generic message when the fork returns an empty reply', async ($, on) => {
  const world = install($, on)
  world.fork = async () => ({ isAnswered: false, reason: 'empty-reply', usage: ZERO_USAGE })
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects).toContain(`toast:${NO_HANDOFF_MESSAGE}`)
  expect(world.effects).not.toContain(`toast:${NO_REPLY_MESSAGE}`)
})

test('It records no fork reason when the fork returns an empty reply', async ($, on) => {
  const world = install($, on)
  world.fork = async () => ({ isAnswered: false, reason: 'empty-reply', usage: ZERO_USAGE })
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(lastRecord(world).trigger_values).not.toHaveProperty('fork_reason')
})

test('It keeps the generic message when the fork throws', async ($, on) => {
  const world = install($, on)
  world.fork = async () => {
    throw new Error('fork failed')
  }
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects).toContain(`toast:${NO_HANDOFF_MESSAGE}`)
  expect(lastRecord(world).trigger_values).not.toHaveProperty('fork_reason')
})
