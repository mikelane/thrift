import { describe, expect, test } from 'claude-code/testing'

import { completeTurn, growTo200k, install, lastRecord, startSession, writingTheNote } from './helpers'

const ACT = { options: { handoffMode: 'act' } } as const

describe('scheduleCompaction', () => {
  test('It compacts once the clock fires and records it', ACT, async ($, on) => {
    const world = install($, on)
    await startSession($)
    await growTo200k($, world)
    await completeTurn($)
    await world.clock.settle()
    expect(world.effects.filter(effect => effect === 'compact')).toHaveLength(1)
    expect(lastRecord(world)).toMatchObject({ action: 'compacted' })
  })

  test('It does not compact while a handoff holds the pending claim', ACT, async ($, on) => {
    const { world } = await writingTheNote($, on)
    await growTo200k($, world)
    await completeTurn($)
    await world.clock.settle()
    expect(world.effects).not.toContain('compact')
  })
})

describe('runCompaction', () => {
  test('It frees the pending claim after a failed compaction so the next turn is evaluated', ACT, async ($, on) => {
    const world = install($, on)
    world.compact = async () => {
      throw new Error('compaction failed')
    }
    await startSession($)
    await growTo200k($, world)
    await completeTurn($)
    await world.clock.settle()
    await completeTurn($)
    await world.clock.settle()
    expect(world.records.map(record => record.trigger_values)).toMatchObject([{ reason: 'compaction_failed' }, { reason: 'backoff' }])
  })
})
