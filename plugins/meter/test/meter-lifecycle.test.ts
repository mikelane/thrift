import { describe, expect, test } from 'claude-code/testing'

import { install, mountPane, resetsIn, runMeter, startSession, textsOf, usageOf, breakdownOf, tool } from './meter-world'

describe('registerMeterCommand', () => {
  test('It registers /meter when an interactive session starts', async ($, on) => {
    const world = install($, on)
    await startSession($)
    expect(world.registered).toEqual(['meter'])
  })

  test('It registers nothing and opens nothing in a non-interactive run with meterAutoOpen on', async ($, on) => {
    const world = install($, on)
    await startSession($, false)
    expect(world.registered).toEqual([])
    expect(world.opens).toEqual([])
  })

  test('It registers /meter again inside a later tick after a clear', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    expect(world.registered).toEqual(['meter'])
    await world.clock.settle()
    expect(world.registered).toEqual(['meter', 'meter'])
  })

  test('It registers nothing again after a session end that is not a clear', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
    await world.clock.settle()
    expect(world.registered).toEqual(['meter'])
  })

  test('It writes to the debug log when registering /meter is refused', async ($, on) => {
    const world = install($, on)
    world.isRegisterFailing = true
    await startSession($)
    expect(world.debugLines).toHaveLength(1)
    expect(world.debugLines[0]).toStartWith('meter: could not register /meter:')
    expect(world.debugLines[0]).toContain('register refused')
  })
})

describe('autoOpen', () => {
  test('It opens the pane at session start when meterAutoOpen is on', { options: { meterAutoOpen: true } }, async ($, on) => {
    const world = install($, on)
    await startSession($)
    await world.clock.settle()
    expect(world.opens).toEqual([{ id: 'meter' }])
    expect(world.usageCalls).toEqual(['plain', 'summary'])
  })

  test('It leaves the pane closed at session start by default', async ($, on) => {
    const world = install($, on)
    await startSession($)
    expect(world.opens).toEqual([])
  })

  test(
    'It opens nothing when meterAutoOpen is on in a non-interactive run',
    { options: { meterAutoOpen: true } },
    async ($, on) => {
      const world = install($, on)
      await startSession($, false)
      expect(world.opens).toEqual([])
    },
  )
})

describe('glyph sets', () => {
  const rich = async ($: Parameters<typeof install>[0], on: Parameters<typeof install>[1]) => {
    const world = install($, on)
    world.usage = usageOf(
      142000,
      [
        { kind: 'five_hour', percentUsed: 100, resetsAt: resetsIn(40) },
        { kind: 'seven_day', percentUsed: 30, resetsAt: resetsIn(3 * 24 * 60) },
      ],
      4.82,
    )
    world.breakdown = breakdownOf({ mcpTools: [tool('github', 3000)] })
    await startSession($)
    await runMeter($)
    return world
  }

  test('It draws the unicode set by default', async ($, on) => {
    await rich($, on)
    const texts = await textsOf(await mountPane($))
    expect(texts.some(text => text.startsWith('◔ CONTEXT'))).toBe(true)
    expect(texts.some(text => text.startsWith('◷ 5-HOUR'))).toBe(true)
  })

  test('It draws the unicode set when meterGlyphs holds a value outside its options', { options: { meterGlyphs: 'emoji' } }, async ($, on) => {
    await rich($, on)
    expect((await textsOf(await mountPane($))).some(text => text.startsWith('◔ CONTEXT'))).toBe(true)
  })

  test('It draws the Nerd Font glyph in every slot', { options: { meterGlyphs: 'nerd' } }, async ($, on) => {
    const world = await rich($, on)
    await world.clock.advance(61_000)
    world.isBreakdownFailing = true
    await $.session.measure({ context: world.usage.context, rateLimits: world.usage.rateLimits, cost: world.usage.cost, changed: ['context'] })
    const pane = await mountPane($)
    const texts = await textsOf(pane)
    expect(texts.some(text => text.startsWith('\u{F1C0} CONTEXT'))).toBe(true)
    expect(texts.some(text => text.startsWith('\u{F05E} limit reached'))).toBe(true)
    expect(texts.some(text => text.startsWith('\u{F073} WEEKLY'))).toBe(true)
    expect(texts.some(text => text.startsWith('\u{F155} COST'))).toBe(true)
    expect(texts.some(text => text.startsWith('\u{F1E6} mcp servers:'))).toBe(true)
    expect(texts).toContain('\u{F071} stale')
    expect((await pane.find({ type: 'Button', key: 'refresh' }))?.props.label).toBe('\u{F021} refresh (r)')
  })
})

describe('runMeterCommand', () => {
  test('It answers with the usage and touches nothing for an unknown argument', async ($, on) => {
    const world = install($, on)
    await startSession($)
    const answer = await runMeter($, 'refesh')
    expect(answer).toEqual({ text: 'Usage: /meter to open or close the pane, /meter refresh to take a full count.' })
    expect(world.opens).toEqual([])
    expect(world.usageCalls).toEqual([])
  })

  const answers = [
    ['refreshes an open pane', 'refresh', 'Meter refreshed.'],
  ] as const

  for (const [name, args, text] of answers) {
    test(`It answers ${text} when /meter ${name}`, async ($, on) => {
      install($, on)
      await startSession($)
      await runMeter($)
      expect(await runMeter($, args)).toEqual({ text })
    })
  }

  test('It answers Meter opened. when /meter opens a closed pane', async ($, on) => {
    install($, on)
    await startSession($)
    expect(await runMeter($)).toEqual({ text: 'Meter opened.' })
  })

  test('It answers Meter closed. when /meter closes an open pane', async ($, on) => {
    install($, on)
    await startSession($)
    await runMeter($)
    expect(await runMeter($)).toEqual({ text: 'Meter closed.' })
  })

  test('It answers that it could not run when the pane cannot open', async ($, on) => {
    const world = install($, on)
    world.isOpenFailing = true
    await startSession($)
    expect(await runMeter($)).toEqual({ text: 'Could not run /meter.' })
  })

  test('It writes to the debug log when /meter cannot run', async ($, on) => {
    const world = install($, on)
    world.isOpenFailing = true
    await startSession($)
    await runMeter($)
    expect(world.debugLines.at(-1)).toStartWith('meter: could not run /meter:')
  })

  test('It accepts surrounding spaces around refresh', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await runMeter($, '  refresh ')
    expect(world.usageCalls).toEqual(['plain', 'full'])
  })

  test('It logs a reply without a breakdown and marks the header stale', async ($, on) => {
    const world = install($, on)
    world.omitsBreakdown = true
    await startSession($)
    await runMeter($)
    expect(world.debugLines[0]).toContain('the reply held no breakdown')
    expect(await textsOf(await mountPane($))).toContain('\u26A0 stale')
  })
})
