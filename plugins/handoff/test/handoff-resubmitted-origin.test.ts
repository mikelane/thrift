import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { bash, completeTurn, growTo200k, startTurn, submitPerson, writingTheNote, type World } from './helpers'

const ASK = { options: { handoffMode: 'ask' } } as const

// The turn a resubmitted prompt starts in the fresh session ends past the threshold. Ask mode acts on that alone only for
// an unattended turn; an attended one is offered a band.
const endStrongTurnInFreshSession = async ($: Engine, world: World) => {
  await growTo200k($, world)
  await startTurn($)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  await world.clock.settle()
}

const handoffsStarted = (world: World) => world.forkPrompts.length

describe('the origin of a prompt the handoff resubmits', () => {
  test('It treats the turn of a resubmitted scheduled prompt as unattended', ASK, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await finishNote()
    await endStrongTurnInFreshSession($, world)
    expect(handoffsStarted(world)).toBe(2)
  })

  test('It treats the turn of a resubmitted person prompt as attended', ASK, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'person says')
    await finishNote()
    await endStrongTurnInFreshSession($, world)
    expect(handoffsStarted(world)).toBe(1)
  })

  test('It treats the turn of a person prompt sent after a scheduled one as attended', ASK, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await finishNote()
    await submitPerson($, 'after')
    await endStrongTurnInFreshSession($, world)
    expect(handoffsStarted(world)).toBe(1)
  })

  test('It treats the turn of a scheduled prompt that arrived during the delivery as unattended', ASK, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'person says')
    world.submitHooks = [
      () => {
        void submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
      },
    ]
    await finishNote()
    await endStrongTurnInFreshSession($, world)
    expect(handoffsStarted(world)).toBe(2)
  })

  test('It treats a scheduled prompt submitted back after a failed handoff as unattended', ASK, async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await failNote()
    await endStrongTurnInFreshSession($, world)
    expect(handoffsStarted(world)).toBe(2)
  })

  test('It leaves the turn attended when the resubmitted scheduled prompt is refused', ASK, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    world.submitDropped = true
    await finishNote()
    await endStrongTurnInFreshSession($, world)
    expect(handoffsStarted(world)).toBe(1)
  })

  test('It leaves a plugin prompt the handoff did not resubmit as it was', ASK, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await finishNote()
    await $.prompt.submit({ text: 'from a plugin', wait: false, origin: { kind: 'plugin', name: 'other' } })
    await endStrongTurnInFreshSession($, world)
    expect(handoffsStarted(world)).toBe(1)
  })
})
