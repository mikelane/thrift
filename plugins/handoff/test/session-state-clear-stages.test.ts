import { expect, test } from 'claude-code/testing'

import {
  preClearOutcome,
  beginBeforeClear,
  beginOwnClear,
  claimPending,
  recordSessionEnd,
  recordResumeDispatch,
  shouldHoldResume,
  holdResume,
  takeHeldResumes,
  markOwnClearReturned,
  createState,
  endHandoff,
} from '../hooks/session-state'
import { settings } from './session-state-fixtures'

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
  expect(preClearOutcome('other', true, false)).toBe('abandon_session_ended')
})

test('It abandons as session_ended when another session end came and nothing is busy in preClearOutcome', () => {
  expect(preClearOutcome('other', false, false)).toBe('abandon_session_ended')
})

test('It delivers to the person clear over busy work in preClearOutcome', () => {
  expect(preClearOutcome('cleared_by_person', true, false)).toBe('deliver_to_person_clear')
})

test('It delivers to the person clear when nothing is busy in preClearOutcome', () => {
  expect(preClearOutcome('cleared_by_person', false, false)).toBe('deliver_to_person_clear')
})

test('It abandons as busy when no session ended and work is busy in preClearOutcome', () => {
  expect(preClearOutcome(null, true, false)).toBe('abandon_busy')
})

test('It clears when no session ended and nothing is busy in preClearOutcome', () => {
  expect(preClearOutcome(null, false, false)).toBe('clear')
})

test('It skips the clear when a turn preempted the compaction and nothing else decided in preClearOutcome', () => {
  expect(preClearOutcome(null, false, true)).toBe('abandon_compaction_preempted')
})

test('It abandons as busy over a preempted compaction in preClearOutcome', () => {
  expect(preClearOutcome(null, true, true)).toBe('abandon_busy')
})

test('It delivers to the person clear over a preempted compaction in preClearOutcome', () => {
  expect(preClearOutcome('cleared_by_person', false, true)).toBe('deliver_to_person_clear')
})

test('It abandons as session_ended over a preempted compaction in preClearOutcome', () => {
  expect(preClearOutcome('other', false, true)).toBe('abandon_session_ended')
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

test('It records a resume dispatched before the handoff clears as another end in recordResumeDispatch', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  recordResumeDispatch(state)
  expect(state.sessionEndBeforeClear).toBe('other')
})

test('It lets a resume dispatch outrank an earlier clear by the person in recordResumeDispatch', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  recordSessionEnd(state, 'clear')
  recordResumeDispatch(state)
  expect(state.sessionEndBeforeClear).toBe('other')
})

test('It ignores a resume dispatched when no handoff is pending in recordResumeDispatch', () => {
  const state = createState(settings)
  recordResumeDispatch(state)
  expect(state.sessionEndBeforeClear).toBeNull()
})

test('It ignores a resume dispatched after the handoff queued its clear in recordResumeDispatch', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  beginOwnClear(state)
  recordResumeDispatch(state)
  expect(state.sessionEndBeforeClear).toBeNull()
})

const PERSON = { kind: 'composer' } as const

test('It holds a resume the person typed while the handoff clear is queued in shouldHoldResume', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  beginOwnClear(state)
  expect(shouldHoldResume(state, PERSON)).toBe(true)
})

test('It does not hold a resume before the handoff queued its clear in shouldHoldResume', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  expect(shouldHoldResume(state, PERSON)).toBe(false)
})

test('It does not hold a resume once the handoff clear returned in shouldHoldResume', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  beginOwnClear(state)
  markOwnClearReturned(state)
  expect(shouldHoldResume(state, PERSON)).toBe(false)
})

test('It does not hold a resume when no handoff is pending in shouldHoldResume', () => {
  expect(shouldHoldResume(createState(settings), PERSON)).toBe(false)
})

test('It does not hold the resume the handoff itself replays in shouldHoldResume', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  beginOwnClear(state)
  expect(shouldHoldResume(state, { kind: 'plugin', name: 'handoff' })).toBe(false)
})

test('It returns held resumes in order and forgets them in takeHeldResumes', () => {
  const state = createState(settings)
  holdResume(state, 'a')
  holdResume(state, 'b')
  expect(takeHeldResumes(state)).toEqual(['a', 'b'])
  expect(takeHeldResumes(state)).toEqual([])
})
