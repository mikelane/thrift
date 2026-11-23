import { describe, expect, test } from 'claude-code/testing'

import {
  beginBeforeClear,
  beginOwnClear,
  clearedByFor,
  hasSecondClear,
  forgetForeignClear,
  markOwnClearReturned,
  recordForeignClear,
  recordForeignClearReturned,
  recordSessionEnd,
  createState,
  endHandoff,
  startMainTurn,
} from '../hooks/session-state'
import { settings } from './session-state-fixtures'
import type { PromptOrigin } from 'claude-code'

const PERSON_ORIGIN: PromptOrigin = { kind: 'composer' }

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
  recordForeignClear(state, PERSON_ORIGIN)
  recordSessionEnd(state, 'clear')
  expect(state.isOwnClearQueued).toBe(true)
})

test('It marks a turn between a foreign clear and the own clear as late in startMainTurn', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClear(state, PERSON_ORIGIN)
  recordSessionEnd(state, 'clear')
  startMainTurn(state, '')
  expect(state.hasLateTurn).toBe(true)
})

test('It treats the second clear as the own clear after one foreign clear in recordSessionEnd', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClear(state, PERSON_ORIGIN)
  recordSessionEnd(state, 'clear')
  recordSessionEnd(state, 'clear')
  expect(state.isOwnClearQueued).toBe(false)
})

test('It keeps the own clear queued through the ends of two foreign clears in recordSessionEnd', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClear(state, PERSON_ORIGIN)
  recordForeignClear(state, PERSON_ORIGIN)
  recordSessionEnd(state, 'clear')
  recordSessionEnd(state, 'clear')
  expect(state.isOwnClearQueued).toBe(true)
})

test('It takes a session end that is not a clear as the end of the queued clear despite a foreign clear in recordSessionEnd', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClear(state, PERSON_ORIGIN)
  recordSessionEnd(state, 'resume')
  expect(state.isOwnClearQueued).toBe(false)
})

test('It keeps the own clear queued when a foreign clear that started before it ended the session first in recordSessionEnd', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  recordForeignClear(state, PERSON_ORIGIN)
  beginOwnClear(state)
  recordSessionEnd(state, 'clear')
  expect(state.isOwnClearQueued).toBe(true)
})

test('It treats the next clear as the own clear after a foreign clear ended its session before the own clear in recordSessionEnd', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  recordForeignClear(state, PERSON_ORIGIN)
  recordSessionEnd(state, 'clear')
  beginOwnClear(state)
  recordSessionEnd(state, 'clear')
  expect(state.isOwnClearQueued).toBe(false)
})

test('It keeps the foreign clear counted when a session end that is not a clear comes before the own clear in recordSessionEnd', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  recordForeignClear(state, PERSON_ORIGIN)
  recordSessionEnd(state, 'resume')
  expect(state.foreignClearsAhead).toBe(1)
})

test('It records the person clear before the own clear even with a foreign clear counted in recordSessionEnd', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  recordForeignClear(state, PERSON_ORIGIN)
  recordSessionEnd(state, 'clear')
  expect(state.sessionEndBeforeClear).toBe('cleared_by_person')
})

test('It ignores a foreign clear while no handoff runs in recordForeignClear', () => {
  const state = createState(settings)
  recordForeignClear(state, PERSON_ORIGIN)
  expect(state.foreignClearsAhead).toBe(0)
})

test('It ignores a foreign clear after the own clear ended the session in recordForeignClear', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordSessionEnd(state, 'clear')
  recordForeignClear(state, PERSON_ORIGIN)
  beginOwnClear(state)
  recordSessionEnd(state, 'clear')
  expect(state.isOwnClearQueued).toBe(false)
})

test('It forgets a foreign clear from endHandoff', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClear(state, PERSON_ORIGIN)
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

test('It drops a counted foreign clear that ended no session in forgetForeignClear', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClear(state, PERSON_ORIGIN)
  forgetForeignClear(state)
  recordSessionEnd(state, 'clear')
  expect(state.isOwnClearQueued).toBe(false)
})

test('It leaves the count at zero when no foreign clear is counted in forgetForeignClear', () => {
  const state = createState(settings)
  beginOwnClear(state)
  forgetForeignClear(state)
  expect(state.foreignClearsAhead).toBe(0)
})

test('It counts another plugin clear as foreign in recordForeignClear', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClear(state, { kind: 'plugin', name: 'other-plugin' })
  recordSessionEnd(state, 'clear')
  expect(state.isOwnClearQueued).toBe(true)
})

test('It marks a foreign clear that returned before the own clear as run ahead in recordForeignClearReturned', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClearReturned(state, PERSON_ORIGIN)
  expect(state.didForeignClearFinishFirst).toBe(true)
})

test('It ignores the handoff plugin own clear returning in recordForeignClearReturned', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClearReturned(state, { kind: 'plugin', name: 'handoff' })
  expect(state.didForeignClearFinishFirst).toBe(false)
})

test('It counts another plugin clear that returned first as run ahead in recordForeignClearReturned', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClearReturned(state, { kind: 'plugin', name: 'other-plugin' })
  expect(state.didForeignClearFinishFirst).toBe(true)
})

test('It ignores a foreign clear that returned after the own clear in recordForeignClearReturned', () => {
  const state = createState(settings)
  beginOwnClear(state)
  markOwnClearReturned(state)
  recordForeignClearReturned(state, PERSON_ORIGIN)
  expect(state.didForeignClearFinishFirst).toBe(false)
})

test('It ignores a foreign clear that returned outside the own_clear stage in recordForeignClearReturned', () => {
  const state = createState(settings)
  beginBeforeClear(state)
  recordForeignClearReturned(state, PERSON_ORIGIN)
  expect(state.didForeignClearFinishFirst).toBe(false)
})

test('It records that the own clear returned in markOwnClearReturned', () => {
  const state = createState(settings)
  beginOwnClear(state)
  markOwnClearReturned(state)
  expect(state.hasOwnClearReturned).toBe(true)
})

test('It forgets a returned own clear and a run-ahead foreign clear from beginOwnClear', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClearReturned(state, PERSON_ORIGIN)
  markOwnClearReturned(state)
  beginOwnClear(state)
  expect(state).toMatchObject({ hasOwnClearReturned: false, didForeignClearFinishFirst: false })
})

test('It forgets a returned own clear and a run-ahead foreign clear from endHandoff', () => {
  const state = createState(settings)
  beginOwnClear(state)
  recordForeignClearReturned(state, PERSON_ORIGIN)
  markOwnClearReturned(state)
  endHandoff(state)
  expect(state).toMatchObject({ hasOwnClearReturned: false, didForeignClearFinishFirst: false })
})

describe('clearedByFor', () => {
  test('It names the handoff when it cleared and no foreign clear finished first', () => {
    expect(clearedByFor(createState(settings), 'clear')).toBe('handoff')
  })

  test('It names the person when the person cleared before the handoff issued its clear', () => {
    expect(clearedByFor(createState(settings), 'deliver_to_person_clear')).toBe('person')
  })

  test('It names the person when a foreign clear finished before the handoff clear', () => {
    const state = createState(settings)
    state.didForeignClearFinishFirst = true
    expect(clearedByFor(state, 'clear')).toBe('person')
  })

  test('It names the person when a foreign clear finished first and the person had cleared too', () => {
    const state = createState(settings)
    state.didForeignClearFinishFirst = true
    expect(clearedByFor(state, 'deliver_to_person_clear')).toBe('person')
  })
})

describe('hasSecondClear', () => {
  test('It is true when the handoff cleared after a foreign clear finished first', () => {
    const state = createState(settings)
    state.didForeignClearFinishFirst = true
    expect(hasSecondClear(state, 'clear')).toBe(true)
  })

  test('It is false when the handoff cleared and nothing cleared before it', () => {
    expect(hasSecondClear(createState(settings), 'clear')).toBe(false)
  })

  test('It is false when the person cleared and the handoff issued no clear of its own', () => {
    const state = createState(settings)
    state.didForeignClearFinishFirst = true
    expect(hasSecondClear(state, 'deliver_to_person_clear')).toBe(false)
  })
})
