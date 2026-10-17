import type { Engine } from 'claude-code/testing'

import { bash, completeTurn, growTo200k, mountBand, type World } from './helpers'

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
