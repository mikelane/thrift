import { describe, expect, test } from 'claude-code/testing'

import {
  MINUTE,
  breakdownOf,
  category,
  install,
  measure,
  mountPane,
  resetsIn,
  runMeter,
  startSession,
  textsOf,
  usageOf,
} from './meter-world'

const opened = async ($: Parameters<typeof install>[0], on: Parameters<typeof install>[1]) => {
  const world = install($, on)
  await startSession($)
  await runMeter($)
  world.usageCalls.length = 0
  return world
}

describe('openMeter', () => {
  test('It opens the pane and takes one plain reading and one summary breakdown on /meter', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await runMeter($)
    expect(world.opens).toEqual([{ id: 'meter' }])
    expect(world.usageCalls).toEqual(['plain', 'summary'])
  })

  test('It draws TOP CONTEXT, the cache line and compacts at from the summary breakdown', async ($, on) => {
    install($, on)
    await startSession($)
    await runMeter($)
    const texts = (await textsOf(await mountPane($))).join('\n')
    expect(texts).toContain('TOP CONTEXT')
    expect(texts).toContain('Messages')
    expect(texts).toContain('compacts 167k · cache 96%')
  })

  test('It takes the full count in place of the summary when /meter refresh opens a closed pane', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await runMeter($, 'refresh')
    expect(world.opens).toEqual([{ id: 'meter' }])
    expect(world.usageCalls).toEqual(['plain', 'full'])
  })

  test('It writes nothing to the debug log when the pane waits undrawn on a narrow terminal', async ($, on) => {
    const world = install($, on)
    world.isPlacedOnOpen = false
    await startSession($)
    await runMeter($)
    expect(world.debugLines).toEqual([])
  })
})

describe('runMeterCommand with a listed but unplaced pane', () => {
  const listUnplaced = async ($: Parameters<typeof install>[0], on: Parameters<typeof install>[1]) => {
    const world = install($, on)
    await startSession($)
    world.panes = [{ id: 'meter', title: 'meter', isShown: true, isFocused: false, isPlaced: false }]
    return world
  }

  test('It opens the pane and replies Meter opened. on /meter', async ($, on) => {
    const world = await listUnplaced($, on)
    expect(await runMeter($)).toEqual({ text: 'Meter opened.' })
    expect(world.opens).toEqual([{ id: 'meter' }])
    expect(world.closes).toEqual([])
  })

  test('It takes the full count and replies Meter opened. on /meter refresh', async ($, on) => {
    const world = await listUnplaced($, on)
    expect(await runMeter($, 'refresh')).toEqual({ text: 'Meter opened.' })
    expect(world.opens).toEqual([{ id: 'meter' }])
    expect(world.closes).toEqual([])
    expect(world.usageCalls).toEqual(['plain', 'full'])
  })

  test('It closes the pane on the next /meter once the open placed it', async ($, on) => {
    const world = await listUnplaced($, on)
    await runMeter($)
    expect(await runMeter($)).toEqual({ text: 'Meter closed.' })
    expect(world.closes).toEqual(['meter'])
  })
})

describe('runMeterCommand after meterAutoOpen left the pane unplaced', () => {
  // #135: the unasked open at session start waits undrawn on a narrow terminal; the person's /meter is asked, so it places.
  const autoOpenedUnplaced = async ($: Parameters<typeof install>[0], on: Parameters<typeof install>[1]) => {
    const world = install($, on)
    world.isPlacedOnOpen = false
    await startSession($)
    await world.clock.settle()
    world.isPlacedOnOpen = true
    return world
  }

  test('It replies Meter opened. on the first /meter', { options: { meterAutoOpen: true } }, async ($, on) => {
    await autoOpenedUnplaced($, on)
    expect(await runMeter($)).toEqual({ text: 'Meter opened.' })
  })

  test('It opens the pane again and closes nothing on the first /meter', { options: { meterAutoOpen: true } }, async ($, on) => {
    const world = await autoOpenedUnplaced($, on)
    await runMeter($)
    expect(world.opens).toEqual([{ id: 'meter' }, { id: 'meter' }])
    expect(world.closes).toEqual([])
  })

  test('It takes a summary reading after the auto-open reading on the first /meter', { options: { meterAutoOpen: true } }, async ($, on) => {
    const world = await autoOpenedUnplaced($, on)
    await runMeter($)
    expect(world.usageCalls).toEqual(['plain', 'summary', 'plain', 'summary'])
  })

  test('It closes the pane on the second /meter', { options: { meterAutoOpen: true } }, async ($, on) => {
    const world = await autoOpenedUnplaced($, on)
    await runMeter($)
    expect(await runMeter($)).toEqual({ text: 'Meter closed.' })
    expect(world.closes).toEqual(['meter'])
  })
})

describe('runMeterCommand when the asked open still answers isPlaced false', () => {
  // UiOpenResult: an asked open is still unplaced where no surface places panes, or none is attached
  // (reason `no-surface`). /meter must stay a toggle there, as it was before #135.
  const stayUnplaced = async ($: Parameters<typeof install>[0], on: Parameters<typeof install>[1]) => {
    const world = install($, on)
    world.isPlacedOnOpen = false
    await startSession($)
    return world
  }

  test('It closes the pane on a second /meter when the open left it unplaced', async ($, on) => {
    const world = await stayUnplaced($, on)
    await runMeter($)
    await runMeter($)
    expect(world.closes).toEqual(['meter'])
  })

  test('It replies Meter closed. on a second /meter while the pane stays unplaced', async ($, on) => {
    await stayUnplaced($, on)
    await runMeter($)
    expect(await runMeter($)).toEqual({ text: 'Meter closed.' })
  })

  test('It loads no reading for a pane it is about to close', async ($, on) => {
    const world = await stayUnplaced($, on)
    await runMeter($)
    world.usageCalls.length = 0
    await runMeter($)
    expect(world.usageCalls).toEqual([])
  })

  test('It keeps a never-listed pane open and says why nothing shows it', async ($, on) => {
    const world = await stayUnplaced($, on)
    expect(await runMeter($)).toEqual({ text: 'Meter opened, but nothing here can show it yet (no-surface).' })
    expect(world.closes).toEqual([])
  })

  test('It loads the reading for a never-listed pane that stays unplaced', async ($, on) => {
    const world = await stayUnplaced($, on)
    await runMeter($)
    expect(world.usageCalls).toEqual(['plain', 'summary'])
  })

  test('It closes a listed unplaced pane on /meter refresh when the open leaves it unplaced', async ($, on) => {
    const world = await stayUnplaced($, on)
    await runMeter($)
    world.usageCalls.length = 0
    expect(await runMeter($, 'refresh')).toEqual({ text: 'Meter closed.' })
    expect(world.closes).toEqual(['meter'])
    expect(world.usageCalls).toEqual([])
  })
})

describe('runMeterCommand with a listed and placed pane', () => {
  test('It refreshes the pane and replies Meter refreshed. on /meter refresh', async ($, on) => {
    const world = await opened($, on)
    expect(await runMeter($, 'refresh')).toEqual({ text: 'Meter refreshed.' })
    expect(world.usageCalls).toEqual(['full'])
  })
})

describe('closeMeter', () => {
  test('It closes a listed and placed pane on /meter', async ($, on) => {
    const world = await opened($, on)
    await runMeter($)
    expect(world.closes).toEqual(['meter'])
  })

  test('It replies Meter closed. for a listed and placed pane', async ($, on) => {
    await opened($, on)
    expect(await runMeter($)).toEqual({ text: 'Meter closed.' })
  })

  test('It takes no reading on a second /meter', async ($, on) => {
    const world = await opened($, on)
    await runMeter($)
    expect(world.usageCalls).toEqual([])
  })

  test('It opens the pane again on a third /meter', async ($, on) => {
    const world = await opened($, on)
    await runMeter($)
    await runMeter($)
    expect(world.opens).toHaveLength(2)
  })
})

describe('recordMeasure', () => {
  test('It redraws the 5-HOUR row from the event without calling session.usage', async ($, on) => {
    const world = await opened($, on)
    const pane = await mountPane($)
    await measure($, usageOf(142000, [{ kind: 'five_hour', percentUsed: 52, resetsAt: resetsIn(114) }]), ['rateLimits'])
    expect((await pane.find({ type: 'Text', text: /5-HOUR/ }))?.text).toContain('52%')
    expect(world.usageCalls).toEqual([])
  })

  test('It redraws the COST row from the event', async ($, on) => {
    await opened($, on)
    const pane = await mountPane($)
    await measure($, usageOf(142000, [], 4.82), ['cost'])
    expect((await textsOf(pane)).join('\n')).toContain('$4.82 at API rates')
  })

  test('It takes no breakdown for a rateLimits change however old the last breakdown is', async ($, on) => {
    const world = await opened($, on)
    await world.clock.advance(5 * MINUTE)
    await measure($, usageOf(142000), ['rateLimits'])
    expect(world.usageCalls).toEqual([])
  })

  test('It does nothing while the pane is closed', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await measure($, usageOf(142000), ['context', 'rateLimits'])
    expect(world.usageCalls).toEqual([])
  })

  test('It throttles the summary breakdown 30 seconds after the last one', async ($, on) => {
    const world = await opened($, on)
    await world.clock.advance(30_000)
    await measure($, usageOf(150000), ['context'])
    expect(world.usageCalls).toEqual([])
    expect(await textsOf(await mountPane($))).toContain('· 30s ago')
  })

  test('It still redraws the CONTEXT row from the event while the breakdown is throttled', async ($, on) => {
    const world = await opened($, on)
    await world.clock.advance(30_000)
    await measure($, usageOf(150000), ['context'])
    expect((await (await mountPane($)).find({ type: 'Text', text: /CONTEXT/ }))?.text).toContain('150k / 200k')
  })

  test('It takes a summary breakdown 60 seconds after the last one', async ($, on) => {
    const world = await opened($, on)
    await world.clock.advance(60_000)
    await measure($, usageOf(150000), ['context'])
    expect(world.usageCalls).toEqual(['summary'])
  })

  test('It draws the new breakdown and a 0s ago header 61 seconds after the last one', async ($, on) => {
    const world = await opened($, on)
    await world.clock.advance(61_000)
    world.breakdown = breakdownOf({ categories: [category('Messages', 95000)] })
    await measure($, usageOf(150000), ['context'])
    const texts = await textsOf(await mountPane($))
    expect(world.usageCalls).toEqual(['summary'])
    expect(texts.some(text => /Messages +95k/.test(text))).toBe(true)
    expect(texts).toContain('· 0s ago')
  })
})

describe('refreshMeter', () => {
  test('It takes a full count when the refresh Button is pressed', async ($, on) => {
    const world = await opened($, on)
    const pane = await mountPane($)
    world.breakdown = breakdownOf({ categories: [category('Messages', 77000)] })
    await $.ui.press({ plugin: 'meter', key: 'refresh' })
    expect(world.usageCalls).toEqual(['full'])
    expect((await textsOf(pane)).some(text => /Messages +77k/.test(text))).toBe(true)
  })

  test('It takes a full count on /meter refresh while the pane is open', async ($, on) => {
    const world = await opened($, on)
    await runMeter($, 'refresh')
    expect(world.usageCalls).toEqual(['full'])
    expect(world.closes).toEqual([])
  })

  test('It takes the full count even when the last breakdown is a second old', async ($, on) => {
    const world = await opened($, on)
    await world.clock.advance(1000)
    await runMeter($, 'refresh')
    expect(world.usageCalls).toEqual(['full'])
  })
})

describe('loadBreakdown', () => {
  test('It logs a failed summary breakdown, keeps the figures and marks the header stale', async ($, on) => {
    const world = await opened($, on)
    await world.clock.advance(61_000)
    world.isBreakdownFailing = true
    await measure($, usageOf(150000), ['context'])
    const texts = await textsOf(await mountPane($))
    expect(world.debugLines).toHaveLength(1)
    expect(world.debugLines[0]).toStartWith('meter: could not take the summary breakdown:')
    expect(world.debugLines[0]).toContain('count refused')
    expect(texts).toContain('⚠ stale')
    expect(texts.some(text => /Messages +88k/.test(text))).toBe(true)
  })

  test('It logs a failed full count and marks the header stale', async ($, on) => {
    const world = await opened($, on)
    world.isBreakdownFailing = true
    await runMeter($, 'refresh')
    expect(world.debugLines).toHaveLength(1)
    expect(world.debugLines[0]).toStartWith('meter: could not take the full breakdown:')
    expect(world.debugLines[0]).toContain('count refused')
    expect(await textsOf(await mountPane($))).toContain('⚠ stale')
  })

  test('It clears the stale marker on the next successful breakdown', async ($, on) => {
    const world = await opened($, on)
    await world.clock.advance(61_000)
    world.isBreakdownFailing = true
    await measure($, usageOf(150000), ['context'])
    world.isBreakdownFailing = false
    await world.clock.advance(61_000)
    await measure($, usageOf(150000), ['context'])
    expect((await textsOf(await mountPane($))).join('\n')).not.toContain('stale')
  })

  test('It keeps the marker through a successful headline redraw', async ($, on) => {
    const world = await opened($, on)
    await world.clock.advance(61_000)
    world.isBreakdownFailing = true
    await measure($, usageOf(150000), ['context'])
    await measure($, usageOf(151000), ['cost'])
    expect(await textsOf(await mountPane($))).toContain('⚠ stale')
  })

  test('It never lets a failed reading break the event', async ($, on) => {
    const world = await opened($, on)
    await world.clock.advance(61_000)
    world.isBreakdownFailing = true
    expect(await measure($, usageOf(150000), ['context'])).toEqual({ changed: ['context'] })
  })
})

describe('loadHeadline', () => {
  test('It logs a failed plain reading on open and marks the header stale', async ($, on) => {
    const world = install($, on)
    world.isPlainFailing = true
    world.isBreakdownFailing = true
    await startSession($)
    await runMeter($)
    expect(world.debugLines[0]).toStartWith('meter: could not read usage:')
    expect(world.debugLines[0]).toContain('plain reading refused')
    expect(await textsOf(await mountPane($))).toContain('⚠ stale')
  })
})
