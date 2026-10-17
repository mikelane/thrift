import { describe, expect, test } from 'claude-code/testing'

import { dropOf, entered, growTo200k, install, mountBand, runCommand, startSession, submitPerson } from './helpers'
import { ASK } from './band-turn-fixtures'

const HELD = 'now ENG-2'

const heldPromptBand = async ($: Parameters<typeof mountBand>[0], world: Parameters<typeof growTo200k>[1]) => {
  world.branch = 'alice/eng-1-start'
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  expect(dropOf(await submitPerson($, HELD))).toBeDefined()
  return mountBand($)
}

describe('pressHeldPromptButton', () => {
  test('It empties the held prompt from the box when Send here is pressed', ASK, async ($, on) => {
    const world = install($, on)
    await startSession($)
    const band = await heldPromptBand($, world)
    await world.clock.settle()
    expect(world.box.text).toContain(HELD)
    await band.press({ key: 'send-here' })
    expect(world.box.text).not.toContain(HELD)
  })

  test('It empties the held prompt from the box when Hand off and send is pressed', ASK, async ($, on) => {
    const world = install($, on)
    await startSession($)
    const band = await heldPromptBand($, world)
    await world.clock.settle()
    await band.press({ key: 'handoff-send' })
    expect(world.box.text).not.toContain(HELD)
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
