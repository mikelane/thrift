import type { Engine } from 'claude-code/testing'
import type { On, SessionCompactResult } from 'claude-code'

import { turnAfterNoteLine } from '../hooks/handoff-note'
import { answered, bash, compacted, completeTurn, growTo200k, holdFork, install, lastRecord, mountBand, notify, runCommand, startSession, startTurn, submitPerson, writingTheNote, type World } from './helpers'

export { holdFork, writingTheNote } from './helpers'

export const ACT = { options: { handoffMode: 'act' } } as const

export const BUSY_MESSAGE = 'Background work is running, and a handoff would cut it off. This session is unchanged. Type /handoff to hand off anyway.'

export const BUSY_TOAST = `toast:${BUSY_MESSAGE}`

export const BUSY_LOG = `log:${BUSY_MESSAGE}`

export const SESSION_ENDED_MESSAGE = 'The session ended before the handoff could clear, so it stopped. No note was carried over.'

export const SESSION_ENDED_TOAST = `toast:${SESSION_ENDED_MESSAGE}`

export const SESSION_ENDED_LOG = `log:${SESSION_ENDED_MESSAGE}`

export const ASK = { options: { handoffMode: 'ask' } } as const

export const COMPACTING = { options: { compactBeforeClear: true } } as const

export const WAITING = 'Handoff note written. The handoff continues when the current turn ends. Your prompts stay held.'

export const BASE_MESSAGE = 'Handoff from the previous session (old-session), written by Claude just before a /clear:\n\nThe handoff note.'

export const SECOND_MESSAGE = 'Handoff from the previous session (new-session), written by Claude just before a /clear:\n\nSecond note.'

export const LATE_TURN_MESSAGE = `${BASE_MESSAGE}\n\n${turnAfterNoteLine('old-session')}`

export const turnRunningWhenTheNoteIsWritten = async ($: Engine, on: On) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await startTurn($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  const finishNote = async () => {
    fork.release(answered('The handoff note.'))
    await world.clock.settle()
  }
  return { world, finishNote }
}

export const endTurn = async ($: Engine, world: World, completion?: Parameters<typeof completeTurn>[1]) => {
  await completeTurn($, completion)
  await world.clock.settle()
}

// In act mode the handoff starts on its own, and a busy session is never handed off. A turn that runs during the
// wait can start background work after that decision was made.
export const actHandoffWhileWritingTheNote = async ($: Engine, on: On) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  await world.clock.settle()
  await startTurn($)
  const finishNote = async () => {
    fork.release(answered('The handoff note.'))
    await world.clock.settle()
  }
  return { world, finishNote }
}

export const turnStartsBackgroundWork = async ($: Engine, on: On) => {
  const { world, finishNote } = await actHandoffWhileWritingTheNote($, on)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  await finishNote()
  await endTurn($, world)
  return world
}

// The person ends the session while the handoff waits: /clear delivers into their fresh session, anything else abandons.
export const waitingForATurn = async ($: Engine, on: On) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  return world
}

export const endSession = ($: Engine, reason: 'resume' | 'other') =>
  $.session.end({ reason, sessionId: 'old-session', resume: { id: 'old-session' } })

export const clearCount = (world: World) => world.effects.filter(effect => effect === 'clear').length

export const actHandoffWithBusyTurn = async ($: Engine, on: On) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  await world.clock.settle()
  await startTurn($)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  await endTurn($, world)
  return world
}

// Records written after the person resumed another session still belong to the session the handoff started in.
export const RECORD_KEYS = ['action', 'component', 'engine_version', 'mode', 'session_id', 'trigger_values', 'ts']

export const resumeDuringCompaction = ($: Engine, world: World, compaction: () => Promise<SessionCompactResult>) => {
  world.compact = async () => {
    world.sessionId = 'resumed-session'
    await $.session.end({ reason: 'resume', sessionId: 'old-session', resume: { id: 'old-session' } })
    return compaction()
  }
}

export const shownText = async (band: Awaited<ReturnType<typeof mountBand>>) =>
  (await band.findAll({ type: 'Text' })).map(text => text.text)

export const countOf = (world: World, effect: string) => world.effects.filter(seen => seen === effect).length

// The person clears while the note is written; a finished background task then starts a turn in the fresh session.
export const personClearedThenTurnInFreshSession = async ($: Engine, on: On) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await runCommand($, 'clear')
  await world.clock.settle()
  await notify($, 'bg1')
  await startTurn($)
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  return world
}

export const WAITING_TOAST = `toast:${WAITING}`

export const SECOND_LATE_TURN_MESSAGE = `${SECOND_MESSAGE}\n\n${turnAfterNoteLine('new-session')}`

export const bandText = async ($: Engine) => shownText(await mountBand($))

// Handoff 1 ends by the person's clear, so sessionEndBeforeClear is left at 'cleared_by_person' until the next handoff.
export const firstHandoffEndsByPersonClear = async ($: Engine, on: On) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await runCommand($, 'clear')
  await world.clock.settle()
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  return world
}

export const ACT_COMPACTING = { options: { handoffMode: 'act', compactBeforeClear: true } } as const

export const BUSY_COMPACTED_MESSAGE =
  'Background work is running, and a handoff would cut it off. This session was compacted, not cleared. Type /handoff to hand off anyway.'

