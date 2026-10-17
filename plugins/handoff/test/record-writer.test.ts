import { describe, expect, test } from 'claude-code/testing'

import { completeTurn, growTo200k, install, lastRecord, startSession } from './helpers'

const NO_LOCATION = 'handoff: no log location: neither THRIFT_HOME nor HOME is set'

describe('writeRecord', () => {
  test('It appends a record for an evaluation', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await growTo200k($, world)
    await completeTurn($)
    expect(lastRecord(world).component).toBe('handoff')
  })

  test('It names the current session on the record', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await growTo200k($, world)
    await completeTurn($)
    expect(lastRecord(world).session_id).toBe('old-session')
  })

  test('It writes to THRIFT_HOME when that is an absolute path', async ($, on) => {
    const world = install($, on, { thriftHome: '/var/thrift' })
    await startSession($)
    await growTo200k($, world)
    await completeTurn($)
    expect(world.logTargets[0]).toEqual(['/var/thrift', '/var/thrift/decisions.jsonl'])
  })

  test('It says the default location is used when THRIFT_HOME is not absolute', async ($, on) => {
    const world = install($, on, { thriftHome: 'relative/dir' })
    await startSession($)
    await growTo200k($, world)
    await completeTurn($)
    expect(world.debugLines).toContain('handoff: THRIFT_HOME is not an absolute path, so the default log location is used')
  })

  test('It writes no record when neither THRIFT_HOME nor HOME is set', async ($, on) => {
    const world = install($, on, { home: null })
    await startSession($)
    await growTo200k($, world)
    await completeTurn($)
    expect(world.records).toEqual([])
  })

  test('It says why it writes no record when neither THRIFT_HOME nor HOME is set', async ($, on) => {
    const world = install($, on, { home: null })
    await startSession($)
    await growTo200k($, world)
    await completeTurn($)
    expect(world.debugLines).toContain(NO_LOCATION)
  })

  test('It says why when the log write exits non-zero', async ($, on) => {
    const world = install($, on)
    world.logWrite = 'exit'
    await startSession($)
    await growTo200k($, world)
    await completeTurn($)
    expect(world.debugLines).toContain('handoff: log write failed: disk full')
  })

  test('It says why when the log write throws', async ($, on) => {
    const world = install($, on)
    world.logWrite = 'throw'
    await startSession($)
    await growTo200k($, world)
    await completeTurn($)
    expect(world.debugLines.some(line => line.startsWith('handoff: log write failed'))).toBe(true)
  })
})
