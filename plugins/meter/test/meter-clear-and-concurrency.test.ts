import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionContextBreakdown, UiPane } from 'claude-code'

import { START, breakdownOf, category, install, measure, mountPane, runMeter, startSession, textsOf, usageOf } from './meter-world'

// Spec behaviour from issue #119 around /clear, non-interactive runs and overlapping breakdown counts.

describe('non-interactive runs', () => {
  test('It registers no command after a clear in a non-interactive run', async ($, on) => {
    const world = install($, on)
    await startSession($, false)
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    await world.clock.settle()
    expect(world.registered).toEqual([])
  })
})

describe('/clear restarts the COST row', () => {
  test('It no longer draws the pre-clear cost after a clear', async ($, on) => {
    const world = install($, on)
    world.usage = usageOf(142000, [], 4.82)
    await startSession($)
    await runMeter($)
    world.usage = usageOf(0)
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    await world.clock.settle()
    expect((await textsOf(await mountPane($))).join('\n')).not.toContain('$4.82')
  })

  test('It no longer draws the pre-clear TOP CONTEXT rows after a clear', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await runMeter($)
    world.breakdown = breakdownOf({ categories: [category('System prompt', 3000)] })
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    await world.clock.settle()
    expect((await textsOf(await mountPane($))).some(text => /Messages +88k/.test(text))).toBe(false)
  })
})

describe('a pane left open across a clear', () => {
  test('It takes a fresh plain and summary reading in the tick after a clear', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await runMeter($)
    world.usageCalls.length = 0
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    await world.clock.settle()
    expect(world.usageCalls).toEqual(['plain', 'summary'])
  })

  test('It takes no reading after a clear when the pane is closed', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    await world.clock.settle()
    expect(world.usageCalls).toEqual([])
  })
})

describe('concurrent measures', () => {
  test('It takes one summary breakdown for two context measures that arrive together', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await runMeter($)
    world.usageCalls.length = 0
    await world.clock.advance(61_000)
    await Promise.all([measure($, usageOf(150000), ['context']), measure($, usageOf(151000), ['context'])])
    expect(world.usageCalls).toEqual(['summary'])
  })
})

describe('/meter refresh while closed never takes a summary', () => {
  test('It takes no summary breakdown when a context measure lands while the opening full count is in flight', async (
    $,
    on,
  ) => {
    const clock = mock.clock(on, { now: START })
    const calls: string[] = []
    let panes: UiPane[] = []
    let releaseFull: () => void = () => {}
    const fullGate = new Promise<void>(resolve => {
      releaseFull = resolve
    })
    const usage = usageOf(142000)
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('ui.log', () => ({ value: undefined }))
    on('ui.panes', () => ({ value: panes }))
    on('ui.open', (_$, e) => {
      panes = [{ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true }]
      return { value: { isPlaced: true as const } }
    })
    // Holds the full count open until the test releases it, as the token-count API would.
    on('session.usage', async (_$, e) => {
      calls.push(e.breakdown ?? 'plain')
      if (e.breakdown === undefined) return { value: usage }
      if (e.breakdown === 'full') await fullGate
      return { value: { ...usage, context: { ...usage.context, breakdown: breakdownOf() } } }
    })
    await startSession($)
    const running = runMeter($, 'refresh')
    await clock.advance(0)
    await measure($, usageOf(150000), ['context'])
    releaseFull()
    await running
    expect(calls).not.toContain('summary')
  })
})

// A clear racing an in-flight full count, and the in-flight counter returning to zero.

type Gated = { calls: string[]; release: () => void; clock: ReturnType<typeof mock.clock>; setBreakdown: (b: SessionContextBreakdown) => void }

// A world whose full count waits for the test, and whose breakdown is read when the call starts (as the engine measures it).
const gatedWorld = ($: Engine, on: On): Gated => {
  const clock = mock.clock(on, { now: START })
  const calls: string[] = []
  let panes: UiPane[] = []
  let current = breakdownOf()
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const usage = usageOf(142000)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: panes }))
  on('ui.open', (_$, e) => {
    panes = [{ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true }]
    return { value: { isPlaced: true as const } }
  })
  on('session.usage', async (_$, e) => {
    calls.push(e.breakdown ?? 'plain')
    if (e.breakdown === undefined) return { value: usage }
    const taken = current
    if (e.breakdown === 'full') await gate
    return { value: { ...usage, context: { ...usage.context, breakdown: taken } } }
  })
  void $
  return { calls, release: () => release(), clock, setBreakdown: b => (current = b) }
}

describe('a plain reading racing a clear', () => {
  test('It never draws the pre-clear cost when a plain reading started before the clear lands after it', async ($, on) => {
    const clock = mock.clock(on, { now: START })
    let panes: UiPane[] = []
    let releaseOld: () => void = () => {}
    const oldGate = new Promise<void>(resolve => {
      releaseOld = resolve
    })
    const answers = [oldGate.then(() => usageOf(142000, [], 4.82)), Promise.resolve(usageOf(0))]
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('ui.log', () => ({ value: undefined }))
    on('ui.panes', () => ({ value: panes }))
    on('ui.open', (_$, e) => {
      panes = [{ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true }]
      return { value: { isPlaced: true as const } }
    })
    on('session.usage', async () => {
      const usage = await answers.shift()!
      return { value: { ...usage, context: { ...usage.context, breakdown: breakdownOf() } } }
    })
    await startSession($)
    const opening = runMeter($)
    await clock.advance(0)
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    await clock.settle()
    releaseOld()
    await opening
    expect((await textsOf(await mountPane($))).join('\n')).not.toContain('$4.82')
  })
})

describe('a clear racing an in-flight full count', () => {
  test('It never draws the pre-clear breakdown when a full count started before the clear lands after it', async (
    $,
    on,
  ) => {
    const world = gatedWorld($, on)
    await startSession($)
    await runMeter($)
    const refreshing = runMeter($, 'refresh')
    await world.clock.advance(0)
    world.setBreakdown(breakdownOf({ categories: [category('System prompt', 3000)] }))
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    await world.clock.settle()
    world.release()
    await refreshing
    expect((await textsOf(await mountPane($))).some(text => /Messages +88k/.test(text))).toBe(false)
  })
})

describe('the in-flight counter returns to zero', () => {
  test('It takes a summary after a refused full count', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await runMeter($)
    world.isBreakdownFailing = true
    await runMeter($, 'refresh')
    world.isBreakdownFailing = false
    world.usageCalls.length = 0
    await world.clock.advance(61_000)
    await measure($, usageOf(150000), ['context'])
    expect(world.usageCalls).toEqual(['summary'])
  })

  test('It takes a summary after an open that the engine refused', async ($, on) => {
    const world = install($, on)
    await startSession($)
    world.isOpenFailing = true
    await runMeter($)
    world.isOpenFailing = false
    await runMeter($)
    world.usageCalls.length = 0
    await world.clock.advance(61_000)
    await measure($, usageOf(150000), ['context'])
    expect(world.usageCalls).toEqual(['summary'])
  })

  test('It takes a summary after a breakdown whose categories are malformed', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await runMeter($)
    world.breakdown = breakdownOf({ categories: undefined as unknown as SessionContextBreakdown['categories'] })
    await runMeter($, 'refresh')
    world.breakdown = breakdownOf()
    world.usageCalls.length = 0
    await world.clock.advance(61_000)
    await measure($, usageOf(150000), ['context'])
    expect(world.usageCalls).toEqual(['summary'])
  })

  test('It takes a summary after a reload on clear whose plain reading was refused', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await runMeter($)
    world.isPlainFailing = true
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    await world.clock.settle()
    world.isPlainFailing = false
    world.usageCalls.length = 0
    await world.clock.advance(61_000)
    await measure($, usageOf(150000), ['context'])
    expect(world.usageCalls).toEqual(['summary'])
  })
})

describe('reload while the pane is closed', () => {
  test('It takes no reading after a clear once the pane was opened and closed again', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await runMeter($)
    await runMeter($)
    world.usageCalls.length = 0
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    await world.clock.settle()
    expect(world.usageCalls).toEqual([])
  })
})
