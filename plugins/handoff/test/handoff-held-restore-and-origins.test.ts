import { describe, expect, test } from 'claude-code/testing'

import { dropOf, submitPerson, writingTheNote } from './helpers'
import {
  ASK,
  NOTE_MESSAGE,
  HELD_FOR_HANDOFF,
  REPEAT_NOT_ADDED,
  IMAGE,
  entered,
  heldBeforeTheHandoff,
  unattendedHandoffWriting,
  carriedPlusScheduled,
  repeatOnSubmitAfter,
} from './handoff-held-prompts-fixtures'

describe('abandoning a handoff and restoring held prompts', () => {
  test('It puts the held prompt back in the box when no note was written', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await failNote()
    expect(world.box.text).toBe('next thing')
  })

  test('It runs no turn for the held prompt when no note was written', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await failNote()
    expect(entered(world)).toEqual([])
  })

  test('It puts the held prompt back in the box when the clear fails', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.clearThrows = true
    await submitPerson($, 'next thing')
    await finishNote()
    expect(world.box.text).toBe('next thing')
  })

  test('It puts every held prompt back in the box in order when the handoff fails', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'first')
    await submitPerson($, 'second')
    await failNote()
    expect(world.box.text).toBe('first\n\nsecond')
  })

  test('It puts the held prompt in the box when the fresh session refuses it', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.submitDropped = true
    await submitPerson($, 'next thing')
    await finishNote()
    expect(world.box.text).toBe('next thing')
  })

  test('It puts a person prompt held during an unattended handoff back in the box when the note fails', ASK, async ($, on) => {
    const { world, failNote } = await unattendedHandoffWriting($, on)
    await submitPerson($, 'actually wait')
    await failNote()
    expect(world.box.text).toBe('actually wait')
  })

  test('It submits the carried scheduled prompt of an unattended handoff when the note fails', ASK, async ($, on) => {
    const { world, failNote } = await unattendedHandoffWriting($, on)
    await submitPerson($, 'actually wait')
    await failNote()
    expect(entered(world)).toEqual(['entered:composer:start on ENG-1', 'entered:plugin:now ENG-2'])
  })

  test('It submits a scheduled prompt held during an attended handoff when the note fails', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'run the nightly job', { kind: 'scheduled-trigger' })
    await failNote()
    expect(entered(world)).toEqual(['entered:plugin:run the nightly job'])
  })

  test('It puts a person prompt back in the box and submits a scheduled one when the clear fails', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.clearThrows = true
    await submitPerson($, 'person says')
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await finishNote()
    expect([world.box.text, entered(world)]).toEqual(['person says', ['entered:plugin:nightly job']])
  })

  test('It puts a person prompt in the box and the transcript for a scheduled one when the fresh session refuses both', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.submitDropped = true
    await submitPerson($, 'person says')
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await finishNote()
    expect([world.box.text, world.effects.filter(effect => effect.startsWith('log:A prompt could not'))]).toEqual([
      'person says',
      ['log:A prompt could not be sent, so here it is:\nnightly job'],
    ])
  })

  test('It holds a carried prompt the person re-sends from the box while a failed handoff is still restoring', ASK, async ($, on) => {
    const { world, fork } = await carriedPlusScheduled($, on)
    const outcome = repeatOnSubmitAfter($, world, 0)
    fork.release({ isAnswered: false, reason: 'nothing-to-fork' })
    await world.clock.settle()
    expect(outcome.repeat).not.toBeNull()
    expect([dropOf(await outcome.repeat), entered(world), world.box.text]).toEqual([
      HELD_FOR_HANDOFF,
      ['entered:composer:start on ENG-1', 'entered:plugin:nightly job'],
      'now ENG-2',
    ])
  })
})

describe('mixed origins and the carried prompt', () => {
  test('It joins a later prompt after the prompt the handoff already carries', ASK, async ($, on) => {
    const { world, finishNote } = await heldBeforeTheHandoff($, on)
    await submitPerson($, 'also this')
    await finishNote()
    expect(entered(world)).toEqual(['entered:composer:start on ENG-1', 'entered:plugin:now ENG-2\n\nalso this'])
  })

  test('It sends the prompt the handoff already carries once when the person sends it again during the write', ASK, async ($, on) => {
    const { world, finishNote } = await heldBeforeTheHandoff($, on)
    await submitPerson($, 'now ENG-2')
    await finishNote()
    expect(entered(world)).toEqual(['entered:composer:start on ENG-1', 'entered:plugin:now ENG-2'])
  })

  test('It logs a dropped repeat of the carried prompt to debug without its text', ASK, async ($, on) => {
    const { world } = await heldBeforeTheHandoff($, on)
    await submitPerson($, 'now ENG-2')
    expect(world.debugLines).toContain('handoff: dropped a repeat of the prompt the handoff carries')
    expect(world.debugLines.join('\n')).not.toContain('ENG-2')
  })

  test('It drops a repeat of the carried prompt with its own message, not the held one', ASK, async ($, on) => {
    const { world } = await heldBeforeTheHandoff($, on)
    expect(dropOf(await submitPerson($, 'now ENG-2'))).toBe(REPEAT_NOT_ADDED)
    expect(world.effects).not.toContain(`toast:${HELD_FOR_HANDOFF}`)
  })

  test('It submits the note alone, then the scheduled prompt, when the append is denied and only a scheduled prompt is held', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.appendDenied = true
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await finishNote()
    expect(entered(world)).toEqual([`entered:plugin:${NOTE_MESSAGE}`, 'entered:plugin:nightly job'])
  })

  test('It sends each origin group in the fresh session joined in arrival order', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'person one')
    await submitPerson($, 'nightly one', { kind: 'scheduled-trigger' })
    await submitPerson($, 'person two')
    await finishNote()
    expect(entered(world)).toEqual(['entered:plugin:person one\n\nperson two', 'entered:plugin:nightly one'])
  })

  test('It joins only the attended prompts to the note of an attended handoff and sends scheduled ones apart', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.appendDenied = true
    await submitPerson($, 'person says')
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await finishNote()
    expect(entered(world)).toEqual([`entered:plugin:${NOTE_MESSAGE}\n\nperson says`, 'entered:plugin:nightly job'])
  })

  test('It joins only the scheduled prompts to the note of an unattended handoff and sends person prompts apart', ASK, async ($, on) => {
    const { world, finishNote } = await unattendedHandoffWriting($, on)
    world.appendDenied = true
    await submitPerson($, 'person says')
    await finishNote()
    expect(entered(world)).toEqual(['entered:composer:start on ENG-1', `entered:plugin:${NOTE_MESSAGE}\n\nnow ENG-2`, 'entered:plugin:person says'])
  })

  test('It drops a repeat of the carried prompt that arrives with an attachment and leaves the box alone', ASK, async ($, on) => {
    const { world, finishNote } = await heldBeforeTheHandoff($, on)
    const repeat = await submitPerson($, 'now ENG-2', { attachments: IMAGE })
    await finishNote()
    expect([dropOf(repeat), world.box.text, entered(world)]).toEqual([
      REPEAT_NOT_ADDED,
      '',
      ['entered:composer:start on ENG-1', 'entered:plugin:now ENG-2'],
    ])
  })
})
