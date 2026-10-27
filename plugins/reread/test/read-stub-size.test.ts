import { describe, expect, test } from 'claude-code/testing'

import { install, isStub, LARGE_FILE, putFile, read, TINY_FILE, triggerValues } from './world'

const ACT = { options: { readMode: 'act' } }
const ASK = { options: { readMode: 'ask' } }
const OFF = { options: { readMode: 'off' } }

describe('readTool: a repeat Read whose stub would not be smaller', () => {
  test('It runs the tool for the repeat of a tiny file in act', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', TINY_FILE)
    await read($, '/work/a.ts')
    const second = await read($, '/work/a.ts')
    expect([isStub(second), world.readsThatRan.length]).toEqual([false, 2])
  })

  test('It logs the repeat of a tiny file as a pass with reason stub_not_smaller in act', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', TINY_FILE)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect([triggerValues(world).decision, triggerValues(world).reason]).toEqual(['pass', 'stub_not_smaller'])
  })

  test('It logs the gross and stub bytes it compared', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', TINY_FILE)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    const { gross_bytes, stub_bytes } = triggerValues(world)
    expect([gross_bytes, (stub_bytes as number) > 58]).toEqual([58, true])
  })

  test('It reports no saving, positive or negative, for the pass', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', TINY_FILE)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect(['bytes_saved' in triggerValues(world), 'bytes_would_save' in triggerValues(world)]).toEqual([false, false])
  })

  test('It passes the same repeat again, not as an override, because no stub was sent', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', TINY_FILE)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect([triggerValues(world).decision, triggerValues(world).reason]).toEqual(['pass', 'stub_not_smaller'])
  })

  test('It logs a pass and no bytes_would_save in off', OFF, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', TINY_FILE)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect([triggerValues(world).decision, triggerValues(world).reason, 'bytes_would_save' in triggerValues(world)]).toEqual(['pass', 'stub_not_smaller', false])
  })

  test('It shows no line in the transcript in ask', ASK, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', TINY_FILE)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect(world.transcriptLines).toEqual([])
  })

  test('It runs the tool for a subrange of a few lines smaller than the stub', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', LARGE_FILE)
    await read($, '/work/a.ts')
    const inside = await read($, '/work/a.ts', { offset: 2, limit: 2 })
    expect([isStub(inside), triggerValues(world).reason]).toEqual([false, 'stub_not_smaller'])
  })

  test('It still answers a subrange larger than the stub with a stub', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', LARGE_FILE)
    await read($, '/work/a.ts')
    const inside = await read($, '/work/a.ts', { offset: 2, limit: 30 })
    expect(isStub(inside)).toBe(true)
  })

  test('It still answers the repeat of a large file with a stub', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', LARGE_FILE)
    await read($, '/work/a.ts')
    const second = await read($, '/work/a.ts')
    expect([isStub(second), world.readsThatRan.length]).toEqual([true, 1])
  })
})
