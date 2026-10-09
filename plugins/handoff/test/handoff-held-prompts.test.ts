import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelForkResult, On } from 'claude-code'

import { groupHeldPrompts, groupJoiningNote, groupsLeftToSend } from '../hooks/handoff-note'
import {
  answered,
  compacted,
  dropOf,
  growTo200k,
  install,
  runCommand,
  startSession,
  submitPerson,
  type World,
} from './helpers'

const ASK = { options: { handoffMode: 'ask' } } as const
const NOTE_MESSAGE = 'Handoff from the previous session (old-session), written by Claude just before a /clear:\n\nThe handoff note.'
const HELD_FOR_HANDOFF = 'A handoff is in progress. Your prompt is held and will be sent when it finishes, or put back if it fails.'
const REPEAT_NOT_ADDED = 'The handoff already carries this prompt, so this repeat was not added.'
const REFUSED_DURING_HANDOFF =
  'A handoff is in progress, and a prompt with attachments or context cannot be held. Its text is put back where possible. Send it again after the handoff.'
const REFUSED_TOAST = "Not held: a prompt with attachments or context can't wait for a handoff. Send it again after."
const IMAGE = [{ type: 'image', mediaType: 'image/png' }] as const

const holdFork = (world: World) => {
  const held: { release: (result: ModelForkResult) => void } = { release: () => undefined }
  world.fork = () =>
    new Promise<ModelForkResult>(resolve => {
      held.release = resolve
    })
  return held
}

const writingTheNote = async ($: Engine, on: On) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  const finishWith = async (result: ModelForkResult) => {
    fork.release(result)
    await world.clock.settle()
  }
  return { world, finishNote: () => finishWith(answered('The handoff note.')), failNote: () => finishWith({ isAnswered: false, reason: 'nothing-to-fork' }) }
}

const entered = (world: World) => world.effects.filter(effect => effect.startsWith('entered:'))

test('It drops a person prompt sent while the note is written', async ($, on) => {
  await writingTheNote($, on)
  expect(dropOf(await submitPerson($, 'next thing'))).toBe(HELD_FOR_HANDOFF)
})

test('It runs no turn for a prompt sent while the note is written', async ($, on) => {
  const { world } = await writingTheNote($, on)
  await submitPerson($, 'next thing')
  expect(entered(world)).toEqual([])
})

test('It sends the held prompt in the fresh session after the note', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await submitPerson($, 'next thing')
  await finishNote()
  expect(world.effects.filter(effect => ['clear', 'append', 'entered:plugin:next thing'].includes(effect))).toEqual([
    'clear',
    'append',
    'entered:plugin:next thing',
  ])
})

test('It holds a prompt from the bridge', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await submitPerson($, 'from phone', { kind: 'bridge' })
  await finishNote()
  expect(entered(world)).toEqual(['entered:plugin:from phone'])
})

test('It holds a prompt from the sdk', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await submitPerson($, 'from sdk', { kind: 'sdk' })
  await finishNote()
  expect(entered(world)).toEqual(['entered:plugin:from sdk'])
})

test('It holds a prompt from a scheduled trigger', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await submitPerson($, 'from schedule', { kind: 'scheduled-trigger' })
  await finishNote()
  expect(entered(world)).toEqual(['entered:plugin:from schedule'])
})

test('It does not hold a prompt from another session', async ($, on) => {
  const { world } = await writingTheNote($, on)
  expect(dropOf(await submitPerson($, 'psst', { kind: 'peer' }))).toBeUndefined()
  expect(entered(world)).toEqual(['entered:peer:psst'])
})

test('It sends several held prompts once, joined in the order they arrived', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await submitPerson($, 'first')
  await submitPerson($, 'second')
  await submitPerson($, 'third')
  await finishNote()
  expect(entered(world)).toEqual(['entered:plugin:first\n\nsecond\n\nthird'])
})

test('It sends two identical prompts sent on purpose during the write both', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await submitPerson($, 'continue')
  await submitPerson($, 'continue')
  await finishNote()
  expect(entered(world)).toEqual(['entered:plugin:continue\n\ncontinue'])
})

const heldBeforeTheHandoff = async ($: Engine, on: On) => {
  const world = install($, on)
  const fork = holdFork(world)
  world.branch = 'alice/eng-1-start'
  await startSession($)
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2')
  await runCommand($, 'handoff')
  await world.clock.settle()
  return { world, fork, finishNote: async () => {
    fork.release(answered('The handoff note.'))
    await world.clock.settle()
  } }
}

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

test('It joins the held prompt to the note when the note has to be submitted', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  world.appendDenied = true
  await submitPerson($, 'next thing')
  await finishNote()
  expect(entered(world)).toEqual([`entered:plugin:${NOTE_MESSAGE}\n\nnext thing`])
})

test('It puts the held prompt in the box when the fresh session refuses it', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  world.submitDropped = true
  await submitPerson($, 'next thing')
  await finishNote()
  expect(world.box.text).toBe('next thing')
})

test('It passes a prompt sent after the handoff finished', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await finishNote()
  expect(dropOf(await submitPerson($, 'after'))).toBeUndefined()
  expect(entered(world)).toEqual(['entered:composer:after'])
})

test('It refuses a prompt with attachments while the note is written', async ($, on) => {
  const { world } = await writingTheNote($, on)
  expect(dropOf(await submitPerson($, 'look', { attachments: IMAGE }))).toBe(REFUSED_DURING_HANDOFF)
  expect(world.effects).toContain(`toast:${REFUSED_TOAST}`)
})

test('It refuses a prompt with context while the note is written', async ($, on) => {
  const { world } = await writingTheNote($, on)
  expect(dropOf(await submitPerson($, 'see this', { context: ['@file'] }))).toBe(REFUSED_DURING_HANDOFF)
  expect(world.effects).toContain(`toast:${REFUSED_TOAST}`)
})

test('It leaves a refused prompt in the box', async ($, on) => {
  const { world } = await writingTheNote($, on)
  await submitPerson($, 'look', { attachments: IMAGE })
  await world.clock.settle()
  expect(world.box.text).toBe('look')
})

test('It does not send a refused prompt in the fresh session', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await submitPerson($, 'look', { attachments: IMAGE })
  await finishNote()
  expect(entered(world)).toEqual([])
})

test('It keeps a refused prompt in the transcript when the box cannot take it', async ($, on) => {
  const { world } = await writingTheNote($, on)
  world.fillRefusal = 'dialog'
  await submitPerson($, 'look', { attachments: IMAGE })
  await world.clock.settle()
  expect(world.effects).toContain('log:Your prompt could not be sent or put back in the box. Here it is:\nlook')
})

test('It holds a text prompt next to a refused one', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await submitPerson($, 'look', { attachments: IMAGE })
  await submitPerson($, 'plain')
  await finishNote()
  expect(entered(world)).toEqual(['entered:plugin:plain'])
})

test('It logs a held prompt to debug with the count and no text', async ($, on) => {
  const { world } = await writingTheNote($, on)
  await submitPerson($, 'secret words')
  await submitPerson($, 'more words')
  expect(world.debugLines).toContain('handoff: held a prompt for the handoff (2 held)')
  expect(world.debugLines.join('\n')).not.toContain('words')
})

test('It logs a refused prompt to debug without its text', async ($, on) => {
  const { world } = await writingTheNote($, on)
  await submitPerson($, 'secret words', { attachments: IMAGE })
  expect(world.debugLines).toContain('handoff: refused a prompt with attachments or context during the handoff')
  expect(world.debugLines.join('\n')).not.toContain('words')
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

test('It holds a prompt sent while the session is compacted before the clear', { options: { compactBeforeClear: true } }, async ($, on) => {
  const world = install($, on)
  let finishCompaction: () => void = () => undefined
  world.compact = () =>
    new Promise(resolve => {
      finishCompaction = () => resolve(compacted(48_000))
    })
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(dropOf(await submitPerson($, 'during compaction'))).toBe(HELD_FOR_HANDOFF)
  finishCompaction()
  await world.clock.settle()
  expect(entered(world)).toEqual(['entered:plugin:during compaction'])
})

// An unattended handoff: a scheduled prompt that names new work hands off without asking.
const unattendedHandoffWriting = async ($: Engine, on: On) => {
  const world = install($, on)
  const fork = holdFork(world)
  world.branch = 'alice/eng-1-start'
  await startSession($)
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2', { kind: 'scheduled-trigger' })
  await world.clock.settle()
  const finishWith = async (result: ModelForkResult) => {
    fork.release(result)
    await world.clock.settle()
  }
  return { world, finishNote: () => finishWith(answered('The handoff note.')), failNote: () => finishWith({ isAnswered: false, reason: 'nothing-to-fork' }) }
}

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

test('It sends each origin group in the fresh session joined in arrival order', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await submitPerson($, 'person one')
  await submitPerson($, 'nightly one', { kind: 'scheduled-trigger' })
  await submitPerson($, 'person two')
  await finishNote()
  expect(entered(world)).toEqual(['entered:plugin:person one\n\nperson two', 'entered:plugin:nightly one'])
})

test('It puts a person prompt in the box and the transcript for a scheduled one when the fresh session refuses both', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  world.submitDropped = true
  await submitPerson($, 'person says')
  await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
  await finishNote()
  expect([world.box.text, world.effects.filter(effect => effect.startsWith('log:Your prompt'))]).toEqual([
    'person says',
    ['log:Your prompt could not be sent or put back in the box. Here it is:\nnightly job'],
  ])
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

test('It never holds a plugin prompt sent while the note is written', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await $.prompt.submit({ text: 'from a plugin', wait: false, origin: { kind: 'plugin', name: 'other' } })
  await finishNote()
  expect(entered(world)).toEqual(['entered:plugin:from a plugin'])
})

// The handoff checks whether the append is denied right after the clear, before it delivers anything: the person repeats the carried prompt then.
const repeatingDuringDelivery = async ($: Engine, on: On) => {
  const { world, finishNote } = await heldBeforeTheHandoff($, on)
  let repeat: Promise<unknown> = Promise.resolve(undefined)
  Object.defineProperty(world, 'appendDenied', {
    get: () => {
      repeat = submitPerson($, 'now ENG-2')
      return false
    },
  })
  await finishNote()
  return { world, outcome: { drop: dropOf(await repeat) } }
}

test('It drops a repeat of the carried prompt that arrives after the clear', ASK, async ($, on) => {
  const { outcome } = await repeatingDuringDelivery($, on)
  expect(outcome.drop).toBe(REPEAT_NOT_ADDED)
})

test('It sends the carried prompt once when it is repeated after the clear', ASK, async ($, on) => {
  const { world } = await repeatingDuringDelivery($, on)
  expect(entered(world)).toEqual(['entered:composer:start on ENG-1', 'entered:plugin:now ENG-2'])
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

test('It lets a repeat of the carried prompt through once the handoff has finished', ASK, async ($, on) => {
  const { world, finishNote } = await heldBeforeTheHandoff($, on)
  await finishNote()
  expect(dropOf(await submitPerson($, 'now ENG-2'))).toBeUndefined()
  expect(entered(world).at(-1)).toBe('entered:composer:now ENG-2')
})

test('It returns no groups from groupHeldPrompts for no prompts', () => {
  expect(groupHeldPrompts([])).toEqual([])
})

test('It joins prompts of one origin in arrival order in groupHeldPrompts', () => {
  expect(groupHeldPrompts([{ text: 'a', isUnattended: false }, { text: 'a', isUnattended: false }])).toEqual([
    { text: 'a\n\na', isUnattended: false },
  ])
})

test('It keeps one group per origin, ordered by first arrival, in groupHeldPrompts', () => {
  expect(
    groupHeldPrompts([
      { text: 'u1', isUnattended: true },
      { text: 'p1', isUnattended: false },
      { text: 'u2', isUnattended: true },
    ]),
  ).toEqual([
    { text: 'u1\n\nu2', isUnattended: true },
    { text: 'p1', isUnattended: false },
  ])
})

// Ask mode: "now ENG-2" names new work and is held on the band; /handoff then carries it. A scheduled prompt
// is held while the note is written, so the handoff settles with two groups: the carried one first.
const carriedPlusScheduled = async ($: Engine, on: On) => {
  const { world, fork } = await heldBeforeTheHandoff($, on)
  await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
  return { world, fork }
}

// The person sends the carried prompt again while the scheduled group is still being delivered: on the submit that
// follows the carried prompt's own (a restore that fills the box makes none), after it was put back or refused.
const repeatOnSubmitAfter = ($: Engine, world: World, submitsBefore: number) => {
  const outcome: { repeat: Promise<unknown> | null } = { repeat: null }
  const repeatCarriedPrompt = () => {
    world.submitDropped = false
    outcome.repeat = submitPerson($, 'now ENG-2')
  }
  world.submitHooks = [...Array.from({ length: submitsBefore }, () => undefined), repeatCarriedPrompt]
  return outcome
}

test('It runs here a carried prompt the person re-sends from the box while a failed handoff is still restoring', ASK, async ($, on) => {
  const { world, fork } = await carriedPlusScheduled($, on)
  const outcome = repeatOnSubmitAfter($, world, 0)
  fork.release({ isAnswered: false, reason: 'nothing-to-fork' })
  await world.clock.settle()
  const repeat = await outcome.repeat
  expect([dropOf(repeat), world.effects.filter(effect => effect.startsWith('entered:'))]).toEqual([
    undefined,
    ['entered:composer:start on ENG-1', 'entered:plugin:nightly job', 'entered:composer:now ENG-2'],
  ])
})

test('It sends a carried prompt the person re-sends from the box after the fresh session refused it', ASK, async ($, on) => {
  const { world, fork } = await carriedPlusScheduled($, on)
  world.submitDropped = true
  const outcome = repeatOnSubmitAfter($, world, 1)
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  const repeat = await outcome.repeat
  expect(dropOf(repeat)).toBeUndefined()
})

test('It runs a carried prompt the person re-sends from the box after the append was denied and the note was refused', ASK, async ($, on) => {
  const { world, fork } = await carriedPlusScheduled($, on)
  world.appendDenied = true
  world.submitDropped = true
  const outcome = repeatOnSubmitAfter($, world, 1)
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  const repeat = await outcome.repeat
  expect([dropOf(repeat), world.effects.filter(effect => effect.startsWith('entered:'))]).toEqual([
    undefined,
    ['entered:composer:start on ENG-1', 'entered:plugin:nightly job', 'entered:composer:now ENG-2'],
  ])
})

const personGroup = { text: 'person says', isUnattended: false }
const scheduledGroup = { text: 'nightly job', isUnattended: true }

test('It picks the group that shares the handoff origin in groupJoiningNote', () => {
  expect([
    groupJoiningNote([personGroup, scheduledGroup], false),
    groupJoiningNote([personGroup, scheduledGroup], true),
  ]).toEqual([personGroup, scheduledGroup])
})

test('It picks no group in groupJoiningNote when none shares the handoff origin', () => {
  expect(groupJoiningNote([scheduledGroup], false)).toBeUndefined()
})

test('It leaves every group to send in groupsLeftToSend when the note was appended', () => {
  expect(groupsLeftToSend([personGroup, scheduledGroup], false, 'appended')).toEqual([personGroup, scheduledGroup])
})

test('It leaves only the other origin to send in groupsLeftToSend when the note was submitted', () => {
  expect(groupsLeftToSend([personGroup, scheduledGroup], false, 'submitted')).toEqual([scheduledGroup])
})

test('It leaves only the other origin to send in groupsLeftToSend when the note was in_box', () => {
  expect(groupsLeftToSend([personGroup, scheduledGroup], false, 'in_box')).toEqual([scheduledGroup])
})

test('It leaves only the other origin to send in groupsLeftToSend when the note was not_carried', () => {
  expect(groupsLeftToSend([personGroup, scheduledGroup], false, 'not_carried')).toEqual([scheduledGroup])
})

test('It leaves no groups to send in groupsLeftToSend for no groups', () => {
  expect(groupsLeftToSend([], false, 'submitted')).toEqual([])
})
