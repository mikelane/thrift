import { describe, expect, test } from 'claude-code/testing'

import { completeTurn, startTurn, writingTheNote } from './helpers'

const TURN_AFTER_NOTE_LINE = 'A turn ran in the previous session while or after this note was written'

describe('the line that says a turn ran after the note', () => {
  // Only microtasks separate a read before the clear from one after it, and the kit cannot tell them apart: this pins the
  // value the note gets, not the order of the read.
  test('It is left out when the only turn starts as the handoff is clearing', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    let ended = world.sessionId
    Object.defineProperty(world, 'sessionId', {
      get: () => ended,
      set: (next: string) => {
        ended = next
        void startTurn($, 'typed during the clear')
      },
    })
    await finishNote()
    expect(world.appended.join('\n')).not.toContain(TURN_AFTER_NOTE_LINE)
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
