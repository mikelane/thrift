import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { bash, completeTurn, growTo200k, install, startSession, type World } from './helpers'

export const ACT = { options: { handoffMode: 'act' } } as const

export const ACT_COMPACTING = { options: { handoffMode: 'act', compactBeforeClear: true } } as const

export const finishedTaskTurn = async ($: Engine, world: World) => {
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
}

export const handedOff = async ($: Engine, on: On) => {
  const world = install($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  return world
}

export const NOT_CARRIED_OVER =
  'The handoff note could not be added to this session. To reopen the full previous conversation: claude --resume old-session'
