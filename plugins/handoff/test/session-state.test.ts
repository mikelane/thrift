import { expect, test } from 'claude-code/testing'

import { createState, resetForNewSession } from '../hooks/session-state'

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
    promptsHeldForHandoff: null,
    carriedForHandoff: null,
    hasBand: false,
    isTurnRunning: false,
    isPressRunning: false,
    deferredPress: null,
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
  state.promptsHeldForHandoff = [{ text: 'next thing', isUnattended: false }]
  state.carriedForHandoff = 'now ENG-2'
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
  expect(state).toMatchObject({
    promptsHeldForHandoff: [{ text: 'next thing', isUnattended: false }],
    carriedForHandoff: 'now ENG-2',
  })
})
