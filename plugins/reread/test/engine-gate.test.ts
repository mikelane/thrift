import { describe, expect, test } from 'claude-code/testing'

import { install, isStub, lastRecord, putFile, read, SEVEN_LINES, triggerValues } from './world'

const ACT = { options: { readMode: 'act' } }

describe('engineInfo: an engine newer than the one the plugin was tested through', () => {
  test('It runs as off and does not answer a repeat with a stub', ACT, async ($, on) => {
    const world = install($, on)
    world.version = { version: '2.1.312', base: '2.1.312' }
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    const second = await read($, '/work/a.ts')
    expect([isStub(second), world.readsThatRan.length]).toEqual([false, 2])
  })

  test('It logs one untested_engine record for the session', ACT, async ($, on) => {
    const world = install($, on)
    world.version = { version: '2.1.312', base: '2.1.312' }
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect(world.records.filter(record => record.action === 'untested_engine')).toHaveLength(1)
  })

  test('It records the untested engine before the first read', ACT, async ($, on) => {
    const world = install($, on)
    world.version = { version: '2.1.312', base: '2.1.312' }
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(world.records[0]?.trigger_values.reason).toBe('untested_engine')
  })

  test('It keeps the setting apart from the effective mode in later records', ACT, async ($, on) => {
    const world = install($, on)
    world.version = { version: '2.1.312', base: '2.1.312' }
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect([triggerValues(world).setting, triggerValues(world).effective_mode, lastRecord(world).mode]).toEqual(['act', 'off', 'shadow'])
  })

  test('It logs what a stub would have saved, as in off', ACT, async ($, on) => {
    const world = install($, on)
    world.version = { version: '2.1.312', base: '2.1.312' }
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect('bytes_would_save' in triggerValues(world)).toBe(true)
  })

  test('It logs no untested_engine record on the tested engine', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(world.records.some(record => record.action === 'untested_engine')).toBe(false)
  })
})

describe('engineInfo: the engine version', () => {
  test('It runs as off on a development build', ACT, async ($, on) => {
    const world = install($, on)
    world.version = { version: '2.1.311-dev.20260920.t101500.sha1a2b3c4', base: '2.1.311-dev' }
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(isStub(await read($, '/work/a.ts'))).toBe(false)
  })

  test('It records the release base as the engine version', ACT, async ($, on) => {
    const world = install($, on)
    world.version = { version: '2.1.300+build', base: '2.1.300' }
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(lastRecord(world).engine_version).toBe('2.1.300')
  })

  test('It records the full version when the base is missing', ACT, async ($, on) => {
    const world = install($, on)
    world.version = { version: 'custom-build' }
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(world.records.map(record => record.engine_version)).toEqual(['custom-build', 'custom-build'])
  })

  test('It runs as off and says why when the version cannot be read', ACT, async ($, on) => {
    const world = install($, on)
    world.versionThrows = true
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    const second = await read($, '/work/a.ts')
    expect([isStub(second), world.debugLines.some(line => line.startsWith('reread: could not read the engine version'))]).toEqual([false, true])
  })

  test('It records unknown as the engine version when it cannot be read', ACT, async ($, on) => {
    const world = install($, on)
    world.versionThrows = true
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(lastRecord(world).engine_version).toBe('unknown')
  })

  test('It reads the version once for the session', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect(world.versionReads).toBe(1)
  })
})
