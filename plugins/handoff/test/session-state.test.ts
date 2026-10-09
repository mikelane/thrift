import { expect, test } from 'claude-code/testing'

import {
  addHeldPrompt,
  preClearOutcome,
  beginHandoffHold,
  beginBeforeClear,
  beginOwnClear,
  recordSessionEnd,
  createState,
  endHandoff,
  isCarriedByHandoff,
  isGroupOfOrigin,
  isHoldingForHandoff,
  beginNoteWindow,
  endMainTurn,
  startMainTurn,
  releaseTurnEndWaiter,
  waitForTurnEnd,
  releaseCarried,
  releaseCarriedGroup,
  resetForNewSession,
  takeHeldPrompts,
} from '../hooks/session-state'

const settings = { setting: 'ask', threshold: 120_000, compactBeforeClear: true } as const

test('It returns the settings with a closed gate and an empty session from createState', () => {
  expect(createState(settings)).toEqual({
    setting: 'ask',
    threshold: 120_000,
    compactBeforeClear: true,
    mode: 'off',
    engineVersion: 'unknown',
    contextTokens: 0,
    cacheReadTokens: 0,
    seenRefs: new Set(),
    urlPrefixes: new Set(),
    backgroundTasks: new Set(),
    hasFinishedTask: false,
    isTurnUnattended: false,
    backoffFrom: null,
    pending: null,
    heldPrompt: null,
    handoffHold: { phase: 'idle' },
    hasBand: false,
    isTurnRunning: false,
    isPressRunning: false,
    deferredPress: null,
    hasTurnAfterNote: false,
    turnEndWaiter: null,
    handoffStage: 'idle',
    sessionEndBeforeClear: null,
  })
})

test('It returns fresh sets from each createState call', () => {
  const first = createState(settings)
  const second = createState(settings)
  first.seenRefs.add('ENG-1')
  expect(second.seenRefs.size).toBe(0)
})

const usedState = () => {
  const state = createState(settings)
  state.mode = 'act'
  state.engineVersion = '2.1.295'
  state.contextTokens = 200_000
  state.cacheReadTokens = 150_000
  state.seenRefs.add('ENG-1')
  state.urlPrefixes.add('ENG')
  state.backgroundTasks.add('bg1')
  state.hasFinishedTask = true
  state.isTurnUnattended = true
  state.backoffFrom = 180_000
  state.pending = 'handoff'
  state.heldPrompt = 'now ENG-2'
  beginHandoffHold(state, { text: 'now ENG-2', isUnattended: false })
  state.hasBand = true
  state.isTurnRunning = true
  state.isPressRunning = true
  state.deferredPress = { offer: { signal: 'strong', contextTokens: 200_000, heldPrompt: false, isBusy: false }, button: 'handoff' }
  return state
}

test('It clears what the old session learned in resetForNewSession', () => {
  const state = usedState()
  resetForNewSession(state)
  expect(state).toMatchObject({
    contextTokens: 0,
    cacheReadTokens: 0,
    seenRefs: new Set(),
    urlPrefixes: new Set(),
    backgroundTasks: new Set(),
    hasFinishedTask: false,
    isTurnUnattended: false,
    backoffFrom: null,
    heldPrompt: null,
    isTurnRunning: false,
    isPressRunning: false,
    deferredPress: null,
  })
})

test('It keeps the settings, mode, engine version, pending claim, and band in resetForNewSession', () => {
  const state = usedState()
  resetForNewSession(state)
  expect(state).toMatchObject({
    setting: 'ask',
    threshold: 120_000,
    compactBeforeClear: true,
    mode: 'act',
    engineVersion: '2.1.295',
    pending: 'handoff',
    hasBand: true,
  })
})

test('It leaves the prompts a handoff holds and carries alone in resetForNewSession, because the clear happens mid-handoff', () => {
  const state = usedState()
  resetForNewSession(state)
  expect(state.handoffHold).toEqual({
    phase: 'holding',
    heldPrompts: [{ text: 'now ENG-2', isUnattended: false }],
    promptCarriedByHandoff: 'now ENG-2',
  })
})

const person = { text: 'person says', isUnattended: false }
const nightly = { text: 'nightly job', isUnattended: true }

test('It reports a state that holds nothing as not holding from isHoldingForHandoff', () => {
  expect(isHoldingForHandoff(createState(settings))).toBe(false)
})

test('It holds the carried prompt first and remembers its text from beginHandoffHold', () => {
  const state = createState(settings)
  beginHandoffHold(state, person)
  expect(state.handoffHold).toEqual({ phase: 'holding', heldPrompts: [person], promptCarriedByHandoff: 'person says' })
})

test('It holds no prompts and carries none from beginHandoffHold without a carried prompt', () => {
  const state = createState(settings)
  beginHandoffHold(state, null)
  expect(state.handoffHold).toEqual({ phase: 'holding', heldPrompts: [], promptCarriedByHandoff: null })
})

test('It reports holding after beginHandoffHold from isHoldingForHandoff', () => {
  const state = createState(settings)
  beginHandoffHold(state, null)
  expect(isHoldingForHandoff(state)).toBe(true)
})

test('It returns the number of held prompts, counting the carried one, from addHeldPrompt', () => {
  const state = createState(settings)
  beginHandoffHold(state, person)
  expect(addHeldPrompt(state, nightly)).toBe(2)
})

test('It adds nothing and returns 0 from addHeldPrompt when no handoff is holding', () => {
  const state = createState(settings)
  expect([addHeldPrompt(state, person), state.handoffHold]).toEqual([0, { phase: 'idle' }])
})

test('It recognizes only the text the handoff carries in isCarriedByHandoff', () => {
  const state = createState(settings)
  beginHandoffHold(state, person)
  expect([isCarriedByHandoff(state, 'person says'), isCarriedByHandoff(state, 'other')]).toEqual([true, false])
})

test('It recognizes nothing in isCarriedByHandoff when the handoff carries no prompt', () => {
  const state = createState(settings)
  beginHandoffHold(state, null)
  expect(isCarriedByHandoff(state, '')).toBe(false)
})

test('It recognizes nothing in isCarriedByHandoff when no handoff is running', () => {
  expect(isCarriedByHandoff(createState(settings), 'person says')).toBe(false)
})

test('It returns the held prompts in arrival order and stops holding from takeHeldPrompts', () => {
  const state = createState(settings)
  beginHandoffHold(state, person)
  addHeldPrompt(state, nightly)
  expect([takeHeldPrompts(state), isHoldingForHandoff(state)]).toEqual([[person, nightly], false])
})

test('It keeps watching the carried prompt after takeHeldPrompts', () => {
  const state = createState(settings)
  beginHandoffHold(state, person)
  takeHeldPrompts(state)
  expect(isCarriedByHandoff(state, 'person says')).toBe(true)
})

test('It returns nothing from takeHeldPrompts when no handoff is holding', () => {
  expect(takeHeldPrompts(createState(settings))).toEqual([])
})

test('It goes idle from takeHeldPrompts when the handoff carries no prompt', () => {
  const state = createState(settings)
  beginHandoffHold(state, null)
  takeHeldPrompts(state)
  expect(state.handoffHold).toEqual({ phase: 'idle' })
})

test('It stops watching the carried prompt after releaseCarried', () => {
  const state = createState(settings)
  beginHandoffHold(state, person)
  takeHeldPrompts(state)
  releaseCarried(state)
  expect(isCarriedByHandoff(state, 'person says')).toBe(false)
})

test('It leaves a handoff that is still holding alone in releaseCarried', () => {
  const state = createState(settings)
  beginHandoffHold(state, person)
  releaseCarried(state)
  expect(isCarriedByHandoff(state, 'person says')).toBe(true)
})

test('It releases the carried prompt when its own origin group is handed back in releaseCarriedGroup', () => {
  const state = createState(settings)
  beginHandoffHold(state, person)
  takeHeldPrompts(state)
  releaseCarriedGroup(state, person, false)
  expect(isCarriedByHandoff(state, 'person says')).toBe(false)
})

test('It keeps the carried prompt when another origin group is handed back in releaseCarriedGroup', () => {
  const state = createState(settings)
  beginHandoffHold(state, person)
  takeHeldPrompts(state)
  releaseCarriedGroup(state, nightly, false)
  expect(isCarriedByHandoff(state, 'person says')).toBe(true)
})

test('It returns to idle from endHandoff in every phase', () => {
  const state = createState(settings)
  beginHandoffHold(state, person)
  endHandoff(state)
  expect(state.handoffHold).toEqual({ phase: 'idle' })
})

test('It tells whether a group shares an origin in isGroupOfOrigin', () => {
  expect([isGroupOfOrigin(person, false), isGroupOfOrigin(person, true), isGroupOfOrigin(nightly, true)]).toEqual([true, false, true])
})

const isPending = async (promise: Promise<void>): Promise<boolean> =>
  Promise.race([promise.then(() => false), Promise.resolve().then(() => true)])

test('It marks a turn running and started since the note from startMainTurn', () => {
  const state = createState(settings)
  startMainTurn(state)
  expect(state).toMatchObject({ isTurnRunning: true, hasTurnAfterNote: true })
})

test('It counts a turn already running when the note began as missing from the note in beginNoteWindow', () => {
  const state = createState(settings)
  startMainTurn(state)
  beginNoteWindow(state)
  expect(state.hasTurnAfterNote).toBe(true)
})

test('It forgets a turn that ended before the note began in beginNoteWindow', () => {
  const state = createState(settings)
  startMainTurn(state)
  endMainTurn(state)
  beginNoteWindow(state)
  expect(state.hasTurnAfterNote).toBe(false)
})

test('It keeps a running turn running in beginNoteWindow', () => {
  const state = createState(settings)
  startMainTurn(state)
  beginNoteWindow(state)
  expect(state.isTurnRunning).toBe(true)
})

test('It marks no turn running from endMainTurn', () => {
  const state = createState(settings)
  startMainTurn(state)
  endMainTurn(state)
  expect(state.isTurnRunning).toBe(false)
})

test('It keeps hasTurnAfterNote after the turn ends in endMainTurn', () => {
  const state = createState(settings)
  startMainTurn(state)
  endMainTurn(state)
  expect(state.hasTurnAfterNote).toBe(true)
})

test('It stays pending in waitForTurnEnd until the waiter is released', async () => {
  const state = createState(settings)
  startMainTurn(state)
  const waiting = waitForTurnEnd(state)
  expect(await isPending(waiting)).toBe(true)
})

test('It resolves waitForTurnEnd once the waiter is released', async () => {
  const state = createState(settings)
  startMainTurn(state)
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
  startMainTurn(state)
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
