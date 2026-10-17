import { describe, expect, test } from 'claude-code/testing'

import { CLEARED_BY, abandonAfterWait, type AbandonCause } from '../hooks/clear-window'
import type { SettledHandoff } from '../hooks/decision-record'
import { compacted, completeTurn, lastRecord, mountBand, startTurn } from './helpers'
import { turnRunningWhenTheNoteIsWritten } from './wait-for-turn-helpers'
import {
  ACT,
  BUSY_MESSAGE,
  COMPACTING,
  SESSION_ENDED_MESSAGE,
  WAITING,
  WAITING_TOAST,
  actHandoffWhileWritingTheNote,
  endTurn,
  personClearedThenTurnInFreshSession,
  shownText,
  writingTheNote,
} from './wait-for-turn-helpers'

const settledHandoff: SettledHandoff = {
  trigger: { point: 'turn-end', signal: 'strong', isBusy: false, contextTokens: 200_000, cacheReadTokens: 0, effectiveMode: 'ask' },
  isUnattended: false,
  heldGroups: [],
}

const abandoning = (cause: AbandonCause) => {
  const calls: Array<{ settled: SettledHandoff; reason: string; message: string; sessionId: string }> = []
  const abandon = async (settled: SettledHandoff, reason: string, message: string, sessionId: string) => {
    calls.push({ settled, reason, message, sessionId })
  }
  return { calls, done: abandonAfterWait(abandon, settledHandoff, cause, false, 'old-session') }
}

describe('CLEARED_BY', () => {
  test('It names the handoff as the one that ran its own clear', () => {
    expect(CLEARED_BY.clear).toBe('handoff')
  })

  test('It names the person as the one that ran the clear before the note was delivered', () => {
    expect(CLEARED_BY.deliver_to_person_clear).toBe('person')
  })
})

describe('showWaitingStatus', () => {
  test('It shows the waiting status on the band while a turn runs', async ($, on) => {
    const { finishNote } = await writingTheNote($, on)
    await startTurn($)
    await finishNote()
    expect(await shownText(await mountBand($))).toEqual([WAITING])
  })

  test('It leaves the band and the toast alone once a session end decided the outcome', async ($, on) => {
    const world = await personClearedThenTurnInFreshSession($, on)
    expect(await shownText(await mountBand($))).toEqual(['engine band'])
    expect(world.effects).not.toContain(WAITING_TOAST)
  })
})

describe('compactBeforeClearing', () => {
  test('It compacts the old session before the clear', COMPACTING, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.compact = async () => compacted(1_000)
    await finishNote()
    expect(world.effects.filter(effect => effect === 'compact' || effect === 'clear')).toEqual(['compact', 'clear'])
  })

  test('It records compaction_vetoed and still clears when a hook vetoes the compaction', COMPACTING, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.compact = async () => ({ skip: 'a hook vetoed it' })
    await finishNote()
    expect(world.records[0]).toMatchObject({ action: 'none', session_id: 'old-session', trigger_values: { reason: 'compaction_vetoed' } })
    expect(world.effects).toContain('clear')
  })

  test('It records compaction_failed and says why when the compaction throws', COMPACTING, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.compact = async () => {
      throw new Error('compaction refused')
    }
    await finishNote()
    expect(world.records[0]).toMatchObject({ action: 'none', session_id: 'old-session', trigger_values: { reason: 'compaction_failed' } })
    expect(world.debugLines.some(line => line.startsWith('handoff: compaction before the clear failed: '))).toBe(true)
  })
})

describe('clearSession', () => {
  test('It runs the clear command', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await finishNote()
    expect(world.effects).toContain('clear')
  })

  test('It says why when the clear fails and abandons the handoff', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.clearThrows = true
    await finishNote()
    expect(world.debugLines.some(line => line.startsWith('handoff: /clear failed: '))).toBe(true)
    expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { reason: 'clear_failed' } })
  })
})

describe('waitForClearWindow', () => {
  test('It clears without showing the waiting status when no turn is running', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await finishNote()
    expect(world.effects).toContain('clear')
    expect(world.effects).not.toContain(WAITING_TOAST)
  })

  test('It holds the clear until the running turn ends', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await startTurn($)
    await finishNote()
    expect(world.effects).not.toContain('clear')
    await endTurn($, world)
    expect(world.effects).toContain('clear')
  })

  test('It clears when the running turn ends while the waiting status is being drawn', async ($, on) => {
    const { world, finishNote } = await turnRunningWhenTheNoteIsWritten($, on)
    world.onOfferWrite = async value => {
      if (!JSON.stringify(value).includes('"stage":"wait"')) return
      await completeTurn($)
      await world.clock.settle()
    }
    await finishNote()
    expect(world.effects).toContain('clear')
  })

  test('It refuses to clear over background work that an act-mode handoff finds', ACT, async ($, on) => {
    const { world, finishNote } = await actHandoffWhileWritingTheNote($, on)
    world.agents = [{ id: 'a1', description: 'd', type: 't', status: 'running' }]
    await finishNote()
    await endTurn($, world)
    expect(world.effects).not.toContain('clear')
  })
})

describe('abandonAfterWait', () => {
  test('It abandons with session_ended and the session-ended message', async () => {
    const { calls, done } = abandoning('session_ended')
    await done
    expect(calls).toMatchObject([{ reason: 'session_ended', message: SESSION_ENDED_MESSAGE, sessionId: 'old-session' }])
  })

  test('It abandons with background_busy, the busy-refusal message, and a busy-refusal trigger', async () => {
    const { calls, done } = abandoning('busy')
    await done
    expect(calls).toMatchObject([{ reason: 'background_busy', message: BUSY_MESSAGE, settled: { trigger: { isBusy: true, signal: 'weak' } } }])
  })

  test('It abandons with clear_failed and the trigger as settled', async () => {
    const { calls, done } = abandoning('clear_failed')
    await done
    expect(calls).toMatchObject([{ reason: 'clear_failed', settled: { trigger: settledHandoff.trigger } }])
  })
})
