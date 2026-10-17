import { expect, test } from 'claude-code/testing'

import {
  beginBeforeClear,
  beginOwnClear,
  noteCacheReads,
  recordSessionEnd,
  createState,
  beginNoteWindow,
  endMainTurn,
  startMainTurn,
  startSubagentTurn,
  endSubagentTurn,
  releaseTurnEndWaiter,
  waitForTurnEnd,
  resetForNewSession,
} from '../hooks/session-state'
import { settings } from './session-state-fixtures'

const isPending = async (promise: Promise<void>): Promise<boolean> =>
  Promise.race([promise.then(() => false), Promise.resolve().then(() => true)])

test('It marks a turn running and started since the note from startMainTurn', () => {
  const state = createState(settings)
  startMainTurn(state, '')
  expect(state).toMatchObject({ isTurnRunning: true, hasTurnAfterNote: true })
})

test('It leaves isTurnRunning false from startSubagentTurn', () => {
  const state = createState(settings)
  startSubagentTurn(state, 'sub-t1')
  expect(state.isTurnRunning).toBe(false)
})

test('It marks a subagent turn after the note as missing from the note in startSubagentTurn', () => {
  const state = createState(settings)
  startSubagentTurn(state, 'sub-t1')
  expect(state.hasTurnAfterNote).toBe(true)
})

test('It marks a subagent turn after beginOwnClear as late in startSubagentTurn', () => {
  const state = createState(settings)
  beginOwnClear(state)
  startSubagentTurn(state, 'sub-t1')
  expect(state.hasLateTurn).toBe(true)
})

test('It leaves hasTurnAfterNote false from startSubagentTurn after the session ended before the clear', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  recordSessionEnd(state, 'clear')
  startSubagentTurn(state, 'sub-t1')
  expect(state.hasTurnAfterNote).toBe(false)
})

test('It leaves hasLateTurn false from startSubagentTurn when no clear is queued', () => {
  const state = createState(settings)
  startSubagentTurn(state, 'sub-t1')
  expect(state.hasLateTurn).toBe(false)
})

test('It counts a subagent turn still running when the note began as missing from the note in beginNoteWindow', () => {
  const state = createState(settings)
  startSubagentTurn(state, 'sub-t1')
  beginNoteWindow(state)
  expect(state.hasTurnAfterNote).toBe(true)
})

test('It stops counting a subagent turn in beginNoteWindow once endSubagentTurn ended it', () => {
  const state = createState(settings)
  startSubagentTurn(state, 'sub-t1')
  endSubagentTurn(state, 'sub-t1')
  beginNoteWindow(state)
  expect(state.hasTurnAfterNote).toBe(false)
})

test('It keeps counting the other subagent turn when endSubagentTurn ends one of two', () => {
  const state = createState(settings)
  startSubagentTurn(state, 'sub-t1')
  startSubagentTurn(state, 'sub-t2')
  endSubagentTurn(state, 'sub-t1')
  beginNoteWindow(state)
  expect(state.hasTurnAfterNote).toBe(true)
})

test('It ignores an endSubagentTurn whose start was never heard', () => {
  const state = createState(settings)
  startSubagentTurn(state, 'sub-t1')
  endSubagentTurn(state, 'unheard')
  expect([...state.runningSubagentTurns]).toEqual(['sub-t1'])
})

test('It forgets running subagent turns in resetForNewSession', () => {
  const state = createState(settings)
  startSubagentTurn(state, 'sub-t1')
  resetForNewSession(state)
  beginNoteWindow(state)
  expect(state.hasTurnAfterNote).toBe(false)
})

test('It counts a turn already running when the note began as missing from the note in beginNoteWindow', () => {
  const state = createState(settings)
  startMainTurn(state, '')
  beginNoteWindow(state)
  expect(state.hasTurnAfterNote).toBe(true)
})

test('It forgets a turn that ended before the note began in beginNoteWindow', () => {
  const state = createState(settings)
  startMainTurn(state, '')
  endMainTurn(state)
  beginNoteWindow(state)
  expect(state.hasTurnAfterNote).toBe(false)
})

test('It keeps a running turn running in beginNoteWindow', () => {
  const state = createState(settings)
  startMainTurn(state, '')
  beginNoteWindow(state)
  expect(state.isTurnRunning).toBe(true)
})

test('It marks no turn running from endMainTurn', () => {
  const state = createState(settings)
  startMainTurn(state, '')
  endMainTurn(state)
  expect(state.isTurnRunning).toBe(false)
})

test('It keeps hasTurnAfterNote after the turn ends in endMainTurn', () => {
  const state = createState(settings)
  startMainTurn(state, '')
  endMainTurn(state)
  expect(state.hasTurnAfterNote).toBe(true)
})

test('It stays pending in waitForTurnEnd until the waiter is released', async () => {
  const state = createState(settings)
  startMainTurn(state, '')
  const waiting = waitForTurnEnd(state)
  expect(await isPending(waiting)).toBe(true)
})

test('It resolves waitForTurnEnd once the waiter is released', async () => {
  const state = createState(settings)
  startMainTurn(state, '')
  const waiting = waitForTurnEnd(state)
  endMainTurn(state)
  releaseTurnEndWaiter(state)
  await waiting
  expect(state.turnEndWaiter).toBeNull()
})

test('It does nothing in releaseTurnEndWaiter when no one is waiting', () => {
  const state = createState(settings)
  expect(() => releaseTurnEndWaiter(state)).not.toThrow()
  expect(state.turnEndWaiter).toBeNull()
})

test('It leaves the waiter pending in resetForNewSession so the handoff resumes after the session end hook', async () => {
  const state = createState(settings)
  startMainTurn(state, '')
  const waiting = waitForTurnEnd(state)
  resetForNewSession(state)
  expect(await isPending(waiting)).toBe(true)
})

test('It stores the turn cache-read tokens from noteCacheReads', () => {
  const state = createState(settings)
  noteCacheReads(state, 33_000)
  expect(state.cacheReadTokens).toBe(33_000)
})

test('It stores zero from noteCacheReads when the turn reported no cache reads', () => {
  const state = createState(settings)
  state.cacheReadTokens = 99_000
  noteCacheReads(state, undefined)
  expect(state.cacheReadTokens).toBe(0)
})
