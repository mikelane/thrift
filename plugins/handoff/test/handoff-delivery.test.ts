import { describe, expect, test } from 'claude-code/testing'

import { dropOf, entered, lastRecord, runCommand, startTurn, submitPerson, writingTheNote } from './helpers'
import { ASK, HELD_FOR_HANDOFF, NOTE_MESSAGE, unattendedHandoffWriting } from './handoff-held-prompts-fixtures'

const HELD_BACK_PERSON = 'log:Your prompt was held back after the handoff note, so read the note first. Here it is:\nnext thing'
const TURN_AFTER_NOTE_LINE = 'A turn ran in the previous session while or after this note was written'

describe('submitOrKeepInTranscript', () => {
  test('It submits a held prompt from another sender when the handoff fails', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'run the nightly job', { kind: 'scheduled-trigger' })
    await failNote()
    expect(entered(world)).toEqual(['entered:plugin:run the nightly job'])
  })

  test('It submits a held person prompt as the person when the box cannot take it', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await world.clock.settle()
    world.isFillRefusedOverText = true
    await failNote()
    expect(entered(world)).toEqual(['entered:plugin+asUser:next thing'])
  })

  test('It says why when the submit throws', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'run the nightly job', { kind: 'scheduled-trigger' })
    world.submitThrows = true
    await failNote()
    expect(world.debugLines).toContain('handoff: could not restore the held prompt: HooksError: no implementation for prompt.submit')
  })
})

describe('sendOrKeepInBox', () => {
  test('It sends a held person prompt as the person after the note', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await finishNote()
    expect(entered(world)).toEqual(['entered:plugin+asUser:next thing'])
  })

  test('It puts the prompt in the box when the fresh session refuses it', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    world.submitDropped = true
    await finishNote()
    expect(world.box.text).toBe('next thing')
  })

  test('It says why when the fresh session refuses the prompt', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    world.submitDropped = true
    await finishNote()
    expect(world.debugLines).toContain('handoff: could not send the prompt: refused by another hook')
  })

  test('It sends no held person prompt ahead of a note that never entered the fresh session', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    world.appendDenied = true
    world.submitDropped = true
    await finishNote()
    expect(entered(world)).toEqual([])
  })

  test('It logs a held-back person prompt that the box refuses', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await world.clock.settle()
    world.appendDenied = true
    world.submitDropped = true
    world.isFillRefusedOverText = true
    await finishNote()
    expect(world.effects.some(effect => effect.endsWith('Here it is:\nnext thing'))).toBe(true)
  })
})

describe('restoreHeldGroups', () => {
  test('It puts every held group back in order when the handoff fails', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'first')
    await world.clock.settle()
    await submitPerson($, 'second')
    await failNote()
    expect(world.box.text).toBe('first\n\nsecond')
  })

  test('It restores nothing when no prompt was held', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await failNote()
    expect([world.box.text, entered(world)]).toEqual(['', []])
  })
})

describe('restoreLateArrivals', () => {
  test('It submits a prompt that arrives mid-restore after the held ones', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    let arrival: Promise<unknown> = Promise.resolve()
    world.submitHooks = [
      () => {
        arrival = submitPerson($, 'late job', { kind: 'scheduled-trigger' })
      },
    ]
    await failNote()
    await arrival
    expect(entered(world)).toEqual(['entered:plugin:nightly job', 'entered:plugin:late job'])
  })

  test('It puts a person prompt that arrives mid-restore in the box behind a draft the person typed since', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    let arrival: Promise<unknown> = Promise.resolve()
    world.submitHooks = [
      () => {
        arrival = submitPerson($, 'late typed').then(() => {
          world.box = { text: 'my draft', cursor: 8 }
        })
      },
    ]
    await failNote()
    await arrival
    expect(world.box.text).toBe('my draft\nlate typed')
  })

  test('It puts a person prompt that arrives mid-restore in the box behind the held one', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    let arrival: Promise<unknown> = Promise.resolve()
    world.submitHooks = [
      () => {
        arrival = submitPerson($, 'late typed')
      },
    ]
    await failNote()
    await arrival
    expect(world.box.text).toBe('held one\nlate typed')
  })
})

describe('continueInFreshSession', () => {
  test('It appends the note to the fresh session', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await finishNote()
    expect(world.appended).toEqual([NOTE_MESSAGE])
  })

  test('It writes a cleared record that names the note delivery', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await finishNote()
    expect([lastRecord(world).action, lastRecord(world).trigger_values.note]).toEqual(['cleared', 'appended'])
  })

  test('It records which delivery a held prompt got', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await finishNote()
    expect(lastRecord(world).trigger_values.held_other_delivery).toBe('submitted')
  })

  test('It keeps a held person prompt in the box when the note could not be delivered', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await world.clock.settle()
    world.appendDenied = true
    world.submitDropped = true
    await finishNote()
    expect(world.box.text).toContain('Handoff from the previous session')
  })

  test('It logs a held-back person prompt when neither the note nor the box can take it', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await world.clock.settle()
    world.appendDenied = true
    world.submitDropped = true
    world.isFillRefusedOverText = true
    await finishNote()
    expect(world.effects).toContain(HELD_BACK_PERSON)
  })
})

describe('the late-turn check in continueInFreshSession', () => {
  test('It leaves the turn-after-note line out when a turn starts while /handoff is being registered after the clear', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.onCommandRegistered = async () => {
      world.onCommandRegistered = undefined
      await startTurn($, 'queued before the clear ran')
    }
    await finishNote()
    expect(world.appended.join('\n')).not.toContain(TURN_AFTER_NOTE_LINE)
  })

  // The person's /clear was counted ahead of the handoff's but has not ended, so the handoff's clear still counts as queued.
  test('It puts the turn-after-note line in when a turn starts while /handoff is being registered with the clear still queued', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    let endPersonClear = () => {}
    const personClearRunning = new Promise<void>(resolve => {
      endPersonClear = resolve
    })
    let personClear: Promise<unknown> = Promise.resolve()
    world.onClearIssued = async () => {
      world.onClearIssued = () => personClearRunning
      personClear = runCommand($, 'clear')
    }
    world.onCommandRegistered = async () => {
      world.onCommandRegistered = undefined
      await startTurn($, 'queued behind the person clear')
    }
    await finishNote()
    endPersonClear()
    await personClear
    expect(world.appended.join('\n')).toContain(TURN_AFTER_NOTE_LINE)
  })
})

describe('releasing the carried prompt in continueInFreshSession', () => {
  test('It holds a repeat of the carried scheduled prompt as a new prompt once the note carried it along', ASK, async ($, on) => {
    const { world, finishNote } = await unattendedHandoffWriting($, on)
    world.appendDenied = true
    await submitPerson($, 'person says')
    let repeat: Promise<unknown> = Promise.resolve()
    world.submitHooks = [
      undefined,
      () => {
        repeat = submitPerson($, 'now ENG-2', { kind: 'scheduled-trigger' })
      },
    ]
    await finishNote()
    expect(dropOf(await repeat)).toBe(HELD_FOR_HANDOFF)
  })
})
