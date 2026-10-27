import { describe, expect, test } from 'claude-code/testing'

import { install, isStub, lastRecord, putFile, read, SEVEN_LINES, triggerValues } from './world'

const OFF = { options: { readMode: 'off' } }
const ASK = { options: { readMode: 'ask' } }
const ACT = { options: { readMode: 'act' } }

describe('readTool in off', () => {
  test('It runs the tool for a repeat Read', OFF, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    const second = await read($, '/work/a.ts')
    expect([isStub(second), world.readsThatRan.length]).toEqual([false, 2])
  })

  test('It runs as off when the setting is left alone', async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect([world.readsThatRan.length, triggerValues(world).setting, lastRecord(world).mode]).toEqual([2, 'off', 'shadow'])
  })

  test('It logs a repeat as no action in shadow mode', OFF, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect([lastRecord(world).action, lastRecord(world).mode]).toEqual(['none', 'shadow'])
  })

  test('It logs the decision the logic reached', OFF, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect([triggerValues(world).decision, triggerValues(world).reason]).toEqual(['dedupe', 'exact_repeat'])
  })

  test('It logs the net bytes a stub would have saved', OFF, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    const { bytes_would_save, gross_bytes, stub_bytes } = triggerValues(world)
    // SEVEN_LINES costs 1465 bytes as read; the stub and its context line cost 232.
    expect([gross_bytes, stub_bytes, bytes_would_save]).toEqual([1465, 232, 1233])
  })

  test('It leaves bytes_saved out of the record', OFF, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect('bytes_saved' in triggerValues(world)).toBe(false)
  })

  test('It shows no line in the transcript', OFF, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect(world.transcriptLines).toEqual([])
  })

  test('It keeps tracking from the fresh read, so every unchanged repeat is a would-save', OFF, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect(world.records.map(record => record.trigger_values.decision)).toEqual(['pass', 'dedupe', 'dedupe'])
  })

  test('It logs a pass for a repeat whose tool result is an error', OFF, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    world.readBehavior = 'error'
    await read($, '/work/a.ts')
    expect([triggerValues(world).decision, triggerValues(world).reason]).toEqual(['pass', 'error_result'])
  })
})

describe('readTool in ask', () => {
  test('It answers a repeat with the stub', ASK, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    const second = await read($, '/work/a.ts')
    expect(isStub(second)).toBe(true)
  })

  test('It shows one line in the transcript for the stub', ASK, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect(world.transcriptLines).toHaveLength(1)
  })

  test('It names the path in the line', ASK, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect(world.transcriptLines[0]).toContain('/work/a.ts')
  })

  test('It shows no line for a read it let through', ASK, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(world.transcriptLines).toEqual([])
  })

  test('It logs the record as active', ASK, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect([lastRecord(world).action, lastRecord(world).mode, triggerValues(world).effective_mode]).toEqual(['dedupe', 'active', 'ask'])
  })
})

describe('readTool in act', () => {
  test('It shows no line in the transcript', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect(world.transcriptLines).toEqual([])
  })
})
