import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { answered, compacted, completeTurn, growTo200k, install, lastRecord, runCommand, startSession, startTurn, submitPerson, type World } from './helpers'
import { ACT, SESSION_ENDED_TOAST, SESSION_ENDED_LOG, COMPACTING, BASE_MESSAGE, SECOND_MESSAGE, LATE_TURN_MESSAGE, holdFork, writingTheNote, waitingForATurn, endSession, clearCount, RECORD_KEYS, resumeDuringCompaction } from './wait-for-turn-helpers'

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

test('It writes the session-ended message to the transcript when the session ends while the handoff waits', async ($, on) => {
  const world = await waitingForATurn($, on)
  await endSession($, 'resume')
  await world.clock.settle()
  expect(world.effects).toContain(SESSION_ENDED_LOG)
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
  expect(world.effects).toContain('entered:plugin+asUser:next thing')
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
  expect(world.appended).toEqual([BASE_MESSAGE])
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
  expect(world.appended).toEqual([BASE_MESSAGE, SECOND_MESSAGE])
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

test('It puts the held prompt back in the box when the person resumes during the wait in act-mode prompt handoff', ACT, async ($, on) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  world.branch = 'alice/eng-1-start'
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  await startTurn($)
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  await $.session.end({ reason: 'resume', sessionId: 'old-session', resume: { id: 'old-session' } })
  await world.clock.settle()
  expect(world.effects).not.toContain('clear')
  expect(world.box.text).toBe('now ENG-2')
})

test('It logs session_ended against the session the handoff started in', async ($, on) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await startTurn($)
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  world.sessionId = 'resumed-session'
  await $.session.end({ reason: 'resume', sessionId: 'old-session', resume: { id: 'old-session' } })
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ session_id: 'old-session', trigger_values: { reason: 'session_ended' } })
})

test('It logs no_handoff_written against the current session with the standard record keys', async ($, on) => {
  const world = install($, on)
  world.fork = async () => ({ isAnswered: false, reason: 'nothing-to-fork' })
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ session_id: 'old-session', trigger_values: { reason: 'no_handoff_written' } })
  expect(Object.keys(lastRecord(world)).sort()).toEqual(RECORD_KEYS)
})

test('It logs handoff_failed against the current session when the first id read is refused', async ($, on) => {
  const world = install($, on)
  world.sessionIdDenials = 1
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ session_id: 'old-session', trigger_values: { reason: 'handoff_failed' } })
})

test('It logs clear_failed against the handoff session and keeps sessionId out of trigger_values', async ($, on) => {
  const world = install($, on)
  world.clearThrows = true
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ session_id: 'old-session', trigger_values: { reason: 'clear_failed', is_background_busy: false } })
  expect(Object.keys(lastRecord(world).trigger_values)).not.toContain('sessionId')
})

test('It logs compaction_failed against the session the handoff started in when resumed during the compaction', COMPACTING, async ($, on) => {
  const world = install($, on)
  await startSession($)
  resumeDuringCompaction($, world, async () => {
    throw new Error('compaction lost its session')
  })
  await runCommand($, 'handoff')
  await world.clock.settle()
  const failed = world.records.filter(record => record.trigger_values.reason === 'compaction_failed')
  expect(failed.map(record => record.session_id)).toEqual(['old-session'])
})

test('It logs compaction_vetoed against the session the handoff started in when resumed during the compaction', COMPACTING, async ($, on) => {
  const world = install($, on)
  await startSession($)
  resumeDuringCompaction($, world, async () => ({ skip: 'vetoed by a hook' }))
  await runCommand($, 'handoff')
  await world.clock.settle()
  const vetoed = world.records.filter(record => record.trigger_values.reason === 'compaction_vetoed')
  expect(vetoed.map(record => record.session_id)).toEqual(['old-session'])
})

test('It logs the cleared record against the handoff session after compacting', COMPACTING, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ session_id: 'old-session', action: 'cleared' })
})

const ENDED = 'The session ended before the handoff could clear, so it stopped. No note was carried over.'
const COMPACTED_ENDED = `${ENDED} The previous session was compacted. To reopen it: claude --resume old-session`

const endOldSession = async ($: Engine, world: World, reason: 'resume' | 'prompt_input_exit') => {
  await $.session.end({ reason, sessionId: 'old-session', resume: { id: 'old-session' } })
  world.sessionId = 'resumed-session'
}

test('It names the compacted old session when the session is resumed during the compaction', COMPACTING, async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.compact = async () => {
    await endOldSession($, world, 'resume')
    return compacted(48_000)
  }
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects).toContain(`toast:${COMPACTED_ENDED}`)
  expect(world.effects).toContain(`log:${COMPACTED_ENDED}`)
  expect(world.effects.filter(effect => effect.includes('The session ended'))).toHaveLength(2)
})

test('It names the compacted old session when the session is left through prompt input during the compaction', COMPACTING, async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.compact = async () => {
    await endOldSession($, world, 'prompt_input_exit')
    return compacted(48_000)
  }
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects).toContain(`toast:${COMPACTED_ENDED}`)
  expect(world.effects).toContain(`log:${COMPACTED_ENDED}`)
  expect(world.effects.filter(effect => effect.includes('The session ended'))).toHaveLength(2)
})

test('It names the compacted old session when the session is resumed during the wait after the compaction', COMPACTING, async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.compact = async () => {
    await startTurn($)
    return compacted(48_000)
  }
  await runCommand($, 'handoff')
  await world.clock.settle()
  await endOldSession($, world, 'resume')
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects).toContain(`toast:${COMPACTED_ENDED}`)
  expect(world.effects).toContain(`log:${COMPACTED_ENDED}`)
  expect(world.effects.filter(effect => effect === 'compact')).toHaveLength(1)
})

test('It names the compacted old session when the session is left through prompt input during the wait after the compaction', COMPACTING, async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.compact = async () => {
    await startTurn($)
    return compacted(48_000)
  }
  await runCommand($, 'handoff')
  await world.clock.settle()
  await endOldSession($, world, 'prompt_input_exit')
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects).toContain(`toast:${COMPACTED_ENDED}`)
  expect(world.effects).toContain(`log:${COMPACTED_ENDED}`)
  expect(world.effects.filter(effect => effect === 'compact')).toHaveLength(1)
})

test('It leaves the resume line off when the session ends during the wait before any compaction', COMPACTING, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await startTurn($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await endOldSession($, world, 'resume')
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects).not.toContain('compact')
  expect(world.effects).toContain(`toast:${ENDED}`)
  expect(world.effects).toContain(`log:${ENDED}`)
  expect(world.effects.filter(effect => effect.includes('The session ended'))).toHaveLength(2)
})
