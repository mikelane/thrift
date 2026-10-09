import { expect, test } from 'claude-code/testing'

import { dropOf } from './helpers'
import {
  bash,
  completeTurn,
  growTo200k,
  install,
  mountBand,
  notify,
  startSession,
  startTurn,
  submitPerson,
} from './helpers'

const ASK = { options: { handoffMode: 'ask' } } as const

const bandAfterFinishedTask = async ($: Parameters<typeof mountBand>[0], world: Parameters<typeof growTo200k>[1]) => {
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  return mountBand($)
}

const buttonLabels = async (band: Awaited<ReturnType<typeof mountBand>>) =>
  (await band.findAll({ type: 'Button' })).map(button => button.props.label)

const clears = (world: Parameters<typeof growTo200k>[1]) => world.effects.filter(effect => effect === 'clear')

test('It keeps the band up when the person starts the next turn', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await bandAfterFinishedTask($, world)
  await submitPerson($, 'keep going')
  await startTurn($)
  expect(await buttonLabels(band)).toEqual(['Hand off and clear', 'Not now'])
})

test('It keeps the band up when a task notification starts the next turn', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await bandAfterFinishedTask($, world)
  await notify($, 'bg1')
  expect(await buttonLabels(band)).toEqual(['Hand off and clear', 'Not now'])
})

test('It does not clear when Hand off and clear is pressed while a turn runs', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await bandAfterFinishedTask($, world)
  await startTurn($)
  await band.press({ key: 'handoff' })
  await world.clock.settle()
  expect(clears(world)).toHaveLength(0)
})

test('It tells the person a press made during a turn waits for the turn to end', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await bandAfterFinishedTask($, world)
  await startTurn($)
  await band.press({ key: 'handoff' })
  expect(world.effects).toContain('toast:handoff: this turn is still running, so your choice will run when it ends.')
})

test('It keeps the band up until a press made during a turn runs', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await bandAfterFinishedTask($, world)
  await startTurn($)
  await band.press({ key: 'handoff' })
  expect(await buttonLabels(band)).toEqual(['Hand off and clear', 'Not now'])
})

test('It clears when the turn ends after Hand off and clear was pressed during it', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await bandAfterFinishedTask($, world)
  await startTurn($)
  await band.press({ key: 'handoff' })
  await completeTurn($)
  await world.clock.settle()
  expect(clears(world)).toHaveLength(1)
})

test('It records a held press as a button handoff once the turn ends', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await bandAfterFinishedTask($, world)
  await startTurn($)
  await band.press({ key: 'handoff' })
  await completeTurn($)
  await world.clock.settle()
  expect(world.records.map(record => record.action)).toEqual(['advised', 'cleared'])
  expect(world.records.at(-1)).toMatchObject({ trigger_values: { point: 'button', signal: 'strong' } })
})

test('It runs a press made twice during a turn only once', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await bandAfterFinishedTask($, world)
  await startTurn($)
  await band.press({ key: 'handoff' })
  await band.press({ key: 'handoff' })
  await completeTurn($)
  await world.clock.settle()
  expect(clears(world)).toHaveLength(1)
})

test('It keeps the first press when a second button is pressed during the same turn', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await bandAfterFinishedTask($, world)
  await startTurn($)
  await band.press({ key: 'handoff' })
  await band.press({ key: 'not-now' })
  await completeTurn($)
  await world.clock.settle()
  expect(world.records.map(record => record.action)).toEqual(['advised', 'cleared'])
})

test('It compacts only once the turn ends after Compact was pressed during it', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  const band = await mountBand($)
  await startTurn($)
  await band.press({ key: 'compact' })
  await world.clock.settle()
  expect(world.effects).not.toContain('compact')
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'compact')).toHaveLength(1)
})

test('It logs Not now only once the turn ends after it was pressed during the turn', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  const band = await mountBand($)
  await startTurn($)
  await band.press({ key: 'not-now' })
  expect(world.records.map(record => record.action)).toEqual(['advised'])
  await completeTurn($)
  expect(world.records.at(-1)).toMatchObject({ action: 'none', trigger_values: { point: 'button', reason: 'not_now' } })
})

test('It runs a held press instead of a fresh offer at the end of that turn', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await bandAfterFinishedTask($, world)
  await startTurn($)
  await band.press({ key: 'handoff' })
  await bash($, world, 'git commit -m y')
  await completeTurn($)
  await world.clock.settle()
  expect(world.records.map(record => record.action)).toEqual(['advised', 'cleared'])
})

test('It runs a held press when the turn is interrupted', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await bandAfterFinishedTask($, world)
  await startTurn($)
  await band.press({ key: 'handoff' })
  await completeTurn($, { reason: 'aborted' })
  await world.clock.settle()
  expect(clears(world)).toHaveLength(1)
})

test('It keeps a press waiting when an agent finishes its turn', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await bandAfterFinishedTask($, world)
  await startTurn($)
  await band.press({ key: 'handoff' })
  await completeTurn($, { agentId: 'agent1' })
  await world.clock.settle()
  expect(clears(world)).toHaveLength(0)
})

test('It presses at once when no turn is running', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await bandAfterFinishedTask($, world)
  await startTurn($)
  await completeTurn($)
  await band.press({ key: 'handoff' })
  await world.clock.settle()
  expect(clears(world)).toHaveLength(1)
})

test('It drops a held press when the session ends before the turn does', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await bandAfterFinishedTask($, world)
  await startTurn($)
  await band.press({ key: 'handoff' })
  await $.session.end({ reason: 'other', sessionId: 'old-session', resume: { id: 'old-session' } })
  await completeTurn($)
  await world.clock.settle()
  expect(clears(world)).toHaveLength(0)
})

test('It takes the band down when the session ends during a turn', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await bandAfterFinishedTask($, world)
  await startTurn($)
  await $.session.end({ reason: 'clear', sessionId: 'old-session', resume: { id: 'old-session' } })
  expect(await band.find({ text: 'engine band' })).toBeDefined()
})

test('It forgets a running turn when the session ends', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await bandAfterFinishedTask($, world)
  await startTurn($)
  await $.session.end({ reason: 'other', sessionId: 'old-session', resume: { id: 'old-session' } })
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m z')
  await completeTurn($)
  const fresh = await mountBand($)
  await fresh.press({ key: 'handoff' })
  await world.clock.settle()
  expect(clears(world)).toHaveLength(1)
  expect(band).toBeDefined()
})

const heldPromptBand = async ($: Parameters<typeof mountBand>[0], world: Parameters<typeof growTo200k>[1]) => {
  world.branch = 'alice/eng-1-start'
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  const dropped = await submitPerson($, 'now ENG-2')
  expect(dropOf(dropped)).toContain('held your prompt')
  return mountBand($)
}

test('It keeps a held-prompt band up when a task notification starts a turn', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await heldPromptBand($, world)
  await notify($, 'bg1')
  expect(await buttonLabels(band)).toEqual(['Hand off and send it', 'Send here'])
})

test('It sends the held prompt only once the turn ends after Send here was pressed during it', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await heldPromptBand($, world)
  await world.clock.settle()
  await startTurn($)
  await band.press({ key: 'send-here' })
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'entered:plugin:now ENG-2')).toHaveLength(0)
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'entered:plugin:now ENG-2')).toHaveLength(1)
})
