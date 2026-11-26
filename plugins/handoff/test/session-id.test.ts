import { describe, expect, test } from 'claude-code/testing'

import { install, runCommand, startSession } from './helpers'

const readFailureLines = (debugLines: string[]) => debugLines.filter(line => line.startsWith('handoff: could not read the session id'))

describe('tryReadSessionId', () => {
  test('It logs nothing when the session id can be read', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(readFailureLines(world.debugLines)).toEqual([])
  })

  test('It logs the read failure with no call-site phrase when the id cannot be read', async ($, on) => {
    const world = install($, on)
    world.sessionIdDenials = 2
    await startSession($)
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(readFailureLines(world.debugLines)).toHaveLength(1)
    expect(readFailureLines(world.debugLines)[0]).toMatch(/^handoff: could not read the session id: /)
  })
})
