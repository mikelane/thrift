import { expect, test } from 'claude-code/testing'

import { bandControls } from '../hooks/band-text'
import { bandButtons } from '../hooks/signals'
import { dropOf } from './helpers'
import {
  bash,
  completeTurn,
  growTo200k,
  install,
  mountBand,
  notify,
  startSession,
  runCommand,
  startTurn,
  submitPerson,
  usageOf,
} from './helpers'

const ASK = { options: { handoffMode: 'ask' } } as const

const bandAfterFinishedTask = async ($: Parameters<typeof mountBand>[0], world: Parameters<typeof growTo200k>[1]) => {
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  return mountBand($)
}

const weakBand = async ($: Parameters<typeof mountBand>[0], world: Parameters<typeof growTo200k>[1]) => {
  await growTo200k($, world)
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

test('It logs Not now at once when it is pressed during a turn', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  const band = await mountBand($)
  await startTurn($)
  await band.press({ key: 'not-now' })
  expect(world.records.at(-1)).toMatchObject({ action: 'none', trigger_values: { point: 'button', reason: 'not_now' } })
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

test('It does not hand off when a background shell started during the turn a Hand off press waited on', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await weakBand($, world)
  await submitPerson($, 'keep going')
  await startTurn($)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  await band.press({ key: 'handoff' })
  await completeTurn($)
  await world.clock.settle()
  expect(clears(world)).toHaveLength(0)
})

test('It records background work as busy for a held press when a background shell started during the turn', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await weakBand($, world)
  await submitPerson($, 'keep going')
  await startTurn($)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  await band.press({ key: 'compact' })
  await completeTurn($)
  await world.clock.settle()
  expect(world.records.find(record => record.trigger_values.point === 'button')).toMatchObject({
    trigger_values: { is_background_busy: true },
  })
})

test('It stops offering Hand off and clear after an interrupted turn started a background shell', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await weakBand($, world)
  await submitPerson($, 'keep going')
  await startTurn($)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  await completeTurn($, { reason: 'aborted' })
  expect(await buttonLabels(band)).not.toContain('Hand off and clear')
})

test('It records the cache reads of the turn a held press ran at', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($, { usage: usageOf(1, 0, 5) })
  const band = await mountBand($)
  await submitPerson($, 'keep going')
  await startTurn($)
  await band.press({ key: 'compact' })
  await completeTurn($, { usage: usageOf(1, 0, 777) })
  await world.clock.settle()
  expect(world.records.at(-1)).toMatchObject({ action: 'compacted', trigger_values: { cache_read_tokens: 777 } })
})

test('It does not tell the person to type 0 in an empty prompt while the held prompt fills the box', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.branch = 'alice/eng-1-start'
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  expect(world.box.text).toContain('now ENG-2')
  const band = await mountBand($)
  expect(await band.find({ text: /0 to dismiss|empty prompt/ })).toBeUndefined()
})

const BUSY_REFUSAL = 'handoff: background work started, and a handoff would cut it off. Nothing was cleared.'

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
    action: 'none',
    trigger_values: { point: 'button', signal: 'weak', is_background_busy: true, reason: 'background_busy' },
  })
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

const BUSY_START = { result: { backgroundTaskId: 'bg1' } }

const heldBand = async ($: Parameters<typeof mountBand>[0], world: Parameters<typeof growTo200k>[1]) => {
  world.branch = 'alice/eng-1-start'
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  const dropped = await submitPerson($, 'now ENG-2')
  expect(dropOf(dropped)).toContain('held your prompt')
  await world.clock.settle()
  return mountBand($)
}

const acted = (world: Parameters<typeof growTo200k>[1]) =>
  world.records.filter(r => r.trigger_values.point === 'button').map(r => `${r.action}:${String(r.trigger_values.reason ?? '')}`)

test('It runs only the first of Not now and Hand off pressed together at idle', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await weakBand($, world)
  await Promise.all([band.press({ key: 'not-now' }), band.press({ key: 'handoff' })])
  await world.clock.settle()
  expect(acted(world)).toEqual(['none:not_now'])
  expect(clears(world)).toHaveLength(0)
})

test('It runs only one of Hand off and Compact pressed together at idle', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await weakBand($, world)
  await Promise.all([band.press({ key: 'handoff' }), band.press({ key: 'compact' })])
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'clear' || effect === 'compact')).toHaveLength(1)
})

test('It does not leave a held-prompt band up after the held prompt was replaced and a busy refusal ran', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await heldBand($, world)
  await notify($, 'bgX')
  await startTurn($)
  await band.press({ key: 'handoff-send' })
  await bash($, world, 'npm run dev', BUSY_START)
  await submitPerson($, 'actually do this instead', { turnId: 't1' })
  await completeTurn($)
  await world.clock.settle()
  const after = await mountBand($)
  expect(await after.find({ text: 'engine band' })).toBeDefined()
})

test('It does not record a strong signal with background work running for a refused held press', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await heldBand($, world)
  await bash($, world, 'npm run dev', BUSY_START)
  await band.press({ key: 'handoff-send' })
  expect(world.records.at(-1)).toMatchObject({ trigger_values: { reason: 'background_busy', is_background_busy: true } })
  expect(world.records.at(-1)?.trigger_values.signal).not.toBe('strong')
})

test('It offers Hand off again after an interrupted turn once the background work it refused over finished', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await weakBand($, world)
  await bash($, world, 'npm run dev', BUSY_START)
  await band.press({ key: 'handoff' })
  expect(await buttonLabels(band)).toEqual(['Compact', 'Not now'])
  await notify($, 'bg1')
  await startTurn($)
  await completeTurn($, { reason: 'aborted' })
  expect(await buttonLabels(band)).toEqual(['Compact', 'Hand off and clear', 'Not now'])
})

test('It refreshes the band on a refusal turn end', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await weakBand($, world)
  await startTurn($)
  await bash($, world, 'npm run dev', BUSY_START)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'refusal',
    refusal: { category: null, explanation: null } })
  expect(await buttonLabels(band)).toEqual(['Compact', 'Not now'])
})

const SHAPES = [
  { signal: 'strong', heldPrompt: false, isBusy: false },
  { signal: 'strong', heldPrompt: true, isBusy: false },
  { signal: 'strong', heldPrompt: true, isBusy: true },
  { signal: 'weak', heldPrompt: false, isBusy: false },
  { signal: 'weak', heldPrompt: false, isBusy: true },
] as const

for (const shape of SHAPES) {
  test(`It gives unique hotkeys and one primary for ${JSON.stringify(shape)}`, () => {
    const controls = bandControls(bandButtons(shape))
    expect(new Set(controls.map(c => c.hotkey)).size).toBe(controls.length)
    expect(controls.filter(c => c.isPrimary)).toHaveLength(1)
  })
}


test('It does not redraw the old held offer when the band was taken down since the press', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await heldBand($, world)
  await notify($, 'bgX')
  await startTurn($)
  await band.press({ key: 'handoff-send' })
  await submitPerson($, 'actually do this instead', { turnId: 't1' })
  await bash($, world, 'npm run dev', BUSY_START)
  await completeTurn($)
  expect(world.records.at(-1)).toMatchObject({ trigger_values: { reason: 'background_busy' } })
  expect(world.effects).toContain(`toast:${BUSY_REFUSAL}`)
  const after = await mountBand($)
  expect(await after.find({ text: 'engine band' })).toBeDefined()
})

test('It says so and takes the band down when a held press finds the prompt no longer held', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.branch = 'alice/eng-1-start'
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2')
  const band = await mountBand($)
  await startTurn($)
  await band.press({ key: 'send-here' })
  world.fillRefusal = 'dialog'
  await world.clock.settle()
  await completeTurn($)
  expect(world.effects).toContain('toast:handoff: that prompt is no longer held, so there is nothing to send.')
  const after = await mountBand($)
  expect(await after.find({ text: 'engine band' })).toBeDefined()
})

test('It leaves a newer band alone when a refused press was made on an older one', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.branch = 'alice/eng-1-start'
  await submitPerson($, 'start on ENG-1')
  const band = await weakBand($, world)
  await startTurn($)
  await band.press({ key: 'handoff' })
  await submitPerson($, 'now ENG-2')
  await bash($, world, 'npm run dev', BUSY_START)
  await completeTurn($)
  expect(await buttonLabels(band)).toEqual(['Hand off and send it', 'Send here'])
})

test('It still refuses and records when the band cannot be read for the redraw', ASK, async ($, on) => {
  const world = install($, on)
  let isStoreGone = false
  on('state.get', (_$, e, next) => (isStoreGone ? { deny: 'store gone' } : next(e)))
  await startSession($)
  const band = await weakBand($, world)
  await bash($, world, 'npm run dev', BUSY_START)
  isStoreGone = true
  await band.press({ key: 'handoff' })
  expect(world.debugLines.join('\n')).toContain('could not read the band')
  expect(world.records.at(-1)).toMatchObject({ trigger_values: { reason: 'background_busy' } })
})

test('It runs a second idle press after the first one settled', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const first = await weakBand($, world)
  await first.press({ key: 'compact' })
  await world.clock.settle()
  const second = await weakBand($, world)
  await second.press({ key: 'handoff' })
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'clear')).toHaveLength(1)
})

test('It runs a press after a /clear that a press caused', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const first = await weakBand($, world)
  await first.press({ key: 'handoff' })
  await world.clock.settle()
  const second = await weakBand($, world)
  await second.press({ key: 'compact' })
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'compact')).toHaveLength(1)
})

test('It runs an idle press after a held press ran at a turn end', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const first = await weakBand($, world)
  await startTurn($)
  await first.press({ key: 'compact' })
  await completeTurn($)
  await world.clock.settle()
  const second = await weakBand($, world)
  await second.press({ key: 'handoff' })
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'clear')).toHaveLength(1)
})

test('It runs a press after a busy refusal settled', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await weakBand($, world)
  await bash($, world, 'npm run dev', BUSY_START)
  await band.press({ key: 'handoff' })
  await band.press({ key: 'compact' })
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'compact')).toHaveLength(1)
})

test('It redraws the busy shape when the band was redrawn with equal content since the press', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await weakBand($, world)
  await startTurn($)
  await band.press({ key: 'handoff' })
  await bash($, world, 'npm run dev', BUSY_START)
  await completeTurn($)
  expect((await band.findAll({ type: 'Button' })).map(button => button.props.label)).toEqual(['Compact', 'Not now'])
})

test('It takes down the held band after a busy refusal once the prompt is sent', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.branch = 'alice/eng-1-start'
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  const band = await mountBand($)
  await notify($, 'bgX')
  await startTurn($)
  await band.press({ key: 'handoff-send' })
  await bash($, world, 'npm run dev', BUSY_START)
  await completeTurn($)
  await world.clock.settle()
  const redrawn = await mountBand($)
  await redrawn.press({ key: 'send-here' })
  await world.clock.settle()
  const after = await mountBand($)
  expect(await after.find({ text: 'engine band' })).toBeDefined()
})

test('It takes down a held band left up by a failed takedown when Send here finds no held prompt', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.branch = 'alice/eng-1-start'
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  const band = await mountBand($)
  world.stateSetThrows = true
  await submitPerson($, 'mid-turn note', { turnId: 't1' })
  world.stateSetThrows = false
  expect(await band.find({ text: 'engine band' })).toBeUndefined()
  await band.press({ key: 'send-here' })
  await world.clock.settle()
  const after = await mountBand($)
  expect(await after.find({ text: 'engine band' })).toBeDefined()
})
