import { describe, expect, test } from 'claude-code/testing'

import { FINAL_MESSAGES } from '../hooks/handoff-note'
import { install, runCommand, startSession, submitPerson, writingTheNote } from './helpers'

describe('debug', () => {
  test('It starts every debug line with the plugin name', async ($, on) => {
    const world = install($, on)
    world.registerThrows = true
    await startSession($)
    expect(world.debugLines.every(line => line.startsWith('handoff: '))).toBe(true)
  })

  test('It writes a line to the debug log when a registration is refused', async ($, on) => {
    const world = install($, on)
    world.registerThrows = true
    await startSession($)
    expect(world.debugLines).toEqual(['handoff: could not register /handoff: HooksError: no implementation for command.register'])
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

describe('announce', () => {
  test('It logs the final message of a handoff', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await finishNote()
    expect(world.effects).toContain(`log:${FINAL_MESSAGES.appended('old-session')}`)
  })

  test('It shows the final message of a handoff as a toast', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await finishNote()
    expect(world.effects).toContain(`toast:${FINAL_MESSAGES.appended('old-session')}`)
  })
})

describe('registerHandoffCommand', () => {
  test('It registers /handoff when an interactive session starts', async ($, on) => {
    const world = install($, on)
    await startSession($)
    expect(world.effects).toContain('register:handoff')
  })

  test('It registers /handoff again once a handoff has cleared', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await finishNote()
    expect(world.effects.slice(world.effects.indexOf('clear'))).toContain('register:handoff')
  })

  test('It does not register /handoff when the registration is refused', async ($, on) => {
    const world = install($, on)
    world.registerThrows = true
    await startSession($)
    await runCommand($, 'handoff')
    expect(world.effects).not.toContain('register:handoff')
  })
})
