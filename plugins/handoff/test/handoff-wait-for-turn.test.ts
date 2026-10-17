import { expect, test } from 'claude-code/testing'
import { answered, bash, compacted, completeTurn, growTo200k, dropOf, install, lastRecord, mountBand, notify, runCommand, startSession, startTurn, submitPerson } from './helpers'
import { ACT, ASK, COMPACTING, WAITING, BASE_MESSAGE, LATE_TURN_MESSAGE, holdFork, writingTheNote, turnRunningWhenTheNoteIsWritten, endTurn, waitingForATurn, shownText } from './wait-for-turn-helpers'

test('It does not clear while a turn that started during the note is running', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  expect(world.effects).not.toContain('clear')
})

test('It clears once the turn that started during the note ends', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  await endTurn($, world)
  expect(world.effects).toContain('clear')
})

test('It clears once the turn ends, whatever the reason it ended', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  await endTurn($, world, { reason: 'aborted' })
  expect(world.effects).toContain('clear')
})

test('It waits for a turn that was already running when the note finishes', async ($, on) => {
  const { world, finishNote } = await turnRunningWhenTheNoteIsWritten($, on)
  await finishNote()
  expect(world.effects).not.toContain('clear')
})

test('It clears once a turn that was already running when the note finishes ends', async ($, on) => {
  const { world, finishNote } = await turnRunningWhenTheNoteIsWritten($, on)
  await finishNote()
  await endTurn($, world)
  expect(world.effects).toContain('clear')
})

test('It waits for a turn that a peer prompt started during the note', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await submitPerson($, 'from a peer', { kind: 'peer' })
  await startTurn($)
  await finishNote()
  expect(world.effects).not.toContain('clear')
})

test('It waits for a turn that a task notification started during the note', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await notify($, 'bg1')
  await startTurn($)
  await finishNote()
  expect(world.effects).not.toContain('clear')
})

test('It does not hold a task notification that arrives during the handoff', async ($, on) => {
  const { world } = await writingTheNote($, on)
  expect(dropOf(await notify($, 'bg1'))).toBeUndefined()
  expect(world.effects.filter(effect => effect.startsWith('toast:'))).toHaveLength(1)
})

test('It does not hold a peer prompt that arrives during the handoff', async ($, on) => {
  await writingTheNote($, on)
  expect(dropOf(await submitPerson($, 'from a peer', { kind: 'peer' }))).toBeUndefined()
})

test('It keeps holding a person prompt while the handoff waits for the turn', async ($, on) => {
  const { finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  expect(dropOf(await submitPerson($, 'next thing'))).toContain('A handoff is in progress')
})

test('It shows the waiting status on the band while the handoff waits for the turn', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  expect(await shownText(await mountBand($))).toEqual([WAITING])
  expect(world.effects).not.toContain('log:Handed off.')
  expect(world.records).toHaveLength(0)
})

test('It does not clear when a subagent turn ends while the main turn runs', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  await endTurn($, world, { agentId: 'sub1' })
  expect(world.effects).not.toContain('clear')
})

test('It waits again when a new turn starts right after the one it waited for', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  await completeTurn($)
  await startTurn($)
  await world.clock.settle()
  expect(world.effects).not.toContain('clear')
})

test('It clears once the second turn ends too', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  await completeTurn($)
  await startTurn($)
  await endTurn($, world)
  expect(world.effects).toContain('clear')
})

test('It clears without waiting when no turn is running', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await finishNote()
  expect(world.effects).toContain('clear')
})

test('It adds the turn-after-note line when a turn started during the note and ended before the clear', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await completeTurn($)
  await finishNote()
  expect(world.appended).toEqual([LATE_TURN_MESSAGE])
})

test('It adds the turn-after-note line when the handoff waited for a turn that started during the note', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  await endTurn($, world)
  expect(world.appended).toEqual([LATE_TURN_MESSAGE])
})

test('It leaves the line out when no turn started after the note began', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await finishNote()
  expect(world.appended).toEqual([BASE_MESSAGE])
})

test('It adds the turn-after-note line when the turn it waited for was already running when the note began', async ($, on) => {
  const { world, finishNote } = await turnRunningWhenTheNoteIsWritten($, on)
  await finishNote()
  await endTurn($, world)
  expect(world.appended).toEqual([LATE_TURN_MESSAGE])
})

test('It leaves the line out when the turn ran before the handoff started', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await startTurn($)
  await completeTurn($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.appended).toEqual([BASE_MESSAGE])
})

test('It abandons the handoff as clear_failed when the clear fails after the wait', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  world.clearThrows = true
  await startTurn($)
  await finishNote()
  await endTurn($, world)
  expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { reason: 'clear_failed' } })
})

test('It does not offer a band over the handoff when the awaited turn ends', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  await endTurn($, world)
  expect(world.records.map(record => record.action)).toEqual(['cleared'])
})

test('It does not compact before the clear while a turn that started during the note is running', COMPACTING, async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  expect(world.effects).not.toContain('compact')
})

test('It compacts once the turn that started during the note ends', COMPACTING, async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  await endTurn($, world)
  expect(world.effects).toContain('compact')
})

test('It compacts before it clears once the awaited turn ends', COMPACTING, async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  await endTurn($, world)
  expect(world.effects.filter(effect => effect === 'compact' || effect === 'clear')).toEqual(['compact', 'clear'])
})

test('It waits again when a turn starts during the compaction', COMPACTING, async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  world.compact = async () => {
    await startTurn($)
    return compacted(48_000)
  }
  await finishNote()
  expect(world.effects).not.toContain('clear')
})

test('It clears once the turn that started during the compaction ends', COMPACTING, async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  world.compact = async () => {
    await startTurn($)
    return compacted(48_000)
  }
  await finishNote()
  await endTurn($, world)
  expect(world.effects).toContain('clear')
})

test('It logs to debug when the handoff starts waiting for a running turn', async ($, on) => {
  const world = await waitingForATurn($, on)
  expect(world.debugLines).toContain('handoff: waiting for a running turn to end before the handoff goes on')
})

test('It logs to debug once when a second turn starts during the wait', async ($, on) => {
  const world = await waitingForATurn($, on)
  await completeTurn($)
  await startTurn($)
  await world.clock.settle()
  expect(world.debugLines.filter(line => line.includes('waiting for a running turn'))).toHaveLength(1)
})

test('It logs to debug when the handoff resumes after the wait', async ($, on) => {
  const world = await waitingForATurn($, on)
  await endTurn($, world)
  expect(world.debugLines).toContain('handoff: resumed after the wait for a running turn')
})

test('It logs nothing about waiting when no turn is running', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await finishNote()
  expect(world.debugLines.filter(line => line.includes('running turn'))).toEqual([])
})

// A band press made mid-turn runs when the turn ends. A handoff that claimed the session meanwhile drops it.
test('It clears after the awaited turn ends when a held band press is dropped for the pending handoff', ASK, async ($, on) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  const band = await mountBand($)
  await startTurn($)
  await band.press({ key: 'handoff' })
  await runCommand($, 'handoff')
  await world.clock.settle()
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  await endTurn($, world)
  expect(world.effects).toContain('toast:A handoff or compaction is already in progress.')
  expect(world.effects).toContain('clear')
})

test('It shows the waiting status once a turn starts during the compaction before the clear', COMPACTING, async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.compact = async () => {
    await startTurn($)
    return compacted(48_000)
  }
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects).not.toContain('clear')
  expect(await shownText(await mountBand($))).toEqual([WAITING])
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects).toContain('clear')
})

test('It keeps a person prompt held while the waiting status is up', async ($, on) => {
  const world = await waitingForATurn($, on)
  await submitPerson($, 'next thing')
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects).toContain('entered:plugin+asUser:next thing')
})

// Guard for the `if (!state.isTurnRunning) break` after the pre-clear busy check in waitForClearWindow.
test('It waits for the turn instead of clearing when one starts during the pre-clear background check', ACT, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  world.onAgentList = async () => {
    world.onAgentList = undefined
    await startTurn($)
  }
  await world.clock.settle()
  expect(world.onAgentList).toBeUndefined()
  expect(world.effects).not.toContain('clear')
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'clear')).toHaveLength(1)
})

test('It clears when a subagent turn started with no main turn running and never sent a main turn complete', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await $.turn.start({ text: 'background work', turnId: 'sub-t1', agentId: 'sub1' })
  await finishNote()
  await world.clock.settle()
  expect(world.effects).toContain('clear')
})

test('It adds the turn-after-note line when a subagent turn started during the note', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await $.turn.start({ text: 'background work', turnId: 'sub-t1', agentId: 'sub1' })
  await finishNote()
  await world.clock.settle()
  expect(world.appended).toEqual([LATE_TURN_MESSAGE])
})

test('It clears once the main turn ends when a subagent turn started inside it', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await $.turn.start({ text: 'background work', turnId: 'sub-t1', agentId: 'sub1' })
  await finishNote()
  await endTurn($, world)
  expect(world.effects).toContain('clear')
})

test('It keeps waiting for the main turn when a subagent turn starts and ends inside it', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await finishNote()
  await $.turn.start({ text: 'background work', turnId: 'sub-t1', agentId: 'sub1' })
  await endTurn($, world, { agentId: 'sub1' })
  expect(world.effects).not.toContain('clear')
})
