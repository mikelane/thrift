import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionCompactResult } from 'claude-code'

import { compacted, install, lastRecord, startSession, type World } from './helpers'
import { ACT, ACT_COMPACTING, finishedTaskTurn, handedOff, NOT_CARRIED_OVER } from './handoff-flow-fixtures'

const HANDED_OFF =
  'Handed off. This session starts from a note summarizing the previous one. To reopen the full previous conversation: claude --resume old-session'

const IN_THE_BOX =
  'Handed off. The note summarizing the previous session is in your prompt box. Press Enter to send it. To reopen the full previous conversation: claude --resume old-session'

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

const compactedFirst = async ($: Engine, on: On, compaction: () => Promise<SessionCompactResult>) => {
  const world = install($, on)
  world.compact = compaction
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  return world
}

const compactionOutcomes: ReadonlyArray<readonly [string, () => Promise<SessionCompactResult>]> = [
  ['is vetoed', async () => ({ skip: 'vetoed' })],
  [
    'fails',
    async () => {
      throw new Error('compaction failed')
    },
  ],
]

test('It records compacted_before_clear true on the cleared record after a successful compaction', ACT_COMPACTING, async ($, on) => {
  const world = await compactedFirst($, on, async () => compacted(48_000))
  expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { compacted_before_clear: true } })
})

for (const [name, compaction] of compactionOutcomes) {
  test(`It leaves compacted_before_clear off the cleared record when the compaction ${name}`, ACT_COMPACTING, async ($, on) => {
    const world = await compactedFirst($, on, compaction)
    expect(lastRecord(world)).toMatchObject({ action: 'cleared' })
    expect(lastRecord(world).trigger_values).not.toHaveProperty('compacted_before_clear')
  })
}

test('It leaves compacted_before_clear off the cleared record when compactBeforeClear is off', ACT, async ($, on) => {
  const world = await handedOff($, on)
  expect(lastRecord(world)).toMatchObject({ action: 'cleared' })
  expect(lastRecord(world).trigger_values).not.toHaveProperty('compacted_before_clear')
})

test('It says the session was compacted, not cleared, when /clear throws after a successful compaction', ACT_COMPACTING, async ($, on) => {
  const world = install($, on)
  world.clearThrows = true
  await startSession($)
  await finishedTaskTurn($, world)
  await world.clock.settle()
  expect(world.effects).toContain('toast:The handoff was written but /clear failed. This session was compacted, not cleared. Type /handoff to try again.')
  expect(world.effects).toContain('log:The handoff was written but /clear failed. This session was compacted, not cleared. Type /handoff to try again.')
  expect(lastRecord(world)).toMatchObject({
    action: 'none',
    trigger_values: { reason: 'clear_failed', compacted_before_clear: true },
  })
  expect(lastRecord(world).trigger_values).not.toHaveProperty('cleared_by')
})

for (const [name, compaction] of compactionOutcomes) {
  test(`It still says the session is unchanged when /clear throws after a compaction that ${name}`, ACT_COMPACTING, async ($, on) => {
    const world = install($, on)
    world.compact = compaction
    world.clearThrows = true
    await startSession($)
    await finishedTaskTurn($, world)
    await world.clock.settle()
    expect(world.effects).toContain('toast:The handoff was written but /clear failed. This session is unchanged. Type /handoff to try again.')
    expect(lastRecord(world).trigger_values).not.toHaveProperty('compacted_before_clear')
  })
}
