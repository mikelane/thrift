import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { answered, completeTurn, growTo200k, holdFork, install, lastRecord, runCommand, startSession, startTurn, type World } from './helpers'

const ACT = { options: { handoffMode: 'act' } } as const
const COMPACTING = { options: { compactBeforeClear: true } } as const

const personClear = ($: Engine) => $.session.end({ reason: 'clear', sessionId: 'old-session', resume: { id: 'old-session' } })

const reasons = (world: World) => world.records.map(record => record.trigger_values.reason ?? record.action)

const clearCount = (world: World) => world.effects.filter(effect => effect === 'clear').length

test('It leaves cleared_by and compacted_before_clear off an act-mode compacted record', ACT, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  expect(lastRecord(world).action).toBe('compacted')
  expect(lastRecord(world).trigger_values).not.toHaveProperty('compacted_before_clear')
  expect(lastRecord(world).trigger_values).not.toHaveProperty('cleared_by')
})

test('It writes one vetoed record and a cleared record without compacted_before_clear on a vetoed compaction', COMPACTING, async ($, on) => {
  const world = install($, on)
  world.compact = async () => ({ skip: 'vetoed' })
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(reasons(world)).toEqual(['compaction_vetoed', 'cleared'])
  expect(lastRecord(world).trigger_values).not.toHaveProperty('compacted_before_clear')
})

test('It records cleared_by person without compacted_before_clear when the person clears during a vetoed compaction', COMPACTING, async ($, on) => {
  const world = install($, on)
  world.compact = async () => {
    await personClear($)
    return { skip: 'vetoed' }
  }
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(reasons(world)).toEqual(['compaction_vetoed', 'cleared'])
  expect(lastRecord(world).trigger_values).toMatchObject({ cleared_by: 'person' })
  expect(lastRecord(world).trigger_values).not.toHaveProperty('compacted_before_clear')
})

test('It skips the compaction and leaves compacted_before_clear off when the person clears during the wait', COMPACTING, async ($, on) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await startTurn($)
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  await personClear($)
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects).not.toContain('compact')
  expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { cleared_by: 'person' } })
  expect(lastRecord(world).trigger_values).not.toHaveProperty('compacted_before_clear')
  expect(clearCount(world)).toBe(0)
})

test('It orders the cleared record keys after a compaction with compacted_before_clear between cleared_by and the held fields', COMPACTING, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(Object.keys(lastRecord(world).trigger_values)).toEqual([
    'point',
    'signal',
    'context_tokens',
    'threshold',
    'is_background_busy',
    'setting',
    'cache_read_tokens',
    'note',
    'cleared_by',
    'compacted_before_clear',
    'held_groups',
    'held_unattended',
    'handoff_unattended',
    'held_other_delivery',
    'effective_mode',
  ])
})

// The race the SAFETY note in prepareHandoff describes. The note leaves out that the record's session_id names the new session too.
test('It records the new session id and cleared_by person when the person clears in the same tick as /handoff', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runCommand($, 'handoff')
  world.sessionId = 'new-session'
  await personClear($)
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ action: 'cleared', session_id: 'new-session', trigger_values: { cleared_by: 'person', note: 'appended' } })
})

test('It writes one cleared record per handoff, each compacted and cleared by the handoff, for two handoffs in a row', COMPACTING, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(reasons(world)).toEqual(['cleared', 'cleared'])
  expect(world.records.map(record => record.trigger_values.compacted_before_clear)).toEqual([true, true])
  expect(world.records.map(record => record.trigger_values.cleared_by)).toEqual(['handoff', 'handoff'])
})
