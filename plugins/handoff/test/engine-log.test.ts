import { describe, expect, test } from 'claude-code/testing'

import { install, startSession, submitPerson, writingTheNote } from './helpers'

describe('debug', () => {
  test('It starts every debug line with the plugin name', async ($, on) => {
    const world = install($, on)
    world.registerThrows = true
    await startSession($)
    expect(world.debugLines.every(line => line.startsWith('handoff: '))).toBe(true)
  })
})

describe('logFailure', () => {
  test('It leaves no failure line when the background clear of a held prompt succeeds', async ($, on) => {
    const { world } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await world.clock.settle()
    expect(world.debugLines.some(line => line.startsWith('handoff: background work failed'))).toBe(false)
  })
})
