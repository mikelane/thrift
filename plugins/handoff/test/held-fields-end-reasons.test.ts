import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { DecisionReason } from '../hooks/decision-reasons'
import { answered, bash, completeTurn, growTo200k, holdFork, install, runCommand, startSession, startTurn, submitPerson, type LogRecord, type World } from './helpers'

const ACT = { options: { handoffMode: 'act' } } as const
const ASK = { options: { handoffMode: 'ask' } } as const
const END_REASONS: readonly DecisionReason[] = ['no_handoff_written', 'handoff_failed', 'session_ended', 'background_busy', 'clear_failed']

const isEndReason = (value: unknown): boolean => END_REASONS.some(reason => reason === value)

const endRecords = (world: World): LogRecord[] =>
  world.records.filter(record => record.action === 'cleared' || isEndReason(record.trigger_values.reason))

const expectOneEndRecord = (world: World, reason: DecisionReason) => {
  const ends = endRecords(world)
  expect(ends).toHaveLength(1)
  expect(ends[0]).toMatchObject({
    session_id: 'old-session',
    action: 'none',
    trigger_values: { reason, held_groups: 1, held_unattended: false, handoff_unattended: false, held_restore: 'in_box' },
  })
  expect(world.effects).toContain('fill:next thing')
  expect(JSON.stringify(ends[0])).not.toContain('next thing')
}

test('It writes one no_handoff_written record with held_restore in_box under the old session', async ($, on) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await submitPerson($, 'next thing')
  fork.release({ isAnswered: false, reason: 'nothing-to-fork' })
  await world.clock.settle()
  expectOneEndRecord(world, 'no_handoff_written')
})

test('It writes one session_ended record with held_restore in_box under the old session', async ($, on) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await startTurn($)
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  await submitPerson($, 'next thing')
  await $.session.end({ reason: 'resume', sessionId: 'old-session', resume: { id: 'old-session' } })
  await world.clock.settle()
  expectOneEndRecord(world, 'session_ended')
})

test('It writes one clear_failed record with held_restore in_box under the old session', async ($, on) => {
  const world = install($, on)
  const fork = holdFork(world)
  world.clearThrows = true
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await submitPerson($, 'next thing')
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  expectOneEndRecord(world, 'clear_failed')
})

test('It writes one background_busy record with held_restore in_box under the old session', ACT, async ($, on) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  await world.clock.settle()
  await startTurn($)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  await submitPerson($, 'next thing')
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  await completeTurn($)
  await world.clock.settle()
  expectOneEndRecord(world, 'background_busy')
})

test('It writes one handoff_failed record with held_restore none', async ($, on) => {
  const world = install($, on)
  world.sessionIdDenials = 1
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  const ends = endRecords(world)
  expect(ends).toHaveLength(1)
  expect(ends[0]?.trigger_values).toMatchObject({ reason: 'handoff_failed', held_groups: 0, held_restore: 'none', handoff_unattended: false })
})

test('It writes one cleared record under the old session when the person clears during the wait', async ($, on) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await startTurn($)
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  await submitPerson($, 'next thing')
  await runCommand($, 'clear')
  await world.clock.settle()
  const ends = endRecords(world)
  expect(ends).toHaveLength(1)
  expect(ends[0]).toMatchObject({
    session_id: 'old-session',
    action: 'cleared',
    trigger_values: { note: 'appended', held_groups: 1, held_other_delivery: 'submitted', handoff_unattended: false },
  })
})

test('It logs the failed session id read and still writes handoff_failed when readSessionId cannot read the id', async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.sessionIdDenials = 2
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.debugLines.filter(line => line.startsWith('handoff: could not read the session id'))).toHaveLength(1)
  const ends = endRecords(world)
  expect(ends).toHaveLength(1)
  expect(ends[0]).toMatchObject({ session_id: 'old-session', trigger_values: { reason: 'handoff_failed', held_restore: 'none' } })
})

test('It writes no handoff_failed record when readSessionId and writeRecord both cannot read the id', async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.sessionIdDenials = 3
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.debugLines.filter(line => line.startsWith('handoff: could not read the session id'))).toHaveLength(1)
  expect(endRecords(world)).toEqual([])
})

const unattendedHandoff = async ($: Engine, on: On) => {
  const world = install($, on)
  const pending = holdFork(world)
  world.branch = 'alice/eng-1-start'
  await startSession($)
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2', { kind: 'scheduled-trigger' })
  await world.clock.settle()
  return { world, pending }
}

test('It records held_restore submitted when an abandoned unattended handoff submits its carried prompt', ASK, async ($, on) => {
  const { world, pending } = await unattendedHandoff($, on)
  pending.release({ isAnswered: false, reason: 'nothing-to-fork' })
  await world.clock.settle()
  expect(world.effects).toContain('entered:plugin:now ENG-2')
  expect(endRecords(world)[0]?.trigger_values).toMatchObject({ held_groups: 1, held_unattended: true, handoff_unattended: true, held_restore: 'submitted' })
})

test('It records held_other_delivery submitted when a cleared unattended handoff submits its carried prompt', ASK, async ($, on) => {
  const { world, pending } = await unattendedHandoff($, on)
  pending.release(answered('The handoff note.'))
  await world.clock.settle()
  expect(world.effects).toContain('entered:plugin:now ENG-2')
  expect(endRecords(world)[0]?.trigger_values).toMatchObject({ note: 'appended', held_groups: 1, held_other_delivery: 'submitted' })
})

test('It records held_other_delivery none when an unattended handoff note is sent as a prompt', ASK, async ($, on) => {
  const { world, pending } = await unattendedHandoff($, on)
  world.appendDenied = true
  pending.release(answered('The handoff note.'))
  await world.clock.settle()
  expect(endRecords(world)[0]?.trigger_values).toMatchObject({ note: 'submitted', held_groups: 1, held_other_delivery: 'none' })
})

test('It logs handoff_failed under the session the handoff began in when the restore runs past a session change', ACT, async ($, on) => {
  const world = install($, on)
  world.branch = 'alice/eng-1-start'
  await startSession($)
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  world.sessionIdDenials = 1
  world.submitHooks = [() => {
    world.sessionId = world.nextSessionId
  }]
  await submitPerson($, 'now ENG-2', { kind: 'scheduled-trigger' })
  await world.clock.settle()
  const ends = endRecords(world)
  expect(ends.map(record => record.trigger_values.reason)).toEqual(['handoff_failed'])
  expect(ends[0]?.session_id).toBe('old-session')
})

test('It logs only its own held groups on the second of two back-to-back handoffs', async ($, on) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await submitPerson($, 'next thing')
  await submitPerson($, 'nightly', { kind: 'scheduled-trigger' })
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  world.fork = async () => answered('Second note.')
  world.nextSessionId = 'third-session'
  await runCommand($, 'handoff')
  await world.clock.settle()
  const cleared = world.records.filter(record => record.action === 'cleared')
  expect(cleared.map(record => record.session_id)).toEqual(['old-session', 'new-session'])
  expect(cleared[0]?.trigger_values).toMatchObject({ held_groups: 2, held_unattended: true, held_other_delivery: 'submitted' })
  expect(cleared[1]?.trigger_values).toMatchObject({ held_groups: 0, held_unattended: false, held_other_delivery: 'none' })
})
