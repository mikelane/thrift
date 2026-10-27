import { describe, expect, test } from 'claude-code/testing'

import { install, isStub, putFile, read, rewriteKeepingStat, SEVEN_LINES, triggerValues, type World } from './world'

const ACT = { options: { readMode: 'act' } }

const reasonOf = (world: World) => [triggerValues(world).decision, triggerValues(world).reason]

const lastAction = (world: World): string => world.records.at(-1)?.action ?? ''

describe('readTool: a Read the plugin lets through', () => {
  test('It passes when the file changed size and mtime', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    putFile(world, '/work/a.ts', `${SEVEN_LINES}\neight`)
    const second = await read($, '/work/a.ts')
    expect([isStub(second), reasonOf(world)]).toEqual([false, ['pass', 'changed']])
  })

  test('It passes when the stat is the same but the content differs', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', 'aaaa\nbbbb')
    await read($, '/work/a.ts')
    rewriteKeepingStat(world, '/work/a.ts', 'cccc\ndddd')
    const second = await read($, '/work/a.ts')
    expect([isStub(second), reasonOf(world)]).toEqual([false, ['pass', 'changed']])
  })

  test('It tracks the changed content, so a third unchanged Read is a stub', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    putFile(world, '/work/a.ts', `${SEVEN_LINES}\neight`)
    await read($, '/work/a.ts')
    const third = await read($, '/work/a.ts')
    expect(isStub(third)).toBe(true)
  })

  test('It passes a different range of a file read as a range', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts', { offset: 1, limit: 2 })
    const other = await read($, '/work/a.ts', { offset: 4, limit: 2 })
    expect([isStub(other), reasonOf(world)]).toEqual([false, ['pass', 'different_range']])
  })

  test('It passes a whole-file Read after only a range was read', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts', { offset: 1, limit: 2 })
    const whole = await read($, '/work/a.ts')
    expect(isStub(whole)).toBe(false)
  })

  test('It passes a range that starts past the end of the file', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    const past = await read($, '/work/a.ts', { offset: 50, limit: 5 })
    expect(isStub(past)).toBe(false)
  })

  test('It never lets a read cut short by the token cap cover a range', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    world.readBehavior = 'truncated'
    await read($, '/work/a.ts')
    world.readBehavior = 'text'
    const range = await read($, '/work/a.ts', { offset: 5, limit: 2 })
    expect(isStub(range)).toBe(false)
  })

  test('It records the truncated read with reason token_cap_truncated', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    world.readBehavior = 'truncated'
    await read($, '/work/a.ts')
    expect(reasonOf(world)).toEqual(['pass', 'token_cap_truncated'])
  })

  test('It answers a repeat of the truncated read itself with a stub', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    world.readBehavior = 'truncated'
    await read($, '/work/a.ts')
    const again = await read($, '/work/a.ts')
    expect(isStub(again)).toBe(true)
  })

  const untracked = [
    ['image', 'not_text'],
    ['pdf', 'not_text'],
    ['notebook', 'not_text'],
    ['error', 'error_result'],
    ['core_unchanged', 'core_dedup'],
  ] as const
  for (const [behavior, reason] of untracked) {
    test(`It passes a ${behavior} result and records ${reason}`, ACT, async ($, on) => {
      const world = install($, on)
      putFile(world, '/work/a.ts', SEVEN_LINES)
      world.readBehavior = behavior
      await read($, '/work/a.ts')
      expect(reasonOf(world)).toEqual(['pass', reason])
    })

    test(`It does not track a ${behavior} result, so the next Read runs the tool`, ACT, async ($, on) => {
      const world = install($, on)
      putFile(world, '/work/a.ts', SEVEN_LINES)
      world.readBehavior = behavior
      await read($, '/work/a.ts')
      await read($, '/work/a.ts')
      expect(world.readsThatRan.length).toBe(2)
    })
  }

  test('It passes a Read with pages set and records pdf_pages', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.pdf', SEVEN_LINES)
    await read($, '/work/a.pdf', { pages: '1-2' })
    await read($, '/work/a.pdf', { pages: '1-2' })
    expect([world.readsThatRan.length, reasonOf(world)]).toEqual([2, ['pass', 'pdf_pages']])
  })

  test('It passes a Read of a file that is not there and records unreadable', ACT, async ($, on) => {
    const world = install($, on)
    await read($, '/work/missing.ts')
    expect([world.readsThatRan.length, reasonOf(world)]).toEqual([1, ['pass', 'unreadable']])
  })

  test('It passes a repeat when the file cannot be read to hash it', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    world.readThrowsFor.add('/work/a.ts')
    const second = await read($, '/work/a.ts')
    expect([isStub(second), reasonOf(world)]).toEqual([false, ['pass', 'unreadable']])
  })

  test('It does not track a first read it cannot hash', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    world.readThrowsFor.add('/work/a.ts')
    await read($, '/work/a.ts')
    world.readThrowsFor.clear()
    const second = await read($, '/work/a.ts')
    expect(isStub(second)).toBe(false)
  })

  test('It does not track a file that changed while the tool ran', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    world.duringRead = () => putFile(world, '/work/a.ts', `${SEVEN_LINES}\neight`)
    await read($, '/work/a.ts')
    expect(reasonOf(world)).toEqual(['pass', 'changed'])
  })

  test('It runs the tool again after a read that changed under it', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    world.duringRead = () => putFile(world, '/work/a.ts', `${SEVEN_LINES}\neight`)
    await read($, '/work/a.ts')
    const second = await read($, '/work/a.ts')
    expect(isStub(second)).toBe(false)
  })

  test('It passes when the original result is no longer in the conversation', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    world.contexts.set('main', [])
    const second = await read($, '/work/a.ts')
    expect([isStub(second), reasonOf(world)]).toEqual([false, ['pass', 'not_in_context']])
  })

  test('It passes when the conversation cannot be read', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    world.messagesThrows = true
    const second = await read($, '/work/a.ts')
    expect([isStub(second), reasonOf(world)]).toEqual([false, ['pass', 'not_in_context']])
  })

  test('It passes when the turn count cannot be read, and still returns the tool result', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    world.turnsThrows = true
    const second = await read($, '/work/a.ts')
    expect([isStub(second), world.readsThatRan.length]).toEqual([false, 2])
  })

  test('It records the read as passing when tracking fails after the tool ran', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    world.turnsThrows = true
    const first = await read($, '/work/a.ts')
    expect([isStub(first), world.readsThatRan.length, reasonOf(world)]).toEqual([false, 1, ['pass', 'unreadable']])
  })
})

describe('readTool: override after a stub', () => {
  test('It gives the contents when the model reads again after a stub', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    const third = await read($, '/work/a.ts')
    expect([isStub(third), world.readsThatRan.length]).toEqual([false, 2])
  })

  test('It records the override with reason override_after_stub', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect([lastAction(world), reasonOf(world)]).toEqual(['override', ['override', 'override_after_stub']])
  })

  test('It answers a fourth Read with a stub again', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    const fourth = await read($, '/work/a.ts')
    expect([isStub(fourth), world.readsThatRan.length]).toEqual([true, 2])
  })

  test('It overrides a range that was answered from a full read, then answers that range from its own read', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts', { offset: 2, limit: 2 })
    const overridden = await read($, '/work/a.ts', { offset: 2, limit: 2 })
    const again = await read($, '/work/a.ts', { offset: 2, limit: 2 })
    expect([isStub(overridden), isStub(again)]).toEqual([false, true])
  })

  test('It still answers a different range of the full read with a stub after an override', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts', { offset: 2, limit: 2 })
    await read($, '/work/a.ts', { offset: 2, limit: 2 })
    const other = await read($, '/work/a.ts', { offset: 5, limit: 2 })
    expect(isStub(other)).toBe(true)
  })
})
