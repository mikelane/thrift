import { describe, expect, test } from 'claude-code/testing'

import { CONTINUE_PROMPT } from '../hooks/continue-decision'
import { answered, entered, holdFork, install, lastRecord, runCommand, startSession, startTurn, submitPerson } from './helpers'
import { bandAfterFinishedTask, weakBand } from './band-turn-fixtures'

const CONTINUING = { options: { handoffMode: 'ask', continueAfterHandoff: true } } as const
const CONTINUING_OFF = { options: { continueAfterHandoff: true } } as const
const NOT_CONTINUING = { options: { handoffMode: 'ask' } } as const

const CONTINUE_ENTRY = `entered:plugin:${CONTINUE_PROMPT}`

const handedOffFromWeakBand = async ($: Parameters<typeof weakBand>[0], world: Parameters<typeof weakBand>[1]) => {
  const band = await weakBand($, world)
  await band.press({ key: 'handoff' })
  await world.clock.settle()
}

describe('continuing after a handoff', () => {
  test('It submits one continue prompt with plugin origin after the note of a weak-signal handoff', CONTINUING, async ($, on) => {
    const world = install($, on)
    await startSession($)
    await handedOffFromWeakBand($, world)
    expect(world.effects.filter(effect => effect === 'append' || effect === CONTINUE_ENTRY)).toEqual(['append', CONTINUE_ENTRY])
  })

  test('It logs continued submitted when the continue prompt was submitted', CONTINUING, async ($, on) => {
    const world = install($, on)
    await startSession($)
    await handedOffFromWeakBand($, world)
    expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { continued: 'submitted' } })
  })

  test('It submits nothing and logs continued off when the setting is off', NOT_CONTINUING, async ($, on) => {
    const world = install($, on)
    await startSession($)
    await handedOffFromWeakBand($, world)
    expect(entered(world)).toEqual([])
    expect(lastRecord(world).trigger_values).toMatchObject({ continued: 'off' })
  })

  test('It submits nothing and logs strong_signal after a strong signal', CONTINUING, async ($, on) => {
    const world = install($, on)
    await startSession($)
    const band = await bandAfterFinishedTask($, world)
    await band.press({ key: 'handoff' })
    await world.clock.settle()
    expect(entered(world)).toEqual([])
    expect(lastRecord(world).trigger_values).toMatchObject({ continued: 'skipped', continue_skip: 'strong_signal' })
  })

  test('It submits one continue prompt after a typed /handoff', CONTINUING, async ($, on) => {
    const world = install($, on)
    await startSession($)
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(world.effects.filter(effect => effect === 'append' || effect === CONTINUE_ENTRY)).toEqual(['append', CONTINUE_ENTRY])
    expect(lastRecord(world).trigger_values).toMatchObject({ continued: 'submitted' })
  })

  test('It submits nothing and logs continued off when the plugin runs in off', CONTINUING_OFF, async ($, on) => {
    const world = install($, on)
    await startSession($)
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(entered(world)).toEqual([])
    expect(lastRecord(world).trigger_values).toMatchObject({ continued: 'off' })
  })

  test('It submits only the note and logs note_not_appended when the append is refused', CONTINUING, async ($, on) => {
    const world = install($, on)
    world.appendDenied = true
    await startSession($)
    await handedOffFromWeakBand($, world)
    expect(entered(world).filter(effect => effect === CONTINUE_ENTRY)).toEqual([])
    expect(lastRecord(world).trigger_values).toMatchObject({ continued: 'skipped', continue_skip: 'note_not_appended' })
  })

  test('It submits no continue prompt and logs held_prompt_sent when a held prompt was sent', CONTINUING, async ($, on) => {
    const world = install($, on)
    const fork = holdFork(world)
    await startSession($)
    const band = await weakBand($, world)
    await band.press({ key: 'handoff' })
    await world.clock.settle()
    await submitPerson($, 'next thing')
    fork.release(answered('The handoff note.'))
    await world.clock.settle()
    expect(entered(world)).toEqual(['entered:plugin+asUser:next thing'])
    expect(lastRecord(world).trigger_values).toMatchObject({ continued: 'skipped', continue_skip: 'held_prompt_sent' })
  })

  test('It submits nothing and logs session_moved when the person moved to another session', CONTINUING, async ($, on) => {
    const world = install($, on)
    world.onCommandRegistered = async () => {
      world.sessionId = 'resumed-elsewhere'
    }
    await startSession($)
    await handedOffFromWeakBand($, world)
    expect(entered(world)).toEqual([])
    expect(lastRecord(world).trigger_values).toMatchObject({ continued: 'skipped', continue_skip: 'session_moved' })
  })

  test('It submits nothing and logs session_moved when the person moves on in the tick before the submit', CONTINUING, async ($, on) => {
    const world = install($, on)
    await startSession($)
    const band = await weakBand($, world)
    world.onCommandRegistered = async () => {
      world.onCommandRegistered = undefined
      void world.clock.sleep(0).then(() => {
        world.sessionId = 'resumed-elsewhere'
      })
    }
    await band.press({ key: 'handoff' })
    await world.clock.settle()
    expect(entered(world)).toEqual([])
    expect(lastRecord(world).trigger_values).toMatchObject({ continued: 'skipped', continue_skip: 'session_moved' })
  })

  test('It submits nothing and logs held_prompt_sent when a prompt started a turn in the tick before the submit', CONTINUING, async ($, on) => {
    const world = install($, on)
    await startSession($)
    const band = await weakBand($, world)
    world.onCommandRegistered = async () => {
      world.onCommandRegistered = undefined
      void world.clock.sleep(0).then(() => startTurn($, 'typed in the fresh session'))
    }
    await band.press({ key: 'handoff' })
    await world.clock.settle()
    expect(entered(world)).toEqual([])
    expect(lastRecord(world).trigger_values).toMatchObject({ continued: 'skipped', continue_skip: 'held_prompt_sent' })
  })

  test('It logs session_moved when the session id cannot be read', CONTINUING, async ($, on) => {
    const world = install($, on)
    await startSession($)
    const band = await weakBand($, world)
    world.onCommandRegistered = async () => {
      world.sessionIdDenials = 1
    }
    await band.press({ key: 'handoff' })
    await world.clock.settle()
    expect(lastRecord(world).trigger_values).toMatchObject({ continued: 'skipped', continue_skip: 'session_moved' })
  })

  test('It logs submit_failed and finishes the handoff when the submit throws', CONTINUING, async ($, on) => {
    const world = install($, on)
    world.submitThrows = true
    await startSession($)
    await handedOffFromWeakBand($, world)
    expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { continued: 'skipped', continue_skip: 'submit_failed' } })
  })

  test('It writes no continued field on the record of a handoff that wrote no note', CONTINUING, async ($, on) => {
    const world = install($, on)
    world.fork = async () => ({ isAnswered: false, reason: 'nothing-to-fork' })
    await startSession($)
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { reason: 'no_handoff_written' } })
    expect(lastRecord(world).trigger_values).not.toHaveProperty('continued')
  })

  test('It logs submit_failed when another hook drops the continue prompt', CONTINUING, async ($, on) => {
    const world = install($, on)
    world.submitDropped = true
    await startSession($)
    await handedOffFromWeakBand($, world)
    expect(lastRecord(world).trigger_values).toMatchObject({ continued: 'skipped', continue_skip: 'submit_failed' })
  })
})
