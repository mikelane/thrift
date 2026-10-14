import { describe, expect, test } from 'claude-code/testing'

import { completeTurn, lastRecord, startTurn, writingTheNote } from './helpers'

const TURN_AFTER_NOTE_LINE = 'A turn ran in the previous session while or after this note was written'

describe('the line that says a turn ran after the note', () => {
  // The engine queues /clear, and a prompt already queued runs first, in the old session, before the clear's session end.
  // The mock's session id setter runs at that point: after the clear was issued, before the session.end hook.
  const startTurnBeforeClearEnds = (world: { sessionId: string }, $: Parameters<typeof startTurn>[0]) => {
    let currentSessionId = world.sessionId
    Object.defineProperty(world, 'sessionId', {
      get: () => currentSessionId,
      set: (next: string) => {
        currentSessionId = next
        void startTurn($, 'queued before the clear ran')
      },
    })
  }

  test('It is added when a turn starts in the old session after the clear was queued and before it ended the session', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    startTurnBeforeClearEnds(world, $)
    await finishNote()
    expect(world.appended.join('\n')).toContain(TURN_AFTER_NOTE_LINE)
  })

  test('It names the old session in the resume command when a turn ran after the clear was queued', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    startTurnBeforeClearEnds(world, $)
    await finishNote()
    expect(world.appended.join('\n')).toContain('claude --resume old-session')
  })

  test('It records late_turn true on the cleared record when a turn ran after the clear was queued', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    startTurnBeforeClearEnds(world, $)
    await finishNote()
    expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { late_turn: true } })
  })

  test('It leaves late_turn off the cleared record when no turn ran after the clear was queued', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await finishNote()
    expect(lastRecord(world).trigger_values).not.toHaveProperty('late_turn')
  })

  test('It is added when a turn started before the clear began', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await startTurn($, 'typed while the note was written')
    await finishNote()
    await completeTurn($)
    await world.clock.settle()
    expect(world.appended.join('\n')).toContain(TURN_AFTER_NOTE_LINE)
  })
})
