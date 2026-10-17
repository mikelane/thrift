import { describe, expect, test } from 'claude-code/testing'

import {
  bash,
  buttonLabels,
  clears,
  completeTurn,
  entered,
  growTo200k,
  install,
  mountBand,
  notify,
  runCommand,
  startSession,
  startTurn,
  submitPerson,
  usageOf,
} from './helpers'
import { ASK, HELD_PROMPT as HELD, heldPromptBand, holdFill, weakBand } from './band-turn-fixtures'

const TAKEDOWN_WRITE = JSON.stringify({ shape: 'offer-has-held-prompt', value: null })

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
  expect(world.effects.filter(effect => effect === 'entered:plugin+asUser:now ENG-2')).toHaveLength(0)
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'entered:plugin+asUser:now ENG-2')).toHaveLength(1)
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

describe('pressHeldPromptButton', () => {
  test('It empties the held prompt from the box when Send here is pressed', ASK, async ($, on) => {
    const world = install($, on)
    await startSession($)
    const band = await heldPromptBand($, world)
    expect(world.box.text).toContain(HELD)
    await band.press({ key: 'send-here' })
    expect(world.box.text).not.toContain(HELD)
  })

  test('It empties the held prompt from the box when Hand off and send is pressed', ASK, async ($, on) => {
    const world = install($, on)
    await startSession($)
    const band = await heldPromptBand($, world)
    expect(world.box.text).toContain(HELD)
    await band.press({ key: 'handoff-send' })
    expect(world.box.text).not.toContain(HELD)
  })

  test('It sends nothing for Send here until the box has been emptied', ASK, async ($, on) => {
    const world = install($, on)
    await startSession($)
    const band = await heldPromptBand($, world)
    const fill = holdFill(world)
    const pressed = band.press({ key: 'send-here' })
    await world.clock.settle()
    expect(entered(world).filter(effect => effect.includes(HELD))).toHaveLength(0)
    fill.release()
    await pressed
    await world.clock.settle()
    expect(entered(world).filter(effect => effect.includes(HELD))).toHaveLength(1)
  })

  test('It takes the band down before it empties the box', ASK, async ($, on) => {
    const world = install($, on)
    await startSession($)
    const band = await heldPromptBand($, world)
    const boxHeldPromptAtTakedown: boolean[] = []
    world.onOfferWrite = async value => {
      if (JSON.stringify(value) === TAKEDOWN_WRITE) boxHeldPromptAtTakedown.push(world.box.text.includes(HELD))
    }
    await band.press({ key: 'send-here' })
    expect(boxHeldPromptAtTakedown).toEqual([true])
  })

  test('It does not carry a prompt Send here already sent into a later /handoff', ASK, async ($, on) => {
    const world = install($, on)
    await startSession($)
    const band = await heldPromptBand($, world)
    await band.press({ key: 'send-here' })
    await world.clock.settle()
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(entered(world).filter(effect => effect.includes(HELD))).toHaveLength(1)
  })
})
