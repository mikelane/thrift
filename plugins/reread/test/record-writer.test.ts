import { describe, expect, test } from 'claude-code/testing'

import { install, isStub, lastRecord, putFile, read, SEVEN_LINES } from './world'

const ACT = { options: { readMode: 'act' } }

const NO_LOCATION = 'reread: no log location: neither THRIFT_HOME nor HOME is set'

describe('writeRecord', () => {
  test('It appends a record for an evaluation', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(world.records.map(record => [record.component, record.trigger_values.reason])).toEqual([['reread', 'first_read']])
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
    expect([world.debugLines, world.logArgv[0]?.slice(4)]).toEqual([
      ['reread: THRIFT_HOME is not an absolute path, so the default log location is used'],
      ['/home/u/.claude/thrift', '/home/u/.claude/thrift/decisions.jsonl'],
    ])
  })

  // The THRIFT_HOME line already says why there is no log, so the no-location line is left out.
  test('It says only that HOME is needed when THRIFT_HOME is not absolute and HOME is unset', ACT, async ($, on) => {
    const world = install($, on, { home: null, thriftHome: 'relative/dir' })
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(world.debugLines).toEqual(['reread: THRIFT_HOME is not an absolute path, so HOME is needed for a log location, and it is not set'])
  })

  test('It treats an empty THRIFT_HOME as unset and writes under HOME without a debug line', ACT, async ($, on) => {
    const world = install($, on, { thriftHome: '' })
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect([world.debugLines, world.logArgv[0]?.slice(4)]).toEqual([[], ['/home/u/.claude/thrift', '/home/u/.claude/thrift/decisions.jsonl']])
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
    expect(world.debugLines).toEqual([NO_LOCATION])
  })

  test('It says why when the log write exits non-zero', ACT, async ($, on) => {
    const world = install($, on)
    world.logWrite = 'exit'
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(world.debugLines).toEqual(['reread: log write to /home/u/.claude/thrift/decisions.jsonl failed (exit 1): disk full'])
  })

  test('It says why when the log write throws', ACT, async ($, on) => {
    const world = install($, on)
    world.logWrite = 'throw'
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect(world.debugLines).toEqual([expect.stringMatching(/^reread: could not write a decision record: /)])
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

  test('It writes a dedupe record whose trigger values are all scalars', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    await read($, '/work/a.ts')
    expect(lastRecord(world).trigger_values).toEqual({
      decision: 'dedupe',
      reason: 'exact_repeat',
      bytes_saved: 1233,
      gross_bytes: 1465,
      stub_bytes: 232,
      lines: 7,
      range_kind: 'full',
      turns_since_read: 0,
      is_subagent: false,
      path_hash: expect.stringMatching(/^[0-9a-f]{16}$/),
      effective_mode: 'act',
      setting: 'act',
    })
  })
})

describe('debug', () => {
  test('It sends a line to the debug log led by the plugin name, and not to the transcript', ACT, async ($, on) => {
    const world = install($, on, { home: null })
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    expect([world.debugLines, world.transcriptLines]).toEqual([[NO_LOCATION], []])
  })
})
