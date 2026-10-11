import { describe, expect, test } from 'claude-code/testing'

import { dropOf, growTo200k, lastRecord, runCommand, submitPerson, writingTheNote, type World } from './helpers'
import type { Engine } from 'claude-code/testing'

const NOTE_MESSAGE = 'Handoff from the previous session (old-session), written by Claude just before a /clear:\n\nThe handoff note.'
const HELD_FOR_HANDOFF = "A handoff is in progress, so your prompt is held. It is sent when the handoff ends, or, if the handoff fails and a person sent it, put in this terminal's prompt box. If that can't be done, it is kept another way, at worst in the transcript."
const REFUSED_DURING_HANDOFF =
  'A handoff is in progress, and a prompt with attachments or context cannot be held. Send it again after the handoff.'

type Arrival = { text: string; kind?: 'composer' | 'scheduled-trigger' }

// One-shot callbacks, one per upcoming prompt.submit in order: each lets its prompt arrive in the fresh session while the
// handoff is still delivering. A test that needs a submit with no arrival puts an undefined slot in world.submitHooks itself.
const arriveDuringSubmits = ($: Engine, world: World, arrivals: Arrival[]) => {
  const results: Array<Promise<unknown>> = []
  world.submitHooks = arrivals.map(({ text, kind = 'composer' }) => () => {
    results.push(submitPerson($, text, { kind }))
  })
  return results
}

const entered = (world: World) => world.effects.filter(effect => effect.startsWith('entered:'))

describe('prompts that arrive while the handoff delivers', () => {
  test('It sends a prompt that arrives mid-delivery after the held prompt', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    arriveDuringSubmits($, world, [{ text: 'late' }])
    await finishNote()
    expect(entered(world)).toEqual(['entered:plugin:held one', 'entered:plugin:late'])
  })

  test('It holds a prompt that arrives mid-delivery instead of running it', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    const results = arriveDuringSubmits($, world, [{ text: 'late' }])
    await finishNote()
    expect([dropOf(await results[0]), entered(world)]).toEqual([HELD_FOR_HANDOFF, ['entered:plugin:held one', 'entered:plugin:late']])
  })

  test('It sends a prompt that arrives mid-delivery after both held groups', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'person says')
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    arriveDuringSubmits($, world, [{ text: 'late' }])
    world.submitHooks.unshift(undefined)
    await finishNote()
    expect(entered(world)).toEqual(['entered:plugin:person says', 'entered:plugin:nightly job', 'entered:plugin:late'])
  })

  test('It sends a held scheduled group before a prompt that arrives mid-delivery', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    arriveDuringSubmits($, world, [{ text: 'late' }])
    await finishNote()
    expect(entered(world)).toEqual(['entered:plugin:nightly job', 'entered:plugin:late'])
  })

  test('It sends prompts that arrive mid-delivery one by one in arrival order', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    arriveDuringSubmits($, world, [{ text: 'late one' }, { text: 'late two', kind: 'scheduled-trigger' }, { text: 'late three' }])
    await finishNote()
    expect(entered(world)).toEqual([
      'entered:plugin:held one',
      'entered:plugin:late one',
      'entered:plugin:late two',
      'entered:plugin:late three',
    ])
  })

  test('It sends a prompt that arrives before the note is submitted after the note', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    let late: Promise<unknown> = Promise.resolve(undefined)
    Object.defineProperty(world, 'appendDenied', {
      get: () => {
        late = submitPerson($, 'late')
        return true
      },
    })
    await finishNote()
    expect(entered(world)).toEqual([`entered:plugin:${NOTE_MESSAGE}`, 'entered:plugin:late'])
    expect(dropOf(await late)).toBe(HELD_FOR_HANDOFF)
  })

  test('It sends a prompt that arrives while the note is submitted with the held prompt after them', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.appendDenied = true
    await submitPerson($, 'held one')
    arriveDuringSubmits($, world, [{ text: 'late' }])
    await finishNote()
    expect(entered(world)).toEqual([`entered:plugin:${NOTE_MESSAGE}\n\nheld one`, 'entered:plugin:late'])
  })

  test('It sends a prompt that arrives mid-delivery once the refused note and held prompt went in the box', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.appendDenied = true
    world.submitDropped = true
    await submitPerson($, 'held one')
    arriveDuringSubmits($, world, [{ text: 'late' }])
    world.submitHooks.push(() => {
      world.submitDropped = false
    })
    await finishNote()
    expect([entered(world), world.box.text]).toEqual([['entered:plugin:late'], `${NOTE_MESSAGE}\n\nheld one`])
  })

  test('It lets a prompt through once the delivery has finished', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    await finishNote()
    expect(dropOf(await submitPerson($, 'after'))).toBeUndefined()
    expect(entered(world)).toEqual(['entered:plugin:held one', 'entered:composer:after'])
  })
})

describe('events that land while the handoff delivers', () => {
  test('It sends a prompt that arrives mid-delivery after the note a person-run /clear made room for', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await runCommand($, 'clear')
    await submitPerson($, 'held one')
    arriveDuringSubmits($, world, [{ text: 'late' }])
    await finishNote()
    expect(entered(world)).toEqual(['entered:plugin:held one', 'entered:plugin:late'])
  })

  test('It refuses a second /handoff while the first is delivering', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    let reply: unknown
    world.submitHooks = [
      () => {
        void runCommand($, 'handoff').then(result => {
          reply = result
        })
      },
    ]
    await finishNote()
    expect([reply, world.forkPrompts.length]).toEqual([{ text: 'A handoff or compaction is already in progress.' }, 1])
  })

  test('It puts a prompt with an attachment that arrives mid-delivery back in the box', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    let late: Promise<unknown> = Promise.resolve(undefined)
    world.submitHooks = [
      () => {
        late = submitPerson($, 'late picture', { attachments: [{ type: 'image', mediaType: 'image/png' }] })
      },
    ]
    await finishNote()
    expect([dropOf(await late), entered(world), world.box.text]).toEqual([REFUSED_DURING_HANDOFF, ['entered:plugin:held one'], 'late picture'])
  })
})

describe('the record of a handoff that held prompts while it delivered', () => {
  test('It counts the groups held while delivering and the origin of a prompt that arrived', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    arriveDuringSubmits($, world, [{ text: 'late' }])
    await finishNote()
    expect(lastRecord(world).trigger_values).toMatchObject({ held_groups: 2, held_unattended: true, held_other_delivery: 'submitted' })
  })

  test('It counts a person prompt that arrives mid-delivery in the group of the person prompts already held', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    arriveDuringSubmits($, world, [{ text: 'late' }])
    await finishNote()
    expect(lastRecord(world).trigger_values).toMatchObject({ held_groups: 1, held_unattended: false })
  })

  test('It reports a prompt that arrived mid-delivery and could not be sent as not carried', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.fillRefusal = 'dialog'
    await submitPerson($, 'held one')
    const refuseTheLateSubmit = () => {
      world.submitDropped = true
    }
    world.submitHooks = [
      () => {
        void submitPerson($, 'late')
      },
      refuseTheLateSubmit,
    ]
    await finishNote()
    expect(entered(world)).toEqual(['entered:plugin:held one'])
    expect(lastRecord(world).trigger_values).toMatchObject({ held_other_delivery: 'not_carried' })
  })

  test('It writes a debug line when the box refuses a prompt that arrived mid-delivery', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    world.fillRefusal = 'dialog'
    world.submitDropped = true
    arriveDuringSubmits($, world, [{ text: 'late' }])
    await finishNote()
    expect(world.debugLines.join('\n')).toContain('the prompt box refused the prompt')
  })
})

describe('tickets named by a prompt that arrived while the handoff delivered', () => {
  test('It does not call a ticket that a prompt arriving mid-delivery named new work later', { options: { handoffMode: 'ask' } }, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.branch = 'alice/eng-1-start'
    await submitPerson($, 'start on ENG-1')
    arriveDuringSubmits($, world, [{ text: 'now ENG-2' }])
    await finishNote()
    await growTo200k($, world)
    const result = await submitPerson($, 'keep going on ENG-2')
    expect([dropOf(result), entered(world)]).toEqual([
      undefined,
      ['entered:plugin:start on ENG-1', 'entered:plugin:now ENG-2', 'entered:composer:keep going on ENG-2'],
    ])
  })
})
