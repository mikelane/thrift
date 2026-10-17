import { describe, expect, test } from 'claude-code/testing'

import { ALREADY_PENDING, NO_HANDOFF_MESSAGE } from '../hooks/handoff-note'
import { install, lastRecord, runCommand, startSession, writingTheNote } from './helpers'

describe('scheduleHandoff', () => {
  test('It starts the handoff in a later tick, not inside the command', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await runCommand($, 'handoff')
    expect(world.effects).not.toContain('fork')
    await world.clock.settle()
    expect(world.effects).toContain('fork')
  })

  test('It answers a second /handoff with the pending notice and writes one note', async ($, on) => {
    const { world } = await writingTheNote($, on)
    const second = await runCommand($, 'handoff')
    expect(JSON.stringify(second)).toContain(ALREADY_PENDING)
    expect(world.forkPrompts).toHaveLength(1)
  })
})

describe('settleHandoff', () => {
  test('It ends the holding of prompts typed while the note was written', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await finishNote()
    expect(world.effects).toContain('clear')
    expect(lastRecord(world)).toMatchObject({ action: 'cleared' })
  })
})

describe('writeNote', () => {
  test('It forks once with the handoff prompt', async ($, on) => {
    const { world } = await writingTheNote($, on)
    expect(world.forkPrompts).toHaveLength(1)
    expect(world.forkPrompts[0]).toContain('Write a handoff for the next session')
  })

  test('It treats a fork that throws as no note', async ($, on) => {
    const world = install($, on)
    world.fork = async () => {
      throw new Error('fork refused')
    }
    await startSession($)
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(world.debugLines.join('\n')).toContain('could not write the handoff note')
  })
})

describe('prepareHandoff', () => {
  test('It abandons with no_handoff_written and the generic message when the note comes back empty', async ($, on) => {
    const world = install($, on)
    world.fork = async () => ({ isAnswered: false, reason: 'empty-reply', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 } })
    await startSession($)
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(world.effects).toContain(`toast:${NO_HANDOFF_MESSAGE}`)
    expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { reason: 'no_handoff_written' } })
  })

  test('It abandons with handoff_failed when the session id cannot be read', async ($, on) => {
    const world = install($, on)
    world.sessionIdDenials = 1
    await startSession($)
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(world.debugLines.join('\n')).toContain('handoff failed before the clear')
  })
})

describe('abandonHandoff', () => {
  test('It announces the reason and leaves the session unchanged', async ($, on) => {
    const world = install($, on)
    world.fork = async () => ({ isAnswered: false, reason: 'nothing-to-fork' })
    await startSession($)
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(world.effects).not.toContain('clear')
    expect(world.records).toHaveLength(1)
  })
})

describe('runHandoff', () => {
  test('It frees the pending claim once the handoff has ended', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await finishNote()
    const next = await runCommand($, 'handoff')
    expect(JSON.stringify(next)).not.toContain(ALREADY_PENDING)
    await world.clock.settle()
  })
})

describe('readSessionId', () => {
  test('It says why when the id cannot be read for the abandoned handoff either', async ($, on) => {
    const world = install($, on)
    world.sessionIdDenials = 2
    await startSession($)
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(world.debugLines.join('\n')).toContain('could not read the session id')
  })
})
