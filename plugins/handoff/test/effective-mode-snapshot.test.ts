import { expect, test } from 'claude-code/testing'
import type { SessionCompactResult } from 'claude-code'

import { answered, compacted, completeTurn, growTo200k, holdFork, install, lastRecord, runCommand, startSession, type World } from './helpers'

const ACT = { options: { handoffMode: 'act' } } as const
const ASK = { options: { handoffMode: 'ask' } } as const

const UNTESTED_ENGINE = { version: '2.1.302-dev.1', base: '2.1.302-dev' }

const holdCompact = (world: World) => {
  const pending: { release: (result: SessionCompactResult) => void; fail: (error: Error) => void } = {
    release: () => undefined,
    fail: () => undefined,
  }
  world.compact = () =>
    new Promise<SessionCompactResult>((resolve, reject) => {
      pending.release = resolve
      pending.fail = reject
    })
  return pending
}

test('It records effective_mode off on the cleared record when a /handoff before session.start clears after it', ACT, async ($, on) => {
  const world = install($, on)
  const pending = holdFork(world)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await startSession($)
  pending.release(answered('The handoff note.'))
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({
    mode: 'active',
    action: 'cleared',
    trigger_values: { point: 'command', setting: 'act', effective_mode: 'off' },
  })
})

test('It records effective_mode off and mode active when a /handoff before session.start is abandoned after it', ASK, async ($, on) => {
  const world = install($, on)
  const pending = holdFork(world)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await startSession($)
  pending.release({ isAnswered: false, reason: 'nothing-to-fork' })
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({
    mode: 'active',
    action: 'none',
    trigger_values: { point: 'command', reason: 'no_handoff_written', setting: 'ask', effective_mode: 'off' },
  })
})

test('It records only a cleared record with effective_mode off when an interactive session.start lands mid-handoff', ACT, async ($, on) => {
  const world = install($, on)
  const pending = holdFork(world)
  await startSession($, false)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await startSession($)
  pending.release(answered('The handoff note.'))
  await world.clock.settle()
  expect(world.records.map(r => [r.action, r.trigger_values.effective_mode])).toEqual([['cleared', 'off']])
})

test('It records off on the untested_engine record and act on the handoff record when an untested-engine session.start lands mid-handoff', ACT, async ($, on) => {
  const world = install($, on)
  const pending = holdFork(world)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  world.version = UNTESTED_ENGINE
  await startSession($)
  pending.release({ isAnswered: false, reason: 'nothing-to-fork' })
  await world.clock.settle()
  expect(world.records.map(r => [r.action, r.mode, r.trigger_values.effective_mode])).toEqual([
    ['untested_engine', 'active', 'off'],
    ['none', 'active', 'act'],
  ])
})

test('It records effective_mode act on the compacted record when a non-interactive session.start lands mid-compaction', ACT, async ($, on) => {
  const world = install($, on)
  const pending = holdCompact(world)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  await startSession($, false)
  pending.release(compacted(48_000))
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ mode: 'active', action: 'compacted', trigger_values: { effective_mode: 'act' } })
})

test('It records effective_mode act and mode active on the compaction_failed record when an untested-engine session.start lands mid-compaction', ACT, async ($, on) => {
  const world = install($, on)
  const pending = holdCompact(world)
  await startSession($)
  await growTo200k($, world)
  await completeTurn($)
  await world.clock.settle()
  world.version = UNTESTED_ENGINE
  await startSession($)
  pending.fail(new Error('boom'))
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({
    mode: 'active',
    action: 'none',
    trigger_values: { point: 'turn-end', reason: 'compaction_failed', effective_mode: 'act' },
  })
})
