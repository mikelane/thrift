import { expect, test } from 'claude-code/testing'

import {
  bash,
  compacted,
  completeTurn,
  growTo200k,
  install,
  lastRecord,
  runStep,
  startSession,
  usageOf,
} from './helpers'

const ACT = { options: { handoffMode: 'act' } } as const

test('It does not compact inside the hook the turn is waiting on', ACT, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  expect(world.effects).not.toContain('compact')
})

test('It compacts after the clock fires when act sees a weak signal', ACT, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects).toContain('compact')
})

test('It logs one compacted record at the turn-end point with the weak signal', ACT, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  expect(world.records).toHaveLength(1)
  expect(lastRecord(world)).toMatchObject({
    mode: 'active',
    action: 'compacted',
    trigger_values: { point: 'turn-end', signal: 'weak', setting: 'act' },
  })
})

test('It compacts for a weak signal when background work is running', ACT, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await bash($, world, 'sleep 100', { result: { backgroundTaskId: 'bg1' } })
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects).toContain('compact')
  expect(lastRecord(world).trigger_values.is_background_busy).toBe(true)
})

test('It compacts once when a second turn ends while the compaction is pending', ACT, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'compact')).toHaveLength(1)
  expect(world.records).toHaveLength(1)
})

test('It does not compact below the threshold', ACT, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runStep($, world, { usage: usageOf(1_000, 0, 99_000) })
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects).not.toContain('compact')
})

test('It does not compact in off mode', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects).not.toContain('compact')
})

test('It sizes the context from tokensAfter once a compaction finishes', ACT, async ($, on) => {
  const world = install($, on)
  world.compact = async () => compacted(48_000)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  await completeTurn($)
  expect(lastRecord(world).trigger_values.context_tokens).toBe(48_000)
})

test('It waits for 50000 more tokens after a compaction before it compacts again', ACT, async ($, on) => {
  const world = install($, on)
  world.compact = async () => compacted(120_000)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  await runStep($, world, { usage: usageOf(1_000, 0, 168_999) })
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'compact')).toHaveLength(1)
  expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { signal: 'weak', reason: 'backoff' } })
})

test('It compacts again once the context has grown 50000 tokens past the compaction', ACT, async ($, on) => {
  const world = install($, on)
  world.compact = async () => compacted(120_000)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  await runStep($, world, { usage: usageOf(1_000, 0, 169_000) })
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'compact')).toHaveLength(2)
})

test('It measures the backoff from the size before a vetoed compaction', ACT, async ($, on) => {
  const world = install($, on)
  world.compact = async () => ({ skip: 'a hook vetoed it' })
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { reason: 'compaction_vetoed' } })
  await runStep($, world, { usage: usageOf(1_000, 0, 248_999) })
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'compact')).toHaveLength(1)
})

test('It measures the backoff from the size before a failed compaction', ACT, async ($, on) => {
  const world = install($, on)
  world.compact = async () => {
    throw new Error('compaction failed')
  }
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { reason: 'compaction_failed' } })
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'compact')).toHaveLength(1)
})

test('It measures the backoff from the size before a compaction that reports no size', ACT, async ($, on) => {
  const world = install($, on)
  world.compact = async () => compacted(undefined)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  expect(lastRecord(world).action).toBe('compacted')
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'compact')).toHaveLength(1)
})

test('It clears the pending claim after a failed compaction so a later turn can be evaluated', ACT, async ($, on) => {
  const world = install($, on)
  world.compact = async () => {
    throw new Error('compaction failed')
  }
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  await completeTurn($)
  expect(world.records.map(record => record.action)).toEqual(['none', 'none'])
})

test('It compacts again when the context grows past the backoff from a fresh session', ACT, async ($, on) => {
  const world = install($, on)
  world.compact = async () => compacted(100_000)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  await $.session.end({ reason: 'clear', sessionId: 'old-session', resume: { id: 'old-session' } })
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'compact')).toHaveLength(2)
})
