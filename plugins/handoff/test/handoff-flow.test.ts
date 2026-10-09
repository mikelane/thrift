import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelForkResult, On } from 'claude-code'

import { HANDOFF_PROMPT } from '../hooks/handoff-note'
import {
  answered,
  bash,
  compacted,
  completeTurn,
  growTo200k,
  install,
  lastRecord,
  runCommand,
  startSession,
  ZERO_USAGE,
  type World,
} from './helpers'

const ACT = { options: { handoffMode: 'act' } } as const
const ACT_COMPACTING = { options: { handoffMode: 'act', compactBeforeClear: true } } as const

const finishedTaskTurn = async ($: Engine, world: World) => {
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
}

const handedOff = async ($: Engine, on: On) => {
  const world = install($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  return world
}

const WRITING = 'toast:Writing a handoff note — this takes a few seconds…'

test('It does not hand off inside the hook the turn is waiting on', ACT, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  expect(world.effects).not.toContain('clear')
  expect(world.effects).not.toContain('fork')
})

test('It hands off in act mode after a commit once the clock fires', ACT, async ($, on) => {
  const world = await handedOff($, on)
  expect(world.effects).toContain('clear')
})

test('It runs the steps in order: toast, fork, clear, append', ACT, async ($, on) => {
  const world = await handedOff($, on)
  const steps = world.effects.filter(effect => [WRITING, 'fork', 'clear', 'append'].includes(effect))
  expect(steps).toEqual([WRITING, 'fork', 'clear', 'append'])
})

test('It asks the fork for the fixed handoff prompt', ACT, async ($, on) => {
  const world = await handedOff($, on)
  expect(world.forkPrompts).toEqual([HANDOFF_PROMPT])
})

test('It appends the handoff for the model with the old session id and the note', ACT, async ($, on) => {
  const world = await handedOff($, on)
  expect(world.appended).toEqual([
    'Handoff from the previous session (old-session), written by Claude just before a /clear:\n\nThe handoff note.',
  ])
})

test('It names the old session and the resume command in a transcript line and a toast', ACT, async ($, on) => {
  const world = await handedOff($, on)
  const named = world.effects.filter(effect => effect.includes('claude --resume old-session'))
  expect(named.map(effect => effect.split(':')[0])).toEqual(['log', 'toast'])
})

test('It leads the final transcript line with the fresh session continuing from the note', ACT, async ($, on) => {
  const world = await handedOff($, on)
  expect(world.effects).toContain('log:Handed off. This session starts from a note summarizing the previous one. To reopen the full previous conversation: claude --resume old-session')
})

test('It leads the final toast with the fresh session continuing from the note', ACT, async ($, on) => {
  const world = await handedOff($, on)
  expect(world.effects).not.toContain(`log:${NOT_CARRIED_OVER}`)
  expect(world.effects).toContain('toast:Handed off. This session starts from a note summarizing the previous one. To reopen the full previous conversation: claude --resume old-session')
})

test('It logs a cleared record under the old session id with the values that triggered it', ACT, async ($, on) => {
  const world = await handedOff($, on)
  expect(world.records).toHaveLength(1)
  expect(lastRecord(world)).toMatchObject({
    session_id: 'old-session',
    mode: 'active',
    action: 'cleared',
    trigger_values: { point: 'turn-end', signal: 'strong', context_tokens: 200_000, setting: 'act' },
  })
})

test('It registers /handoff again after the clear', ACT, async ($, on) => {
  const world = await handedOff($, on)
  const afterClear = world.effects.slice(world.effects.indexOf('clear'))
  expect(afterClear).toContain('register:handoff')
})

test('It carries on when registering /handoff again is refused', ACT, async ($, on) => {
  const world = install($, on)
  world.registerThrows = true
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(world.effects).toContain('append')
  expect(world.debugLines.join('\n')).toContain('register')
})

test('It does not compact the old session by default', ACT, async ($, on) => {
  const world = await handedOff($, on)
  expect(world.effects).not.toContain('compact')
})

test('It compacts the old session between the fork and the clear when compactBeforeClear is on', ACT_COMPACTING, async ($, on) => {
  const world = await handedOff($, on)
  const steps = world.effects.filter(effect => ['fork', 'compact', 'clear'].includes(effect))
  expect(steps).toEqual(['fork', 'compact', 'clear'])
})

test('It logs a failed compaction and still clears', ACT_COMPACTING, async ($, on) => {
  const world = install($, on)
  world.compact = async () => {
    throw new Error('compaction failed')
  }
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(world.records.map(record => record.action)).toEqual(['none', 'cleared'])
  expect(world.records[0]?.trigger_values.reason).toBe('compaction_failed')
  expect(world.effects).toContain('clear')
})

test('It logs a vetoed compaction and still clears', ACT_COMPACTING, async ($, on) => {
  const world = install($, on)
  world.compact = async () => ({ skip: 'vetoed' })
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(world.records[0]?.trigger_values.reason).toBe('compaction_vetoed')
  expect(world.effects).toContain('clear')
})

test('It still clears after a successful compaction first', ACT_COMPACTING, async ($, on) => {
  const world = install($, on)
  world.compact = async () => compacted(48_000)
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(world.records.map(record => record.action)).toEqual(['cleared'])
})

const failedForks: ReadonlyArray<readonly [string, () => Promise<ModelForkResult>]> = [
  ['an API error', async () => ({ isAnswered: false, reason: 'api-error', status: 500, error: 'server_error', usage: ZERO_USAGE })],
  ['nothing to fork', async () => ({ isAnswered: false, reason: 'nothing-to-fork' })],
  ['an empty reply', async () => ({ isAnswered: false, reason: 'empty-reply', usage: ZERO_USAGE })],
  ['a blank note', async () => answered('   ')],
  [
    'a fork that throws',
    async () => {
      throw new Error('fork failed')
    },
  ],
]

for (const [name, fork] of failedForks) {
  test(`It clears nothing and says so when the fork returns ${name}`, ACT, async ($, on) => {
    const world = install($, on)
    world.fork = fork
    await startSession($)
    await finishedTaskTurn($, world)
    await world.clock.settle()
    expect(world.effects).not.toContain('clear')
    expect(world.effects).toContain('toast:No handoff was written. This session is unchanged.')
    expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { reason: 'no_handoff_written' } })
  })
}

test('It evaluates the next turn after a failed fork', ACT, async ($, on) => {
  const world = install($, on)
  world.fork = async () => ({ isAnswered: false, reason: 'nothing-to-fork' })
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  await bash($, world, 'git commit -m y')
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'fork')).toHaveLength(2)
})

test('It tells the person the session is unchanged when /clear throws', ACT, async ($, on) => {
  const world = install($, on)
  world.clearThrows = true
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(world.effects).toContain('toast:The handoff was written but /clear failed. This session is unchanged.')
  expect(world.effects).not.toContain('append')
  expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { reason: 'clear_failed' } })
})

test('It submits the handoff as a prompt when the append is refused', ACT, async ($, on) => {
  const world = install($, on)
  world.appendDenied = true
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  const entered = world.effects.filter(effect => effect.startsWith('entered:plugin:'))
  expect(entered).toEqual([
    'entered:plugin:Handoff from the previous session (old-session), written by Claude just before a /clear:\n\nThe handoff note.',
  ])
})

test('It submits nothing when the append is stored and no prompt was held', ACT, async ($, on) => {
  const world = await handedOff($, on)
  expect(world.effects.filter(effect => effect.startsWith('entered:'))).toEqual([])
})

test('It runs /handoff in off mode', async ($, on) => {
  const world = install($, on)
  await startSession($)
  const answer = await runCommand($, 'handoff')
  await world.clock.settle()
  expect(answer.text).toBe('Writing a handoff for a fresh session...')
  expect(world.effects).toContain('clear')
})

test('It logs an active cleared record for /handoff even in off mode', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({
    mode: 'active',
    action: 'cleared',
    trigger_values: { point: 'command', setting: 'off' },
  })
})

test('It logs an active record for /handoff even when the handoff fails', async ($, on) => {
  const world = install($, on)
  world.fork = async () => ({ isAnswered: false, reason: 'nothing-to-fork' })
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ mode: 'active', action: 'none', trigger_values: { point: 'command' } })
})

test('It does not start a second handoff while one is pending', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runCommand($, 'handoff')
  const second = await runCommand($, 'handoff')
  await world.clock.settle()
  expect(second.text).toBe('A handoff or compaction is already in progress.')
  expect(world.effects.filter(effect => effect === 'fork')).toHaveLength(1)
})

test('It starts one handoff when /handoff runs twice at once', async ($, on) => {
  const world = install($, on)
  await startSession($)
  const runs = await Promise.all([runCommand($, 'handoff'), runCommand($, 'handoff')])
  await world.clock.settle()
  expect(runs.filter(run => run.text === 'A handoff or compaction is already in progress.')).toHaveLength(1)
  expect(world.effects.filter(effect => effect === 'fork')).toHaveLength(1)
})

test('It can hand off again after a handoff finished', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'fork')).toHaveLength(2)
})

test('It runs /handoff on an untested engine', async ($, on) => {
  const world = install($, on)
  world.version = { version: '9.9.9', base: '9.9.9' }
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects).toContain('clear')
})

const HANDED_OFF =
  'Handed off. This session starts from a note summarizing the previous one. To reopen the full previous conversation: claude --resume old-session'
const IN_THE_BOX =
  'Handed off. The note summarizing the previous session is in your prompt box. Press Enter to send it. To reopen the full previous conversation: claude --resume old-session'
const NOT_CARRIED_OVER =
  'The handoff note could not be added to this session. The previous conversation is unchanged: claude --resume old-session'

const refuseEveryWayToCarryTheNote = (world: World) => {
  world.appendDenied = true
  world.submitThrows = true
  world.fillRefusal = 'dialog'
}

test('It reports the handoff when the note is submitted after a refused append', ACT, async ($, on) => {
  const world = install($, on)
  world.appendDenied = true
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(world.effects).toContain(`log:${HANDED_OFF}`)
  expect(world.effects).not.toContain(`log:${NOT_CARRIED_OVER}`)
})

test('It says the note waits in the prompt box when the append and the send are refused', ACT, async ($, on) => {
  const world = install($, on)
  world.appendDenied = true
  world.submitThrows = true
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(world.effects).toContain(`log:${IN_THE_BOX}`)
  expect(world.effects).toContain(`toast:${IN_THE_BOX}`)
})

test('It does not claim the session starts from the note when the note only waits in the prompt box', ACT, async ($, on) => {
  const world = install($, on)
  world.appendDenied = true
  world.submitThrows = true
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(world.effects).not.toContain(`log:${HANDED_OFF}`)
  expect(world.effects).not.toContain(`log:${NOT_CARRIED_OVER}`)
})

test('It does not claim the session starts from the note when it could not be appended, sent, or put in the box', ACT, async ($, on) => {
  const world = install($, on)
  refuseEveryWayToCarryTheNote(world)
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(world.effects).not.toContain(`log:${HANDED_OFF}`)
})

test('It says the note was not carried over, with the resume command, when nothing could carry it', ACT, async ($, on) => {
  const world = install($, on)
  refuseEveryWayToCarryTheNote(world)
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(world.effects).toContain(`log:${NOT_CARRIED_OVER}`)
  expect(world.effects).toContain(`toast:${NOT_CARRIED_OVER}`)
})

test('It logs note appended in the cleared record when the append is stored', ACT, async ($, on) => {
  const world = await handedOff($, on)
  expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { note: 'appended' } })
})

test('It logs note submitted in the cleared record when the note is sent after a refused append', ACT, async ($, on) => {
  const world = install($, on)
  world.appendDenied = true
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { note: 'submitted' } })
})

test('It logs note in_box in the cleared record when the note waits in the prompt box', ACT, async ($, on) => {
  const world = install($, on)
  world.appendDenied = true
  world.submitThrows = true
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { note: 'in_box' } })
})

// A prompt.submit hook beneath the plugin (another plugin, or a settings hook) refuses the submitted note:
// $.prompt.submit resolves with { drop } rather than rejecting, so the note never entered the session.
const droppedNoteWorld = ($: Engine, on: On) => {
  const world = install($, on)
  world.appendDenied = true
  world.submitDropped = true
  return world
}

test('It does not log note submitted when the submitted note is dropped by a hook', ACT, async ($, on) => {
  const world = droppedNoteWorld($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(lastRecord(world).trigger_values.note).not.toBe('submitted')
})

test('It does not announce the session starts from the note when the submitted note is dropped by a hook', ACT, async ($, on) => {
  const world = droppedNoteWorld($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(world.effects).not.toContain(`log:${HANDED_OFF}`)
})

test('It puts the note back in the prompt box when a hook drops the submitted note', ACT, async ($, on) => {
  const world = droppedNoteWorld($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { note: 'in_box' } })
  expect(world.effects).toContain(`log:${IN_THE_BOX}`)
})

test('It writes the drop reason to the debug log when a hook drops the submitted note', ACT, async ($, on) => {
  const world = droppedNoteWorld($, on)
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(world.debugLines).toContain('handoff: could not send the prompt: refused by another hook')
})

test('It logs note not_carried in the cleared record when nothing could carry the note', ACT, async ($, on) => {
  const world = install($, on)
  refuseEveryWayToCarryTheNote(world)
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(world.records).toHaveLength(1)
  expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { note: 'not_carried' } })
})

test('It leaves note out of a record that is not a clear', ACT, async ($, on) => {
  const world = install($, on)
  world.fork = async () => ({ isAnswered: false, reason: 'nothing-to-fork' })
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(lastRecord(world).trigger_values).not.toHaveProperty('note')
})

test('It writes the deny reason to the debug log when the append is refused', ACT, async ($, on) => {
  const world = install($, on)
  world.appendDenied = true
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(world.debugLines).toContain('handoff: append denied: refused')
})
