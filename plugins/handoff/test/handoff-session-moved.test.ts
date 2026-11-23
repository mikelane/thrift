import { describe, expect, test } from 'claude-code/testing'

import { handedOffMessage, noteElsewhereMessage } from '../hooks/handoff-note'
import { install, lastRecord, runCommand, startSession } from './helpers'

const LOG_PREFIX = 'log:'
const TOAST_PREFIX = 'toast:'
const ELSEWHERE = noteElsewhereMessage('new-session')

const handoffThatEndsIn = async ($: Parameters<typeof install>[0], on: Parameters<typeof install>[1], resumedSession?: string) => {
  const world = install($, on)
  if (resumedSession !== undefined) {
    world.onCommandRegistered = async () => {
      world.sessionId = resumedSession
    }
  }
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  return world
}

describe('a /resume that switched sessions after the clear', () => {
  test('It logs one line naming the session that holds the note', async ($, on) => {
    const world = await handoffThatEndsIn($, on, 'resumed-elsewhere')
    expect(world.effects).toContain(`${LOG_PREFIX}${ELSEWHERE}`)
  })

  test('It shows no toast', async ($, on) => {
    const world = await handoffThatEndsIn($, on, 'resumed-elsewhere')
    expect(world.effects.filter(effect => effect.startsWith(TOAST_PREFIX) && effect.includes('new-session'))).toEqual([])
  })

  test('It leaves the handed-off line out of the resumed session', async ($, on) => {
    const world = await handoffThatEndsIn($, on, 'resumed-elsewhere')
    expect(world.effects).not.toContain(`${LOG_PREFIX}${handedOffMessage('old-session')}`)
  })

  test('It records reason session_moved and keeps the delivery fields', async ($, on) => {
    const world = await handoffThatEndsIn($, on, 'resumed-elsewhere')
    expect(lastRecord(world)).toMatchObject({
      action: 'cleared',
      trigger_values: { reason: 'session_moved', note: 'appended', cleared_by: 'handoff' },
    })
  })
})

describe('a handoff that stayed in the fresh session', () => {
  test('It shows the handed-off line and toast', async ($, on) => {
    const world = await handoffThatEndsIn($, on)
    expect(world.effects).toContain(`${LOG_PREFIX}${handedOffMessage('old-session')}`)
    expect(world.effects).toContain(`${TOAST_PREFIX}${handedOffMessage('old-session')}`)
  })

  test('It records no reason', async ($, on) => {
    const world = await handoffThatEndsIn($, on)
    expect(lastRecord(world).trigger_values.reason).toBeUndefined()
  })
})

describe('a session id that cannot be read after the clear', () => {
  test('It shows the handed-off line because a move cannot be told', async ($, on) => {
    const world = install($, on)
    world.onClearEnded = async () => {
      world.sessionIdDenials = 1
    }
    await startSession($)
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(world.effects).toContain(`${LOG_PREFIX}${handedOffMessage('old-session')}`)
    expect(lastRecord(world).trigger_values.reason).toBeUndefined()
  })
})
