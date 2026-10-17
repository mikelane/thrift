import { describe, expect, test } from 'claude-code/testing'

import { type World, lastRecord, runCommand, startTurn, writingTheNote } from './helpers'

const TURN_AFTER_NOTE_LINE = 'A turn ran in the previous session while or after this note was written'

// The person's /clear ran ahead of the plugin's, which was already queued, and a turn started in the session it made.
const personClearsThenTurnRuns = (world: World, $: Parameters<typeof startTurn>[0]) => {
  world.onClearIssued = async () => {
    world.onClearIssued = undefined
    await runCommand($, 'clear')
    await startTurn($, 'queued behind the person clear')
  }
}

// The handoff's own clear ran alone, and a turn started in the fresh session before the note went in.
const turnRunsAfterOwnClear = (world: World, $: Parameters<typeof startTurn>[0]) => {
  world.onClearEnded = async () => {
    world.onClearEnded = undefined
    await startTurn($, 'started in the fresh session')
  }
}

describe('the handoff clear alone, with a turn in the fresh session', () => {
  test('It returns the handoff clear with the plugin origin', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await finishNote()
    expect(world.clearOrigins).toEqual(['plugin:handoff'])
  })

  test('It leaves late_turn off when the turn started after the handoff clear ended the session', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    turnRunsAfterOwnClear(world, $)
    await finishNote()
    expect(lastRecord(world).trigger_values.late_turn).toBeUndefined()
  })

  test('It leaves the turn-after-note line out when the turn started after the handoff clear ended the session', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    turnRunsAfterOwnClear(world, $)
    await finishNote()
    expect(world.appended.join('\n')).not.toContain(TURN_AFTER_NOTE_LINE)
  })
})

describe('a person clear queued ahead of the handoff clear', () => {
  test('It adds the turn-after-note line when a turn ran in the session the person cleared to', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    personClearsThenTurnRuns(world, $)
    await finishNote()
    expect(world.appended.join('\n')).toContain(TURN_AFTER_NOTE_LINE)
  })

  test('It records late_turn true when a turn ran in the session the person cleared to', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    personClearsThenTurnRuns(world, $)
    await finishNote()
    expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { late_turn: true } })
  })

  test('It records cleared_by handoff because the handoff clear made the session that holds the note', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    personClearsThenTurnRuns(world, $)
    await finishNote()
    expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { cleared_by: 'handoff' } })
  })
})
