import { describe, expect, test } from 'claude-code/testing'

import { entered, submitPerson, writingTheNote } from './helpers'

const AFTER_THE_CLEAR = 1
const DELIVERY_PAUSE = 10

// The person types `five` while the delivery is in its sending stage, which the delivery waits in until the clock passes
// DELIVERY_PAUSE. The test then lets the timers due now run, as the engine does between two submits, and types `six`.
const typingDuringDelivery = async ($: Parameters<typeof submitPerson>[0], on: Parameters<typeof writingTheNote>[1]) => {
  const { world, finishNote } = await writingTheNote($, on)
  await submitPerson($, 'held one')
  await world.clock.settle()
  world.onCommandRegistered = async () => {
    world.onCommandRegistered = undefined
    await submitPerson($, 'five')
    await world.clock.sleep(DELIVERY_PAUSE)
  }
  await finishNote()
  await world.clock.advance(AFTER_THE_CLEAR)
  return { world, typeSix: () => submitPerson($, 'six'), finishDelivery: () => world.clock.advance(DELIVERY_PAUSE) }
}

describe('the prompt box while the held prompts are being delivered', () => {
  test('It holds each of two prompts typed during the delivery as typed', async ($, on) => {
    const { world, typeSix, finishDelivery } = await typingDuringDelivery($, on)
    await typeSix()
    await finishDelivery()
    expect(entered(world)).toEqual(['entered:plugin+asUser:held one', 'entered:plugin+asUser:five', 'entered:plugin+asUser:six'])
  })

  test('It leaves the box empty after two prompts typed during the delivery are sent', async ($, on) => {
    const { world, typeSix, finishDelivery } = await typingDuringDelivery($, on)
    await typeSix()
    await finishDelivery()
    expect(world.box.text).toBe('')
  })

  test('It leaves exactly one copy of a prompt typed during a restore in the box', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
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
