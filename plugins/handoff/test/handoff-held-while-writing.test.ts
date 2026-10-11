import { describe, expect, test } from 'claude-code/testing'

import { compacted, dropOf, entered, install, runCommand, startSession, submitPerson, writingTheNote } from './helpers'
import { NOTE_MESSAGE, HELD_FOR_HANDOFF, IMAGE } from './handoff-held-prompts-fixtures'

const REFUSED_DURING_HANDOFF =
  'A handoff is in progress, and a prompt with attachments or context cannot be held. Send it again after the handoff.'

const REFUSED_TOAST = "Not held: a prompt with attachments or context can't wait for a handoff. Send it again after."

describe('holding prompts while the note is written', () => {
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

  test('It joins the held prompt to the note when the note has to be submitted', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.appendDenied = true
    await submitPerson($, 'next thing')
    await finishNote()
    expect(entered(world)).toEqual([`entered:plugin:${NOTE_MESSAGE}\n\nnext thing`])
  })

  test('It logs a held prompt to debug with the count and no text', async ($, on) => {
    const { world } = await writingTheNote($, on)
    await submitPerson($, 'secret words')
    await submitPerson($, 'more words')
    expect(world.debugLines).toContain('handoff: held a prompt for the handoff (2 held)')
    expect(world.debugLines.join('\n')).not.toContain('words')
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

  test('It never holds a plugin prompt sent while the note is written', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await $.prompt.submit({ text: 'from a plugin', wait: false, origin: { kind: 'plugin', name: 'other' } })
    await finishNote()
    expect(entered(world)).toEqual(['entered:plugin:from a plugin'])
  })
})

describe('refusing a prompt with attachments or context', () => {
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
    expect(world.effects).toContain('log:Your prompt could not be sent or put in the prompt box. Here it is:\nlook')
  })

  test('It holds a text prompt next to a refused one', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'look', { attachments: IMAGE })
    await submitPerson($, 'plain')
    await finishNote()
    expect(entered(world)).toEqual(['entered:plugin:plain'])
  })

  test('It logs a refused prompt to debug without its text', async ($, on) => {
    const { world } = await writingTheNote($, on)
    await submitPerson($, 'secret words', { attachments: IMAGE })
    expect(world.debugLines).toContain('handoff: refused a prompt with attachments or context during the handoff')
    expect(world.debugLines.join('\n')).not.toContain('words')
  })
})
