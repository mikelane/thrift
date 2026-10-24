import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, SessionContextBreakdown, SessionUsage, UiPane } from 'claude-code'

import { START, breakdownOf, category, install, measure, mountPane, runMeter, startSession, textsOf, usageOf } from './meter-world'

// Adversarial QA (Gate 3, run 3): the generation guard across clears.

type Gate = { open: () => void; wait: Promise<void> }
const gate = (): Gate => {
  let open: () => void = () => {}
  const wait = new Promise<void>(resolve => {
    open = resolve
  })
  return { open: () => open(), wait }
}

// Every call reads the world as it stands when it starts; a call whose kind has a gate set waits for it.
const gatedWorld = (on: On) => {
  const clock = mock.clock(on, { now: START })
  const calls: string[] = []
  const gates: Partial<Record<'plain' | 'summary' | 'full', Gate>> = {}
  const registered: string[] = []
  let panes: UiPane[] = []
  const world = { usage: usageOf(142000, [], 4.82) as SessionUsage, breakdown: breakdownOf() as SessionContextBreakdown }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: panes }))
  on('ui.open', (_$, e) => {
    panes = [{ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true }]
    return { value: { isPlaced: true as const } }
  })
  on('session.usage', async (_$, e) => {
    const kind = e.breakdown ?? 'plain'
    calls.push(kind)
    const usage = world.usage
    const breakdown = world.breakdown
    const held = gates[kind]
    if (held) await held.wait
    if (kind === 'plain') return { value: usage }
    return { value: { ...usage, context: { ...usage.context, breakdown } } }
  })
  return { clock, calls, gates, registered, world }
}

const clear = (sessionId: string) =>
  ({ reason: 'clear', sessionId, resume: { id: sessionId } }) as const

describe('reloadOpenMeter: a full count and a summary both in flight across a clear', () => {
  test('It draws only the post-clear breakdown when both pre-clear counts land after the clear', async ($, on) => {
    const w = gatedWorld(on)
    await startSession($)
    await runMeter($)
    await w.clock.advance(61_000)
    const summary = gate()
    const full = gate()
    w.gates.summary = summary
    w.gates.full = full
    const measuring = measure($, usageOf(150000), ['context'])
    await w.clock.advance(0)
    const refreshing = runMeter($, 'refresh')
    await w.clock.advance(0)
    delete w.gates.summary
    delete w.gates.full
    w.world.breakdown = breakdownOf({ categories: [category('System prompt', 3000)] })
    w.world.usage = usageOf(1000)
    await $.session.end(clear('s1'))
    await w.clock.settle()
    summary.open()
    full.open()
    await measuring
    await refreshing
    const texts = await textsOf(await mountPane($))
    expect(w.calls).toEqual(['plain', 'summary', 'summary', 'full', 'plain', 'summary'])
    expect(texts.some(text => /Messages +88k/.test(text))).toBe(false)
    expect(texts.some(text => /System prompt +3k/.test(text))).toBe(true)
    expect(texts.join('\n')).not.toContain('$4.82')
  })

  test('It draws only the post-clear breakdown when a pre-clear summary from a measure lands after the clear', async (
    $,
    on,
  ) => {
    const w = gatedWorld(on)
    await startSession($)
    await runMeter($)
    await w.clock.advance(61_000)
    const summary = gate()
    w.gates.summary = summary
    const measuring = measure($, usageOf(150000), ['context'])
    await w.clock.advance(0)
    w.world.breakdown = breakdownOf({ categories: [category('System prompt', 3000)] })
    delete w.gates.summary
    await $.session.end(clear('s1'))
    await w.clock.settle()
    summary.open()
    await measuring
    const texts = await textsOf(await mountPane($))
    expect(w.calls.filter(call => call === 'summary')).toHaveLength(3)
    expect(texts.some(text => /Messages +88k/.test(text))).toBe(false)
    expect(texts.some(text => /System prompt +3k/.test(text))).toBe(true)
  })
})

describe('reloadOpenMeter: two clears in a row', () => {
  test('It draws the second post-clear reading when the first reload is still in flight at the second clear', async (
    $,
    on,
  ) => {
    const w = gatedWorld(on)
    await startSession($)
    await runMeter($)
    const firstReload = gate()
    w.gates.summary = firstReload
    w.world.breakdown = breakdownOf({ categories: [category('Skills', 5000)] })
    await $.session.end(clear('s1'))
    await w.clock.settle()
    delete w.gates.summary
    w.world.breakdown = breakdownOf({ categories: [category('System prompt', 3000)] })
    await $.session.end(clear('s2'))
    await w.clock.settle()
    firstReload.open()
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
