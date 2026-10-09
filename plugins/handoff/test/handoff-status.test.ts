import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelForkResult, SessionCompactResult } from 'claude-code'

import {
  answered,
  bash,
  completeTurn,
  growTo200k,
  install,
  mountBand,
  notify,
  runCommand,
  startSession,
  startTurn,
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

// A typed /handoff is entered from the box the held prompt was refilled into, so the box is empty by then.
const holdPrompt = async ($: Engine, world: World) => {
  world.branch = 'alice/eng-1-start'
  await startSession($)
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
}

const holdPromptThenRunHandoff = async ($: Engine, world: World) => {
  await holdPrompt($, world)
  world.box = { text: '', cursor: 0 }
  await runCommand($, 'handoff')
  await world.clock.settle()
}

test('It submits a held prompt in the fresh session when /handoff runs over it', ASK, async ($, on) => {
  const world = install($, on)
  await holdPromptThenRunHandoff($, world)
  expect(world.effects.slice(world.effects.indexOf('clear'))).toContain('entered:plugin:now ENG-2')
})

test('It puts a held prompt back in the box when /handoff cannot write the note', ASK, async ($, on) => {
  const world = install($, on)
  world.fork = async () => ({ isAnswered: false, reason: 'nothing-to-fork' })
  await holdPromptThenRunHandoff($, world)
  expect(world.box.text).toBe('now ENG-2')
})

const HELD = 'now ENG-2'

const sentHeldPrompts = (world: World) => world.effects.filter(effect => effect === `entered:plugin:${HELD}`)

test('It submits a held prompt exactly once when /handoff runs over it', ASK, async ($, on) => {
  const world = install($, on)
  await holdPromptThenRunHandoff($, world)
  expect(sentHeldPrompts(world)).toHaveLength(1)
})

test('It puts a held prompt back in the box and sends nothing when the fork throws under /handoff', ASK, async ($, on) => {
  const world = install($, on)
  world.fork = async () => {
    throw new Error('fork down')
  }
  await holdPromptThenRunHandoff($, world)
  expect([world.box.text, sentHeldPrompts(world).length]).toEqual([HELD, 0])
})

test('It puts a held prompt back in the box and sends nothing when session.id is denied under /handoff', ASK, async ($, on) => {
  const world = install($, on)
  await holdPrompt($, world)
  world.box = { text: '', cursor: 0 }
  world.sessionIdDenials = 1
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect([world.box.text, sentHeldPrompts(world).length]).toEqual([HELD, 0])
})

test('It puts a held prompt back in the box and sends nothing when the clear throws under /handoff', ASK, async ($, on) => {
  const world = install($, on)
  world.clearThrows = true
  await holdPromptThenRunHandoff($, world)
  expect([world.box.text, sentHeldPrompts(world).length]).toEqual([HELD, 0])
})

test('It submits nothing in the fresh session when /handoff runs with no prompt held', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects.filter(effect => effect.startsWith('entered:'))).toEqual([])
})

// The Remote Control bridge enters /handoff without touching the terminal box, which still holds the refilled prompt.
test('It empties the box of a held prompt when /handoff arrives from the bridge', ASK, async ($, on) => {
  const world = install($, on)
  await holdPrompt($, world)
  await $.command.run({
    command: 'handoff',
    args: '',
    origin: { kind: 'bridge' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  await world.clock.settle()
  expect(world.box.text).toBe('')
})

const handoffFromBridge = ($: Engine) =>
  $.command.run({
    command: 'handoff',
    args: '',
    origin: { kind: 'bridge' },
    presentation: { isFullscreen: false, columns: 80 },
  })

// A background task finishes while a prompt is held; its turn ends on a weak signal and redraws the band with
// Compact, the person presses it, and while the compaction runs /handoff arrives from the bridge.
const compactingOverHeldPrompt = async ($: Engine, world: World) => {
  await holdPrompt($, world)
  world.compact = () => new Promise<SessionCompactResult>(() => undefined)
  await notify($, 'task-1')
  await startTurn($)
  await completeTurn($)
  const band = await mountBand($)
  await band.press({ key: 'compact' })
  await world.clock.settle()
}

test('It leaves a held prompt in the box when /handoff from the bridge is refused because a compaction is running', ASK, async ($, on) => {
  const world = install($, on)
  await compactingOverHeldPrompt($, world)
  await handoffFromBridge($)
  await world.clock.settle()
  expect(world.box.text).toBe(HELD)
})

test('It never empties the box when /handoff answers that a compaction is already in progress', ASK, async ($, on) => {
  const world = install($, on)
  await compactingOverHeldPrompt($, world)
  await handoffFromBridge($)
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'fill:')).toEqual([])
})

test('It still hands off a held prompt when the box cannot be read under /handoff from the bridge', ASK, async ($, on) => {
  const world = install($, on)
  await holdPrompt($, world)
  world.boxReadDenied = true
  await handoffFromBridge($)
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === `entered:plugin:${HELD}`)).toHaveLength(1)
})

test('It still hands off a held prompt when the box refuses the fill under /handoff from the bridge', ASK, async ($, on) => {
  const world = install($, on)
  await holdPrompt($, world)
  world.fillRefusal = 'no_composer'
  await handoffFromBridge($)
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === `entered:plugin:${HELD}`)).toHaveLength(1)
})

test('It keeps what else the person typed when /handoff from the bridge empties a held prompt', ASK, async ($, on) => {
  const world = install($, on)
  await holdPrompt($, world)
  world.box = { text: `${HELD}\nalso this`, cursor: 0 }
  await handoffFromBridge($)
  await world.clock.settle()
  expect(world.box.text).toBe('also this')
})

test('It leaves an edited held prompt in the box under /handoff from the bridge', ASK, async ($, on) => {
  const world = install($, on)
  await holdPrompt($, world)
  world.box = { text: `${HELD} and ENG-3`, cursor: 0 }
  await handoffFromBridge($)
  await world.clock.settle()
  expect(world.box.text).toBe(`${HELD} and ENG-3`)
})

test('It restores a held prompt to the box once when the clear throws under /handoff from the bridge', ASK, async ($, on) => {
  const world = install($, on)
  await holdPrompt($, world)
  world.clearThrows = true
  await handoffFromBridge($)
  await world.clock.settle()
  expect([world.box.text, world.effects.filter(effect => effect === `fill:${HELD}`).length]).toEqual([HELD, 2])
})

test('It answers /handoff from the bridge with already-in-progress while the compaction runs over a held prompt', ASK, async ($, on) => {
  const world = install($, on)
  await compactingOverHeldPrompt($, world)
  const before = world.box.text
  const ran = await handoffFromBridge($)
  await world.clock.settle()
  expect([before, world.effects.includes('fork'), ran]).toEqual([HELD, false, { text: 'A handoff or compaction is already in progress.' }])
})
