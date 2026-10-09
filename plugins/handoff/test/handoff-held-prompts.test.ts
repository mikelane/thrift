import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelForkResult, On } from 'claude-code'

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
const HELD_FOR_HANDOFF = 'A handoff is in progress. Your prompt is held and will be sent in the fresh session.'
const REFUSED_DURING_HANDOFF =
  'A handoff is in progress, so a prompt with attachments or context cannot be held. It is back in your prompt box. Send it again after the handoff.'
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

test('It sends a prompt sent twice during the write only once', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await submitPerson($, 'again')
  await submitPerson($, 'again')
  await finishNote()
  expect(entered(world)).toEqual(['entered:plugin:again'])
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
  return { world, finishNote: async () => {
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
  expect(world.effects).toContain(`toast:${REFUSED_DURING_HANDOFF}`)
})

test('It refuses a prompt with context while the note is written', async ($, on) => {
  const { world } = await writingTheNote($, on)
  expect(dropOf(await submitPerson($, 'see this', { context: ['@file'] }))).toBe(REFUSED_DURING_HANDOFF)
  expect(world.effects).toContain(`toast:${REFUSED_DURING_HANDOFF}`)
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
