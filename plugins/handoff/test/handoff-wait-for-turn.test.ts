import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelForkResult, On } from 'claude-code'

import { turnAfterNoteLine } from '../hooks/handoff-note'
import { answered, completeTurn, dropOf, install, lastRecord, notify, runCommand, startSession, startTurn, submitPerson, type World } from './helpers'

const BASE_MESSAGE = 'Handoff from the previous session (old-session), written by Claude just before a /clear:\n\nThe handoff note.'
const LATE_TURN_MESSAGE = `${BASE_MESSAGE}\n\n${turnAfterNoteLine('old-session')}`

const holdFork = (world: World) => {
  const pendingFork: { release: (result: ModelForkResult) => void } = { release: () => undefined }
  world.fork = () =>
    new Promise<ModelForkResult>(resolve => {
      pendingFork.release = resolve
    })
  return pendingFork
}

const writingTheNote = async ($: Engine, on: On) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  const finishNote = async () => {
    fork.release(answered('The handoff note.'))
    await world.clock.settle()
  }
  return { world, finishNote }
}

const turnRunningWhenTheNoteIsWritten = async ($: Engine, on: On) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await startTurn($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  const finishNote = async () => {
    fork.release(answered('The handoff note.'))
    await world.clock.settle()
  }
  return { world, finishNote }
}

const endTurn = async ($: Engine, world: World, completion?: Parameters<typeof completeTurn>[1]) => {
  await completeTurn($, completion)
  await world.clock.settle()
}

test('It does not clear while a turn that started during the note is running', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  expect(world.effects).not.toContain('clear')
})

test('It clears once the turn that started during the note ends', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  await endTurn($, world)
  expect(world.effects).toContain('clear')
})

test('It clears once the turn ends, whatever the reason it ended', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  await endTurn($, world, { reason: 'aborted' })
  expect(world.effects).toContain('clear')
})

test('It waits for a turn that was already running when the note finishes', async ($, on) => {
  const { world, finishNote } = await turnRunningWhenTheNoteIsWritten($, on)
  await finishNote()
  expect(world.effects).not.toContain('clear')
})

test('It clears once a turn that was already running when the note finishes ends', async ($, on) => {
  const { world, finishNote } = await turnRunningWhenTheNoteIsWritten($, on)
  await finishNote()
  await endTurn($, world)
  expect(world.effects).toContain('clear')
})

test('It waits for a turn that a peer prompt started during the note', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await submitPerson($, 'from a peer', { kind: 'peer' })
  await startTurn($)
  await finishNote()
  expect(world.effects).not.toContain('clear')
})

test('It waits for a turn that a task notification started during the note', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await notify($, 'bg1')
  await startTurn($)
  await finishNote()
  expect(world.effects).not.toContain('clear')
})

test('It does not hold a task notification that arrives during the handoff', async ($, on) => {
  const { world } = await writingTheNote($, on)
  expect(dropOf(await notify($, 'bg1'))).toBeUndefined()
  expect(world.effects.filter(effect => effect.startsWith('toast:'))).toHaveLength(1)
})

test('It does not hold a peer prompt that arrives during the handoff', async ($, on) => {
  await writingTheNote($, on)
  expect(dropOf(await submitPerson($, 'from a peer', { kind: 'peer' }))).toBeUndefined()
})

test('It keeps holding a person prompt while the handoff waits for the turn', async ($, on) => {
  const { finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  expect(dropOf(await submitPerson($, 'next thing'))).toContain('A handoff is in progress')
})

test('It keeps the Writing status up while the handoff waits for the turn', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  expect(world.effects).not.toContain('log:Handed off.')
  expect(world.records).toHaveLength(0)
})

test('It does not clear when a subagent turn ends while the main turn runs', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  await endTurn($, world, { agentId: 'sub1' })
  expect(world.effects).not.toContain('clear')
})

test('It waits again when a new turn starts right after the one it waited for', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  await completeTurn($)
  await startTurn($)
  await world.clock.settle()
  expect(world.effects).not.toContain('clear')
})

test('It clears once the second turn ends too', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  await completeTurn($)
  await startTurn($)
  await endTurn($, world)
  expect(world.effects).toContain('clear')
})

test('It clears without waiting when no turn is running', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await finishNote()
  expect(world.effects).toContain('clear')
})

test('It adds the turn-after-note line when a turn started during the note and ended before the clear', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await completeTurn($)
  await finishNote()
  expect(world.appended).toEqual([LATE_TURN_MESSAGE])
})

test('It adds the turn-after-note line when the handoff waited for a turn that started during the note', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  await endTurn($, world)
  expect(world.appended).toEqual([LATE_TURN_MESSAGE])
})

test('It leaves the line out when no turn started after the note began', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await finishNote()
  expect(world.appended).toEqual([BASE_MESSAGE])
})

test('It adds the turn-after-note line when the turn it waited for was already running when the note began', async ($, on) => {
  const { world, finishNote } = await turnRunningWhenTheNoteIsWritten($, on)
  await finishNote()
  await endTurn($, world)
  expect(world.appended).toEqual([LATE_TURN_MESSAGE])
})

test('It leaves the line out when the turn ran before the handoff started', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await startTurn($)
  await completeTurn($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.appended).toEqual([BASE_MESSAGE])
})

test('It abandons the handoff as clear_failed when the clear fails after the wait', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  world.clearThrows = true
  await startTurn($)
  await finishNote()
  await endTurn($, world)
  expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { reason: 'clear_failed' } })
})

test('It does not offer a band over the handoff when the awaited turn ends', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  await endTurn($, world)
  expect(world.records.map(record => record.action)).toEqual(['cleared'])
})
