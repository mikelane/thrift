import { expect, test } from 'claude-code/testing'

import {
  preClearOutcome,
  beginBeforeClear,
  beginOwnClear,
  claimPending,
  noteCacheReads,
  recordForeignClear,
  recordSessionEnd,
  createState,
  endHandoff,
  beginNoteWindow,
  endMainTurn,
  startMainTurn,
  releaseTurnEndWaiter,
  waitForTurnEnd,
  resetForNewSession,
} from '../hooks/session-state'
import { settings } from './session-state-fixtures'
import type { PromptOrigin } from 'claude-code'

const PERSON: PromptOrigin = { kind: 'composer' }

const isPending = async (promise: Promise<void>): Promise<boolean> =>
  Promise.race([promise.then(() => false), Promise.resolve().then(() => true)])

test('It marks a turn running and started since the note from startMainTurn', () => {
  const state = createState(settings)
  startMainTurn(state, '')
  expect(state).toMatchObject({ isTurnRunning: true, hasTurnAfterNote: true })
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

test('It enters the before_clear stage and forgets an earlier session end in beginBeforeClear', () => {
  const state = createState(settings)
  state.sessionEndBeforeClear = 'other'
  beginBeforeClear(state)
  expect(state.handoffStage).toBe('before_clear')
  expect(state.sessionEndBeforeClear).toBeNull()
})

test('It enters the own_clear stage in beginOwnClear', () => {
  const state = createState(settings)
  beginOwnClear(state)
  expect(state.handoffStage).toBe('own_clear')
})

test('It returns to idle in endHandoff', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  endHandoff(state)
  expect(state.handoffStage).toBe('idle')
})

test('It records a clear before the handoff clears as the person clearing in recordSessionEnd', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  recordSessionEnd(state, 'clear')
  expect(state.sessionEndBeforeClear).toBe('cleared_by_person')
})

test('It records any other end before the handoff clears as other in recordSessionEnd', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  recordSessionEnd(state, 'resume')
  expect(state.sessionEndBeforeClear).toBe('other')
})

test('It lets a later other end outrank a clear in recordSessionEnd', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  recordSessionEnd(state, 'clear')
  recordSessionEnd(state, 'resume')
  expect(state.sessionEndBeforeClear).toBe('other')
})

test('It keeps other when a clear follows in recordSessionEnd', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  recordSessionEnd(state, 'resume')
  recordSessionEnd(state, 'clear')
  expect(state.sessionEndBeforeClear).toBe('other')
})

test('It ignores the end the handoff own clear causes in recordSessionEnd', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  beginOwnClear(state)
  recordSessionEnd(state, 'clear')
  expect(state.sessionEndBeforeClear).toBeNull()
})

test('It ignores a session end when no handoff is pending in recordSessionEnd', () => {
  const state = createState(settings)
  recordSessionEnd(state, 'resume')
  expect(state.sessionEndBeforeClear).toBeNull()
})

test('It abandons as session_ended when another session end came, even if work is busy, in preClearOutcome', () => {
  expect(preClearOutcome('other', true)).toBe('abandon_session_ended')
})

test('It abandons as session_ended when another session end came and nothing is busy in preClearOutcome', () => {
  expect(preClearOutcome('other', false)).toBe('abandon_session_ended')
})

test('It delivers to the person clear over busy work in preClearOutcome', () => {
  expect(preClearOutcome('cleared_by_person', true)).toBe('deliver_to_person_clear')
})

test('It delivers to the person clear when nothing is busy in preClearOutcome', () => {
  expect(preClearOutcome('cleared_by_person', false)).toBe('deliver_to_person_clear')
})

test('It abandons as busy when no session ended and work is busy in preClearOutcome', () => {
  expect(preClearOutcome(null, true)).toBe('abandon_busy')
})

test('It clears when no session ended and nothing is busy in preClearOutcome', () => {
  expect(preClearOutcome(null, false)).toBe('clear')
})

test('It takes a free pending slot and returns true from claimPending', () => {
  const state = createState(settings)
  expect(claimPending(state, 'compact')).toBe(true)
  expect(state.pending).toBe('compact')
})

test('It refuses a taken pending slot and keeps the first claim from claimPending', () => {
  const state = createState(settings)
  claimPending(state, 'compact')
  expect(claimPending(state, 'handoff')).toBe(false)
  expect(state.pending).toBe('compact')
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

test('It marks a turn that starts after beginOwnClear as late in startMainTurn', () => {
  const state = createState(settings)
  beginOwnClear(state)
  startMainTurn(state, '')
  expect(state.hasLateTurn).toBe(true)
})

test('It leaves a turn that starts before beginOwnClear unmarked as late in startMainTurn', () => {
  const state = createState(settings)
  startMainTurn(state, '')
  expect(state.hasLateTurn).toBe(false)
})

test('It leaves a turn that starts after the own clear ended the session unmarked as late in startMainTurn', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordSessionEnd(state, 'clear')
  startMainTurn(state, '')
  expect(state.hasLateTurn).toBe(false)
})

test('It keeps the clear queued when a session end arrives before the own clear in recordSessionEnd', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  recordSessionEnd(state, 'clear')
  beginOwnClear(state)
  startMainTurn(state, '')
  expect(state.hasLateTurn).toBe(true)
})

test('It forgets a late turn from beginOwnClear when the next clear is queued', () => {
  const state = createState(settings)
  beginOwnClear(state)
  startMainTurn(state, '')
  beginOwnClear(state)
  expect(state.hasLateTurn).toBe(false)
})

test('It clears the queued-clear and late-turn marks from endHandoff', () => {
  const state = createState(settings)
  beginOwnClear(state)
  startMainTurn(state, '')
  endHandoff(state)
  expect(state).toMatchObject({ isOwnClearQueued: false, hasLateTurn: false })
})

test('It keeps the own clear queued when a foreign clear ended the session first in recordSessionEnd', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClear(state, PERSON)
  recordSessionEnd(state, 'clear')
  expect(state.isOwnClearQueued).toBe(true)
})

test('It marks a turn between a foreign clear and the own clear as late in startMainTurn', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClear(state, PERSON)
  recordSessionEnd(state, 'clear')
  startMainTurn(state, '')
  expect(state.hasLateTurn).toBe(true)
})

test('It treats the second clear as the own clear after one foreign clear in recordSessionEnd', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClear(state, PERSON)
  recordSessionEnd(state, 'clear')
  recordSessionEnd(state, 'clear')
  expect(state.isOwnClearQueued).toBe(false)
})

test('It treats the second clear as the own clear after two foreign clears in recordSessionEnd', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClear(state, PERSON)
  recordForeignClear(state, PERSON)
  recordSessionEnd(state, 'clear')
  recordSessionEnd(state, 'clear')
  expect(state.isOwnClearQueued).toBe(true)
})

test('It takes a session end that is not a clear as the end of the queued clear despite a foreign clear in recordSessionEnd', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClear(state, PERSON)
  recordSessionEnd(state, 'resume')
  expect(state.isOwnClearQueued).toBe(false)
})

test('It ignores a foreign clear before the own clear is queued in recordForeignClear', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  recordForeignClear(state, PERSON)
  beginOwnClear(state)
  recordSessionEnd(state, 'clear')
  expect(state.isOwnClearQueued).toBe(false)
})

test('It ignores a foreign clear after the own clear ended the session in recordForeignClear', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordSessionEnd(state, 'clear')
  recordForeignClear(state, PERSON)
  beginOwnClear(state)
  recordSessionEnd(state, 'clear')
  expect(state.isOwnClearQueued).toBe(false)
})

test('It forgets a foreign clear from endHandoff', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClear(state, PERSON)
  endHandoff(state)
  beginOwnClear(state)
  recordSessionEnd(state, 'clear')
  expect(state.isOwnClearQueued).toBe(false)
})

test('It ignores the handoff plugin own clear in recordForeignClear', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClear(state, { kind: 'plugin', name: 'handoff' })
  recordSessionEnd(state, 'clear')
  expect(state.isOwnClearQueued).toBe(false)
})

test('It counts another plugin clear as foreign in recordForeignClear', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClear(state, { kind: 'plugin', name: 'other-plugin' })
  recordSessionEnd(state, 'clear')
  expect(state.isOwnClearQueued).toBe(true)
})
