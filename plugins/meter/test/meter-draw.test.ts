import { describe, expect, test } from 'claude-code/testing'

import {
  breakdownOf,
  category,
  install,
  mountPane,
  resetsIn,
  runMeter,
  startSession,
  textsOf,
  tool,
  usageOf,
} from './meter-world'

const pairs = (texts: string[], pattern: RegExp) => texts.filter(text => pattern.test(text))

describe('drawMeter', () => {
  test('It draws the CONTEXT row yellow against the cached auto-compact threshold', async ($, on) => {
    const world = install($, on)
    world.usage = usageOf(150000)
    world.breakdown = breakdownOf({ autoCompactThreshold: 167000 })
    await startSession($)
    await runMeter($)
    const pane = await mountPane($)
    const row = await pane.find({ type: 'Text', text: /CONTEXT/ })
    expect(row?.props.color).toBe('warning')
    expect(row?.text).toContain('90% of 167k')
    expect(pairs(await textsOf(pane), /compacts at 167k/)).toHaveLength(1)
  })

  test('It colors the CONTEXT row against the window before any breakdown', async ($, on) => {
    const world = install($, on)
    world.usage = usageOf(150000)
    world.isBreakdownFailing = true
    await startSession($)
    await runMeter($)
    const pane = await mountPane($)
    const texts = await textsOf(pane)
    expect((await pane.find({ type: 'Text', text: /CONTEXT/ }))?.props.color).toBe('warning')
    expect(pairs(texts, /compacts at/)).toEqual([])
    expect(pairs(texts, /cache hit/)).toHaveLength(1)
    expect(texts.join('\n')).toContain('cache hit \u2014')
  })

  test('It draws the CONTEXT row red at 105 percent over the window with no breakdown', async ($, on) => {
    const world = install($, on)
    world.usage = usageOf(210000)
    world.isBreakdownFailing = true
    await startSession($)
    await runMeter($)
    const row = await (await mountPane($)).find({ type: 'Text', text: /CONTEXT/ })
    expect(row?.props.color).toBe('error')
    expect(row?.text).toContain('105%')
  })

  test('It draws the cache line from the breakdown', async ($, on) => {
    install($, on)
    await startSession($)
    await runMeter($)
    expect((await (await mountPane($)).find({ type: 'Text', text: /cache hit/ }))?.text).toContain('cache hit 96%')
  })

  test('It draws cache hit with a dash when every count is 0', async ($, on) => {
    const world = install($, on)
    world.breakdown = breakdownOf({
      apiUsage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })
    await startSession($)
    await runMeter($)
    expect((await (await mountPane($)).find({ type: 'Text', text: /cache hit/ }))?.text).toContain('cache hit —')
  })

  test('It waits uncolored for the first response when the context has no tokens', async ($, on) => {
    const world = install($, on)
    world.usage = usageOf(undefined)
    await startSession($)
    await runMeter($)
    const row = await (await mountPane($)).find({ type: 'Text', text: /CONTEXT/ })
    expect(row?.text).toContain('waiting for first response')
    expect(row?.props.color).toBeUndefined()
  })

  test('It leaves out the 5-HOUR and WEEKLY rows and keeps CONTEXT and COST when rateLimits is empty', async ($, on) => {
    const world = install($, on)
    world.usage = usageOf(1000, [], 4.82)
    await startSession($)
    await runMeter($)
    const texts = (await textsOf(await mountPane($))).join('\n')
    expect(texts).not.toContain('5-HOUR')
    expect(texts).not.toContain('WEEKLY')
    expect(texts).toContain('CONTEXT')
    expect(texts).toContain('COST   $4.82')
  })

  test('It leaves out the COST row and any $0.00 when usage carries no cost', async ($, on) => {
    install($, on)
    await startSession($)
    await runMeter($)
    const texts = (await textsOf(await mountPane($))).join('\n')
    expect(texts).not.toContain('COST')
    expect(texts).not.toContain('$0.00')
  })

  test('It draws a green 5-HOUR row with its pace and no projection', async ($, on) => {
    const world = install($, on)
    world.usage = usageOf(1000, [{ kind: 'five_hour', percentUsed: 48, resetsAt: resetsIn(114) }])
    await startSession($)
    await runMeter($)
    const pane = await mountPane($)
    const row = await pane.find({ type: 'Text', text: /5-HOUR/ })
    expect(row?.props.color).toBe('success')
    expect((await pane.find({ type: 'Text', text: /pace 0.77/ }))?.text).not.toContain('hits')
  })

  test('It draws too early with the percent and no color under 5 percent elapsed', async ($, on) => {
    const world = install($, on)
    world.usage = usageOf(1000, [{ kind: 'five_hour', percentUsed: 10, resetsAt: resetsIn(286) }])
    await startSession($)
    await runMeter($)
    const row = await (await mountPane($)).find({ type: 'Text', text: /5-HOUR/ })
    expect(row?.text).toContain('10%')
    expect(row?.text).toContain('too early')
    expect(row?.props.color).toBeUndefined()
  })

  test('It draws a window with no usable reset time with only its percent', async ($, on) => {
    const world = install($, on)
    world.usage = usageOf(1000, [{ kind: 'five_hour', percentUsed: 30, resetsAt: resetsIn(-1) }])
    await startSession($)
    await runMeter($)
    const pane = await mountPane($)
    const row = await pane.find({ type: 'Text', text: /5-HOUR/ })
    expect(row?.text).toBe('◷ 5-HOUR   30%')
    expect(row?.props.color).toBeUndefined()
    expect(pairs(await textsOf(pane), /pace/)).toEqual([])
  })

  test('It draws a red limit reached row at 100 percent with no pace', async ($, on) => {
    const world = install($, on)
    world.usage = usageOf(1000, [{ kind: 'five_hour', percentUsed: 100, resetsAt: resetsIn(40) }])
    await startSession($)
    await runMeter($)
    const pane = await mountPane($)
    const row = await pane.find({ type: 'Text', text: /5-HOUR/ })
    expect(row?.props.color).toBe('error')
    expect(row?.text).toContain('limit reached')
    expect(pairs(await textsOf(pane), /pace|hits/)).toEqual([])
  })

  const spendCases = [
    [99.9, undefined],
    [100, 'error'],
    [104.5, 'error'],
  ] as const

  for (const [used, color] of spendCases) {
    test(`It draws a spend_limit at ${used} percent in ${color ?? 'no color'} with no pace`, async ($, on) => {
      const world = install($, on)
      world.usage = usageOf(1000, [{ kind: 'spend_limit', percentUsed: used, resetsAt: resetsIn(60) }])
      await startSession($)
      await runMeter($)
      const pane = await mountPane($)
      expect((await pane.find({ type: 'Text', text: /SPEND LIMIT/ }))?.props.color).toBe(color)
      expect(pairs(await textsOf(pane), /pace/)).toEqual([])
    })
  }

  test('It lists used categories only, largest first, at most five, with each name as given', async ($, on) => {
    const world = install($, on)
    world.breakdown = breakdownOf({
      categories: [
        category('System prompt', 4000),
        category('Messages', 88000),
        category('Skills', 8000),
        category('Free space', 40000, 'free'),
        category('MCP tools', 21000),
        category('Autocompact buffer', 33000, 'buffer'),
        category('Custom agents', 14000),
        category('Memory files', 6000),
      ],
    })
    await startSession($)
    await runMeter($)
    const rows = (await textsOf(await mountPane($))).filter(text => /^ {2}\S.* \d+k {2}/.test(text))
    expect(rows.map(row => row.trim().replace(/ +\d+k.*$/, ''))).toEqual([
      'Messages',
      'MCP tools',
      'Custom agents',
      'Skills',
      'Memory files',
    ])
  })

  test('It lists Memory files before Skills when both hold 8000', async ($, on) => {
    const world = install($, on)
    world.breakdown = breakdownOf({ categories: [category('Skills', 8000), category('Memory files', 8000)] })
    await startSession($)
    await runMeter($)
    const rows = (await textsOf(await mountPane($))).filter(text => /(Skills|Memory files)/.test(text))
    expect(rows.map(row => row.includes('Memory files'))).toEqual([true, false])
  })

  test('It names the two largest servers by loaded tokens on the mcp servers line', async ($, on) => {
    const world = install($, on)
    world.breakdown = breakdownOf({
      mcpTools: [
        tool('github', 4000),
        tool('github', 5000),
        tool('ha', 6000),
        tool('slack', 2000),
        tool('github', 5000, false),
      ],
    })
    await startSession($)
    await runMeter($)
    expect(pairs(await textsOf(await mountPane($)), /mcp servers/)).toEqual(['⬡ mcp servers: github 9k, ha 6k'])
  })

  test('It draws the mcp servers line when the MCP category is deferred', async ($, on) => {
    const world = install($, on)
    world.breakdown = breakdownOf({
      categories: [category('Messages', 1000), category('MCP tools', 3000, 'deferred')],
      mcpTools: [tool('github', 3000)],
    })
    await startSession($)
    await runMeter($)
    const texts = await textsOf(await mountPane($))
    expect(pairs(texts, /MCP tools/)).toEqual([])
    expect(pairs(texts, /mcp servers/)).toEqual(['⬡ mcp servers: github 3k'])
  })

  test('It leaves out the mcp servers line when no loaded tool remains', async ($, on) => {
    const world = install($, on)
    world.breakdown = breakdownOf({ mcpTools: [tool('github', 3000, false)] })
    await startSession($)
    await runMeter($)
    expect(pairs(await textsOf(await mountPane($)), /mcp servers/)).toEqual([])
  })

  const ages = [
    [59, '59s ago'],
    [60, '1m ago'],
    [59 * 60, '59m ago'],
    [60 * 60, '1h ago'],
  ] as const

  for (const [seconds, label] of ages) {
    test(`It reads ${label} in the TOP CONTEXT header ${seconds} seconds after the breakdown`, async ($, on) => {
      const world = install($, on)
      await startSession($)
      await runMeter($)
      await world.clock.advance(seconds * 1000)
      expect(pairs(await textsOf(await mountPane($)), /ago/)).toEqual([`· ${label}`])
    })
  }

  test('It draws the refresh Button with its key, hotkey and glyph label', async ($, on) => {
    install($, on)
    await startSession($)
    await runMeter($)
    const button = await (await mountPane($)).find({ type: 'Button', key: 'refresh' })
    expect(button?.props.hotkey).toBe('r')
    expect(button?.props.label).toBe('↻ [r] refresh')
  })
})
