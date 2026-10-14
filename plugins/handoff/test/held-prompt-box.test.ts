import { describe, expect, test } from 'claude-code/testing'

import { boxCopiesOf } from '../hooks/handoff-note'
import { entered, submitPerson, writingTheNote } from './helpers'

const fills = (effects: string[]) => effects.filter(effect => effect.startsWith('fill:'))

describe('the prompt box after a held prompt is delivered', () => {
  test('It leaves the box empty after a held person prompt is sent in the fresh session', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await finishNote()
    expect([entered(world), world.box.text]).toEqual([['entered:plugin:next thing'], ''])
  })

  test('It leaves the box empty after a group of held prompts is sent', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'first')
    await submitPerson($, 'second')
    await finishNote()
    expect([entered(world), world.box.text]).toEqual([['entered:plugin:first\n\nsecond'], ''])
  })

  test('It leaves the box empty after the note and a held prompt are sent together', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.appendDenied = true
    await submitPerson($, 'first')
    await submitPerson($, 'second')
    await finishNote()
    expect([entered(world).length, world.box.text]).toEqual([1, ''])
  })

  test('It leaves the box empty after a prompt that arrived during the delivery is sent', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    world.submitHooks = [
      () => {
        void submitPerson($, 'late')
      },
    ]
    await finishNote()
    expect([entered(world), world.box.text]).toEqual([['entered:plugin:held one', 'entered:plugin:late'], ''])
  })

  test('It leaves a box alone that holds a different draft than the prompt sent', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    world.box = { text: 'something else', cursor: 14 }
    await finishNote()
    expect([world.box.text, fills(world.effects)]).toEqual(['something else', []])
  })

  test('It takes only the sent prompt out of a box that also holds a draft', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    world.box = { text: 'next thing\nmy draft', cursor: 18 }
    await finishNote()
    expect(world.box.text).toBe('my draft')
  })

  test('It leaves the box alone after a held bridge prompt is sent', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'from phone', { kind: 'bridge' })
    world.box = { text: 'from phone', cursor: 10 }
    await finishNote()
    expect([world.box.text, fills(world.effects)]).toEqual(['from phone', []])
  })

  test('It keeps the box when a held prompt could not be sent', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    world.submitDropped = true
    await finishNote()
    expect([entered(world), world.box.text]).toEqual([[], 'next thing'])
  })

  test('It writes a debug line and carries on when the box refuses to be emptied', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    world.isFillRefusedOverText = true
    await finishNote()
    expect(world.effects).toContain('debug:handoff: the prompt box refused to be emptied: refused by a hook')
  })

  test('It writes a debug line and carries on when the box cannot be read', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    world.boxReadDenied = true
    await finishNote()
    expect(world.effects.filter(effect => effect.startsWith('debug:handoff: could not empty the prompt box'))).toHaveLength(1)
  })
})

describe('the prompt box when a held group goes back to it', () => {
  test('It puts a group of held prompts back once when the engine kept its last prompt', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'first')
    await submitPerson($, 'second')
    await failNote()
    expect(world.box.text).toBe('first\n\nsecond')
  })

  test('It keeps a draft typed after the last prompt when the group goes back', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'first')
    await submitPerson($, 'second')
    world.box = { text: 'second\nmy draft', cursor: 14 }
    await failNote()
    expect(world.box.text).toBe('first\n\nsecond\nmy draft')
  })

  test('It puts a single held prompt back once when the engine kept its text', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await failNote()
    expect([world.box.text, fills(world.effects)]).toEqual(['next thing', []])
  })
})

describe('boxCopiesOf', () => {
  test('It returns the text alone for a prompt without a last prompt', () => {
    expect(boxCopiesOf({ text: 'a' })).toEqual(['a'])
  })

  test('It returns the joined text and the last prompt for a group', () => {
    expect(boxCopiesOf({ text: 'a\n\nb', lastText: 'b' })).toEqual(['a\n\nb', 'b'])
  })
})
