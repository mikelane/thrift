import { describe, expect, test } from 'claude-code/testing'

import { entered, lastRecord, submitPerson, writingTheNote, type World } from './helpers'
import { unattendedHandoffWriting } from './handoff-held-prompts-fixtures'
import { NOTE_MESSAGE } from './handoff-held-prompts-fixtures'

// The note goes first and the person's prompts follow it (#55). A note that did not enter the fresh session leaves the
// prompts nothing to follow: run now, they would start a session that knows nothing of the work, ahead of the note.
describe('held person prompts when the note did not enter the fresh session', () => {
  test('It runs no held prompt ahead of a note that could only go in the prompt box', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.appendDenied = true
    await submitPerson($, 'next thing')
    world.submitHooks = [
      () => {
        world.submitDropped = true
      },
      () => {
        world.submitDropped = false
      },
    ]
    await finishNote()
    expect(entered(world)).toEqual([])
  })

  test('It runs no held bridge prompt ahead of a note that could only go in the prompt box', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.appendDenied = true
    await submitPerson($, 'from phone', { kind: 'bridge' })
    world.submitHooks = [
      () => {
        world.submitDropped = true
      },
      () => {
        world.submitDropped = false
      },
    ]
    await finishNote()
    expect(entered(world)).toEqual([])
  })

  test('It runs no held prompt in the fresh session when the note was only kept in the transcript', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.appendDenied = true
    await submitPerson($, 'next thing')
    await world.clock.settle()
    world.fillRefusal = 'dialog'
    world.submitHooks = [
      () => {
        world.submitDropped = true
      },
      () => {
        world.submitDropped = false
      },
    ]
    await finishNote()
    expect(entered(world)).toEqual([])
  })
})

describe('where a held prompt goes when the note did not enter the fresh session', () => {
  const noteRefusedApart = (world: World) => {
    world.appendDenied = true
    world.submitHooks = [
      () => {
        world.submitDropped = true
      },
      () => {
        world.submitDropped = false
      },
    ]
  }

  test('It puts the note, then the held prompt, in the prompt box', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    noteRefusedApart(world)
    await finishNote()
    expect(world.box.text).toBe(`${NOTE_MESSAGE}\nnext thing`)
  })

  test('It keeps a held bridge prompt out of the box and in the transcript', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'from phone', { kind: 'bridge' })
    noteRefusedApart(world)
    await finishNote()
    expect([world.box.text, world.effects.filter(effect => effect.startsWith('log:A prompt could not be sent'))]).toEqual([
      NOTE_MESSAGE,
      ['log:A prompt could not be sent, so here it is:\nfrom phone'],
    ])
  })

  test('It still submits a held scheduled prompt, framed, when the note could only go in the prompt box', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    noteRefusedApart(world)
    await finishNote()
    expect(entered(world)).toEqual(['entered:plugin:nightly job'])
  })

  test('It holds back a person prompt that arrives mid-delivery when the note could only go in the prompt box', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.appendDenied = true
    world.submitDropped = true
    world.submitHooks = [
      () => {
        void submitPerson($, 'late')
      },
    ]
    await finishNote()
    expect([entered(world), world.box.text]).toEqual([[], `${NOTE_MESSAGE}\nlate`])
  })

  test('It leaves one box copy of the held prompt', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    noteRefusedApart(world)
    await finishNote()
    expect(world.box.text.split('\n').filter(line => line === 'next thing')).toHaveLength(1)
  })
})

describe('what the record and the transcript say about a held-back prompt', () => {
  const noteRefusedApart = (world: World) => {
    world.appendDenied = true
    world.submitHooks = [
      () => {
        world.submitDropped = true
      },
      () => {
        world.submitDropped = false
      },
    ]
  }
  const lines = (world: World) => world.effects.filter(effect => effect.startsWith('log:'))

  test('It records in_box for a held prompt that went in the prompt box after the note', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    noteRefusedApart(world)
    await finishNote()
    expect(lastRecord(world).trigger_values).toMatchObject({ note: 'in_box', held_other_delivery: 'in_box' })
  })

  test('It records not_carried for a held bridge prompt kept in the transcript', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'from phone', { kind: 'bridge' })
    noteRefusedApart(world)
    await finishNote()
    expect(lastRecord(world).trigger_values).toMatchObject({ note: 'in_box', held_other_delivery: 'not_carried' })
  })

  test('It writes the note to the transcript before the held bridge prompt, once each', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'from phone', { kind: 'bridge' })
    noteRefusedApart(world)
    world.fillRefusal = 'dialog'
    await finishNote()
    expect(lines(world).map(line => line.split('\n')[0])).toEqual([
      'log:The handoff note could not be sent or put in the prompt box. Here it is:',
      'log:The handoff note could not be added to this session. To reopen the full previous conversation: claude --resume old-session',
      'log:A prompt could not be sent, so here it is:',
    ])
  })

  test('It puts the held prompt after a draft that follows the note in the prompt box', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'next thing')
    world.box = { text: 'my draft', cursor: 8 }
    noteRefusedApart(world)
    await finishNote()
    expect(world.box.text).toBe(`${NOTE_MESSAGE}\nmy draft\nnext thing`)
  })

  test('It writes a held bridge prompt that arrives mid-delivery to the transcript once', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.appendDenied = true
    world.submitDropped = true
    world.submitHooks = [
      () => {
        void submitPerson($, 'late phone', { kind: 'bridge' })
      },
    ]
    await finishNote()
    expect(lines(world).filter(line => line.includes('late phone'))).toEqual(['log:A prompt could not be sent, so here it is:\nlate phone'])
  })
})

describe('held person prompts when a scheduled handoff note did not enter the fresh session', () => {
  const ASK = { options: { handoffMode: 'ask' } } as const

  test('It holds a person prompt back in the prompt box when the scheduled note and its group were refused', ASK, async ($, on) => {
    const { world, finishNote } = await unattendedHandoffWriting($, on)
    world.appendDenied = true
    world.submitDropped = true
    await submitPerson($, 'person says')
    world.submitHooks = [undefined, () => {
      world.submitDropped = false
    }]
    await finishNote()
    expect([entered(world), world.box.text]).toEqual([['entered:composer:start on ENG-1'], 'person says'])
  })

  test('It holds a bridge prompt back in the transcript when the scheduled note was refused', ASK, async ($, on) => {
    const { world, finishNote } = await unattendedHandoffWriting($, on)
    world.appendDenied = true
    world.submitDropped = true
    await submitPerson($, 'from phone', { kind: 'bridge' })
    world.submitHooks = [undefined, () => {
      world.submitDropped = false
    }]
    await finishNote()
    expect([entered(world), world.box.text]).toEqual([['entered:composer:start on ENG-1'], ''])
  })
})
