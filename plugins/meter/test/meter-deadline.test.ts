import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { breakdownOf, category, install, measure, mountPane, runMeter, startSession, textsOf, usageOf } from './meter-world'

const SECOND = 1000

const summaryCalls = (calls: readonly string[]) => calls.filter(call => call === 'summary')

// A pane mounts once per test, so each test reads it once and checks the text.
const readPane = async ($: Engine) => (await textsOf(await mountPane($))).join('\n')

const tracked = (dispatch: Promise<unknown>) => {
  const state = { isResolved: false }
  void dispatch.then(() => {
    state.isResolved = true
  })
  return state
}

// The pane is open with Messages 88k from a breakdown taken 61 s ago, and the next summary will answer 95k and is held.
const heldSummaryWorld = async ($: Engine, on: On) => {
  const world = install($, on)
  await startSession($)
  await runMeter($)
  await world.clock.advance(61 * SECOND)
  world.breakdown = breakdownOf({ categories: [category('Messages', 95000)] })
  const release = world.hold('summary')
  world.usageCalls.length = 0
  return { world, release }
}

const startHeldSummary = async ($: Engine, on: On) => {
  const held = await heldSummaryWorld($, on)
  const measuring = tracked(measure($, usageOf(150000), ['context']))
  await held.world.clock.settle()
  return { ...held, measuring }
}

describe('takeBreakdown: a held summary and its 30 s deadline', () => {
  test('It still blocks throttled summaries 29 s into a held summary', async ($, on) => {
    const { world } = await startHeldSummary($, on)
    await world.clock.advance(29 * SECOND)
    await measure($, usageOf(151000), ['context'])
    expect(summaryCalls(world.usageCalls)).toHaveLength(1)
  })

  test('It stops blocking throttled summaries once a held summary reaches its 30 s deadline', async ($, on) => {
    const { world } = await startHeldSummary($, on)
    await world.clock.advance(30 * SECOND)
    await measure($, usageOf(151000), ['context'])
    expect(summaryCalls(world.usageCalls)).toHaveLength(2)
  })

  test('It logs a summary that reaches its deadline as a failed summary breakdown', async ($, on) => {
    const { world } = await startHeldSummary($, on)
    await world.clock.advance(30 * SECOND)
    expect(world.debugLines).toEqual(['meter: could not take the summary breakdown: Error: timed out after 30s'])
  })

  test('It marks the TOP CONTEXT header stale and keeps Messages 88k when a summary reaches its deadline', async ($, on) => {
    const { world } = await startHeldSummary($, on)
    await world.clock.advance(30 * SECOND)
    const pane = await readPane($)
    expect(pane).toContain('stale')
    expect(pane).toMatch(/Messages +88k/)
  })

  test('It leaves the session.measure dispatch pending 29 s into a held summary', async ($, on) => {
    const { world, measuring } = await startHeldSummary($, on)
    await world.clock.advance(29 * SECOND)
    expect(measuring.isResolved).toBe(false)
  })

  test('It resolves the session.measure dispatch at the summary deadline', async ($, on) => {
    const { world, measuring } = await startHeldSummary($, on)
    await world.clock.advance(30 * SECOND)
    expect(measuring.isResolved).toBe(true)
  })

  test('It drops a summary that answers after its deadline and keeps the header stale', async ($, on) => {
    const { world, release } = await startHeldSummary($, on)
    await world.clock.advance(30 * SECOND)
    await world.clock.advance(10 * SECOND)
    release()
    await world.clock.settle()
    const pane = await readPane($)
    expect(pane).not.toMatch(/Messages +95k/)
    expect(pane).toMatch(/Messages +88k/)
    expect(pane).toContain('stale')
  })

  test('It does not let a late summary release the count held by a newer summary', async ($, on) => {
    const { world, release } = await startHeldSummary($, on)
    await world.clock.advance(30 * SECOND)
    await world.clock.advance(1 * SECOND)
    world.hold('summary')
    void measure($, usageOf(151000), ['context'])
    await world.clock.settle()
    await world.clock.advance(9 * SECOND)
    release()
    await world.clock.settle()
    await world.clock.advance(1 * SECOND)
    await measure($, usageOf(152000), ['context'])
    expect(summaryCalls(world.usageCalls)).toHaveLength(2)
  })

  test('It logs nothing more when a summary refused after its deadline answers', async ($, on) => {
    const { world, release } = await startHeldSummary($, on)
    await world.clock.advance(30 * SECOND)
    world.isBreakdownFailing = true
    release()
    await world.clock.settle()
    expect(world.debugLines).toHaveLength(1)
  })

  test('It draws a summary that answers before its deadline and never times it out', async ($, on) => {
    const { world, release } = await startHeldSummary($, on)
    await world.clock.advance(5 * SECOND)
    release()
    await world.clock.settle()
    await world.clock.advance(60 * SECOND)
    expect(world.debugLines.filter(line => line.includes('timed out'))).toEqual([])
    const pane = await readPane($)
    expect(pane).not.toContain('stale')
    expect(pane).toMatch(/Messages +95k/)
  })
})

// The pane is open, and the next full count will answer Messages 77k and is held.
const heldFullWorld = async ($: Engine, on: On) => {
  const world = install($, on)
  await startSession($)
  await runMeter($)
  world.breakdown = breakdownOf({ categories: [category('Messages', 77000)] })
  const release = world.hold('full')
  return { world, release }
}

describe('takeBreakdown: a held full count and its 180 s deadline', () => {
  test('It draws a full count from the refresh Button that answers after 31 s', async ($, on) => {
    const { world, release } = await heldFullWorld($, on)
    const pane = await mountPane($)
    void $.ui.press({ plugin: 'meter', key: 'refresh' })
    await world.clock.settle()
    await world.clock.advance(31 * SECOND)
    release()
    await world.clock.settle()
    expect((await textsOf(pane)).join('\n')).toMatch(/Messages +77k/)
    expect(world.debugLines.filter(line => line.includes('timed out'))).toEqual([])
  })

  test('It logs a full count from the refresh Button that reaches 180 s and marks the header stale', async ($, on) => {
    const { world } = await heldFullWorld($, on)
    const pane = await mountPane($)
    void $.ui.press({ plugin: 'meter', key: 'refresh' })
    await world.clock.settle()
    await world.clock.advance(180 * SECOND)
    expect(world.debugLines).toEqual(['meter: could not take the full breakdown: Error: timed out after 180s'])
    expect((await textsOf(pane)).join('\n')).toContain('stale')
  })

  test('It keeps waiting on a full count 179 s in', async ($, on) => {
    const { world } = await heldFullWorld($, on)
    const refreshing = tracked(runMeter($, 'refresh'))
    await world.clock.settle()
    await world.clock.advance(179 * SECOND)
    expect(refreshing.isResolved).toBe(false)
    expect(world.debugLines).toEqual([])
  })

  test('It replies Meter refreshed. to /meter refresh once its full count reaches 180 s', async ($, on) => {
    const { world } = await heldFullWorld($, on)
    const refreshing = runMeter($, 'refresh')
    await world.clock.settle()
    await world.clock.advance(180 * SECOND)
    expect(await refreshing).toEqual({ text: 'Meter refreshed.' })
  })
})

const clear = (sessionId: string) => ({ reason: 'clear', sessionId, resume: { id: sessionId } }) as const

// The pane is closed, and the next plain call will answer cost 9.99 and is held.
const heldPlainOpen = async ($: Engine, on: On) => {
  const world = install($, on)
  await startSession($)
  world.usage = usageOf(142000, [], 9.99)
  const release = world.hold('plain')
  const opening = runMeter($)
  await world.clock.settle()
  return { world, release, opening }
}

describe('loadHeadline: a held plain call and its 30 s deadline', () => {
  test('It logs a plain call during /meter that reaches 30 s as a failed usage read', async ($, on) => {
    const { world } = await heldPlainOpen($, on)
    await world.clock.advance(30 * SECOND)
    expect(world.debugLines).toEqual(['meter: could not read usage: Error: timed out after 30s'])
  })

  test('It goes on to the summary breakdown and replies Meter opened. once the plain call reaches 30 s', async ($, on) => {
    const { world, opening } = await heldPlainOpen($, on)
    await world.clock.advance(30 * SECOND)
    expect(await opening).toEqual({ text: 'Meter opened.' })
    expect(world.usageCalls).toEqual(['plain', 'summary'])
  })

  test('It is still waiting on the plain call 29 s into /meter', async ($, on) => {
    const { world } = await heldPlainOpen($, on)
    await world.clock.advance(29 * SECOND)
    expect(world.usageCalls).toEqual(['plain'])
  })

  test('It draws no cost from a plain call that answers after its deadline', async ($, on) => {
    const { world, release } = await heldPlainOpen($, on)
    await world.clock.advance(30 * SECOND)
    await world.clock.advance(10 * SECOND)
    release()
    await world.clock.settle()
    expect(await readPane($)).not.toContain('$9.99')
  })
})

describe('reloadOpenMeter: deadlines across a clear', () => {
  test('It logs a reload summary that reaches 30 s after a clear and marks the header stale', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await runMeter($)
    world.hold('summary')
    await $.session.end(clear('s1'))
    await world.clock.settle()
    await world.clock.advance(30 * SECOND)
    expect(world.debugLines).toEqual(['meter: could not take the summary breakdown: Error: timed out after 30s'])
    expect(await readPane($)).toContain('stale')
  })

  test('It leaves the new session unmarked when a pre-clear summary reaches its deadline after the clear', async ($, on) => {
    const { world } = await startHeldSummary($, on)
    await world.clock.advance(10 * SECOND)
    await $.session.end(clear('s1'))
    await world.clock.settle()
    await world.clock.advance(20 * SECOND)
    expect(world.debugLines).toEqual(['meter: could not take the summary breakdown: Error: timed out after 30s'])
    expect(await readPane($)).not.toContain('stale')
  })
})
