import { expect, test } from 'claude-code/testing'

import { CONTINUE_PROMPT } from '../hooks/continue-decision'
import { completeTurn, entered, install, lastRecord, runCommand, startSession, startTurn, submitPerson } from './helpers'
import { bandAfterFinishedTask, weakBand } from './band-turn-fixtures'

const CONTINUING = { options: { handoffMode: 'ask', continueAfterHandoff: true } } as const
const CONTINUE_ENTRY = `entered:plugin:${CONTINUE_PROMPT}`
const RUNNING_AGENT = { id: 'a1', description: 'd', type: 't', status: 'running' } as const

// A band raised by a strong signal (a finished task) that goes through a busy redraw and back comes out weak:
// offerWithBusyState overwrites offer.signal with 'weak' and never restores it. The press then hands off with
// signal 'weak' and continueAfterHandoff fires at the natural stopping point the README says always waits.
test('It submits no continue prompt after a strong-signal band that a busy refusal redrew', CONTINUING, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await bandAfterFinishedTask($, world)
  world.agents = [RUNNING_AGENT]
  await band.press({ key: 'handoff' })
  await world.clock.settle()
  world.agents = []
  // The busy redraw dropped the Hand off button; an interrupted turn with the agent gone redraws the band idle, still weak.
  await submitPerson($, 'keep going')
  await startTurn($)
  await completeTurn($, { reason: 'aborted' })
  await band.press({ key: 'handoff' })
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ action: 'cleared' })
  expect(entered(world)).not.toContain(CONTINUE_ENTRY)
  expect(lastRecord(world).trigger_values).toMatchObject({ continued: 'skipped', continue_skip: 'strong_signal' })
})

// Same laundering without any refused press: an interrupted turn while an agent runs redraws the strong band busy.
test('It submits no continue prompt after a strong-signal band that an interrupted busy turn redrew', CONTINUING, async ($, on) => {
  const world = install($, on)
  await startSession($)
  const band = await bandAfterFinishedTask($, world)
  world.agents = [RUNNING_AGENT]
  await submitPerson($, 'keep going')
  await startTurn($)
  await completeTurn($, { reason: 'aborted' })
  world.agents = []
  await submitPerson($, 'keep going')
  await startTurn($)
  await completeTurn($, { reason: 'aborted' })
  await band.press({ key: 'handoff' })
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ action: 'cleared' })
  expect(entered(world)).not.toContain(CONTINUE_ENTRY)
  expect(lastRecord(world).trigger_values).toMatchObject({ continued: 'skipped', continue_skip: 'strong_signal' })
})

// Mutation-gap probe: both id reads fail. Passes on the code; fails if the freshSessionId !== undefined guard is removed.
test('It logs session_moved when neither session id read succeeds', CONTINUING, async ($, on) => {
  const world = install($, on)
  world.onClearEnded = async () => {
    world.sessionIdDenials = 2
  }
  await startSession($)
  const band = await weakBand($, world)
  await band.press({ key: 'handoff' })
  await world.clock.settle()
  expect(world.sessionIdDenials).toBe(1)
  expect(entered(world)).not.toContain(CONTINUE_ENTRY)
  expect(lastRecord(world).trigger_values).toMatchObject({ continued: 'skipped', continue_skip: 'session_moved' })
})

// Coverage probe: act mode with a typed /handoff continues (README: only plugin-started handoffs are always strong).
test('It submits one continue prompt after a typed /handoff in act mode', { options: { handoffMode: 'act', continueAfterHandoff: true } }, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(entered(world)).toEqual([CONTINUE_ENTRY])
  expect(lastRecord(world).trigger_values).toMatchObject({ continued: 'submitted', effective_mode: 'act' })
})
