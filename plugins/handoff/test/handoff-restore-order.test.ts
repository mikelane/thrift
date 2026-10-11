import { describe, expect, test } from 'claude-code/testing'

import { groupHeldPrompts } from '../hooks/handoff-note'
import { bash, completeTurn, dropOf, growTo200k, install, lastRecord, startSession, submitPerson, writingTheNote, type World } from './helpers'

const HELD_FOR_HANDOFF = "A handoff is in progress, so your prompt is held. It is sent when the handoff ends, or, if the handoff fails and a person sent it, put in this terminal's prompt box. If that can't be done, it is kept another way, at worst in the transcript."

const entered = (world: World) => world.effects.filter(effect => effect.startsWith('entered:'))

type Arrival = { text: string; kind?: 'composer' | 'bridge' | 'scheduled-trigger' }

// One-shot callbacks, one per upcoming prompt.submit in order: each lets its prompt arrive while the restore is submitting.
const arriveDuringSubmits = ($: Parameters<typeof submitPerson>[0], world: World, arrivals: Arrival[]) => {
  const results: Array<Promise<unknown>> = []
  world.submitHooks = arrivals.map(({ text, kind = 'composer' }) => () => {
    results.push(submitPerson($, text, { kind }))
  })
  return results
}

describe('prompts that arrive while an abandoned handoff restores its held prompts', () => {
  test('It submits a scheduled prompt that arrives mid-restore after the held scheduled prompt', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    arriveDuringSubmits($, world, [{ text: 'late job', kind: 'scheduled-trigger' }])
    await failNote()
    expect(entered(world)).toEqual(['entered:plugin:nightly job', 'entered:plugin:late job'])
  })

  test('It holds a prompt that arrives mid-restore instead of running it', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    const results = arriveDuringSubmits($, world, [{ text: 'late job', kind: 'scheduled-trigger' }])
    await failNote()
    expect(dropOf(await results[0])).toBe(HELD_FOR_HANDOFF)
  })

  test('It submits prompts that arrive mid-restore one by one in arrival order', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    arriveDuringSubmits($, world, [
      { text: 'late one', kind: 'scheduled-trigger' },
      { text: 'late two', kind: 'bridge' },
      { text: 'late three', kind: 'scheduled-trigger' },
    ])
    await failNote()
    expect(entered(world)).toEqual([
      'entered:plugin:nightly job',
      'entered:plugin:late one',
      'entered:plugin:late two',
      'entered:plugin:late three',
    ])
  })

  test('It puts a person prompt that arrives mid-restore in the box after the held person prompt', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    arriveDuringSubmits($, world, [{ text: 'late' }])
    await failNote()
    expect([entered(world), world.box.text]).toEqual([['entered:plugin:nightly job'], 'held one\nlate'])
  })

  test('It lets a prompt through once the restore has finished', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await failNote()
    expect(dropOf(await submitPerson($, 'after'))).toBeUndefined()
    expect(entered(world)).toEqual(['entered:plugin:nightly job', 'entered:composer:after'])
  })

  test('It counts a prompt that arrived mid-restore in the record of the abandoned handoff', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    arriveDuringSubmits($, world, [{ text: 'late' }])
    await failNote()
    expect(lastRecord(world).trigger_values).toMatchObject({ held_groups: 2, held_unattended: true, held_restore: 'in_box' })
  })
})

describe('a held remote prompt that cannot be resubmitted', () => {
  for (const kind of ['bridge', 'sdk'] as const) {
    test(`It keeps a ${kind} prompt out of the box when its resubmit fails`, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'from far away', { kind })
    world.submitDropped = true
    await finishNote()
    expect(world.box.text).toBe('')
    expect(world.effects).toContain('log:A prompt could not be sent, so here it is:\nfrom far away')
    })
  }

  test('It still puts a composer prompt in the box when its resubmit fails', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'typed here')
    world.submitDropped = true
    await finishNote()
    expect(world.box.text).toBe('typed here')
  })

  test('It keeps a mixed group of composer and bridge prompts out of the box when its resubmit fails', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'typed here')
    await submitPerson($, 'from far away', { kind: 'bridge' })
    world.submitDropped = true
    await finishNote()
    expect(world.box.text).toBe('')
  })

  test('It keeps a bridge prompt out of the box when the handoff is abandoned', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'from far away', { kind: 'bridge' })
    await failNote()
    expect([world.box.text, entered(world)]).toEqual(['', ['entered:plugin:from far away']])
  })
})

describe('groupHeldPrompts origin', () => {
  const typed = { text: 'a', isUnattended: false, origin: 'composer' }
  const remote = { text: 'b', isUnattended: false, origin: 'bridge' }

  test('It keeps the composer as the origin of a group of composer prompts', () => {
    expect(groupHeldPrompts([typed, typed]).map(group => group.origin)).toEqual(['composer'])
  })

  test('It gives a group the remote origin when a remote prompt joins a composer prompt', () => {
    expect(groupHeldPrompts([typed, remote]).map(group => group.origin)).toEqual(['bridge'])
  })

  test('It gives a group the remote origin when a composer prompt joins a remote prompt', () => {
    expect(groupHeldPrompts([remote, typed]).map(group => group.origin)).toEqual(['bridge'])
  })
})

describe('the transcript wording for a note that could be neither sent nor put in the box', () => {
  const refuseEverything = (world: World) => {
    world.appendDenied = true
    world.submitDropped = true
    world.fillRefusal = 'dialog'
  }

  test('It calls a note that went alone the handoff note', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    refuseEverything(world)
    await finishNote()
    expect(world.effects.filter(effect => effect.startsWith('log:The handoff note could not be sent or put in the prompt box. Here it is:'))).toHaveLength(1)
  })

  test('It does not call a note that went alone the prompt', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    refuseEverything(world)
    await finishNote()
    expect(world.effects.filter(effect => effect.startsWith('log:Your prompt'))).toEqual([])
  })

  test('It still calls a note that went with a held prompt the prompt', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    refuseEverything(world)
    await finishNote()
    expect(world.effects.filter(effect => effect.startsWith('log:Your prompt'))).toHaveLength(1)
  })
})

describe('the transcript wording for a scheduled turn handoff note that could not be delivered', () => {
  const ACT = { options: { handoffMode: 'act' } } as const

  test('It does not say a scheduled note was put in the prompt box', ACT, async ($, on) => {
    const world = install($, on)
    await startSession($)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    world.appendDenied = true
    world.submitDropped = true
    await growTo200k($, world)
    await bash($, world, 'git commit -m x')
    await completeTurn($)
    await world.clock.settle()
    expect(world.effects.filter(effect => effect.startsWith('log:The handoff note could not be sent or put in the prompt box'))).toEqual([])
  })
})
