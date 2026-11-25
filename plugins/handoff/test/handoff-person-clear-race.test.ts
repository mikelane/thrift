import { describe, expect, test } from 'claude-code/testing'

import { type World, lastRecord, runCommand } from './helpers'
import { FOREIGN_CLEAR_TIMEOUT_MS } from '../hooks/handoff-delivery'
import { waitingForATurn } from './wait-for-turn-helpers'

type Engine = Parameters<typeof runCommand>[0]

// The person's /clear ended the session while the handoff waited on a turn, and has not returned: the engine still names the
// cleared session until the clear's transcript rewrite is done. The handoff resumes in that window.
const personClearStillFinishing = async ($: Engine, world: World) => {
  const gate: { release: () => void } = { release: () => undefined }
  world.isSessionIdStaleUntilClearReturns = true
  world.onClearEnded = () =>
    new Promise<void>(resolve => {
      gate.release = resolve
    })
  const personClear = runCommand($, 'clear')
  await world.clock.settle()
  return {
    finishClear: async () => {
      gate.release()
      await personClear
      await world.clock.settle()
    },
  }
}

describe('a person clear still finishing when the handoff resumes after the wait', () => {
  test('It appends the note to the fresh session the person made', async ($, on) => {
    const world = await waitingForATurn($, on)
    const { finishClear } = await personClearStillFinishing($, world)
    await finishClear()
    expect(world.appendedTo).toEqual(['new-session'])
  })

  test('It records cleared_by person without session_moved', async ($, on) => {
    const world = await waitingForATurn($, on)
    const { finishClear } = await personClearStillFinishing($, world)
    await finishClear()
    expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { cleared_by: 'person', note: 'appended' } })
    expect(lastRecord(world).trigger_values.reason).toBeUndefined()
  })
})

describe('a person clear that returns before the wait runs out', () => {
  test('It writes no timeout debug line and cancels the wait timer', async ($, on) => {
    const world = await waitingForATurn($, on)
    const { finishClear } = await personClearStillFinishing($, world)
    await finishClear()
    await world.clock.advance(FOREIGN_CLEAR_TIMEOUT_MS)
    expect(world.debugLines.filter(line => line.includes('did not return within'))).toEqual([])
  })
})

describe('a person clear that never returns', () => {
  test('It delivers to the session the engine names once the bounded wait ran out', async ($, on) => {
    const world = await waitingForATurn($, on)
    await personClearStillFinishing($, world)
    await world.clock.advance(FOREIGN_CLEAR_TIMEOUT_MS)
    expect(world.appendedTo).toEqual(['old-session'])
  })

  test('It writes a debug line saying the clear did not return in time', async ($, on) => {
    const world = await waitingForATurn($, on)
    await personClearStillFinishing($, world)
    await world.clock.advance(FOREIGN_CLEAR_TIMEOUT_MS)
    expect(world.debugLines).toContain(`handoff: a clear did not return within ${FOREIGN_CLEAR_TIMEOUT_MS} ms, so the note goes to the session the engine names now`)
  })

  test('It holds the note back until the wait ran out', async ($, on) => {
    const world = await waitingForATurn($, on)
    await personClearStillFinishing($, world)
    await world.clock.advance(FOREIGN_CLEAR_TIMEOUT_MS - 1)
    expect(world.appendedTo).toEqual([])
  })
})

describe('a person clear that throws after the session ended', () => {
  test('It releases the wait so the note is delivered', async ($, on) => {
    const world = await waitingForATurn($, on)
    world.onClearEnded = async () => {
      throw new Error('clear failed late')
    }
    await runCommand($, 'clear').catch(() => undefined)
    await world.clock.settle()
    expect(world.appended).toHaveLength(1)
  })
})
