import { describe, expect, test } from 'claude-code/testing'

import { HELD_RESUME_REPLAY_TIMEOUT_MS } from '../hooks/handoff-delivery'
import { install, lastRecord, runCommand, startSession } from './helpers'

const COMPACTING = { options: { compactBeforeClear: true } } as const
const composerResume = (args: string) =>
  ({ command: 'resume', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }) as const

describe('replayHeldResumes', () => {
  test('It replays several held resumes in order', COMPACTING, async ($, on) => {
    const world = install($, on)
    await startSession($)
    world.onClearIssued = async () => {
      await $.command.run(composerResume('a'))
      await $.command.run(composerResume('b'))
    }
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(world.effects.filter(e => e === 'clear' || e.startsWith('resume:'))).toEqual(['clear', 'resume:a', 'resume:b'])
  })

  test('It does not report the note in another session when every replayed resume failed', COMPACTING, async ($, on) => {
    const world = install($, on)
    world.resumeThrows = true
    await startSession($)
    world.onClearIssued = async () => {
      await $.command.run(composerResume('a'))
    }
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(world.effects.some(e => e.includes('not this one'))).toBe(false)
    expect(lastRecord(world)).not.toMatchObject({ trigger_values: { reason: 'session_moved' } })
  })

  test('It reports session_moved when the first held resume throws and the second runs', COMPACTING, async ($, on) => {
    const world = install($, on)
    let reads = 0
    // The mock reads resumeThrows once per plugin-origin resume: only the first replay throws.
    Object.defineProperty(world, 'resumeThrows', { get: () => reads++ === 0 })
    await startSession($)
    world.onClearIssued = async () => {
      await $.command.run(composerResume('a'))
      await $.command.run(composerResume('b'))
    }
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(world.effects.filter(e => e.startsWith('resume:'))).toEqual(['resume:b'])
    expect(lastRecord(world)).toMatchObject({ trigger_values: { reason: 'session_moved' } })
  })

  test('It answers a held resume with the clearing-first text instead of running it in the command.run hook', COMPACTING, async ($, on) => {
    const world = install($, on)
    await startSession($)
    let answer: unknown
    world.onClearIssued = async () => {
      answer = await $.command.run(composerResume('abc'))
    }
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(answer).toMatchObject({ text: 'The handoff is clearing this session first; your /resume runs right after.' })
  })
})

describe('a held resume replay that never returns', () => {
  const hangingReplay = async ($: Parameters<typeof install>[0], on: Parameters<typeof install>[1]) => {
    const world = install($, on)
    world.resumeHangs = true
    await startSession($)
    world.onClearIssued = async () => {
      await $.command.run(composerResume('a'))
    }
    await runCommand($, 'handoff')
    return world
  }

  test('It holds the record back until the bounded wait ran out', COMPACTING, async ($, on) => {
    const world = await hangingReplay($, on)
    await world.clock.advance(HELD_RESUME_REPLAY_TIMEOUT_MS - 1)
    expect(world.records).toEqual([])
  })

  test('It writes the record once the bounded wait ran out', COMPACTING, async ($, on) => {
    const world = await hangingReplay($, on)
    await world.clock.advance(HELD_RESUME_REPLAY_TIMEOUT_MS)
    expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { note: 'appended' } })
  })

  test('It writes a debug line saying the replay did not return in time', COMPACTING, async ($, on) => {
    const world = await hangingReplay($, on)
    await world.clock.advance(HELD_RESUME_REPLAY_TIMEOUT_MS)
    expect(world.debugLines).toContain(`handoff: a held /resume did not return within ${HELD_RESUME_REPLAY_TIMEOUT_MS} ms, so the session id decides whether the person moved`)
  })
})
