import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { growTo200k, install, startSession, submitPerson } from './helpers'

export const ASK = { options: { handoffMode: 'ask' } } as const

export const ACT = { options: { handoffMode: 'act' } } as const

export const NOTE_HEADING = 'Handoff from the previous session (old-session), written by Claude just before a /clear:\n\nThe handoff note.'

export const ready = async ($: Engine, on: On) => {
  const world = install($, on)
  world.branch = 'alice/eng-1-start'
  await startSession($)
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  return world
}

export const entered = (world: Awaited<ReturnType<typeof ready>>) => world.effects.filter(effect => effect.startsWith('entered:'))
