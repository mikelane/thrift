import { describe, expect, test } from 'claude-code/testing'

import { install, isStub, lastRecord, putFile, read, SEVEN_LINES } from './world'

const ACT = { options: { readMode: 'act' } }

const NO_LOCATION = 'reread: no log location: neither THRIFT_HOME nor HOME is set'

describe('writeRecord', () => {
  test('It appends a record for an evaluation', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(lastRecord(world).component).toBe('reread')
  })

  test('It writes through the owner-only appender', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(world.logArgv[0]?.slice(0, 4)).toEqual(['sh', '-c', 'umask 077 && mkdir -p -- "$1" && cat >> "$2" && chmod 600 "$2"', 'sh'])
  })

  test('It writes to the default location under HOME', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(world.logArgv[0]?.slice(4)).toEqual(['/home/u/.claude/thrift', '/home/u/.claude/thrift/decisions.jsonl'])
  })

  test('It writes to THRIFT_HOME when that is an absolute path', ACT, async ($, on) => {
    const world = install($, on, { thriftHome: '/var/thrift' })
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(world.logArgv[0]?.slice(4)).toEqual(['/var/thrift', '/var/thrift/decisions.jsonl'])
  })

  test('It says the default location is used when THRIFT_HOME is not absolute', ACT, async ($, on) => {
    const world = install($, on, { thriftHome: 'relative/dir' })
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(world.debugLines).toContain('reread: THRIFT_HOME is not an absolute path, so the default log location is used')
  })

  test('It says HOME is needed when THRIFT_HOME is not absolute and HOME is unset', ACT, async ($, on) => {
    const world = install($, on, { home: null, thriftHome: 'relative/dir' })
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(world.debugLines).toContain('reread: THRIFT_HOME is not an absolute path, so HOME is needed for a log location, and it is not set')
  })

  test('It writes no record when neither THRIFT_HOME nor HOME is set', ACT, async ($, on) => {
    const world = install($, on, { home: null })
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(world.records).toEqual([])
  })

  test('It says why it writes no record when neither THRIFT_HOME nor HOME is set', ACT, async ($, on) => {
    const world = install($, on, { home: null })
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(world.debugLines).toContain(NO_LOCATION)
  })

  test('It says why when the log write exits non-zero', ACT, async ($, on) => {
    const world = install($, on)
    world.logWrite = 'exit'
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(world.debugLines).toContain('reread: log write failed: disk full')
  })

  test('It says why when the log write throws', ACT, async ($, on) => {
    const world = install($, on)
    world.logWrite = 'throw'
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(world.debugLines.some(line => line.startsWith('reread: log write failed'))).toBe(true)
  })

  test('It still returns the stub when the log write fails', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    world.logWrite = 'throw'
    expect(isStub(await read($, '/work/a.ts'))).toBe(true)
  })

  test('It still returns the tool result when the log write fails', ACT, async ($, on) => {
    const world = install($, on)
    world.logWrite = 'exit'
    putFile(world, '/work/a.ts', SEVEN_LINES)
    const first = await read($, '/work/a.ts')
    expect([isStub(first), world.readsThatRan.length]).toEqual([false, 1])
  })

  test('It writes scalars only, one record per line', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    const values = Object.values(lastRecord(world).trigger_values)
    expect(values.every(value => ['string', 'number', 'boolean'].includes(typeof value))).toBe(true)
  })
})

describe('debug', () => {
  test('It sends a line to the debug log led by the plugin name, and not to the transcript', ACT, async ($, on) => {
    const world = install($, on, { home: null })
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect([world.debugLines.every(line => line.startsWith('reread: ')), world.transcriptLines]).toEqual([true, []])
  })
})
