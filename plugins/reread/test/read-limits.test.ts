import { describe, expect, test } from 'claude-code/testing'

import { install, isStub, LARGE_FILE, putFile, read, triggerValues } from './world'

const ACT = { options: { readMode: 'act' } }

// The stub's context line for lines 2 to 40 of LARGE_FILE, read in full at turn 1.
const LINES_TO_END =
  'reread: /work/a.ts is unchanged since you read it at turn 1 (same content, 39 lines). Its contents are earlier in this conversation. Read it again only if you need it in full.'

describe('readTool: a limit that is zero or negative', () => {
  // On 2.1.311 Read reads to the end of the file for a limit of zero or less, as with no limit.
  test('It counts a negative limit inside a full read as the lines to the end of the file', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', LARGE_FILE)
    await read($, '/work/a.ts')
    const inside = await read($, '/work/a.ts', { offset: 2, limit: -2 })
    expect(inside.context).toEqual([LINES_TO_END])
  })

  test('It records a negative limit inside a full read with the lines to the end of the file', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', LARGE_FILE)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts', { offset: 2, limit: -2 })
    expect(triggerValues(world).lines).toBe(39)
  })

  test('It answers a zero limit inside a full read with a stub for the lines to the end of the file', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', LARGE_FILE)
    await read($, '/work/a.ts')
    const inside = await read($, '/work/a.ts', { offset: 2, limit: 0 })
    expect([isStub(inside), inside.context]).toEqual([true, [LINES_TO_END]])
  })
})
