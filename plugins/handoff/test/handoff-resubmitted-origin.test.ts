import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { bash, completeTurn, growTo200k, startTurn, submitPerson, writingTheNote, type World } from './helpers'

const ASK = { options: { handoffMode: 'ask' } } as const

// The turn a resubmitted prompt starts in the fresh session ends past the threshold. Ask mode acts on that alone only for
// an unattended turn; an attended one is offered a band.
const endStrongTurnInFreshSession = async ($: Engine, world: World, promptText: string) => {
  await growTo200k($, world)
  await startTurn($, promptText)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  await world.clock.settle()
}

// A resubmitted prompt's turn starts and ends before the next one is judged, as it does in a session.
const runTurnWithoutContext = async ($: Engine, promptText: string) => {
  await startTurn($, promptText)
  await completeTurn($)
}

const handoffsStarted = (world: World) => world.forkPrompts.length

describe('the origin of a prompt the handoff resubmits', () => {
  test('It treats the turn of a resubmitted scheduled prompt as unattended', ASK, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await finishNote()
    await endStrongTurnInFreshSession($, world, 'nightly job')
    expect(handoffsStarted(world)).toBe(2)
  })

  test('It treats the turn of a resubmitted person prompt as attended', ASK, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'person says')
    await finishNote()
    await endStrongTurnInFreshSession($, world, 'person says')
    expect(handoffsStarted(world)).toBe(1)
  })

  test('It treats the turn of a person prompt sent after a scheduled one as attended', ASK, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await finishNote()
    await runTurnWithoutContext($, 'nightly job')
    await submitPerson($, 'after')
    await endStrongTurnInFreshSession($, world, 'after')
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
    await runTurnWithoutContext($, 'person says')
    await endStrongTurnInFreshSession($, world, 'nightly job')
    expect(handoffsStarted(world)).toBe(2)
  })

  test('It treats a scheduled prompt submitted back after a failed handoff as unattended', ASK, async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await failNote()
    await endStrongTurnInFreshSession($, world, 'nightly job')
    expect(handoffsStarted(world)).toBe(2)
  })

  test('It leaves the turn attended when the resubmitted scheduled prompt is refused', ASK, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    world.submitDropped = true
    await finishNote()
    await endStrongTurnInFreshSession($, world, 'nightly job')
    expect(handoffsStarted(world)).toBe(1)
  })

  test('It leaves the turn attended when submitting the resubmitted scheduled prompt throws', ASK, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    world.submitThrows = true
    await finishNote()
    await endStrongTurnInFreshSession($, world, 'nightly job')
    expect(handoffsStarted(world)).toBe(1)
  })

  test('It leaves a plugin prompt the handoff did not resubmit as it was', ASK, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await finishNote()
    await $.prompt.submit({ text: 'from a plugin', wait: false, origin: { kind: 'plugin', name: 'other' } })
    await endStrongTurnInFreshSession($, world, 'from a plugin')
    expect(handoffsStarted(world)).toBe(1)
  })
})

describe('a turn that starts between resubmitted prompts', () => {
  test('It keeps the origin of each resubmitted turn when a task notification starts a turn between them', ASK, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await submitPerson($, 'person says')
    await finishNote()
    await runTurnWithoutContext($, '<task-notification><task-id>b1</task-id><status>completed</status></task-notification>')
    await endStrongTurnInFreshSession($, world, 'nightly job')
    expect(handoffsStarted(world)).toBe(2)
  })

  test('It judges a resubmitted turn by its origin when the engine frames the prompt text', ASK, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await finishNote()
    await endStrongTurnInFreshSession($, world, 'The handoff plugin sent a message: nightly job')
    expect(handoffsStarted(world)).toBe(2)
  })
})
