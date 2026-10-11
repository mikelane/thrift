import { describe, expect, test } from 'claude-code/testing'

import { dropOf, lastRecord, submitPerson, writingTheNote, type World } from './helpers'
import type { Engine } from 'claude-code/testing'

const NOTE_MESSAGE = 'Handoff from the previous session (old-session), written by Claude just before a /clear:\n\nThe handoff note.'
const HELD_FOR_HANDOFF = 'A handoff is in progress. Your prompt is held and will be sent when it finishes. If the handoff fails, it goes back in the prompt box, or is sent here if a scheduled task sent it.'

type Arrival = { text: string; kind?: 'composer' | 'scheduled-trigger' }

// One-shot callbacks, one per upcoming prompt.submit in order: each submit that carries a callback lets that prompt arrive
// in the fresh session while the handoff is still delivering.
const arriveDuringSubmits = ($: Engine, world: World, arrivals: Array<Arrival | undefined>) => {
  const results: Array<Promise<unknown>> = []
  world.submitHooks = arrivals.map(arrival =>
    arrival === undefined
      ? undefined
      : () => {
          results.push(submitPerson($, arrival.text, arrival.kind === undefined ? {} : { kind: arrival.kind }))
        },
  )
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
    expect(dropOf(await results[0])).toBe(HELD_FOR_HANDOFF)
  })

  test('It sends a prompt that arrives mid-delivery after both held groups', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'person says')
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    arriveDuringSubmits($, world, [undefined, { text: 'late' }])
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

  test('It sends a prompt that arrives while the note lands in the box after nothing else', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.appendDenied = true
    world.submitDropped = true
    await submitPerson($, 'held one')
    arriveDuringSubmits($, world, [{ text: 'late' }, undefined])
    world.submitHooks[1] = () => {
      world.submitDropped = false
    }
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
    const afterFirstSubmit = () => {
      world.submitDropped = true
    }
    world.submitHooks = [
      () => {
        void submitPerson($, 'late')
      },
      afterFirstSubmit,
    ]
    await finishNote()
    expect(lastRecord(world).trigger_values).toMatchObject({ held_other_delivery: 'not_carried' })
  })
})
