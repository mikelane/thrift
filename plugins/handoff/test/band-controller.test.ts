import { describe, expect, test } from 'claude-code/testing'

import { WRITING_STATUS } from '../hooks/band-text'
import { bash, buttonLabels, completeTurn, install, mountBand, runCommand, startSession, startTurn, writingTheNote } from './helpers'
import { ASK, bandAfterFinishedTask, weakBand } from './band-turn-fixtures'
import { shownText } from './wait-for-turn-helpers'

const FRESH_OFFER = { shape: 'offer-has-held-prompt', value: { signal: 'strong', contextTokens: 200_000, hasHeldPrompt: false, isBusy: false } }
const TAKEDOWN = { shape: 'offer-has-held-prompt', value: null }

describe('readBand', () => {
  test('It hands the stored offer to the render', ASK, async ($, on) => {
    const world = install($, on)
    await startSession($)
    const band = await bandAfterFinishedTask($, world)
    expect(await buttonLabels(band)).toEqual(['Hand off and clear', 'Not now'])
  })
})

describe('drawBand', () => {
  test('It draws the writing status without buttons while the note is written', ASK, async ($, on) => {
    await writingTheNote($, on)
    const band = await mountBand($)
    expect(await buttonLabels(band)).toEqual([])
    expect(await shownText(band)).toEqual([WRITING_STATUS])
  })

  test('It draws a button for each choice in an offer', ASK, async ($, on) => {
    const world = install($, on)
    await startSession($)
    const band = await weakBand($, world)
    expect(await buttonLabels(band)).toEqual(['Compact', 'Hand off and clear', 'Not now'])
  })
})

describe('takeDownBand', () => {
  test('It writes nothing to the offer store when no band is up', ASK, async ($, on) => {
    const world = install($, on)
    await startSession($)
    await startTurn($)
    await completeTurn($)
    expect(world.offerWrites).toEqual([])
  })

  test('It writes one takedown, not one per later turn, after a press took the band down', ASK, async ($, on) => {
    const world = install($, on)
    await startSession($)
    const band = await weakBand($, world)
    await band.press({ key: 'not-now' })
    await startTurn($)
    await completeTurn($)
    expect(world.offerWrites.slice(1)).toEqual([TAKEDOWN])
  })
})

describe('takeDownBandFromBeforeReload', () => {
  test('It takes down an offer that the store kept from before the reload', ASK, async ($, on) => {
    const world = install($, on)
    on('state.get', () => ({ value: { value: FRESH_OFFER, version: 0 } }))
    await startSession($)
    expect(world.offerWrites).toEqual([TAKEDOWN])
  })
})

describe('offerBand', () => {
  test('It writes the offer and an advised record', ASK, async ($, on) => {
    const world = install($, on)
    await startSession($)
    await bandAfterFinishedTask($, world)
    expect(world.offerWrites).toEqual([FRESH_OFFER])
    expect(world.records.map(record => record.action)).toEqual(['advised'])
  })
})

describe('redrawBand', () => {
  test('It says why when the band cannot be redrawn and still writes the note', ASK, async ($, on) => {
    const world = install($, on)
    world.stateSetThrows = true
    await startSession($)
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(world.debugLines.join('\n')).toContain('could not redraw the band')
    expect(world.effects).toContain('fork')
  })
})

describe('refreshBandBusyState', () => {
  test('It drops the handoff button when background work started during a turn with no answer', ASK, async ($, on) => {
    const world = install($, on)
    await startSession($)
    const band = await bandAfterFinishedTask($, world)
    await startTurn($)
    await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
    await completeTurn($, { reason: 'aborted' })
    expect(await buttonLabels(band)).toEqual(['Compact', 'Not now'])
  })

  test('It leaves the writing status as it is when a turn with no answer ends while the note is written', ASK, async ($, on) => {
    const { world } = await writingTheNote($, on)
    const writesBefore = [...world.offerWrites]
    await startTurn($)
    await completeTurn($, { reason: 'aborted' })
    expect(world.offerWrites).toEqual(writesBefore)
  })
})

describe('claimAndRunPress', () => {
  test('It runs a press that waited for the turn once the turn ends', ASK, async ($, on) => {
    const world = install($, on)
    await startSession($)
    const band = await bandAfterFinishedTask($, world)
    await startTurn($)
    await band.press({ key: 'handoff' })
    await completeTurn($)
    await world.clock.settle()
    expect(world.effects).toContain('clear')
  })
})
