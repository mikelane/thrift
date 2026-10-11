import { expect, test } from 'claude-code/testing'
import { answered, bash, compacted, completeTurn, growTo200k, install, lastRecord, mountBand, runCommand, startSession, startTurn, submitPerson } from './helpers'
import { ACT, SESSION_ENDED_MESSAGE, BUSY_TOAST, BUSY_LOG, ASK, COMPACTING, writingTheNote, endTurn, actHandoffWhileWritingTheNote, turnStartsBackgroundWork, actHandoffWithBusyTurn, shownText, countOf, ACT_COMPACTING, BUSY_COMPACTED_MESSAGE } from './wait-for-turn-helpers'

test('It does not clear over background work that a turn started while an act-mode handoff waited', ACT, async ($, on) => {
  const world = await turnStartsBackgroundWork($, on)
  expect(world.effects).not.toContain('clear')
})

test('It tells the person nothing was cleared when background work stops an act-mode handoff', ACT, async ($, on) => {
  const world = await turnStartsBackgroundWork($, on)
  expect(world.effects).toContain(BUSY_TOAST)
})

test('It writes the busy message to the transcript when background work stops an act-mode handoff', ACT, async ($, on) => {
  const world = await turnStartsBackgroundWork($, on)
  expect(world.effects).toContain(BUSY_LOG)
})

test('It records background_busy when background work stops an act-mode handoff after the wait', ACT, async ($, on) => {
  const world = await turnStartsBackgroundWork($, on)
  expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { reason: 'background_busy' } })
})

test('It puts a held prompt back in the box when background work stops the handoff', ACT, async ($, on) => {
  const { world, finishNote } = await actHandoffWhileWritingTheNote($, on)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  await submitPerson($, 'next thing')
  await finishNote()
  await endTurn($, world)
  expect(world.box.text).toBe('next thing')
})

test('It clears a typed /handoff over background work that a turn started during the wait', async ($, on) => {
  const { world, finishNote } = await writingTheNote($, on)
  await startTurn($)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  await finishNote()
  await endTurn($, world)
  expect(world.effects).toContain('clear')
})

test('It clears an act-mode handoff when no background work started during the wait', ACT, async ($, on) => {
  const { world, finishNote } = await actHandoffWhileWritingTheNote($, on)
  await finishNote()
  await endTurn($, world)
  expect(world.effects).toContain('clear')
})

test('It records the background_busy abandon after the wait as busy, with a weak signal', ACT, async ($, on) => {
  const world = await actHandoffWithBusyTurn($, on)
  expect(lastRecord(world).trigger_values).toMatchObject({ reason: 'background_busy', is_background_busy: true, signal: 'weak' })
})

test('It keeps the point and context tokens of the decision on the background_busy abandon', ACT, async ($, on) => {
  const world = await actHandoffWithBusyTurn($, on)
  expect(lastRecord(world)).toMatchObject({
    session_id: 'old-session',
    trigger_values: { reason: 'background_busy', point: 'turn-end', context_tokens: 200_000 },
  })
})

test('It records only scalars in trigger_values on the background_busy abandon', ACT, async ($, on) => {
  const world = await actHandoffWithBusyTurn($, on)
  const objectValues = Object.values(lastRecord(world).trigger_values).filter(value => typeof value === 'object')
  expect(objectValues).toEqual([])
})

test('It writes the busy refusal line and toast exactly once after the wait', ACT, async ($, on) => {
  const world = await actHandoffWithBusyTurn($, on)
  expect(countOf(world, BUSY_LOG)).toBe(1)
  expect(countOf(world, BUSY_TOAST)).toBe(1)
})

test('It hands off when the person types /handoff after the busy abandon, as the refusal says', ACT, async ($, on) => {
  const world = await actHandoffWithBusyTurn($, on)
  world.fork = async () => answered('Second note.')
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects).toContain('clear')
  expect(lastRecord(world)).toMatchObject({ action: 'cleared' })
})

test('It takes the waiting status down after the busy abandon', ACT, async ($, on) => {
  await actHandoffWithBusyTurn($, on)
  expect(await shownText(await mountBand($))).toEqual(['engine band'])
})

test('It hands off when the person types /handoff after a band press was refused as busy', ASK, async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  const band = await mountBand($)
  await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
  await band.press({ key: 'handoff' })
  await world.clock.settle()
  expect(world.effects).toContain(BUSY_TOAST)
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(world.effects).toContain('clear')
})

test('It records compacted_before_clear on the background_busy abandon that follows a compaction', ACT_COMPACTING, async ($, on) => {
  const world = await actHandoffWithBusyTurn($, on)
  expect(lastRecord(world)).toMatchObject({
    action: 'none',
    trigger_values: { reason: 'background_busy', compacted_before_clear: true },
  })
  expect(lastRecord(world).trigger_values).not.toHaveProperty('cleared_by')
})

test('It names the compacted previous session in the session-ended message that follows a compaction', COMPACTING, async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.compact = async () => {
    await $.session.end({ reason: 'resume', sessionId: 'old-session', resume: { id: 'old-session' } })
    world.sessionId = 'resumed-session'
    return compacted(48_000)
  }
  await runCommand($, 'handoff')
  await world.clock.settle()
  const message = `${SESSION_ENDED_MESSAGE} The previous session was compacted. To reopen it: claude --resume old-session`
  expect(world.effects).toContain(`toast:${message}`)
  expect(world.effects).toContain(`log:${message}`)
  expect(world.effects.filter(effect => effect.includes('This session was compacted'))).toEqual([])
})

test('It leaves compacted_before_clear off the background_busy abandon when compactBeforeClear is off', ACT, async ($, on) => {
  const world = await actHandoffWithBusyTurn($, on)
  expect(lastRecord(world).trigger_values).not.toHaveProperty('compacted_before_clear')
})

test('It records compacted_before_clear on the session_ended abandon that follows a compaction', COMPACTING, async ($, on) => {
  const world = install($, on)
  await startSession($)
  world.compact = async () => {
    await $.session.end({ reason: 'resume', sessionId: 'old-session', resume: { id: 'old-session' } })
    return compacted(48_000)
  }
  await runCommand($, 'handoff')
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ trigger_values: { reason: 'session_ended', compacted_before_clear: true } })
  expect(lastRecord(world).trigger_values).not.toHaveProperty('cleared_by')
})

test('It says the session was compacted, not cleared, in the busy refusal that follows a compaction', ACT_COMPACTING, async ($, on) => {
  const world = await actHandoffWithBusyTurn($, on)
  expect(world.effects).toContain(`toast:${BUSY_COMPACTED_MESSAGE}`)
  expect(world.effects).toContain(`log:${BUSY_COMPACTED_MESSAGE}`)
  expect(world.effects).not.toContain(BUSY_TOAST)
})
