import { expect, test } from 'claude-code/testing'

import { compacted, completeTurn, growTo200k, install, lastRecord, runStep, startSession, usageOf } from './helpers'

const ACT_AT_150K = { options: { handoffMode: 'act', handoffContextTokens: 150_000 } } as const

test('It does not carry a floor into a new session when /clear lands while a compaction is running', ACT_AT_150K, async ($, on) => {
  const world = install($, on)
  const release: { done: () => void } = { done: () => undefined }
  world.compact = () =>
    new Promise(resolve => {
      release.done = () => resolve(compacted(60_000))
    })
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  await $.session.end({ reason: 'clear', sessionId: 'old-session', resume: { id: 'old-session' } })
  release.done()
  await world.clock.settle()
  world.compact = async () => compacted(60_000)
  await runStep($, world, { usage: usageOf(1_000, 0, 47_000) })
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ action: 'compacted' })
  expect(lastRecord(world).trigger_values).not.toHaveProperty('floor_tokens')
})
