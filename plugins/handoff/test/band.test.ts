import { expect, test } from 'claude-code/testing'

import { BAND_HINT } from '../hooks/band-text'
import {
  bash,
  completeTurn,
  growTo200k,
  install,
  lastRecord,
  mountBand,
  notify,
  runStep,
  startSession,
  submitPerson,
  usageOf,
} from './helpers'

const ASK = { options: { handoffMode: 'ask' } } as const

const finishedTaskTurn = async ($: Parameters<typeof mountBand>[0], world: Parameters<typeof growTo200k>[1]) => {
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
}

const labelsOf = async (band: Awaited<ReturnType<typeof mountBand>>) =>
  (await band.findAll({ type: 'Button' })).map(button => button.props.label)

test('It draws no band of its own while no offer stands', ASK, async ($, on) => {
  install($, on)
  await startSession($)
  const band = await mountBand($)
  expect(await band.find({ text: 'engine band' })).toBeDefined()
})

test('It offers a band after a finished task in ask mode', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  const band = await mountBand($)
  expect(await labelsOf(band)).toEqual(['Hand off and clear', 'Not now'])
})

test('It logs an advised record when it offers a band', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  expect(lastRecord(world)).toMatchObject({
    mode: 'active',
    action: 'advised',
    trigger_values: { point: 'turn-end', signal: 'strong', setting: 'ask' },
  })
})

test('It states the context in thousands and that accuracy drops in a finished-task band', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  const band = await mountBand($)
  const message = await band.find({ text: 'Context is 200k and the task just finished.' })
  expect(message?.text).toContain('Accuracy drops as context grows.')
})

test('It takes the band down when the person starts the next turn', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  await submitPerson($, 'keep going')
  const band = await mountBand($)
  expect(await band.find({ text: 'engine band' })).toBeDefined()
})

test('It takes the band down when a task notification starts the next turn', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  await notify($, 'bg1')
  const band = await mountBand($)
  expect(await band.find({ text: 'engine band' })).toBeDefined()
})

test('It adds a dim line about act mode to the band', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  const band = await mountBand($)
  expect(await band.find({ text: BAND_HINT })).toBeDefined()
})

test('It offers Hand off, Compact, and Not now for a weak signal', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  const band = await mountBand($)
  expect(await labelsOf(band)).toEqual(['Hand off and clear', 'Compact', 'Not now'])
})

test('It offers no handoff button while background work runs', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'sleep 100', { result: { backgroundTaskId: 'bg1' } })
  await completeTurn($)
  const band = await mountBand($)
  expect(await labelsOf(band)).toEqual(['Compact', 'Not now'])
})

test('It says a handoff would orphan background work in that band', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'sleep 100', { result: { backgroundTaskId: 'bg1' } })
  await completeTurn($)
  const band = await mountBand($)
  expect(await band.find({ text: 'Context is 200k and background work is still running.' })).toBeDefined()
})

test('It says only the size in a plain weak band', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  const band = await mountBand($)
  expect(await band.find({ text: 'Context is 200k.' })).toBeDefined()
})

test('It yields the band to a survey', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  const band = await mountBand($, { hasSurvey: true })
  expect(await band.find({ text: 'engine band' })).toBeDefined()
})

test('It takes the band down when a later turn needs no offer', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  await runStep($, world, { usage: usageOf(1_000, 0, 9_000) })
  await completeTurn($)
  const band = await mountBand($)
  expect(await band.find({ text: 'engine band' })).toBeDefined()
})

test('It keeps evaluating turns when the band cannot be taken down', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  world.stateSetThrows = true
  await runStep($, world, { usage: usageOf(1_000, 0, 9_000) })
  await completeTurn($)
  expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { signal: 'none' } })
  expect(world.debugLines.join('\n')).toContain('could not take down the band')
})

test('It logs the offer as none when the band cannot be shown', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.stateSetThrows = true
  await finishedTaskTurn($, world)
  expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { reason: 'band_failed' } })
})

test('It does nothing but offer in ask mode', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(world.effects).not.toContain('fork')
  expect(world.effects).not.toContain('compact')
})

test('It hands off when Hand off and clear is pressed', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  const band = await mountBand($)
  await band.press({ key: 'handoff' })
  await world.clock.settle()
  expect(world.effects).toContain('clear')
  expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { point: 'button', signal: 'strong' } })
})

test('It does not hand off inside the press', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  const band = await mountBand($)
  await band.press({ key: 'handoff' })
  expect(world.effects).not.toContain('clear')
})

test('It compacts when Compact is pressed', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  const band = await mountBand($)
  await band.press({ key: 'compact' })
  await world.clock.settle()
  expect(world.effects).toContain('compact')
  expect(lastRecord(world)).toMatchObject({ action: 'compacted', trigger_values: { point: 'button', signal: 'weak' } })
})

test('It ignores a second Compact press while one is pending', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  const band = await mountBand($)
  await Promise.all([band.press({ key: 'compact' }), band.press({ key: 'compact' })])
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'compact')).toHaveLength(1)
})

test('It logs none and takes the band down when Not now is pressed', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  const band = await mountBand($)
  await band.press({ key: 'not-now' })
  expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { point: 'button', reason: 'not_now' } })
  expect(await band.find({ text: 'engine band' })).toBeDefined()
})

test('It stays quiet for a weak signal until the context grows 50000 tokens after Not now', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  const band = await mountBand($)
  await band.press({ key: 'not-now' })
  await runStep($, world, { usage: usageOf(1_000, 0, 248_999) })
  await completeTurn($)
  expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { reason: 'backoff' } })
})

test('It offers a weak band again once the context has grown 50000 tokens after Not now', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  const band = await mountBand($)
  await band.press({ key: 'not-now' })
  await runStep($, world, { usage: usageOf(1_000, 0, 249_000) })
  await completeTurn($)
  expect(lastRecord(world).action).toBe('advised')
})

test('It still offers a strong band after Not now', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  const band = await mountBand($)
  await band.press({ key: 'not-now' })
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  expect(lastRecord(world)).toMatchObject({ action: 'advised', trigger_values: { signal: 'strong' } })
})

test('It does not offer while a handoff is pending', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  const band = await mountBand($)
  await band.press({ key: 'handoff' })
  await bash($, world, 'git commit -m y')
  await completeTurn($)
  await world.clock.settle()
  expect(world.records.map(record => record.action)).toEqual(['advised', 'cleared'])
})

test('It takes a standing band down when the plugin starts again after a reload', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  const band = await mountBand($)
  await startSession($)
  expect(await band.find({ text: 'engine band' })).toBeDefined()
})
