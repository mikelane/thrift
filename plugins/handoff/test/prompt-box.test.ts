import { describe, expect, test } from 'claude-code/testing'

import { canUseBox, composerPrompt, markKeptInBox } from '../hooks/prompt-box'
import { createState } from '../hooks/session-state'
import { entered, submitPerson, writingTheNote } from './helpers'
import { nightly, person, settings } from './session-state-fixtures'

const UNSENT_PERSON = 'log:Your prompt could not be sent or put in the prompt box. Here it is:\nnext thing'

describe('markKeptInBox', () => {
  test('It returns in_box', () => {
    expect(markKeptInBox(createState(settings))).toBe('in_box')
  })

  test('It forgets the text the engine left in the box', () => {
    const state = createState(settings)
    state.boxLeftover = 'left over'
    markKeptInBox(state)
    expect(state.boxLeftover).toBeNull()
  })
})

describe('composerPrompt', () => {
  test('It returns a prompt the person typed at this terminal', () => {
    expect(composerPrompt('hello')).toEqual({ text: 'hello', isUnattended: false, origin: 'composer', author: 'person' })
  })
})

describe('canUseBox', () => {
  test('It returns true for a prompt typed at this terminal', () => {
    expect(canUseBox(person)).toBe(true)
  })

  test('It returns false for a prompt from a scheduled trigger', () => {
    expect(canUseBox(nightly)).toBe(false)
  })
})

describe('refillBox', () => {
  test('It fills the box with a held prompt when the handoff fails', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await failNote()
    expect(world.box.text).toBe('next thing')
  })

  test('It puts the held prompt ahead of a draft typed since', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await world.clock.settle()
    world.box = { text: 'draft', cursor: 5 }
    await failNote()
    expect(world.box.text).toBe('next thing\ndraft')
  })

  test('It does not add a prompt the box already holds', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await world.clock.settle()
    world.box = { text: 'next thing', cursor: 10 }
    await failNote()
    expect(world.box.text).toBe('next thing')
  })

  test('It says why when the box refuses the prompt', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await world.clock.settle()
    world.isFillRefusedOverText = true
    await failNote()
    expect(world.debugLines).toContain('handoff: the prompt box refused the prompt: refused by a hook')
  })

  test('It says why when the box cannot be read', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await world.clock.settle()
    world.boxReadDenied = true
    await failNote()
    expect(world.debugLines.some(line => line.startsWith('handoff: could not refill the prompt box'))).toBe(true)
  })
})

describe('emptySentPromptFromBox', () => {
  test('It takes the copy of a sent prompt out of the box and keeps a draft typed since', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await world.clock.settle()
    world.box = { text: 'next thing\ndraft', cursor: 16 }
    await finishNote()
    expect([entered(world), world.box.text]).toEqual([['entered:plugin+asUser:next thing'], 'draft'])
  })

  test('It leaves a draft alone that holds no copy of the sent prompt', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await world.clock.settle()
    world.box = { text: 'draft', cursor: 5 }
    await finishNote()
    expect(world.box.text).toBe('draft')
  })

  test('It says why when the box refuses to be emptied', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await world.clock.settle()
    world.box = { text: 'next thing', cursor: 10 }
    world.isFillRefusedOverText = true
    await finishNote()
    expect(world.debugLines).toContain('handoff: the prompt box refused to be emptied: refused by a hook')
  })
})

describe('keepInTranscript', () => {
  test('It logs a person prompt that could be neither sent nor put in the box', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await world.clock.settle()
    world.isFillRefusedOverText = true
    world.submitDropped = true
    await failNote()
    expect(world.effects).toContain(UNSENT_PERSON)
  })

  test('It logs a prompt from another sender under a notice that names no box', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'run the nightly job', { kind: 'scheduled-trigger' })
    world.submitDropped = true
    await failNote()
    expect(world.effects).toContain('log:A prompt could not be sent, so here it is:\nrun the nightly job')
  })
})

describe('returnToBox', () => {
  test('It puts a refused composer prompt back in the box', async ($, on) => {
    const { world } = await writingTheNote($, on)
    await submitPerson($, 'look', { context: ['file.ts'] })
    await world.clock.settle()
    expect(world.box.text).toBe('look')
  })

  test('It logs a refused composer prompt that the box also refuses', async ($, on) => {
    const { world } = await writingTheNote($, on)
    world.isFillRefusedOverText = true
    await submitPerson($, 'look', { context: ['file.ts'] })
    world.box = { text: '', cursor: 0 }
    await world.clock.settle()
    expect(world.effects).toContain('log:Your prompt could not be sent or put in the prompt box. Here it is:\nlook')
  })
})

describe('emptyBoxIfHolding', () => {
  test('It empties the box when it holds the copy of a held prompt', async ($, on) => {
    const { world } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await world.clock.settle()
    expect(world.box.text).toBe('')
  })

  test('It says why when the box refuses to be emptied', async ($, on) => {
    const { world } = await writingTheNote($, on)
    world.isFillRefusedOverText = true
    await submitPerson($, 'next thing')
    await world.clock.settle()
    expect(world.debugLines).toContain('handoff: the prompt box refused to be emptied: refused by a hook')
  })

  test('It says why when the box cannot be read', async ($, on) => {
    const { world } = await writingTheNote($, on)
    world.boxReadDenied = true
    await submitPerson($, 'next thing')
    await world.clock.settle()
    expect(world.debugLines.some(line => line.startsWith('handoff: could not empty the prompt box'))).toBe(true)
  })
})

describe('clearBoxCopyWhileHeld', () => {
  test('It leaves a box alone that no longer holds the copy', async ($, on) => {
    const { world } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    world.box = { text: 'something else', cursor: 14 }
    await world.clock.settle()
    expect(world.box.text).toBe('something else')
  })

  test('It does not clear a copy of a prompt the handoff already took', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await finishNote()
    expect(entered(world)).toEqual(['entered:plugin+asUser:next thing'])
  })
})
