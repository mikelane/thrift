import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelForkResult } from 'claude-code'

import {
  answered,
  bash,
  completeTurn,
  growTo200k,
  install,
  mountBand,
  runCommand,
  startSession,
  submitPerson,
  type World,
} from './helpers'

const ASK = { options: { handoffMode: 'ask' } } as const
const ACT = { options: { handoffMode: 'act' } } as const

const STATUS = 'Writing a handoff note — this takes a few seconds…'

// The fork stays unanswered until the test releases it, so the band can be read while the note is being written.
const holdFork = (world: World) => {
  const held: { release: (result: ModelForkResult) => void } = { release: () => undefined }
  world.fork = () =>
    new Promise<ModelForkResult>(resolve => {
      held.release = resolve
    })
  return (result: ModelForkResult) => held.release(result)
}

const shownText = async (band: Awaited<ReturnType<typeof mountBand>>) =>
  (await band.findAll({ type: 'Text' })).map(text => text.text)

const buttonCount = async (band: Awaited<ReturnType<typeof mountBand>>) => (await band.findAll({ type: 'Button' })).length

const pressedAskBand = async ($: Engine, world: World, beforePress: () => void = () => undefined) => {
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  const band = await mountBand($)
  beforePress()
  await band.press({ key: 'handoff' })
  await world.clock.settle()
  return band
}

test('It shows a status line while the note is written after Hand off and clear is pressed', ASK, async ($, on) => {
  const world = install($, on)
  holdFork(world)
  const band = await pressedAskBand($, world)
  expect(await shownText(band)).toEqual([STATUS])
})

test('It shows no buttons while the note is written', ASK, async ($, on) => {
  const world = install($, on)
  holdFork(world)
  const band = await pressedAskBand($, world)
  expect(await buttonCount(band)).toBe(0)
})

test('It shows the status line while the note is written in act mode', ACT, async ($, on) => {
  const world = install($, on)
  holdFork(world)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  await world.clock.settle()
  expect(await shownText(await mountBand($))).toEqual([STATUS])
})

test('It shows the status line while the note is written for /handoff', async ($, on) => {
  const world = install($, on)
  holdFork(world)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(await shownText(await mountBand($))).toEqual([STATUS])
})

test('It shows the status line while the note is written for a held prompt handed off first', ACT, async ($, on) => {
  const world = install($, on)
  holdFork(world)
  world.branch = 'alice/eng-1-start'
  await startSession($)
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  expect(await shownText(await mountBand($))).toEqual([STATUS])
})

test('It takes the status line down once the clear runs', ASK, async ($, on) => {
  const world = install($, on)
  const release = holdFork(world)
  const band = await pressedAskBand($, world)
  release(answered('The handoff note.'))
  await world.clock.settle()
  expect(world.effects).toContain('clear')
  expect(await shownText(band)).toEqual(['engine band'])
})

test('It takes the status line down when the fork gives no answer', ASK, async ($, on) => {
  const world = install($, on)
  const release = holdFork(world)
  const band = await pressedAskBand($, world)
  release({ isAnswered: false, reason: 'nothing-to-fork' })
  await world.clock.settle()
  expect(await shownText(band)).toEqual(['engine band'])
})

test('It takes the status line down when the fork gives an empty note', ASK, async ($, on) => {
  const world = install($, on)
  const release = holdFork(world)
  const band = await pressedAskBand($, world)
  release(answered('   '))
  await world.clock.settle()
  expect(await shownText(band)).toEqual(['engine band'])
})

test('It takes the status line down when a step throws before the clear', ASK, async ($, on) => {
  const world = install($, on)
  const release = holdFork(world)
  const band = await pressedAskBand($, world, () => {
    world.sessionIdDenials = 1
  })
  release(answered('The handoff note.'))
  await world.clock.settle()
  expect(world.effects).not.toContain('clear')
  expect(await shownText(band)).toEqual(['engine band'])
})

test('It takes the status line down when the clear fails', ASK, async ($, on) => {
  const world = install($, on)
  world.clearThrows = true
  const release = holdFork(world)
  const band = await pressedAskBand($, world)
  release(answered('The handoff note.'))
  await world.clock.settle()
  expect(await shownText(band)).toEqual(['engine band'])
})

test('It leaves the status line up when a turn ends without an answer while the note is written', ASK, async ($, on) => {
  const world = install($, on)
  holdFork(world)
  const band = await pressedAskBand($, world)
  await completeTurn($, { reason: 'aborted' })
  expect(await shownText(band)).toEqual([STATUS])
})

test('It ignores a Not now press while the note is written', ASK, async ($, on) => {
  const world = install($, on)
  holdFork(world)
  const band = await pressedAskBand($, world)
  const recordsBefore = world.records.length
  await expect(band.press({ key: 'not-now' })).rejects.toThrow()
  expect(world.records).toHaveLength(recordsBefore)
  expect(await shownText(band)).toEqual([STATUS])
})

test('It starts no second handoff from a press while the note is written', ASK, async ($, on) => {
  const world = install($, on)
  holdFork(world)
  const band = await pressedAskBand($, world)
  await expect(band.press({ key: 'handoff' })).rejects.toThrow()
  expect(world.effects.filter(effect => effect === 'fork')).toHaveLength(1)
})

test('It does not keep the status line across a session start', ASK, async ($, on) => {
  const world = install($, on)
  holdFork(world)
  const band = await pressedAskBand($, world)
  await startSession($)
  expect(await shownText(band)).toEqual(['engine band'])
})

test('It keeps the status line when a held prompt is sent again while /handoff writes the note', ASK, async ($, on) => {
  const world = install($, on)
  world.branch = 'alice/eng-1-start'
  holdFork(world)
  await startSession($)
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  await runCommand($, 'handoff')
  await world.clock.settle()
  await submitPerson($, 'now ENG-2')
  expect(await shownText(await mountBand($))).toEqual([STATUS])
})

test('It leaves a held prompt in the box when /handoff runs instead of sending it', ASK, async ($, on) => {
  const world = install($, on)
  world.branch = 'alice/eng-1-start'
  holdFork(world)
  await startSession($)
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.box.text).toBe('now ENG-2')
})
