import { expect, test } from 'claude-code/testing'
import { answered, compacted, completeTurn, install, lastRecord, mountBand, notify, runCommand, startSession, startTurn, submitPerson } from './helpers'
import { ACT, SESSION_ENDED_MESSAGE, COMPACTING, WAITING, BASE_MESSAGE, LATE_TURN_MESSAGE, holdFork, writingTheNote, endTurn, actHandoffWhileWritingTheNote, waitingForATurn, clearCount, shownText, countOf, personClearedThenTurnInFreshSession, WAITING_TOAST, SECOND_LATE_TURN_MESSAGE, bandText, firstHandoffEndsByPersonClear } from './wait-for-turn-helpers'

test('It delivers the note into the fresh session when the person clears during the post-wait busy check', ACT, async ($, on) => {
  const { world, finishNote } = await actHandoffWhileWritingTheNote($, on)
  world.agents = [{ id: 'a1', description: 'd', type: 't', status: 'running' }]
  world.onAgentList = async () => {
    world.onAgentList = undefined
    await runCommand($, 'clear')
  }
  await finishNote()
  await endTurn($, world)
  expect(world.onAgentList).toBeUndefined()
  expect(clearCount(world)).toBe(1)
  expect(world.appended).toEqual([LATE_TURN_MESSAGE])
  expect(lastRecord(world)).toMatchObject({ action: 'cleared' })
})

test('It takes the waiting status down once the note is delivered into the session the person cleared to', async ($, on) => {
  const world = await personClearedThenTurnInFreshSession($, on)
  await completeTurn($)
  await world.clock.settle()
  expect(world.appended).toHaveLength(1)
  expect(await shownText(await mountBand($))).toEqual(['engine band'])
})

test('It does not show the waiting status once the person has cleared, while a turn runs in the fresh session', async ($, on) => {
  const world = await personClearedThenTurnInFreshSession($, on)
  expect(await shownText(await mountBand($))).toEqual(['engine band'])
  expect(world.appended).toEqual([])
})

test('It leaves the turn-after-note line out when the only later turn ran in the session the person cleared to', async ($, on) => {
  const world = await personClearedThenTurnInFreshSession($, on)
  await completeTurn($)
  await world.clock.settle()
  expect(world.appended).toEqual([BASE_MESSAGE])
})

test('It takes the waiting status down when the session is resumed during the wait', async ($, on) => {
  const world = await waitingForATurn($, on)
  await $.session.end({ reason: 'resume', sessionId: 'old-session', resume: { id: 'old-session' } })
  await world.clock.settle()
  expect(await shownText(await mountBand($))).toEqual(['engine band'])
})

test('It writes the session-ended line and toast exactly once when the session is resumed during the wait', async ($, on) => {
  const world = await waitingForATurn($, on)
  await $.session.end({ reason: 'resume', sessionId: 'old-session', resume: { id: 'old-session' } })
  await world.clock.settle()
  expect(countOf(world, `log:${SESSION_ENDED_MESSAGE}`)).toBe(1)
  expect(countOf(world, `toast:${SESSION_ENDED_MESSAGE}`)).toBe(1)
})

test('It adds the turn-after-note line on a second handoff after the first ended by the person clearing', async ($, on) => {
  const world = await firstHandoffEndsByPersonClear($, on)
  expect(world.appended).toEqual([BASE_MESSAGE])
  const fork = holdFork(world)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await startTurn($)
  fork.release(answered('Second note.'))
  await world.clock.settle()
  await completeTurn($)
  await world.clock.settle()
  expect(world.appended).toEqual([BASE_MESSAGE, SECOND_LATE_TURN_MESSAGE])
})

test('It adds the turn-after-note line on a second handoff when a turn starts before the second handoff is scheduled', async ($, on) => {
  const world = await firstHandoffEndsByPersonClear($, on)
  const fork = holdFork(world)
  await startTurn($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  fork.release(answered('Second note.'))
  await world.clock.settle()
  await completeTurn($)
  await world.clock.settle()
  expect(world.appended).toEqual([BASE_MESSAGE, SECOND_LATE_TURN_MESSAGE])
})

test('It keeps the line for an old-session turn that started during the note and ended before the person cleared', async ($, on) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await startTurn($)
  await completeTurn($)
  await world.clock.settle()
  await runCommand($, 'clear')
  await world.clock.settle()
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  expect(world.appended).toEqual([LATE_TURN_MESSAGE])
})

test('It keeps the line for an old-session turn when a fresh-session turn also runs after the person clears', async ($, on) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await startTurn($)
  await completeTurn($)
  await world.clock.settle()
  await runCommand($, 'clear')
  await world.clock.settle()
  await notify($, 'bg1')
  await startTurn($)
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  await completeTurn($)
  await world.clock.settle()
  expect(world.appended).toEqual([LATE_TURN_MESSAGE])
})

test('It keeps the line and takes the band down when the person clears while the waiting status is up', async ($, on) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await startTurn($)
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  expect(await bandText($)).toEqual([WAITING])
  await runCommand($, 'clear')
  await world.clock.settle()
  expect(world.appended).toEqual([LATE_TURN_MESSAGE])
  expect(await bandText($)).toEqual(['engine band'])
})

test('It takes the band down when the person clears before the note starts and the note is delivered', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await runCommand($, 'handoff')
  await runCommand($, 'clear')
  await world.clock.settle()
  // The clear lands before prepareHandoff reads the id, so the note names the new session: the race the SAFETY note in
  // prepareHandoff accepts.
  expect(world.appended).toEqual([BASE_MESSAGE.replace('(old-session)', '(new-session)')])
  expect(await bandText($)).toEqual(['engine band'])
})

test('It shows no waiting toast when the person cleared and a fresh-session turn runs', async ($, on) => {
  const world = await personClearedThenTurnInFreshSession($, on)
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects).not.toContain(WAITING_TOAST)
  expect(world.appended).toEqual([BASE_MESSAGE])
})

test('It sends a person prompt held during the silent wait in the cleared-to session after the note', async ($, on) => {
  const world = await personClearedThenTurnInFreshSession($, on)
  await submitPerson($, 'next thing')
  await completeTurn($)
  await world.clock.settle()
  expect(world.appended).toEqual([BASE_MESSAGE])
  expect(world.effects).toContain('entered:plugin:next thing')
})

test('It shows the waiting status again on a second handoff after the first ended by the person clearing', async ($, on) => {
  const world = await firstHandoffEndsByPersonClear($, on)
  const fork = holdFork(world)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await startTurn($)
  fork.release(answered('Second note.'))
  await world.clock.settle()
  expect(await bandText($)).toEqual([WAITING])
})

test('It logs to debug that the wait is for delivering the note once the person has cleared', async ($, on) => {
  const world = await personClearedThenTurnInFreshSession($, on)
  expect(world.debugLines).toContain('handoff: waiting for a running turn to end before delivering the note')
  expect(world.debugLines).not.toContain('handoff: waiting for a running turn to end before the handoff goes on')
})

test('It logs to debug that the wait is for stopping the handoff once the session ended another way', async ($, on) => {
  const world = install($, on)
  const fork = holdFork(world)
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  await $.session.end({ reason: 'resume', sessionId: 'old-session', resume: { id: 'old-session' } })
  await startTurn($)
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  expect(world.debugLines).toContain('handoff: waiting for a running turn to end before stopping the handoff')
})

test('It records cleared_by person on the cleared record when the person clears during the wait', async ($, on) => {
  const world = await firstHandoffEndsByPersonClear($, on)
  expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { cleared_by: 'person' } })
})

test('It records cleared_by handoff on the cleared record when the handoff runs its own clear', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await finishNote()
  expect(world.effects).toContain('clear')
  expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { cleared_by: 'handoff' } })
})

test('It records cleared_by person and compacted_before_clear when the person clears during the compaction', COMPACTING, async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.compact = async () => {
    await $.session.end({ reason: 'clear', sessionId: 'old-session', resume: { id: 'old-session' } })
    return compacted(48_000)
  }
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({
    action: 'cleared',
    trigger_values: { cleared_by: 'person', compacted_before_clear: true },
  })
  expect(world.effects).not.toContain('clear')
})
