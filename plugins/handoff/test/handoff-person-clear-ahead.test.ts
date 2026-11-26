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

// A hook beneath answered the person's /clear in its place, then the handoff's clear ran and a turn started in its session.
const answeredPersonClearThenOwnClear = (world: World, $: Parameters<typeof startTurn>[0]) => {
  world.answersPersonClear = true
  world.onClearIssued = async () => {
    world.onClearIssued = undefined
    await runCommand($, 'clear')
  }
  turnRunsAfterOwnClear(world, $)
}

// The person's /clear failed in core, then the handoff's clear ran and a turn started in its session.
const failedPersonClearThenOwnClear = (world: World, $: Parameters<typeof startTurn>[0]) => {
  world.onClearIssued = async () => {
    world.onClearIssued = undefined
    world.clearThrows = true
    await runCommand($, 'clear').catch(() => undefined)
    world.clearThrows = false
  }
  turnRunsAfterOwnClear(world, $)
}

describe('a person clear that failed while the handoff clear waits', () => {
  test('It leaves late_turn off when the turn started after the handoff clear ended the session', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    failedPersonClearThenOwnClear(world, $)
    await finishNote()
    expect(lastRecord(world).trigger_values.late_turn).toBeUndefined()
  })
})

describe('a person clear answered in its place while the handoff clear waits', () => {
  test('It leaves late_turn off when the turn started after the handoff clear ended the session', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    answeredPersonClearThenOwnClear(world, $)
    await finishNote()
    expect(lastRecord(world).trigger_values.late_turn).toBeUndefined()
  })
})

// The person's /clear started while the note was being written, and its session end landed only after the handoff queued its
// own clear (core's clear awaits, such as the SessionEnd hooks, before the end). The handoff's clear then ran behind it, after a
// turn started in the session the person made.
const personClearInFlightAcrossOwnClear = (world: World, $: Parameters<typeof startTurn>[0]) => {
  const personGate: { release: () => void } = { release: () => undefined }
  const personEndsLater = new Promise<void>(resolve => {
    personGate.release = resolve
  })
  const personClear: { run: Promise<unknown> } = { run: Promise.resolve() }
  world.onClearIssued = async () => {
    world.onClearIssued = async () => {
      world.onClearIssued = undefined
      personGate.release()
      await personClear.run
      await startTurn($, 'queued behind the person clear')
    }
    await personEndsLater
  }
  personClear.run = runCommand($, 'clear')
}

describe('a person clear in flight when the handoff clear is queued', () => {
  test('It records late_turn true when a turn ran in the session the in-flight person clear made', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    personClearInFlightAcrossOwnClear(world, $)
    await finishNote()
    expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { late_turn: true } })
  })

  test('It adds the turn-after-note line when a turn ran in the session the in-flight person clear made', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    personClearInFlightAcrossOwnClear(world, $)
    await finishNote()
    expect(world.appended.join('\n')).toContain(TURN_AFTER_NOTE_LINE)
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

  test('It records cleared_by person because the person clear ran before the handoff clear', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    personClearsThenTurnRuns(world, $)
    await finishNote()
    expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { cleared_by: 'person' } })
  })
})

describe('a foreign clear that finished before the handoff clear', () => {
  test('It writes a debug line saying the clear is credited to the person', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    personClearsThenTurnRuns(world, $)
    await finishNote()
    expect(world.debugLines).toContain('a clear this plugin did not issue finished first, so the clear is credited to the person')
  })

  test('It writes no such debug line when the handoff clear ran alone', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await finishNote()
    expect(world.debugLines.filter(line => line.includes('did not issue'))).toEqual([])
  })
})

describe('second_clear', () => {
  test('It records second_clear true when the person clear ran first and the handoff clear ran too', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    personClearsThenTurnRuns(world, $)
    await finishNote()
    expect(lastRecord(world).trigger_values).toMatchObject({ cleared_by: 'person', second_clear: true })
  })

  test('It leaves second_clear off when the handoff clear ran alone', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await finishNote()
    expect(lastRecord(world).trigger_values.second_clear).toBeUndefined()
  })
})

describe('a person clear in flight when the handoff clear is queued, ending first', () => {
  test('It records cleared_by person because the in-flight person clear ended before the handoff clear', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    personClearInFlightAcrossOwnClear(world, $)
    await finishNote()
    expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { cleared_by: 'person' } })
  })
})

describe('a person clear that ran after the handoff clear', () => {
  test('It records cleared_by handoff because the handoff clear ran first', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    // The delivery registers /handoff after the handoff clear returned and before the record is written, so the person's
    // clear runs and returns inside the handoff, behind the handoff clear.
    world.onCommandRegistered = async () => {
      world.onCommandRegistered = undefined
      await runCommand($, 'clear')
    }
    await finishNote()
    expect(world.clearOrigins).toHaveLength(2)
    expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { cleared_by: 'handoff' } })
  })
})

describe('a person clear answered in its place while the handoff clear waits, for cleared_by', () => {
  test('It records cleared_by handoff because the answered clear ran nothing', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    answeredPersonClearThenOwnClear(world, $)
    await finishNote()
    expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { cleared_by: 'handoff' } })
  })
})
