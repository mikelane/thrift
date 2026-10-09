import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelForkResult, On } from 'claude-code'

import { turnAfterNoteLine } from '../hooks/handoff-note'
import { answered, bash, compacted, completeTurn, growTo200k, dropOf, install, lastRecord, notify, runCommand, startSession, startTurn, submitPerson, type World } from './helpers'

const ACT = { options: { handoffMode: 'act' } } as const
const BUSY_TOAST = 'toast:Background work started, and a handoff would cut it off. Nothing was cleared.'
const SESSION_ENDED_TOAST = 'toast:The session ended, so the handoff stopped. Nothing was cleared.'
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

// The person ends the session while the handoff waits: /clear delivers into their fresh session, anything else abandons.
const waitingForATurn = async ($: Engine, on: On) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  return world
}

const endSession = ($: Engine, reason: 'resume' | 'other') =>
  $.session.end({ reason, sessionId: 'old-session', resume: { id: 'old-session' } })

const clearCount = (world: World) => world.effects.filter(effect => effect === 'clear').length

test('It does not clear a session the person resumed while the handoff waited for a turn', async ($, on) => {
  const world = await waitingForATurn($, on)
  await endSession($, 'resume')
  await world.clock.settle()
  expect(world.effects).not.toContain('clear')
})

test('It does not clear a session that ended for another reason while the handoff waited', async ($, on) => {
  const world = await waitingForATurn($, on)
  await endSession($, 'other')
  await world.clock.settle()
  expect(world.effects).not.toContain('clear')
})

test('It adds no note when the session ends while the handoff waits', async ($, on) => {
  const world = await waitingForATurn($, on)
  await endSession($, 'resume')
  await world.clock.settle()
  expect(world.appended).toEqual([])
})

test('It tells the person the handoff stopped when the session ends while it waits', async ($, on) => {
  const world = await waitingForATurn($, on)
  await endSession($, 'resume')
  await world.clock.settle()
  expect(world.effects).toContain(SESSION_ENDED_TOAST)
})

test('It records session_ended when the session ends while the handoff waits', async ($, on) => {
  const world = await waitingForATurn($, on)
  await endSession($, 'resume')
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { reason: 'session_ended' } })
})

test('It puts a held prompt back in the box when the session ends while the handoff waits', async ($, on) => {
  const world = await waitingForATurn($, on)
  await submitPerson($, 'next thing')
  await endSession($, 'resume')
  await world.clock.settle()
  expect(world.box.text).toBe('next thing')
})

test('It abandons the handoff when the session ends while the note is written', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await endSession($, 'resume')
  await finishNote()
  expect(world.effects).not.toContain('clear')
  expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { reason: 'session_ended' } })
})

test('It runs no second clear after the person typed /clear while the handoff waited', async ($, on) => {
  const world = await waitingForATurn($, on)
  await runCommand($, 'clear')
  await world.clock.settle()
  expect(clearCount(world)).toBe(1)
})

test('It delivers the note into the session the person cleared to, with the turn-missing line', async ($, on) => {
  const world = await waitingForATurn($, on)
  await runCommand($, 'clear')
  await world.clock.settle()
  expect(world.appended).toEqual([LATE_TURN_MESSAGE])
})

test('It logs cleared when the person cleared while the handoff waited', async ($, on) => {
  const world = await waitingForATurn($, on)
  await runCommand($, 'clear')
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ action: 'cleared' })
})

test('It sends a held prompt into the session the person cleared to', async ($, on) => {
  const world = await waitingForATurn($, on)
  await submitPerson($, 'next thing')
  await runCommand($, 'clear')
  await world.clock.settle()
  expect(world.effects).toContain('entered:plugin:next thing')
})

test('It runs no second clear after the person typed /clear while the note is written', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await runCommand($, 'clear')
  await finishNote()
  expect(clearCount(world)).toBe(1)
  expect(world.appended).toEqual([BASE_MESSAGE])
})

test('It clears normally after a session ended while no handoff was pending', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await endSession($, 'resume')
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects).toContain('clear')
})

const actHandoffWithBusyTurn = async ($: Engine, on: On) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  await world.clock.settle()
  await startTurn($)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  await endTurn($, world)
  return world
}

test('It records the background_busy abandon after the wait as busy, with a weak signal', ACT, async ($, on) => {
  const world = await actHandoffWithBusyTurn($, on)
  expect(lastRecord(world).trigger_values).toMatchObject({ reason: 'background_busy', is_background_busy: true, signal: 'weak' })
})

test('It runs one clear and delivers the note when the person clears during the compaction', COMPACTING, async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.compact = async () => {
    await runCommand($, 'clear')
    return compacted(48_000)
  }
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'clear')).toHaveLength(1)
  expect(world.appended).toHaveLength(1)
})

test('It abandons as session_ended when the session is resumed during the compaction', COMPACTING, async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.compact = async () => {
    await $.session.end({ reason: 'resume', sessionId: 'old-session', resume: { id: 'old-session' } })
    return compacted(48_000)
  }
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects).not.toContain('clear')
  expect(lastRecord(world)).toMatchObject({ trigger_values: { reason: 'session_ended' } })
})

test('It clears normally on the handoff after one the person cleared during', async ($, on) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await runCommand($, 'clear')
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  world.fork = async () => answered('Second note.')
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'clear')).toHaveLength(2)
  expect(world.appended).toHaveLength(2)
})

test('It clears normally on the handoff after one abandoned as session_ended', async ($, on) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await $.session.end({ reason: 'resume', sessionId: 'old-session', resume: { id: 'old-session' } })
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  world.fork = async () => answered('Second note.')
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects).toContain('clear')
})

test('It puts the held prompt back when the person resumes during the wait in act-mode prompt handoff', ACT, async ($, on) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await growTo200k($, world)
  await submitPerson($, 'Start on PROJ-42 next')
  await world.clock.settle()
  await startTurn($)
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  await $.session.end({ reason: 'resume', sessionId: 'old-session', resume: { id: 'old-session' } })
  await world.clock.settle()
  expect(world.effects).not.toContain('clear')
})
