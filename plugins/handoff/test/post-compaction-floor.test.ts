import { describe, expect, test } from 'claude-code/testing'

import { bash, clears, compacted, completeTurn, growTo200k, install, lastRecord, runStep, startSession, usageOf, type World } from './helpers'

const ACT_AT_150K = { options: { handoffMode: 'act', handoffContextTokens: 150_000 } } as const
const ACT_AT_160K = { options: { handoffMode: 'act', handoffContextTokens: 160_000 } } as const

const compactions = (world: World) => world.effects.filter(effect => effect === 'compact')

const measureContext = async ($: Parameters<typeof runStep>[0], world: World, tokens: number) => {
  await runStep($, world, { usage: usageOf(1_000, 0, tokens - 1_000) })
}

describe('runCompaction', () => {
  test('It backs off from the measured context when tokensAfter undercounts', ACT_AT_160K, async ($, on) => {
    const world = install($, on)
    world.compact = async () => compacted(60_000)
    await startSession($)
    await growTo200k($, world)
    await completeTurn($)
    await world.clock.settle()
    await measureContext($, world, 158_000)
    await completeTurn($)
    await world.clock.settle()
    await measureContext($, world, 170_000)
    await completeTurn($)
    await world.clock.settle()
    expect(compactions(world)).toHaveLength(1)
    expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { signal: 'weak', reason: 'backoff' } })
  })

  test('It compacts again at exactly 50000 tokens past the measured post-compaction context', ACT_AT_160K, async ($, on) => {
    const world = install($, on)
    world.compact = async () => compacted(60_000)
    await startSession($)
    await growTo200k($, world)
    await completeTurn($)
    await world.clock.settle()
    await measureContext($, world, 158_000)
    await completeTurn($)
    await world.clock.settle()
    await measureContext($, world, 208_000)
    await completeTurn($)
    await world.clock.settle()
    expect(compactions(world)).toHaveLength(2)
  })

  test('It does not compact again at 49999 tokens past the measured post-compaction context', ACT_AT_160K, async ($, on) => {
    const world = install($, on)
    world.compact = async () => compacted(60_000)
    await startSession($)
    await growTo200k($, world)
    await completeTurn($)
    await world.clock.settle()
    await measureContext($, world, 158_000)
    await completeTurn($)
    await world.clock.settle()
    await measureContext($, world, 207_999)
    await completeTurn($)
    await world.clock.settle()
    expect(compactions(world)).toHaveLength(1)
  })

  test('It anchors the backoff on the first measurement after a compaction, not a later one', ACT_AT_160K, async ($, on) => {
    const world = install($, on)
    world.compact = async () => compacted(60_000)
    await startSession($)
    await growTo200k($, world)
    await completeTurn($)
    await world.clock.settle()
    await measureContext($, world, 158_000)
    await measureContext($, world, 230_000)
    await completeTurn($)
    await world.clock.settle()
    expect(compactions(world)).toHaveLength(2)
  })

  test('It holds the backoff on the reported size until the first measurement after a compaction exists', ACT_AT_160K, async ($, on) => {
    const world = install($, on)
    world.compact = async () => compacted(170_000)
    await startSession($)
    await growTo200k($, world)
    await completeTurn($)
    await world.clock.settle()
    await completeTurn($)
    await world.clock.settle()
    expect(compactions(world)).toHaveLength(1)
    expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { reason: 'backoff', context_tokens: 170_000 } })
  })

  test('It keeps waiting for a measurement when the first step after a compaction measures 0', ACT_AT_160K, async ($, on) => {
    const world = install($, on)
    world.compact = async () => compacted(120_000)
    await startSession($)
    await growTo200k($, world)
    await completeTurn($)
    await world.clock.settle()
    await runStep($, world, { usage: usageOf(0, 0, 0) })
    await measureContext($, world, 158_000)
    await measureContext($, world, 200_000)
    await completeTurn($)
    await world.clock.settle()
    expect(compactions(world)).toHaveLength(1)
  })

  test('It ignores a subagent step when it anchors the backoff', ACT_AT_160K, async ($, on) => {
    const world = install($, on)
    world.compact = async () => compacted(60_000)
    await startSession($)
    await growTo200k($, world)
    await completeTurn($)
    await world.clock.settle()
    await runStep($, world, { usage: usageOf(1_000, 0, 9_000), agentId: 'sub' })
    await measureContext($, world, 158_000)
    await measureContext($, world, 200_000)
    await completeTurn($)
    await world.clock.settle()
    expect(compactions(world)).toHaveLength(1)
  })

  test('It keeps today\'s backoff after a failed compaction', ACT_AT_160K, async ($, on) => {
    const world = install($, on)
    world.compact = async () => {
      throw new Error('compaction failed')
    }
    await startSession($)
    await measureContext($, world, 181_046)
    await completeTurn($)
    await world.clock.settle()
    await measureContext($, world, 200_000)
    await completeTurn($)
    await world.clock.settle()
    expect(compactions(world)).toHaveLength(1)
    expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { reason: 'backoff' } })
  })
})

const compactThenMeasure = async ($: Parameters<typeof runStep>[0], world: World, measured: number) => {
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  await measureContext($, world, measured)
  await completeTurn($)
  await world.clock.settle()
}

describe('knownFloor', () => {
  test('It records the last measured floor on the next compacted record', ACT_AT_150K, async ($, on) => {
    const world = install($, on)
    world.compact = async () => compacted(60_000)
    await compactThenMeasure($, world, 168_000)
    await measureContext($, world, 230_000)
    await completeTurn($)
    await world.clock.settle()
    expect(compactions(world)).toHaveLength(2)
    expect(lastRecord(world)).toMatchObject({ action: 'compacted', trigger_values: { floor_tokens: 168_000 } })
  })

  test('It compacts again every 50000 tokens past the floor when the floor is above the threshold', ACT_AT_150K, async ($, on) => {
    const world = install($, on)
    world.compact = async () => compacted(60_000)
    await compactThenMeasure($, world, 168_000)
    await measureContext($, world, 230_000)
    await completeTurn($)
    await world.clock.settle()
    await measureContext($, world, 290_000)
    await measureContext($, world, 340_001)
    await completeTurn($)
    await world.clock.settle()
    expect(compactions(world)).toHaveLength(3)
  })

  test('It compacts and omits floor_tokens when a weak signal comes before any compaction has set a floor', ACT_AT_150K, async ($, on) => {
    const world = install($, on)
    await startSession($)
    await growTo200k($, world)
    await completeTurn($)
    await world.clock.settle()
    expect(compactions(world)).toHaveLength(1)
    expect(lastRecord(world)).toMatchObject({ action: 'compacted' })
    expect(lastRecord(world).trigger_values).not.toHaveProperty('floor_tokens')
  })

  test('It compacts when the floor is below the threshold once the backoff has released', ACT_AT_160K, async ($, on) => {
    const world = install($, on)
    world.compact = async () => compacted(60_000)
    await compactThenMeasure($, world, 158_000)
    await measureContext($, world, 208_001)
    await completeTurn($)
    await world.clock.settle()
    expect(compactions(world)).toHaveLength(2)
  })

  test('It treats a floor of 0 as unknown and compacts', ACT_AT_150K, async ($, on) => {
    const world = install($, on)
    world.compact = async () => compacted(60_000)
    await startSession($)
    await growTo200k($, world)
    await completeTurn($)
    await world.clock.settle()
    await runStep($, world, { usage: usageOf(0, 0, 0) })
    await measureContext($, world, 260_000)
    await completeTurn($)
    await world.clock.settle()
    expect(compactions(world)).toHaveLength(1)
    expect(lastRecord(world).trigger_values).toMatchObject({ reason: 'backoff' })
  })

  test('It hands off on a strong signal when the floor is above the threshold', ACT_AT_150K, async ($, on) => {
    const world = install($, on)
    world.compact = async () => compacted(60_000)
    await compactThenMeasure($, world, 168_000)
    await measureContext($, world, 230_000)
    await bash($, world, 'git commit -m x')
    await completeTurn($)
    await world.clock.settle()
    expect(clears(world)).toHaveLength(1)
  })

  test('It forgets the floor when /clear starts a new session', ACT_AT_150K, async ($, on) => {
    const world = install($, on)
    world.compact = async () => compacted(60_000)
    await compactThenMeasure($, world, 168_000)
    await $.session.end({ reason: 'clear', sessionId: 'old-session', resume: { id: 'old-session' } })
    await growTo200k($, world)
    await completeTurn($)
    await world.clock.settle()
    expect(compactions(world)).toHaveLength(2)
  })
})
