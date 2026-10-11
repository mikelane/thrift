import { expect, test } from 'claude-code/testing'

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
import { ASK, bandAfterFinishedTask, buttonLabels, clears } from './band-turn-fixtures'

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
  expect(world.effects).toContain('toast:This turn is still running, so your choice will run when it ends.')
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
  expect(world.records.at(-1)).toMatchObject({ mode: 'active', trigger_values: { point: 'button', signal: 'strong' } })
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

test('It logs Not now at once when it is pressed during a turn', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  const band = await mountBand($)
  await startTurn($)
  await band.press({ key: 'not-now' })
  expect(world.records.at(-1)).toMatchObject({ mode: 'active', action: 'none', trigger_values: { point: 'button', reason: 'not_now' } })
})

test('It takes the band down at once when Not now is pressed during a turn', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  const band = await mountBand($)
  await startTurn($)
  await band.press({ key: 'not-now' })
  expect(await band.find({ text: 'engine band' })).toBeDefined()
})

test('It does not say a turn is running when Not now is pressed during it', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  const band = await mountBand($)
  await startTurn($)
  await band.press({ key: 'not-now' })
  expect(world.effects.filter(effect => effect.includes('still running'))).toHaveLength(0)
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
  await completeTurn($)
  await world.clock.settle()
  expect(clears(world)).toHaveLength(1)
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
  await bandAfterFinishedTask($, world)
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
})
