import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { bash, completeTurn, growTo200k, runCommand, startTurn, submitPerson, writingTheNote, type World } from './helpers'

const entered = (world: World) => world.effects.filter(effect => effect.startsWith('entered:'))

const ASK = { options: { handoffMode: 'ask' } } as const

// $.prompt.submit resolves once the prompt entered and its turn started, or it was queued behind the running one
// (PromptSubmitResult in the engine's declarations). So when the handoff resubmits two groups back to back, the first
// group's turn is the one running when the second is queued, and the first turn to end is the first group's.
const endFirstTurnInFreshSession = async ($: Engine, world: World, promptText: string) => {
  await growTo200k($, world)
  await startTurn($, promptText)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  await world.clock.settle()
}

const handoffsStarted = (world: World) => world.forkPrompts.length

describe('the origin of the first of several resubmitted turns', () => {
  test('It judges the turn of a resubmitted person group as attended when a scheduled group is queued behind it', ASK, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'person says')
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await finishNote()
    await endFirstTurnInFreshSession($, world, 'person says')
    expect(handoffsStarted(world)).toBe(1)
  })

  test('It judges the turn of a resubmitted scheduled group as unattended when a person group is queued behind it', ASK, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await submitPerson($, 'person says')
    await finishNote()
    await endFirstTurnInFreshSession($, world, 'nightly job')
    expect(handoffsStarted(world)).toBe(2)
  })

  test('It judges the turn of a resubmitted person group as attended when a scheduled prompt that arrived mid-delivery is queued behind it', ASK, async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'person says')
    world.submitHooks = [
      () => {
        void submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
      },
    ]
    await finishNote()
    await endFirstTurnInFreshSession($, world, 'person says')
    expect(handoffsStarted(world)).toBe(1)
  })
})

describe('the session ends while the handoff sends', () => {
  test('It still sends a prompt that arrived mid-delivery when the person runs /clear during the delivery', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    world.submitHooks = [
      () => {
        void submitPerson($, 'late')
        void runCommand($, 'clear')
      },
    ]
    await finishNote()
    expect([entered(world), world.records.filter(record => record.action === 'cleared').length]).toEqual([
      ['entered:plugin:held one', 'entered:plugin:late'],
      1,
    ])
  })

  test('It still sends a prompt that arrived mid-delivery when the session ends for a resume during the delivery', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    world.submitHooks = [
      () => {
        void submitPerson($, 'late')
        void $.session.end({ reason: 'resume', sessionId: 'new-session', resume: { id: 'new-session' } })
      },
    ]
    await finishNote()
    expect([entered(world), world.records.filter(record => record.action === 'cleared').length]).toEqual([
      ['entered:plugin:held one', 'entered:plugin:late'],
      1,
    ])
  })
})

describe('the box order when the fresh session refuses every submit', () => {
  test('It leaves a held prompt ahead of a prompt that arrived mid-delivery in the box', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    world.submitDropped = true
    world.submitHooks = [
      () => {
        void submitPerson($, 'late')
      },
    ]
    await finishNote()
    expect(world.box.text).toBe('held one\nlate')
  })

  test('It leaves prompts that arrived mid-delivery in the box in arrival order', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    world.submitDropped = true
    world.submitHooks = [
      () => {
        void submitPerson($, 'late one')
      },
      () => {
        void submitPerson($, 'late two')
      },
    ]
    await finishNote()
    expect(world.box.text).toBe('held one\nlate one\nlate two')
  })
})

describe('identical prompts that arrived mid-delivery when the box takes them', () => {
  test('It shows an identical prompt typed twice once in the box', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    world.submitDropped = true
    world.submitHooks = [
      () => {
        void submitPerson($, 'again')
      },
      () => {
        void submitPerson($, 'again')
      },
    ]
    await finishNote()
    expect(world.box.text).toBe('held one\nagain')
  })
})
