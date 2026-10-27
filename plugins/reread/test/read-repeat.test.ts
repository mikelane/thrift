import { describe, expect, test } from 'claude-code/testing'

import { install, isStub, lastRecord, putFile, read, SEVEN_LINES, startSession, triggerValues } from './world'

const ACT = { options: { readMode: 'act' } }

describe('readTool: a repeat Read of an unchanged file in act', () => {
  test('It lets the first Read through to the tool', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    const first = await read($, '/work/a.ts')
    expect([isStub(first), world.readsThatRan.length]).toEqual([false, 1])
  })

  test('It answers the repeat with the native file_unchanged result', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    const second = await read($, '/work/a.ts')
    expect(second.result).toEqual({ type: 'file_unchanged', file: { filePath: '/work/a.ts' } })
  })

  test('It does not run the tool for the repeat', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect(world.readsThatRan.length).toBe(1)
  })

  test('It adds one context line naming the path, the turn and the line count', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    world.turns = 3
    await read($, '/work/a.ts')
    world.turns = 5
    const second = await read($, '/work/a.ts')
    expect(second.context).toEqual([
      'reread: /work/a.ts is unchanged since you read it at turn 3 (same content, 7 lines). Its contents are earlier in this conversation. Read it again only if you need it in full.',
    ])
  })


  test('It answers a range inside a full read with a stub', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    const inside = await read($, '/work/a.ts', { offset: 2, limit: 3 })
    expect(isStub(inside)).toBe(true)
  })

  test('It answers an exact repeat of a range with a stub', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts', { offset: 2, limit: 3 })
    const again = await read($, '/work/a.ts', { offset: 2, limit: 3 })
    expect(isStub(again)).toBe(true)
  })

  test('It counts the lines of a range stub, not of the file', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    const inside = await read($, '/work/a.ts', { offset: 2, limit: 3 })
    expect(inside.context?.[0]).toContain('(same content, 3 lines)')
  })

  test('It tracks the real path, so a symlink and its target are one file', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    world.links.set('/work/link.ts', '/work/a.ts')
    await read($, '/work/a.ts')
    const viaLink = await read($, '/work/link.ts')
    expect(viaLink.result).toEqual({ type: 'file_unchanged', file: { filePath: '/work/link.ts' } })
  })
})

describe('readTool: the record of a Read evaluation', () => {
  test('It records the first read as a pass with reason first_read', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect([triggerValues(world).decision, triggerValues(world).reason]).toEqual(['pass', 'first_read'])
  })

  test('It records a repeat as a dedupe with reason exact_repeat', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect([lastRecord(world).action, triggerValues(world).reason, lastRecord(world).mode]).toEqual(['dedupe', 'exact_repeat', 'active'])
  })

  test('It records a range inside a full read with reason inside_full_read and range kind subrange', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts', { offset: 2, limit: 3 })
    expect([triggerValues(world).reason, triggerValues(world).range_kind, triggerValues(world).lines]).toEqual(['inside_full_read', 'subrange', 3])
  })

  test('It records the range kind of a whole-file repeat as full', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect(triggerValues(world).range_kind).toBe('full')
  })

  test('It records the range kind of a repeated range as range', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts', { offset: 1, limit: 2 })
    await read($, '/work/a.ts', { offset: 1, limit: 2 })
    expect(triggerValues(world).range_kind).toBe('range')
  })

  test('It records the bytes saved as the gross bytes of the first read less the stub', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    const { bytes_saved, gross_bytes, stub_bytes } = triggerValues(world)
    expect([gross_bytes, (gross_bytes as number) - (stub_bytes as number) === bytes_saved]).toEqual([58, true])
  })

  test('It records the turns since the read', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    world.turns = 2
    await read($, '/work/a.ts')
    world.turns = 6
    await read($, '/work/a.ts')
    expect(triggerValues(world).turns_since_read).toBe(4)
  })

  test('It records a hash of the path, never the path', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    const serialized = JSON.stringify(lastRecord(world))
    expect([triggerValues(world).path_hash, serialized.includes('a.ts')]).toEqual([expect.stringMatching(/^[0-9a-f]{16}$/), false])
  })

  test('It records the engine version and the session id', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect([lastRecord(world).engine_version, lastRecord(world).session_id, lastRecord(world).component]).toEqual(['2.1.311', 'session-1', 'reread'])
  })

  test('It records that the read was in the main loop', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(triggerValues(world).is_subagent).toBe(false)
  })

  test('It records the setting and the effective mode', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect([triggerValues(world).setting, triggerValues(world).effective_mode]).toEqual(['act', 'act'])
  })

  test('It writes the record the session started with', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await startSession($)
    await read($, '/work/a.ts')
    expect(lastRecord(world).session_id).toBe('session-1')
  })
})
