import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelForkResult, On } from 'claude-code'

import { turnAfterNoteLine } from '../hooks/handoff-note'
import { answered, bash, compacted, completeTurn, growTo200k, dropOf, install, lastRecord, notify, runCommand, startSession, startTurn, submitPerson, type World } from './helpers'

const ACT = { options: { handoffMode: 'act' } } as const
const BUSY_TOAST = 'toast:Background work started, and a handoff would cut it off. Nothing was cleared.'
const COMPACTING = { options: { compactBeforeClear: true } } as const

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

test('It does not compact before the clear while a turn that started during the note is running', COMPACTING, async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  expect(world.effects).not.toContain('compact')
})

test('It compacts once the turn that started during the note ends', COMPACTING, async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  await endTurn($, world)
  expect(world.effects).toContain('compact')
})

test('It compacts before it clears once the awaited turn ends', COMPACTING, async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  await endTurn($, world)
  expect(world.effects.filter(effect => effect === 'compact' || effect === 'clear')).toEqual(['compact', 'clear'])
})

test('It waits again when a turn starts during the compaction', COMPACTING, async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  world.compact = async () => {
    await startTurn($)
    return compacted(48_000)
  }
  await finishNote()
  expect(world.effects).not.toContain('clear')
})

test('It clears once the turn that started during the compaction ends', COMPACTING, async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  world.compact = async () => {
    await startTurn($)
    return compacted(48_000)
  }
  await finishNote()
  await endTurn($, world)
  expect(world.effects).toContain('clear')
})

// In act mode the handoff starts on its own, and a busy session is never handed off. A turn that runs during the
// wait can start background work after that decision was made.
const actHandoffWhileWritingTheNote = async ($: Engine, on: On) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  await world.clock.settle()
  await startTurn($)
  const finishNote = async () => {
    fork.release(answered('The handoff note.'))
    await world.clock.settle()
  }
  return { world, finishNote }
}

const turnStartsBackgroundWork = async ($: Engine, on: On) => {
  const { world, finishNote } = await actHandoffWhileWritingTheNote($, on)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  await finishNote()
  await endTurn($, world)
  return world
}

test('It does not clear over background work that a turn started while an act-mode handoff waited', ACT, async ($, on) => {
  const world = await turnStartsBackgroundWork($, on)
  expect(world.effects).not.toContain('clear')
})

test('It tells the person nothing was cleared when background work stops an act-mode handoff', ACT, async ($, on) => {
  const world = await turnStartsBackgroundWork($, on)
  expect(world.effects).toContain(BUSY_TOAST)
})

test('It records background_busy when background work stops an act-mode handoff after the wait', ACT, async ($, on) => {
  const world = await turnStartsBackgroundWork($, on)
  expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { reason: 'background_busy' } })
})

test('It puts a held prompt back in the box when background work stops the handoff', ACT, async ($, on) => {
  const { world, finishNote } = await actHandoffWhileWritingTheNote($, on)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  await submitPerson($, 'next thing')
  await finishNote()
  await endTurn($, world)
  expect(world.box.text).toBe('next thing')
})

test('It clears a typed /handoff over background work that a turn started during the wait', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  await finishNote()
  await endTurn($, world)
  expect(world.effects).toContain('clear')
})

test('It clears an act-mode handoff when no background work started during the wait', ACT, async ($, on) => {
  const { world, finishNote } = await actHandoffWhileWritingTheNote($, on)
  await finishNote()
  await endTurn($, world)
  expect(world.effects).toContain('clear')
})
