import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { breakdownOf, category, install, measure, mountPane, runMeter, startSession, textsOf, usageOf } from './meter-world'

// Adversarial QA (Gate 3, run 3): the generation guard across clears.

const installWithCost = ($: Engine, on: On) => {
  const world = install($, on)
  world.usage = usageOf(142000, [], 4.82)
  return world
}

const clear = (sessionId: string) =>
  ({ reason: 'clear', sessionId, resume: { id: sessionId } }) as const

describe('reloadOpenMeter: a full count and a summary both in flight across a clear', () => {
  test('It draws only the post-clear breakdown when both pre-clear counts land after the clear', async ($, on) => {
    const w = installWithCost($, on)
    await startSession($)
    await runMeter($)
    await w.clock.advance(61_000)
    const releaseSummary = w.hold('summary')
    const releaseFull = w.hold('full')
    const measuring = measure($, usageOf(150000), ['context'])
    await w.clock.advance(0)
    const refreshing = runMeter($, 'refresh')
    await w.clock.advance(0)
    w.breakdown = breakdownOf({ categories: [category('System prompt', 3000)] })
    w.usage = usageOf(1000)
    await $.session.end(clear('s1'))
    await w.clock.settle()
    releaseSummary()
    releaseFull()
    await measuring
    await refreshing
    const texts = await textsOf(await mountPane($))
    expect(w.usageCalls).toEqual(['plain', 'summary', 'summary', 'full', 'plain', 'summary'])
    expect(texts.some(text => /Messages +88k/.test(text))).toBe(false)
    expect(texts.some(text => /System prompt +3k/.test(text))).toBe(true)
    expect(texts.join('\n')).not.toContain('$4.82')
  })

  test('It draws only the post-clear breakdown when a pre-clear summary from a measure lands after the clear', async (
    $,
    on,
  ) => {
    const w = installWithCost($, on)
    await startSession($)
    await runMeter($)
    await w.clock.advance(61_000)
    const releaseSummary = w.hold('summary')
    const measuring = measure($, usageOf(150000), ['context'])
    await w.clock.advance(0)
    w.breakdown = breakdownOf({ categories: [category('System prompt', 3000)] })
    await $.session.end(clear('s1'))
    await w.clock.settle()
    releaseSummary()
    await measuring
    const texts = await textsOf(await mountPane($))
    expect(w.usageCalls.filter(call => call === 'summary')).toHaveLength(3)
    expect(texts.some(text => /Messages +88k/.test(text))).toBe(false)
    expect(texts.some(text => /System prompt +3k/.test(text))).toBe(true)
  })
})

describe('reloadOpenMeter: two clears in a row', () => {
  test('It draws the second post-clear reading when the first reload is still in flight at the second clear', async (
    $,
    on,
  ) => {
    const w = installWithCost($, on)
    await startSession($)
    await runMeter($)
    const releaseFirstReload = w.hold('summary')
    w.breakdown = breakdownOf({ categories: [category('Skills', 5000)] })
    await $.session.end(clear('s1'))
    await w.clock.settle()
    w.breakdown = breakdownOf({ categories: [category('System prompt', 3000)] })
    await $.session.end(clear('s2'))
    await w.clock.settle()
    releaseFirstReload()
    await w.clock.settle()
    const texts = await textsOf(await mountPane($))
    expect(texts.some(text => /Skills +5k/.test(text))).toBe(false)
    expect(texts.some(text => /System prompt +3k/.test(text))).toBe(true)
    expect(w.registered).toEqual(['meter', 'meter', 'meter'])
  })

  test('It still takes throttled summaries after two clears in a row', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await runMeter($)
    await $.session.end(clear('s1'))
    await $.session.end(clear('s2'))
    await world.clock.settle()
    world.usageCalls.length = 0
    await world.clock.advance(61_000)
    await measure($, usageOf(150000), ['context'])
    expect(world.usageCalls).toEqual(['summary'])
  })
})

describe('reloadOpenMeter: run-1 fixes still hold after a clear', () => {
  test('It takes one summary for two simultaneous context measures after a clear', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await runMeter($)
    await $.session.end(clear('s1'))
    await world.clock.settle()
    world.usageCalls.length = 0
    await world.clock.advance(61_000)
    await Promise.all([measure($, usageOf(150000), ['context']), measure($, usageOf(151000), ['context'])])
    expect(world.usageCalls).toEqual(['summary'])
  })

  test('It marks the header stale when a post-clear summary fails', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await runMeter($)
    world.isBreakdownFailing = true
    await $.session.end(clear('s1'))
    await world.clock.settle()
    expect(await textsOf(await mountPane($))).toContain('⚠ stale')
  })
})
