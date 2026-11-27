import { describe, expect, test } from 'claude-code/testing'

import { install } from './world'
import { isStub, lastRecord, read, triggerValues } from './world-actions'
import { putFile, SEVEN_LINES } from './world-files'

const ACT = { options: { readMode: 'act' } }

describe('engineInfo: an engine older than the minimum', () => {
  test('It runs as off and does not answer a repeat with a stub', ACT, async ($, on) => {
    const world = install($, on)
    world.version = { version: '2.1.307', base: '2.1.307' }
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    const second = await read($, '/work/a.ts')
    expect([isStub(second), world.readsThatRan.length]).toEqual([false, 2])
  })

  test('It logs one untested_engine record for the session', ACT, async ($, on) => {
    const world = install($, on)
    world.version = { version: '2.1.307', base: '2.1.307' }
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect(world.records.filter(record => record.action === 'untested_engine')).toHaveLength(1)
  })

  test('It records the unsupported engine before the first read', ACT, async ($, on) => {
    const world = install($, on)
    world.version = { version: '2.1.307', base: '2.1.307' }
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(world.records[0]?.trigger_values.reason).toBe('untested_engine')
  })

  test('It keeps the setting apart from the effective mode in later records', ACT, async ($, on) => {
    const world = install($, on)
    world.version = { version: '2.1.307', base: '2.1.307' }
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect([triggerValues(world).setting, triggerValues(world).effective_mode, lastRecord(world).mode]).toEqual(['act', 'off', 'shadow'])
  })

  test('It logs what a stub would have saved, as in off', ACT, async ($, on) => {
    const world = install($, on)
    world.version = { version: '2.1.307', base: '2.1.307' }
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    // SEVEN_LINES costs 1465 bytes as read; the stub and its context line cost 232.
    expect([lastRecord(world).action, triggerValues(world).bytes_would_save, 'bytes_saved' in triggerValues(world)]).toEqual(['none', 1233, false])
  })
})

describe('engineInfo: an engine at or after the minimum', () => {
  test('It logs no untested_engine record on the default engine', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(world.records.some(record => record.action === 'untested_engine')).toBe(false)
  })

  test('It answers a repeat with a stub on the minimum engine', ACT, async ($, on) => {
    const world = install($, on)
    world.version = { version: '2.1.308', base: '2.1.308' }
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    const second = await read($, '/work/a.ts')
    expect([isStub(second), world.records.some(record => record.action === 'untested_engine')]).toEqual([true, false])
  })

  test('It answers a repeat with a stub on a release newer than any tested', ACT, async ($, on) => {
    const world = install($, on)
    world.version = { version: '2.1.333', base: '2.1.333' }
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    const second = await read($, '/work/a.ts')
    expect([isStub(second), world.records.some(record => record.action === 'untested_engine')]).toEqual([true, false])
  })

  test('It runs in the configured mode on a newer release', ACT, async ($, on) => {
    const world = install($, on)
    world.version = { version: '2.1.333', base: '2.1.333' }
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect([triggerValues(world).setting, triggerValues(world).effective_mode, lastRecord(world).mode]).toEqual(['act', 'act', 'active'])
  })
})

describe('engineInfo: the engine version', () => {
  test('It runs as off on a development build', ACT, async ($, on) => {
    const world = install($, on)
    world.version = { version: '2.1.332-dev.20260920.t101500.sha1a2b3c4', base: '2.1.332-dev' }
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
    world.isVersionFailing = true
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    const second = await read($, '/work/a.ts')
    expect([isStub(second), world.debugLines]).toEqual([
      false,
      [
        expect.stringMatching(/^could not read the engine version: /),
        'engine unknown is older than the minimum reread runs on, or is not a release, so it runs as off',
      ],
    ])
  })

  test('It records unknown as the engine version when it cannot be read', ACT, async ($, on) => {
    const world = install($, on)
    world.isVersionFailing = true
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
