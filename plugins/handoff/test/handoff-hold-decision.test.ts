import { describe, expect, test } from 'claude-code/testing'

import { dropOf, entered, install, startSession, submitPerson, writingTheNote } from './helpers'
import { ASK, HELD_FOR_HANDOFF, REPEAT_NOT_ADDED, heldBeforeTheHandoff } from './handoff-held-prompts-fixtures'

describe('decideDuringHandoff', () => {
  test('It lets a prompt through when no handoff is in progress', async ($, on) => {
    install($, on)
    await startSession($)
    expect(dropOf(await submitPerson($, 'hello'))).toBeUndefined()
  })

  test('It holds a prompt that arrives while the note is written', async ($, on) => {
    await writingTheNote($, on)
    expect(dropOf(await submitPerson($, 'next thing'))).toBe(HELD_FOR_HANDOFF)
  })

  test('It drops a repeat of the prompt the handoff carries', ASK, async ($, on) => {
    await heldBeforeTheHandoff($, on)
    expect(dropOf(await submitPerson($, 'now ENG-2'))).toBe(REPEAT_NOT_ADDED)
  })

  test('It refuses a prompt with context and says it cannot be held', async ($, on) => {
    await writingTheNote($, on)
    expect(dropOf(await submitPerson($, 'look', { context: ['file.ts'] }))).toContain('cannot be held')
  })

  test('It sends a refused prompt with context to no turn', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'look', { context: ['file.ts'] })
    await finishNote()
    expect(entered(world)).toEqual([])
  })

  test('It keeps a refused prompt from another sender in the transcript, not the box', async ($, on) => {
    const { world } = await writingTheNote($, on)
    await submitPerson($, 'look', { kind: 'scheduled-trigger', context: ['file.ts'] })
    await world.clock.settle()
    expect([world.box.text, world.effects.some(effect => effect.startsWith('log:A prompt from '))]).toEqual(['', true])
  })

  test('It sends a held prompt in the fresh session once the note is delivered', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    await finishNote()
    expect(entered(world)).toEqual(['entered:plugin+asUser:next thing'])
  })
})
