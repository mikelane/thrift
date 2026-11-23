import { describe, expect, test } from 'claude-code/testing'

import { handedOffMessage, noteInOtherSessionMessage } from '../hooks/handoff-note'
import { install, lastRecord, runCommand, startSession } from './helpers'

const LOG_PREFIX = 'log:'
const TOAST_PREFIX = 'toast:'
const ELSEWHERE = noteInOtherSessionMessage('new-session')

type Engine = Parameters<typeof install>[0]
type On = Parameters<typeof install>[1]

const startedWorld = async ($: Engine, on: On) => {
  const world = install($, on)
  await startSession($)
  return world
}

const runHandoff = async ($: Engine, world: ReturnType<typeof install>) => {
  await runCommand($, 'handoff')
  await world.clock.settle()
  return world
}

// A /resume queued behind the clear switches the session once the note is in. Set after the session start, so only the
// command registration that follows the clear sees it.
const handoffThenResume = async ($: Engine, on: On) => {
  const world = await startedWorld($, on)
  world.onCommandRegistered = async () => {
    world.sessionId = 'resumed-elsewhere'
  }
  return runHandoff($, world)
}

const handoffThatStays = async ($: Engine, on: On) => runHandoff($, await startedWorld($, on))

describe('a /resume that switched sessions after the clear', () => {
  test('It logs exactly one line naming the session that holds the note', async ($, on) => {
    const world = await handoffThenResume($, on)
    expect(world.effects.filter(effect => effect === `${LOG_PREFIX}${ELSEWHERE}`)).toHaveLength(1)
  })

  test('It shows no handed-off or note-elsewhere toast', async ($, on) => {
    const world = await handoffThenResume($, on)
    expect(world.effects).not.toContain(`${TOAST_PREFIX}${handedOffMessage('old-session')}`)
    expect(world.effects).not.toContain(`${TOAST_PREFIX}${ELSEWHERE}`)
  })

  test('It leaves the handed-off line out of the resumed session', async ($, on) => {
    const world = await handoffThenResume($, on)
    expect(world.effects).not.toContain(`${LOG_PREFIX}${handedOffMessage('old-session')}`)
  })

  test('It records reason session_moved and keeps the delivery fields', async ($, on) => {
    const world = await handoffThenResume($, on)
    expect(lastRecord(world)).toMatchObject({
      action: 'cleared',
      trigger_values: { reason: 'session_moved', note: 'appended', cleared_by: 'handoff' },
    })
  })
})

describe('a handoff that stayed in the fresh session', () => {
  test('It shows the handed-off line and toast', async ($, on) => {
    const world = await handoffThatStays($, on)
    expect(world.effects).toContain(`${LOG_PREFIX}${handedOffMessage('old-session')}`)
    expect(world.effects).toContain(`${TOAST_PREFIX}${handedOffMessage('old-session')}`)
  })

  test('It does not log the note-elsewhere line', async ($, on) => {
    const world = await handoffThatStays($, on)
    expect(world.effects).not.toContain(`${LOG_PREFIX}${ELSEWHERE}`)
  })

  test('It records no reason', async ($, on) => {
    const world = await handoffThatStays($, on)
    expect(lastRecord(world).trigger_values.reason).toBeUndefined()
  })
})

// Wording-independent: the message names whichever session holds the note, not a fixed one.
test('It names the session it is given in noteInOtherSessionMessage', () => {
  expect(noteInOtherSessionMessage('session-a')).toContain('session-a')
  expect(noteInOtherSessionMessage('session-b')).toContain('session-b')
  expect(noteInOtherSessionMessage('session-a')).not.toContain('session-b')
})

describe('a session id that cannot be read after the clear', () => {
  test('It shows the handed-off line because a move cannot be told', async ($, on) => {
    const world = await startedWorld($, on)
    world.onClearEnded = async () => {
      world.sessionIdDenials = 1
    }
    await runHandoff($, world)
    expect(world.effects).toContain(`${LOG_PREFIX}${handedOffMessage('old-session')}`)
    expect(lastRecord(world).trigger_values.reason).toBeUndefined()
  })
})

describe('a session id that cannot be read once the note is in, for hasSessionMovedFrom', () => {
  test('It shows the handed-off line and records no reason because the current session cannot be told', async ($, on) => {
    const world = await startedWorld($, on)
    // The delivery registers /handoff straight after it reads the fresh id, so a denial set there hits only the read once the
    // note is in. The hook removes itself, so the later registration from the clear's session-end tick sets no denial.
    world.onCommandRegistered = async () => {
      world.onCommandRegistered = undefined
      world.sessionIdDenials = 1
    }
    await runHandoff($, world)
    expect(world.sessionIdDenials).toBe(0)
    expect(world.effects).toContain(`${LOG_PREFIX}${handedOffMessage('old-session')}`)
    expect(world.effects).not.toContain(`${LOG_PREFIX}${ELSEWHERE}`)
    expect(lastRecord(world).trigger_values.reason).toBeUndefined()
  })
})
