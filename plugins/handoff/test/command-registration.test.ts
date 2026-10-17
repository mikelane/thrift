import { describe, expect, test } from 'claude-code/testing'

import { FINAL_MESSAGES } from '../hooks/handoff-note'
import { install, startSession, writingTheNote } from './helpers'

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

  test('It writes a line to the debug log when a registration is refused', async ($, on) => {
    const world = install($, on)
    world.registerThrows = true
    await startSession($)
    expect(world.debugLines).toEqual(['handoff: could not register /handoff: HooksError: no implementation for command.register'])
  })

  test('It still delivers the note when registering /handoff after the clear is refused', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.registerThrows = true
    await finishNote()
    expect(world.effects).toContain(`toast:${FINAL_MESSAGES.appended('old-session')}`)
  })
})
