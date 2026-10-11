import { expect, test } from 'claude-code/testing'

import {
  bash,
  completeTurn,
  growTo200k,
  install,
  lastRecord,
  mountBand,
  startSession,
  runCommand,
  startTurn,
  submitPerson,
} from './helpers'
import { ASK, bandAfterFinishedTask, weakBand, buttonLabels, clears, BUSY_REFUSAL } from './band-turn-fixtures'

test('It refuses to clear and says why when background work started before an immediate press', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await weakBand($, world)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  await band.press({ key: 'handoff' })
  await world.clock.settle()
  expect(clears(world)).toHaveLength(0)
  expect(world.effects).toContain(`toast:${BUSY_REFUSAL}`)
})

test('It redraws the band in its busy shape after refusing to clear', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await weakBand($, world)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  await band.press({ key: 'handoff' })
  expect(await buttonLabels(band)).toEqual(['Compact', 'Not now'])
})

test('It writes a background_busy record when it refuses to clear', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await weakBand($, world)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  await band.press({ key: 'handoff' })
  expect(world.records.at(-1)).toMatchObject({
    mode: 'active',
    action: 'none',
    trigger_values: { point: 'button', signal: 'weak', is_background_busy: true, reason: 'background_busy' },
  })
})

test('It writes the background_busy record of a refused press with no held-prompt fields', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await weakBand($, world)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  await band.press({ key: 'handoff' })
  const { trigger_values } = lastRecord(world)
  expect(trigger_values.reason).toBe('background_busy')
  expect(Object.keys(trigger_values).sort()).toEqual(
    ['cache_read_tokens', 'context_tokens', 'effective_mode', 'is_background_busy', 'point', 'reason', 'setting', 'signal', 'threshold'],
  )
})

test('It still writes the record and toast when the busy band cannot be redrawn', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await weakBand($, world)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  world.stateSetThrows = true
  await band.press({ key: 'handoff' })
  expect(world.debugLines.join('\n')).toContain('could not redraw the band')
  expect(world.records.at(-1)).toMatchObject({ trigger_values: { reason: 'background_busy' } })
})

test('It refuses Hand off and send it and leaves Send here when background work started', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.branch = 'alice/eng-1-start'
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2')
  const band = await mountBand($)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  await band.press({ key: 'handoff-send' })
  await world.clock.settle()
  expect(clears(world)).toHaveLength(0)
  expect(await buttonLabels(band)).toEqual(['Send here'])
  expect((await band.find({ type: 'Button' }))?.props).toMatchObject({ variant: 'primary', autoFocus: true })
})

test('It does not refuse Compact when background work is running', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await weakBand($, world)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  await band.press({ key: 'compact' })
  await world.clock.settle()
  expect(world.effects).toContain('compact')
})

test('It keeps a band whose busy state is unchanged after an interrupted turn', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await weakBand($, world)
  await submitPerson($, 'keep going')
  await startTurn($)
  await completeTurn($, { reason: 'aborted' })
  expect(await buttonLabels(band)).toEqual(['Compact', 'Hand off and clear', 'Not now'])
})

test('It draws no band after an interrupted turn when none was up', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await startTurn($)
  await completeTurn($, { reason: 'aborted' })
  const band = await mountBand($)
  expect(await band.find({ text: 'engine band' })).toBeDefined()
})

test('It starts the next turn when the band cannot be read after an interrupted turn', ASK, async ($, on) => {
  const world = install($, on)
  on('state.get', () => ({ deny: 'store gone' }))
  await startSession($)
  world.debugLines.length = 0
  await startTurn($)
  await completeTurn($, { reason: 'aborted' })
  expect(world.debugLines.join('\n')).toContain('could not read the band')
})

test('It tells the person when a held press is dropped because a handoff is already pending', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await bandAfterFinishedTask($, world)
  await startTurn($)
  await band.press({ key: 'handoff' })
  await runCommand($, 'handoff')
  await completeTurn($)
  expect(world.effects).toContain('toast:A handoff or compaction is already in progress.')
})
