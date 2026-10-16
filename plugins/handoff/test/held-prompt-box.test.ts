import { describe, expect, test } from 'claude-code/testing'

import { boxCopiesOf, boxCopyOf, withoutBoxCopy } from '../hooks/handoff-note'
import { NOTE_MESSAGE } from './handoff-held-prompts-fixtures'
import { entered, submitPerson, writingTheNote, type World } from './helpers'

// The hold-time clear did not run, so the text Claude Code left in the box is still there when the handoff delivers or restores.
const leftInBox = async (world: World, text: string) => {
  await world.clock.settle()
  world.box = { text, cursor: text.length }
}

// The fills that put text in the box; the one that empties it at hold time is `fill:` with nothing after it.
const fills = (effects: string[]) => effects.filter(effect => effect.startsWith('fill:') && effect !== 'fill:')

describe('the prompt box after a held prompt is delivered', () => {
  test('It leaves the box empty after a held person prompt is sent in the fresh session', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await leftInBox(world, 'next thing')
    await finishNote()
    expect([entered(world), world.box.text]).toEqual([['entered:plugin+asUser:next thing'], ''])
  })

  test('It leaves the box empty after a group of held prompts is sent', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'first')
    await world.clock.settle()
    await submitPerson($, 'second')
    await leftInBox(world, 'second')
    await finishNote()
    expect([entered(world), world.box.text]).toEqual([['entered:plugin+asUser:first\n\nsecond'], ''])
  })

  test('It leaves the box empty after the note and a held prompt are sent apart', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.appendDenied = true
    await submitPerson($, 'first')
    await world.clock.settle()
    await submitPerson($, 'second')
    await leftInBox(world, 'second')
    await finishNote()
    expect([entered(world), world.box.text]).toEqual([[`entered:plugin:${NOTE_MESSAGE}`, 'entered:plugin+asUser:first\n\nsecond'], ''])
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
    expect([entered(world), world.box.text]).toEqual([['entered:plugin+asUser:held one', 'entered:plugin+asUser:late'], ''])
  })

  test('It leaves a box alone that holds a different draft than the prompt sent', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await leftInBox(world, 'something else')
    await finishNote()
    expect([world.box.text, fills(world.effects)]).toEqual(['something else', []])
  })

  test('It takes only the sent prompt out of a box that also holds a draft', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await leftInBox(world, 'next thing\nmy draft')
    await finishNote()
    expect(world.box.text).toBe('my draft')
  })

  test('It takes the composer prompt out of the box when a bridge prompt was held beside it', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'my prompt')
    await submitPerson($, 'from phone', { kind: 'bridge' })
    await finishNote()
    expect([entered(world), world.box.text]).toEqual([['entered:plugin+asUser:my prompt\n\nfrom phone'], ''])
  })

  test('It takes a multi-line composer prompt out of the box', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'line one\nline two')
    await finishNote()
    expect(world.box.text).toBe('')
  })

  test('It leaves the box alone after a held bridge prompt is sent', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'from phone', { kind: 'bridge' })
    await leftInBox(world, 'from phone')
    await finishNote()
    expect([world.box.text, fills(world.effects)]).toEqual(['from phone', []])
  })

  test('It keeps the box when a held prompt could not be sent', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await leftInBox(world, 'next thing')
    world.submitDropped = true
    await finishNote()
    expect([entered(world), world.box.text]).toEqual([[], 'next thing'])
  })

  test('It writes a debug line and carries on when the box refuses to be emptied', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await leftInBox(world, 'next thing')
    world.isFillRefusedOverText = true
    await finishNote()
    expect(world.effects).toContain('debug:handoff: the prompt box refused to be emptied: refused by a hook')
  })

  test('It writes a debug line and carries on when the box cannot be read', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await leftInBox(world, 'next thing')
    world.boxReadDenied = true
    await finishNote()
    expect(world.effects.filter(effect => effect.startsWith('debug:handoff: could not empty the prompt box'))).toHaveLength(1)
  })
})

describe('the prompt box when a held group goes back to it', () => {
  test('It puts a group of held prompts back once when the engine kept its last prompt', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'first')
    await world.clock.settle()
    await submitPerson($, 'second')
    await leftInBox(world, 'second')
    await failNote()
    expect(world.box.text).toBe('first\n\nsecond')
  })

  test('It keeps a draft typed after the last prompt when the group goes back', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'first')
    await world.clock.settle()
    await submitPerson($, 'second')
    await leftInBox(world, 'second\nmy draft')
    await failNote()
    expect(world.box.text).toBe('first\n\nsecond\nmy draft')
  })

  test('It puts a single held prompt back once when the engine kept its text', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await leftInBox(world, 'next thing')
    await failNote()
    expect([world.box.text, fills(world.effects)]).toEqual(['next thing', []])
  })
})

describe('the prompt box when a group with a remote prompt in it is sent back', () => {
  test('It takes the composer prompt out of the box when an abandoned handoff sends the group back', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'my prompt')
    await submitPerson($, 'from phone', { kind: 'bridge' })
    await failNote()
    expect([entered(world), world.box.text]).toEqual([['entered:plugin+asUser:my prompt\n\nfrom phone'], ''])
  })

  test('It leaves a draft alone that matches a bridge prompt sent on its own', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'from phone', { kind: 'bridge' })
    await submitPerson($, 'again', { kind: 'bridge' })
    world.box = { text: 'again', cursor: 5 }
    await finishNote()
    expect(world.box.text).toBe('again')
  })
})

describe('boxCopiesOf', () => {
  test('It returns the text alone for a prompt without a last prompt', () => {
    expect(boxCopiesOf({ text: 'a', origin: 'composer' })).toEqual(['a'])
  })

  test('It returns the joined text and the last prompt for a group', () => {
    expect(boxCopiesOf({ text: 'a\n\nb', origin: 'composer', boxText: 'b' })).toEqual(['a\n\nb', 'b'])
  })
})

describe('boxCopiesOf for a prompt from elsewhere', () => {
  test('It returns nothing for a bridge prompt without a composer prompt in it', () => {
    expect(boxCopiesOf({ text: 'a', origin: 'bridge' })).toEqual([])
  })

  test('It returns only the last composer prompt for a group that holds a bridge prompt', () => {
    expect(boxCopiesOf({ text: 'a\n\nb', origin: 'bridge', boxText: 'a' })).toEqual(['a'])
  })
})

describe('withoutBoxCopy', () => {
  test('It returns the draft unchanged for a prompt with no kept copy', () => {
    expect(withoutBoxCopy('b\nmy draft', {})).toBe('b\nmy draft')
  })

  test('It returns the draft without the kept copy when the draft holds it', () => {
    expect(withoutBoxCopy('b\nmy draft', { boxText: 'b' })).toBe('my draft')
  })

  test('It returns the draft unchanged when the draft no longer holds the kept copy', () => {
    expect(withoutBoxCopy('my draft', { boxText: 'b' })).toBe('my draft')
  })
})

describe('boxCopyOf', () => {
  test('It returns the text of a composer prompt that has no last prompt', () => {
    expect(boxCopyOf({ text: 'a', origin: 'composer' })).toBe('a')
  })

  test('It returns the last prompt of a group', () => {
    expect(boxCopyOf({ text: 'a\n\nb', origin: 'composer', boxText: 'b' })).toBe('b')
  })

  test('It returns nothing for a prompt from elsewhere', () => {
    expect(boxCopyOf({ text: 'a', origin: 'bridge' })).toBeUndefined()
  })
})

describe('the prompt box while prompts are held', () => {
  test('It holds each of several prompts as typed, not with the earlier ones in front', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'one')
    await world.clock.settle()
    await submitPerson($, 'two')
    await world.clock.settle()
    await submitPerson($, 'three')
    await world.clock.settle()
    await finishNote()
    expect(entered(world)).toEqual(['entered:plugin+asUser:one\n\ntwo\n\nthree'])
  })

  test('It empties the box after a held person prompt', async ($, on) => {
    const { world } = await writingTheNote($, on)
    await submitPerson($, 'one')
    await world.clock.settle()
    expect(world.box.text).toBe('')
  })

  test('It keeps a draft typed after the held prompt', async ($, on) => {
    const { world } = await writingTheNote($, on)
    await submitPerson($, 'one')
    world.box = { text: 'one\nmy draft', cursor: 12 }
    await world.clock.settle()
    expect(world.box.text).toBe('my draft')
  })

  test('It leaves the box alone for a held bridge prompt', async ($, on) => {
    const { world } = await writingTheNote($, on)
    world.box = { text: 'from phone', cursor: 10 }
    await submitPerson($, 'from phone', { kind: 'bridge' })
    await world.clock.settle()
    expect([world.box.text, fills(world.effects)]).toEqual(['from phone', []])
  })

  test('It leaves a prompt that arrived mid-delivery in the box when the delivery is refused', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    await world.clock.settle()
    world.submitDropped = true
    world.submitHooks = [
      () => {
        void submitPerson($, 'late')
      },
    ]
    await finishNote()
    expect(world.box.text).toBe('held one\nlate')
  })

  test('It writes a debug line and carries on when the box cannot be read', async ($, on) => {
    const { world } = await writingTheNote($, on)
    world.boxReadDenied = true
    await submitPerson($, 'one')
    await world.clock.settle()
    expect(world.effects.filter(effect => effect.startsWith('debug:handoff: could not empty the prompt box'))).toHaveLength(1)
  })

  test('It writes a debug line and carries on when the box refuses to be emptied at hold time', async ($, on) => {
    const { world } = await writingTheNote($, on)
    world.isFillRefusedOverText = true
    await submitPerson($, 'one')
    await world.clock.settle()
    expect(world.effects).toContain('debug:handoff: the prompt box refused to be emptied: refused by a hook')
  })

  test('It restores a held group once when the hold-time clear emptied the box', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'first')
    await world.clock.settle()
    await submitPerson($, 'second')
    await world.clock.settle()
    await failNote()
    expect(world.box.text).toBe('first\n\nsecond')
  })

  test('It keeps the box copy of a held prompt the handoff put back before the hold-time clear ran', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await failNote()
    await world.clock.settle()
    expect(world.box.text).toBe('next thing')
  })
})
