import { describe, expect, test } from 'claude-code/testing'

import { install, startSession, submitPerson, writingTheNote } from './helpers'

describe('debug', () => {
  test('It passes a debug line through without the plugin name, which the engine adds', async ($, on) => {
    const world = install($, on)
    world.registerThrows = true
    await startSession($)
    expect(world.debugLines).toEqual(['could not register /handoff: HooksError: no implementation for command.register'])
  })
})

describe('logFailure', () => {
  test('It leaves no failure line when the background clear of a held prompt succeeds', async ($, on) => {
    const { world } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await world.clock.settle()
    expect(world.debugLines.some(line => line.startsWith('background work failed'))).toBe(false)
  })
})
