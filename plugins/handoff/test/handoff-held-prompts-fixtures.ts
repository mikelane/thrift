import type { Engine } from 'claude-code/testing'
import type { ModelForkResult, On } from 'claude-code'

import type { HeldPrompt } from '../hooks/session-state'
import {
  answered,
  dropOf,
  growTo200k,
  holdFork,
  install,
  runCommand,
  startSession,
  submitPerson,
  type World,
} from './helpers'

export const ASK = { options: { handoffMode: 'ask' } } as const

export const NOTE_MESSAGE = 'Handoff from the previous session (old-session), written by Claude just before a /clear:\n\nThe handoff note.'

export const HELD_FOR_HANDOFF = "A handoff is in progress, so your prompt is held. It is sent when the handoff ends, or, if the handoff fails and a person sent it, put in this terminal's prompt box. If that can't be done, it is kept another way, at worst in the transcript."

export const REPEAT_NOT_ADDED = 'The handoff already carries this prompt, so this repeat was not added.'

export const IMAGE = [{ type: 'image', mediaType: 'image/png' }] as const

export const heldBeforeTheHandoff = async ($: Engine, on: On) => {
  const world = install($, on)
  const fork = holdFork(world)
  world.branch = 'alice/eng-1-start'
  await startSession($)
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2')
  await runCommand($, 'handoff')
  await world.clock.settle()
  return { world, fork, finishNote: async () => {
    fork.release(answered('The handoff note.'))
    await world.clock.settle()
  } }
}

// An unattended handoff: a scheduled prompt that names new work hands off without asking.
export const unattendedHandoffWriting = async ($: Engine, on: On) => {
  const world = install($, on)
  const fork = holdFork(world)
  world.branch = 'alice/eng-1-start'
  await startSession($)
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2', { kind: 'scheduled-trigger' })
  await world.clock.settle()
  const finishWith = async (result: ModelForkResult) => {
    fork.release(result)
    await world.clock.settle()
  }
  return { world, finishNote: () => finishWith(answered('The handoff note.')), failNote: () => finishWith({ isAnswered: false, reason: 'nothing-to-fork' }) }
}

// The handoff checks whether the append is denied right after the clear, before it delivers anything: the person repeats the carried prompt then.
export const repeatingDuringDelivery = async ($: Engine, on: On) => {
  const { world, finishNote } = await heldBeforeTheHandoff($, on)
  let repeat: Promise<unknown> = Promise.resolve(undefined)
  Object.defineProperty(world, 'appendDenied', {
    get: () => {
      repeat = submitPerson($, 'now ENG-2')
      return false
    },
  })
  await finishNote()
  return { world, outcome: { drop: dropOf(await repeat) } }
}

// Ask mode: "now ENG-2" names new work and is held on the band; /handoff then carries it. A scheduled prompt
// is held while the note is written, so the handoff settles with two groups: the carried one first.
export const carriedPlusScheduled = async ($: Engine, on: On) => {
  const { world, fork } = await heldBeforeTheHandoff($, on)
  await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
  return { world, fork }
}

// The person sends the carried prompt again while the scheduled group is still being delivered: on the submit that
// follows the carried prompt's own (a restore that fills the box makes none), after it was put back or refused.
export const repeatOnSubmitAfter = ($: Engine, world: World, submitsBefore: number) => {
  const outcome: { repeat: Promise<unknown> | null } = { repeat: null }
  const repeatCarriedPrompt = () => {
    world.submitDropped = false
    outcome.repeat = submitPerson($, 'now ENG-2')
  }
  world.submitHooks = [...Array.from({ length: submitsBefore }, () => undefined), repeatCarriedPrompt]
  return outcome
}

export const personGroup = { text: 'person says', isUnattended: false, origin: 'composer' } satisfies HeldPrompt

export const scheduledGroup = { text: 'nightly job', isUnattended: true, origin: 'scheduled-trigger' } satisfies HeldPrompt
