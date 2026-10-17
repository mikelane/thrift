import { describe, expect, test } from 'claude-code/testing'

import { entered, submitPerson, writingTheNote } from './helpers'

const DELIVERY_PAUSE = 10
const LATE = { restoresLate: true }
const EARLY = { restoresLate: false }

type Kit = Parameters<typeof submitPerson>[0]
type On = Parameters<typeof writingTheNote>[1]

// The person types `five` while the delivery is in its sending stage, which the delivery waits in until the clock passes
// DELIVERY_PAUSE. Claude Code puts the dropped text back in the box a moment after the hook returns: with `restoresLate`, only
// after the deferred clear has already looked at an empty box, as live on a busy worker; otherwise before it looks.
const typingDuringDelivery = async ($: Kit, on: On, { restoresLate }: { restoresLate: boolean }) => {
  const { world, finishNote } = await writingTheNote($, on)
  await submitPerson($, 'held one')
  await world.clock.settle()
  world.onCommandRegistered = async () => {
    world.onCommandRegistered = undefined
    await submitPerson($, 'five')
    if (restoresLate) world.box = { text: '', cursor: 0 }
    await world.clock.sleep(DELIVERY_PAUSE)
  }
  await finishNote()
  if (restoresLate) world.box = { text: 'five', cursor: 4 }
  return {
    world,
    typeNext: (text: string) => submitPerson($, text),
    finishDelivery: () => world.clock.advance(DELIVERY_PAUSE),
  }
}

describe('the prompt box while the held prompts are being delivered', () => {
  test('It holds a second prompt typed before the first one was cleared from the box as typed', async ($, on) => {
    const { world, typeNext, finishDelivery } = await typingDuringDelivery($, on, LATE)
    await typeNext('six')
    await finishDelivery()
    expect(entered(world)).toEqual(['entered:plugin+asUser:held one', 'entered:plugin+asUser:five', 'entered:plugin+asUser:six'])
  })

  test('It leaves the box empty after a second prompt typed before the first was cleared is sent', async ($, on) => {
    const { world, typeNext, finishDelivery } = await typingDuringDelivery($, on, LATE)
    await typeNext('six')
    await finishDelivery()
    expect(world.box.text).toBe('')
  })

  // The clear for `six` also finds an empty box, and the engine puts the joined `fivesix` back late: only the held prompt's
  // record of what the box held lets the delivery take that copy out.
  test('It leaves the box empty when the joined text came back late and the prompt typed after an uncleared one is sent', async ($, on) => {
    const { world, typeNext, finishDelivery } = await typingDuringDelivery($, on, LATE)
    await typeNext('six')
    world.box = { text: '', cursor: 0 }
    await world.clock.settle()
    world.box = { text: 'fivesix', cursor: 7 }
    await finishDelivery()
    expect(world.box.text).toBe('')
  })

  test('It holds a third prompt typed before the earlier ones were cleared as typed', async ($, on) => {
    const { world, typeNext, finishDelivery } = await typingDuringDelivery($, on, LATE)
    await typeNext('six')
    await typeNext('seven')
    await finishDelivery()
    expect(entered(world)).toEqual([
      'entered:plugin+asUser:held one',
      'entered:plugin+asUser:five',
      'entered:plugin+asUser:six',
      'entered:plugin+asUser:seven',
    ])
  })

  test('It holds each of two prompts typed during the delivery as typed when the clear ran between them', async ($, on) => {
    const { world, typeNext, finishDelivery } = await typingDuringDelivery($, on, EARLY)
    await typeNext('six')
    await finishDelivery()
    expect(entered(world)).toEqual(['entered:plugin+asUser:held one', 'entered:plugin+asUser:five', 'entered:plugin+asUser:six'])
  })

  test('It keeps the start of a prompt that repeats the cleared one as typed', async ($, on) => {
    const { world, typeNext, finishDelivery } = await typingDuringDelivery($, on, EARLY)
    await typeNext('five six')
    await finishDelivery()
    expect(entered(world)).toEqual(['entered:plugin+asUser:held one', 'entered:plugin+asUser:five', 'entered:plugin+asUser:five six'])
  })

  test('It keeps a bridge prompt that starts with the text left in the box as sent', async ($, on) => {
    const { world, finishDelivery } = await typingDuringDelivery($, on, LATE)
    await submitPerson($, 'fivesix', { kind: 'bridge' })
    await finishDelivery()
    expect(entered(world)).toEqual(['entered:plugin+asUser:held one', 'entered:plugin+asUser:five', 'entered:plugin+asUser:fivesix'])
  })

  // `held one`, `five`, then `remote` are submitted; `fivesix` is typed while `remote` goes in, after `five` was sent and the
  // delivery tried to take its copy out of the box.
  const typingWhileRemoteGoesIn = async ($: Kit, on: On, { isBoxFillRefused }: { isBoxFillRefused: boolean }) => {
    const { world, finishDelivery } = await typingDuringDelivery($, on, LATE)
    await submitPerson($, 'remote', { kind: 'bridge' })
    world.isFillRefusedOverText = isBoxFillRefused
    world.submitHooks = [undefined, undefined, () => void submitPerson($, 'fivesix')]
    await finishDelivery()
    return world
  }

  test('It keeps the start of a prompt typed after the delivery took the uncleared one out of the box', async ($, on) => {
    const world = await typingWhileRemoteGoesIn($, on, { isBoxFillRefused: false })
    expect(entered(world)).toEqual([
      'entered:plugin+asUser:held one',
      'entered:plugin+asUser:five',
      'entered:plugin+asUser:remote',
      'entered:plugin+asUser:fivesix',
    ])
  })

  test('It holds a prompt without the leftover when the delivery could not take the leftover out of the box', async ($, on) => {
    const world = await typingWhileRemoteGoesIn($, on, { isBoxFillRefused: true })
    expect(entered(world)).toEqual([
      'entered:plugin+asUser:held one',
      'entered:plugin+asUser:five',
      'entered:plugin+asUser:remote',
      'entered:plugin+asUser:six',
    ])
  })

  test('It holds a prompt typed during the delivery without the leftover of one held before it whose clear found no text', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'five')
    world.box = { text: '', cursor: 0 }
    await world.clock.settle()
    world.box = { text: 'five', cursor: 4 }
    world.onCommandRegistered = async () => {
      world.onCommandRegistered = undefined
      await submitPerson($, 'six')
    }
    await finishNote()
    expect(entered(world)).toEqual(['entered:plugin+asUser:five', 'entered:plugin+asUser:six'])
  })

  test('It keeps a prompt typed after a held prompt the restore put back in the box whole', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'five')
    world.box = { text: '', cursor: 0 }
    await world.clock.settle()
    world.box = { text: 'five', cursor: 4 }
    // A scheduled prompt gives the restore a submit after `five` is back in the box; `six` is typed after it at the composer.
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    world.submitHooks = [
      () => {
        world.isRunningSubmitHook = false
        void submitPerson($, 'six')
      },
    ]
    await failNote()
    expect(world.box.text).toBe('fivesix')
  })

  test('It keeps a prompt typed after a held prompt the delivery could not send and kept in the box whole', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'five')
    world.box = { text: '', cursor: 0 }
    await world.clock.settle()
    world.box = { text: 'five', cursor: 4 }
    // The fresh session refuses every submit, so `five` is kept in the box; `six` is typed after it while the scheduled
    // prompt is tried.
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    world.submitDropped = true
    world.submitHooks = [
      undefined,
      () => {
        world.isRunningSubmitHook = false
        void submitPerson($, 'six')
      },
    ]
    await finishNote()
    expect(world.box.text).toBe('fivesix')
  })

  test('It leaves exactly one copy of a prompt typed during a restore in the box', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    // A scheduled prompt gives the restore a submit, and so a moment for the late prompt to arrive; it is not what is tested.
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await world.clock.settle()
    world.submitHooks = [
      () => {
        void submitPerson($, 'late')
      },
    ]
    await failNote()
    expect(world.box.text).toBe('held one\nlate')
  })
})
