import { describe, expect, test } from 'claude-code/testing'

import { install, isStub, LARGE_FILE, putFile, read, rewriteKeepingStat, SEVEN_LINES, triggerValues } from './world'

const ACT = { options: { readMode: 'act' } }

// The same length as SEVEN_LINES, so a rewrite to it leaves the size as it was.
const SEVEN_LINES_EDITED = SEVEN_LINES.replace('one', 'ONE')

describe('readTool: what is tracked is what the model read', () => {
  test('It does not track a read when the file was rewritten after the tool ran with the same size and modified time', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    world.beforeFsRead = () => rewriteKeepingStat(world, '/work/a.ts', SEVEN_LINES_EDITED)
    await read($, '/work/a.ts')
    expect([triggerValues(world).decision, triggerValues(world).reason]).toEqual(['pass', 'changed'])
  })

  test('It runs the tool again for a repeat of a read whose file was rewritten after the tool ran with the same stat', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    world.beforeFsRead = () => rewriteKeepingStat(world, '/work/a.ts', SEVEN_LINES_EDITED)
    await read($, '/work/a.ts')
    const second = await read($, '/work/a.ts')
    expect(isStub(second)).toBe(false)
  })

  test('It runs the tool again when a link pointed elsewhere while the tool ran and back before the plugin read the file', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/x.ts', SEVEN_LINES)
    putFile(world, '/work/y.ts', SEVEN_LINES_EDITED)
    world.links.set('/work/a.ts', '/work/x.ts')
    world.duringRead = () => world.links.set('/work/a.ts', '/work/y.ts')
    world.beforeFsRead = () => world.links.set('/work/a.ts', '/work/x.ts')
    await read($, '/work/a.ts')
    const second = await read($, '/work/a.ts')
    expect(isStub(second)).toBe(false)
  })

  test('It still tracks a range when the file was rewritten with the same stat outside the lines the model read', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', LARGE_FILE)
    world.beforeFsRead = () => rewriteKeepingStat(world, '/work/a.ts', LARGE_FILE.replace('line 40 of', 'LINE 40 of'))
    await read($, '/work/a.ts', { offset: 1, limit: 30 })
    const second = await read($, '/work/a.ts', { offset: 1, limit: 30 })
    expect(isStub(second)).toBe(true)
  })

  test('It does not track a range when the file was rewritten with the same stat inside the lines the model read', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', LARGE_FILE)
    world.beforeFsRead = () => rewriteKeepingStat(world, '/work/a.ts', LARGE_FILE.replace('line 2 of', 'LINE 2 of'))
    await read($, '/work/a.ts', { offset: 1, limit: 30 })
    expect(triggerValues(world).reason).toBe('changed')
  })
})
