import { expect, type Engine } from 'claude-code/testing'

import { bash, completeTurn, dropOf, growTo200k, mountBand, submitPerson, type World } from './helpers'

export const ASK = { options: { handoffMode: 'ask' } } as const

export const bandAfterFinishedTask = async ($: Engine, world: World) => {
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  return mountBand($)
}

export const weakBand = async ($: Engine, world: World) => {
  await growTo200k($, world)
  await completeTurn($)
  return mountBand($)
}

export const BUSY_REFUSAL = 'Background work is running, and its results would reach a fresh session without this conversation. This session is unchanged. Type /handoff to hand off anyway.'

export const HELD_PROMPT = 'now ENG-2'

// A band that offers to hand off and send the prompt the plugin held; the held prompt has settled into the box.
export const heldPromptBand = async ($: Engine, world: World) => {
  world.branch = 'alice/eng-1-start'
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  const dropped = await submitPerson($, HELD_PROMPT)
  expect(dropOf(dropped)).toBe('Held your prompt. Choose below, or press Enter again to send it here.')
  await world.clock.settle()
  return mountBand($)
}

// Holds every prompt.fill until the returned release is called; fills after the release run at once.
export const holdFill = (world: World) => {
  const gate: { open: () => void } = { open: () => undefined }
  const opened = new Promise<void>(resolve => {
    gate.open = resolve
  })
  world.onFill = () => opened
  return {
    release: () => {
      world.onFill = undefined
      gate.open()
    },
  }
}
