import { expect, test } from 'claude-code/testing'

import {
  addHeldPrompt,
  beginHandoffHold,
  beginSending,
  createState,
  endHandoff,
  isCarriedByHandoff,
  isAwaitingDelivery,
  isGroupOfOrigin,
  isHoldingForHandoff,
  releaseCarried,
  releaseCarriedGroup,
  resetForNewSession,
  takeHeldPrompts,
  takeLateArrivalsOrEndSending,
} from '../hooks/session-state'
import { settings, person, nightly } from './session-state-fixtures'

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
    runningSubagentTurns: new Set(),
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
    isOwnClearQueued: false,
    foreignClearsAhead: 0,
    hasLateTurn: false,
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
  beginHandoffHold(state, { text: 'now ENG-2', isUnattended: false, origin: 'composer', author: 'person' })
  state.hasBand = true
  state.isTurnRunning = true
  state.isPressRunning = true
  state.deferredPress = { offer: { signal: 'strong', contextTokens: 200_000, hasHeldPrompt: false, isBusy: false }, button: 'handoff' }
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
    heldPrompts: [{ text: 'now ENG-2', isUnattended: false, origin: 'composer', author: 'person' }],
    promptCarriedByHandoff: 'now ENG-2',
  })
})

test('It reports a state that holds nothing as not holding from isHoldingForHandoff', () => {
  expect(isHoldingForHandoff(createState(settings))).toBe(false)
})

test('It reports a state that holds nothing as not awaiting delivery from isAwaitingDelivery', () => {
  expect(isAwaitingDelivery(createState(settings), person)).toBe(false)
})

test('It reports a prompt held while collecting as awaiting delivery from isAwaitingDelivery', () => {
  const state = createState(settings)
  beginHandoffHold(state, null)
  addHeldPrompt(state, person)
  expect(isAwaitingDelivery(state, person)).toBe(true)
})

test('It reports a prompt that was never held as not awaiting delivery from isAwaitingDelivery', () => {
  const state = createState(settings)
  beginHandoffHold(state, null)
  expect(isAwaitingDelivery(state, person)).toBe(false)
})

test('It reports a prompt whose holding group was taken as not awaiting delivery from isAwaitingDelivery', () => {
  const state = createState(settings)
  beginHandoffHold(state, person)
  takeHeldPrompts(state)
  expect(isAwaitingDelivery(state, person)).toBe(false)
})

test('It reports a late arrival as awaiting delivery from isAwaitingDelivery', () => {
  const state = createState(settings)
  beginSending(state)
  addHeldPrompt(state, person)
  expect(isAwaitingDelivery(state, person)).toBe(true)
})

test('It reports a late arrival the delivery took as not awaiting delivery from isAwaitingDelivery', () => {
  const state = createState(settings)
  beginSending(state)
  addHeldPrompt(state, person)
  takeLateArrivalsOrEndSending(state)
  expect(isAwaitingDelivery(state, person)).toBe(false)
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
