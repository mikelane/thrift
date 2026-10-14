import { describe, expect, test } from 'claude-code/testing'

import { groupHeldPrompts, groupJoiningNote, groupsLeftToSend, speaksForPerson } from '../hooks/handoff-note'
import { answered, dropOf, entered, submitPerson, writingTheNote } from './helpers'
import {
  ASK,
  HELD_FOR_HANDOFF,
  REPEAT_NOT_ADDED,
  heldBeforeTheHandoff,
  repeatingDuringDelivery,
  carriedPlusScheduled,
  repeatOnSubmitAfter,
  personGroup,
  scheduledGroup,
} from './handoff-held-prompts-fixtures'

describe('prompts that arrive after the clear', () => {
  test('It passes a prompt sent after the handoff finished', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await finishNote()
    expect(dropOf(await submitPerson($, 'after'))).toBeUndefined()
    expect(entered(world)).toEqual(['entered:composer:after'])
  })

  test('It drops a repeat of the carried prompt that arrives after the clear', ASK, async ($, on) => {
    const { outcome } = await repeatingDuringDelivery($, on)
    expect(outcome.drop).toBe(REPEAT_NOT_ADDED)
  })

  test('It sends the carried prompt once when it is repeated after the clear', ASK, async ($, on) => {
    const { world } = await repeatingDuringDelivery($, on)
    expect(entered(world)).toEqual(['entered:composer:start on ENG-1', 'entered:plugin+asUser:now ENG-2'])
  })

  test('It lets a repeat of the carried prompt through once the handoff has finished', ASK, async ($, on) => {
    const { world, finishNote } = await heldBeforeTheHandoff($, on)
    await finishNote()
    expect(dropOf(await submitPerson($, 'now ENG-2'))).toBeUndefined()
    expect(entered(world).at(-1)).toBe('entered:composer:now ENG-2')
  })

  test('It holds a carried prompt the person re-sends from the box while the scheduled group is delivered', ASK, async ($, on) => {
    const { world, fork } = await carriedPlusScheduled($, on)
    world.submitDropped = true
    const outcome = repeatOnSubmitAfter($, world, 1)
    fork.release(answered('The handoff note.'))
    await world.clock.settle()
    expect(outcome.repeat).not.toBeNull()
    expect(dropOf(await outcome.repeat)).toBe(HELD_FOR_HANDOFF)
  })

  test('It holds back a carried prompt the person re-sends from the box, but sends the scheduled group, once the note was refused', ASK, async ($, on) => {
    const { world, fork } = await carriedPlusScheduled($, on)
    world.appendDenied = true
    world.submitDropped = true
    const outcome = repeatOnSubmitAfter($, world, 1)
    fork.release(answered('The handoff note.'))
    await world.clock.settle()
    expect(outcome.repeat).not.toBeNull()
    expect([dropOf(await outcome.repeat), entered(world)]).toEqual([
      HELD_FOR_HANDOFF,
      ['entered:composer:start on ENG-1', 'entered:plugin:nightly job'],
    ])
  })
})

describe('groupHeldPrompts', () => {
  test('It returns no groups from groupHeldPrompts for no prompts', () => {
    expect(groupHeldPrompts([])).toEqual([])
  })

  test('It joins prompts of one origin in arrival order in groupHeldPrompts', () => {
    expect(groupHeldPrompts([{ text: 'a', isUnattended: false, origin: 'composer' }, { text: 'a', isUnattended: false, origin: 'composer' }])).toEqual([
      { text: 'a\n\na', isUnattended: false, origin: 'composer', boxText: 'a' },
    ])
  })

  test('It keeps one group per origin, ordered by first arrival, in groupHeldPrompts', () => {
    expect(
      groupHeldPrompts([
        { text: 'u1', isUnattended: true, origin: 'scheduled-trigger' },
        { text: 'p1', isUnattended: false, origin: 'composer' },
        { text: 'u2', isUnattended: true, origin: 'scheduled-trigger' },
      ]),
    ).toEqual([
      { text: 'u1\n\nu2', isUnattended: true, origin: 'scheduled-trigger' },
      { text: 'p1', isUnattended: false, origin: 'composer' },
    ])
  })
})

describe('boxText on a group', () => {
  test('It leaves boxText off a group of one prompt', () => {
    expect(groupHeldPrompts([personGroup])[0]).not.toHaveProperty('boxText')
  })

  test('It sets boxText to the last prompt of a group of several', () => {
    const prompts = [personGroup, { ...personGroup, text: 'and then' }, { ...personGroup, text: 'finally, this' }]
    expect(groupHeldPrompts(prompts)[0]?.boxText).toBe('finally, this')
  })

  test('It keeps the composer prompt as boxText when a bridge prompt joins after it', () => {
    const prompts = [personGroup, { ...personGroup, text: 'from phone', origin: 'bridge' as const }]
    expect(groupHeldPrompts(prompts)[0]?.boxText).toBe(personGroup.text)
  })

  test('It sets boxText to a composer prompt that joins a bridge prompt', () => {
    const prompts = [{ ...personGroup, text: 'from phone', origin: 'bridge' as const }, personGroup]
    expect(groupHeldPrompts(prompts)[0]?.boxText).toBe(personGroup.text)
  })

  test('It leaves boxText off a group with no composer prompt in it', () => {
    const prompts = [{ ...personGroup, origin: 'bridge' as const }, { ...personGroup, text: 'again', origin: 'sdk' as const }]
    expect(groupHeldPrompts(prompts)[0]).not.toHaveProperty('boxText')
  })
})

describe('groupJoiningNote and groupsLeftToSend', () => {
  test('It picks the scheduled group in groupJoiningNote for an unattended handoff', () => {
    expect(groupJoiningNote([personGroup, scheduledGroup], true)).toEqual(scheduledGroup)
  })

  test('It picks no group in groupJoiningNote for an attended handoff, so the person group stays apart from the note', () => {
    expect(groupJoiningNote([personGroup, scheduledGroup], false)).toBeUndefined()
  })

  test('It picks no group in groupJoiningNote when no scheduled group is held for an unattended handoff', () => {
    expect(groupJoiningNote([personGroup], true)).toBeUndefined()
  })

  test('It leaves every group to send in groupsLeftToSend when the note was appended', () => {
    expect(groupsLeftToSend([personGroup, scheduledGroup], false, 'appended')).toEqual([personGroup, scheduledGroup])
  })

  for (const noteDelivery of ['submitted', 'in_box', 'not_carried'] as const) {
    test(`It leaves every group to send in groupsLeftToSend when the note was ${noteDelivery} and an attended handoff kept it apart`, () => {
      expect(groupsLeftToSend([personGroup, scheduledGroup], false, noteDelivery)).toEqual([personGroup, scheduledGroup])
    })

    test(`It leaves only the person group to send in groupsLeftToSend when the note was ${noteDelivery} with the scheduled group of an unattended handoff`, () => {
      expect(groupsLeftToSend([personGroup, scheduledGroup], true, noteDelivery)).toEqual([personGroup])
    })
  }

  test('It leaves no groups to send in groupsLeftToSend for no groups', () => {
    expect(groupsLeftToSend([], false, 'submitted')).toEqual([])
  })
})

describe('speaksForPerson', () => {
  test('It returns true from speaksForPerson for an attended composer prompt', () => {
    expect(speaksForPerson(personGroup)).toBe(true)
  })

  test('It returns false from speaksForPerson for a scheduled prompt', () => {
    expect(speaksForPerson(scheduledGroup)).toBe(false)
  })

  test('It returns false from speaksForPerson for the plugin note, whatever person origin it borrows', () => {
    expect(speaksForPerson({ ...personGroup, isPluginAuthored: true })).toBe(false)
  })

  test('It returns true from speaksForPerson for a bridge prompt', () => {
    expect(speaksForPerson({ ...personGroup, origin: 'bridge' })).toBe(true)
  })

  test('It returns false from speaksForPerson for an origin that is not a person', () => {
    expect(speaksForPerson({ ...personGroup, origin: 'task-notification' })).toBe(false)
  })
})
