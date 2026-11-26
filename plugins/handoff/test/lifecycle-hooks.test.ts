import { describe, expect, test } from 'claude-code/testing'

import { install, lastRecord, runCommand, startSession } from './helpers'

const ACT = { options: { handoffMode: 'act' } } as const

// registerLifecycleHooks takes `on`, so these drive its four hooks through the installed plugin. The branches each hook
// takes are covered in detail by lifecycle.test.ts, handoff.test.ts, the clear-race tests and
// handoff-held-resume-replay.test.ts. A clear that throws is not tested here: the kit reports a mock beneath that throws as
// a skipped hook and answers "no implementation", so the clear's rethrow cannot be told apart from that.
describe('registerLifecycleHooks', () => {
  test('It returns the session.start output and registers /handoff when an interactive session starts', async ($, on) => {
    const world = install($, on)
    expect(await startSession($)).toEqual({ cwd: '/work' })
    expect(world.effects).toEqual(['register:handoff'])
  })

  test('It records engine_version unknown when session.start cannot read the version', ACT, async ($, on) => {
    const world = install($, on)
    world.versionThrows = true
    await startSession($)
    expect(lastRecord(world)).toMatchObject({ action: 'untested_engine', engine_version: 'unknown' })
  })

  test('It registers /handoff again after a person clear ends the session', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await runCommand($, 'clear')
    await world.clock.settle()
    expect(world.effects).toEqual(['register:handoff', 'clear', 'register:handoff'])
  })

  test('It passes a /resume through when no handoff is clearing', async ($, on) => {
    const world = install($, on)
    await startSession($)
    expect(await runCommand($, 'resume')).toEqual({ text: 'ran resume' })
    expect(world.effects).toContain('resume:')
  })
})
