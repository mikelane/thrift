import { describe, expect, test } from 'claude-code/testing'

import { install, isStub, LARGE_FILE, putFile, read, SEVEN_LINES, triggerValues } from './world'

const ACT = { options: { readMode: 'act' } }

const firstReadId = (readsThatRan: readonly string[]): string => {
  const id = readsThatRan[0]
  if (id === undefined) throw new Error('no read reached the tool')
  return id
}

describe('readTool: the original result must still hold what the model read', () => {
  test('It passes when the original result is in the conversation only as an error', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    world.errorResults.add(firstReadId(world.readsThatRan))
    const second = await read($, '/work/a.ts')
    expect([isStub(second), triggerValues(world).reason]).toEqual([false, 'not_in_context'])
  })

  test('It passes when the original result no longer holds the text the model read', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    world.resultTexts.set(firstReadId(world.readsThatRan), '[result withheld by a plugin]')
    const second = await read($, '/work/a.ts')
    expect([isStub(second), triggerValues(world).reason]).toEqual([false, 'not_in_context'])
  })

  test('It passes a range inside a full read whose result no longer holds the text the model read', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', LARGE_FILE)
    await read($, '/work/a.ts')
    world.resultTexts.set(firstReadId(world.readsThatRan), '')
    const inside = await read($, '/work/a.ts', { offset: 2, limit: 30 })
    expect([isStub(inside), triggerValues(world).reason]).toEqual([false, 'not_in_context'])
  })

  test('It still answers with a stub when the original result holds the text with more after it', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    const id = firstReadId(world.readsThatRan)
    world.resultTexts.set(id, `${world.resultTexts.get(id) ?? ''}\n<system-reminder>a note</system-reminder>`)
    const second = await read($, '/work/a.ts')
    expect(isStub(second)).toBe(true)
  })
})
