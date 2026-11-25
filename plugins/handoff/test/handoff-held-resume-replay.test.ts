import { expect, test } from 'claude-code/testing'

import { install, lastRecord, runCommand, startSession } from './helpers'

const COMPACTING = { options: { compactBeforeClear: true } } as const

test('It replays several held resumes in order', COMPACTING, async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.onClearIssued = async () => {
    await $.command.run({ command: 'resume', args: 'a', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
    await $.command.run({ command: 'resume', args: 'b', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
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
    await $.command.run({ command: 'resume', args: 'a', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  }
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects.some(e => e.includes('not this one'))).toBe(false)
  expect(lastRecord(world)).not.toMatchObject({ trigger_values: { reason: 'session_moved' } })
})
