import { expect, test } from 'claude-code/testing'

import {
  addHeldPrompt,
  beginSending,
  removeResubmittedPrompt,
  queueResubmittedPrompt,
  preClearOutcome,
  beginHandoffHold,
  beginBeforeClear,
  beginOwnClear,
  claimPending,
  noteCacheReads,
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
  takeLateArrivalsOrEndSending,
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
    resubmittedPrompts: [],
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
  beginHandoffHold(state, { text: 'now ENG-2', isUnattended: false, origin: 'composer' })
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
    heldPrompts: [{ text: 'now ENG-2', isUnattended: false, origin: 'composer' }],
    promptCarriedByHandoff: 'now ENG-2',
  })
})

const person = { text: 'person says', isUnattended: false, origin: 'composer' }
const nightly = { text: 'nightly job', isUnattended: true, origin: 'scheduled-trigger' }

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

const sendingState = () => {
  const state = createState(settings)
  beginHandoffHold(state, person)
  takeHeldPrompts(state)
  beginSending(state)
  return state
}

test('It reports holding while sending from isHoldingForHandoff', () => {
  expect(isHoldingForHandoff(sendingState())).toBe(true)
})

test('It keeps the prompt the handoff carries watched through beginSending', () => {
  expect(isCarriedByHandoff(sendingState(), person.text)).toBe(true)
})

test('It watches no carried prompt after beginSending when the handoff carried none', () => {
  const state = createState(settings)
  beginHandoffHold(state, null)
  takeHeldPrompts(state)
  beginSending(state)
  expect(state.handoffHold).toEqual({ phase: 'sending', promptCarriedByHandoff: null, lateArrivals: [] })
})

test('It returns the number of prompts that arrived while sending from addHeldPrompt', () => {
  const state = sendingState()
  expect([addHeldPrompt(state, nightly), addHeldPrompt(state, person)]).toEqual([1, 2])
})

test('It returns the prompts that arrived while sending, oldest first, from takeLateArrivalsOrEndSending', () => {
  const state = sendingState()
  addHeldPrompt(state, nightly)
  addHeldPrompt(state, person)
  expect(takeLateArrivalsOrEndSending(state)).toEqual([nightly, person])
})

test('It keeps holding after takeLateArrivalsOrEndSending returned prompts, so more can still arrive', () => {
  const state = sendingState()
  addHeldPrompt(state, nightly)
  takeLateArrivalsOrEndSending(state)
  expect([addHeldPrompt(state, person), takeLateArrivalsOrEndSending(state)]).toEqual([1, [person]])
})

test('It ends the sending when takeLateArrivalsOrEndSending finds no prompt', () => {
  const state = sendingState()
  expect([takeLateArrivalsOrEndSending(state), state.handoffHold, isHoldingForHandoff(state)]).toEqual([[], { phase: 'idle' }, false])
})

test('It returns nothing from takeLateArrivalsOrEndSending when the handoff is not sending', () => {
  const state = createState(settings)
  beginHandoffHold(state, person)
  expect([takeLateArrivalsOrEndSending(state), state.handoffHold.phase]).toEqual([[], 'holding'])
})

test('It stops watching the carried prompt after releaseCarried while sending, and keeps holding', () => {
  const state = sendingState()
  releaseCarried(state)
  expect([isCarriedByHandoff(state, person.text), isHoldingForHandoff(state)]).toEqual([false, true])
})

test('It judges a turn start by the first queued resubmitted prompt whose text the turn contains', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, nightly)
  queueResubmittedPrompt(state, person)
  startMainTurn(state, 'nightly job')
  expect([state.isTurnUnattended, state.resubmittedPrompts]).toEqual([true, [person]])
})

test('It leaves the turn origin alone at a turn start when no resubmitted prompt is queued', () => {
  const state = createState(settings)
  state.isTurnUnattended = true
  startMainTurn(state, '')
  expect(state.isTurnUnattended).toBe(true)
})

test('It removes a prompt that did not enter from the queue in removeResubmittedPrompt', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, nightly)
  queueResubmittedPrompt(state, person)
  removeResubmittedPrompt(state, nightly)
  expect(state.resubmittedPrompts).toEqual([person])
})

test('It ignores a prompt that is not queued in removeResubmittedPrompt', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, person)
  removeResubmittedPrompt(state, nightly)
  expect(state.resubmittedPrompts).toEqual([person])
})

test('It leaves the queue alone at a turn start whose text matches no queued prompt', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, nightly)
  startMainTurn(state, '<task-notification>done</task-notification>')
  expect([state.isTurnUnattended, state.resubmittedPrompts]).toEqual([false, [nightly]])
})

test('It watches no carried prompt after beginSending from an idle hold', () => {
  const state = createState(settings)
  beginSending(state)
  expect(state.handoffHold).toEqual({ phase: 'sending', promptCarriedByHandoff: null, lateArrivals: [] })
})

test('It judges a turn start by a queued resubmitted prompt that the turn text frames', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, nightly)
  startMainTurn(state, 'The handoff plugin sent a message: nightly job')
  expect([state.isTurnUnattended, state.resubmittedPrompts]).toEqual([true, []])
})

test('It empties the queue of resubmitted prompts in resetForNewSession', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, nightly)
  resetForNewSession(state)
  expect(state.resubmittedPrompts).toEqual([])
})
