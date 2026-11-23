import { describe, expect, test } from 'claude-code/testing'

import { CLEAR_SKIPPED_MESSAGE } from '../hooks/handoff-note'
import { completeTurn, install, lastRecord, runCommand, startSession, startTurn } from './helpers'

const COMPACTING = { options: { compactBeforeClear: true } } as const

// The person's command took the turn while the compaction ran, so the compaction failed against a turn in flight.
const compactionPreemptedByATurn = async ($: Parameters<typeof install>[0], on: Parameters<typeof install>[1]) => {
  const world = install($, on)
  world.compact = async () => {
    await startTurn($, 'the command the person typed')
    throw new Error('a turn is in flight')
  }
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await completeTurn($)
  await world.clock.settle()
  return world
}

test('It words CLEAR_SKIPPED_MESSAGE as the final copy', () => {
  expect(CLEAR_SKIPPED_MESSAGE).toBe(
    'The handoff stopped before clearing: a turn started while it was compacting this session. This session is unchanged, and no note was carried over. Type /handoff to try again.',
  )
})

describe('a compaction that failed because a turn took the session', () => {
  test('It skips the handoff clear', COMPACTING, async ($, on) => {
    const world = await compactionPreemptedByATurn($, on)
    expect(world.effects).not.toContain('clear')
  })

  test('It does not retry the compaction', COMPACTING, async ($, on) => {
    const world = await compactionPreemptedByATurn($, on)
    expect(world.effects.filter(effect => effect === 'compact')).toHaveLength(1)
  })

  test('It records clear_skipped turn_running on the record that ends the handoff', COMPACTING, async ($, on) => {
    const world = await compactionPreemptedByATurn($, on)
    expect(lastRecord(world)).toMatchObject({
      action: 'none',
      trigger_values: { reason: 'compaction_failed', clear_skipped: 'turn_running', held_groups: 0 },
    })
  })

  test('It writes one compaction_failed record for the handoff, the one that ends it', COMPACTING, async ($, on) => {
    const world = await compactionPreemptedByATurn($, on)
    const failed = world.records.filter(record => record.trigger_values.reason === 'compaction_failed')
    expect(failed.map(record => record.trigger_values.clear_skipped)).toEqual(['turn_running'])
  })

  test('It writes a debug line saying a running turn preempted the compaction', COMPACTING, async ($, on) => {
    const world = await compactionPreemptedByATurn($, on)
    expect(world.debugLines).toContain('handoff: the compaction was preempted by a running turn, so the handoff skips the clear')
  })

  test('It says the handoff did not clear', COMPACTING, async ($, on) => {
    const world = await compactionPreemptedByATurn($, on)
    expect(world.effects).toContain(`log:${CLEAR_SKIPPED_MESSAGE}`)
  })

  test('It delivers no note', COMPACTING, async ($, on) => {
    const world = await compactionPreemptedByATurn($, on)
    expect(world.appended).toEqual([])
  })
})

describe('a compaction that failed with no turn in flight', () => {
  test('It writes the compaction_failed record when the compaction fails, since the handoff goes on to clear', COMPACTING, async ($, on) => {
    const world = install($, on)
    world.compact = async () => {
      throw new Error('compaction failed')
    }
    await startSession($)
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(world.records.filter(record => record.trigger_values.reason === 'compaction_failed')).toHaveLength(1)
  })

  test('It still clears and leaves clear_skipped off', COMPACTING, async ($, on) => {
    const world = install($, on)
    world.compact = async () => {
      throw new Error('compaction failed')
    }
    await startSession($)
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(world.effects).toContain('clear')
    expect(lastRecord(world)).toMatchObject({ action: 'cleared' })
    expect(lastRecord(world).trigger_values.clear_skipped).toBeUndefined()
  })
})

describe('a compaction that a hook vetoed while a turn took the session, for compactBeforeClearing', () => {
  test('It clears once the turn ends because only a failed compaction counts as preempted', COMPACTING, async ($, on) => {
    const world = install($, on)
    world.compact = async () => {
      await startTurn($, 'the command the person typed')
      return { skip: 'a hook vetoed it' }
    }
    await startSession($)
    await runCommand($, 'handoff')
    await world.clock.settle()
    await completeTurn($)
    await world.clock.settle()
    expect(world.effects).toContain('clear')
    expect(lastRecord(world)).toMatchObject({ action: 'cleared' })
    expect(lastRecord(world).trigger_values.clear_skipped).toBeUndefined()
  })
})

describe('a compaction that failed against a turn while the person also cleared', () => {
  test('It delivers to the person clear and leaves clear_skipped off', COMPACTING, async ($, on) => {
    const world = install($, on)
    world.compact = async () => {
      await startTurn($, 'the command the person typed')
      throw new Error('a turn is in flight')
    }
    await startSession($)
    await runCommand($, 'handoff')
    await world.clock.settle()
    await runCommand($, 'clear')
    await world.clock.settle()
    expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { cleared_by: 'person' } })
    expect(lastRecord(world).trigger_values.clear_skipped).toBeUndefined()
  })
})
