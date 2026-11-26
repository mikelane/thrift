import { expect, test } from 'claude-code/testing'
import type { PromptOrigin } from 'claude-code'

import { createState, recordForeignClearDone, recordForeignClearRunning, whenForeignClearsSettled } from '../hooks/session-state'
import { settings } from './session-state-fixtures'

const PERSON_ORIGIN: PromptOrigin = { kind: 'composer' }
const OWN_ORIGIN: PromptOrigin = { kind: 'plugin', name: 'handoff' }

const settledFlag = (wait: Promise<void>) => {
  const flag = { isSettled: false }
  void wait.then(() => {
    flag.isSettled = true
  })
  return flag
}

test('It counts a person clear from recordForeignClearRunning', () => {
  const state = createState(settings)
  recordForeignClearRunning(state, PERSON_ORIGIN)
  expect(state.foreignClearsRunning).toBe(1)
})

test('It leaves the count alone for the handoff own clear in recordForeignClearRunning', () => {
  const state = createState(settings)
  recordForeignClearRunning(state, OWN_ORIGIN)
  expect(state.foreignClearsRunning).toBe(0)
})

test('It takes a running clear off the count in recordForeignClearDone', () => {
  const state = createState(settings)
  recordForeignClearRunning(state, PERSON_ORIGIN)
  recordForeignClearDone(state, PERSON_ORIGIN)
  expect(state.foreignClearsRunning).toBe(0)
})

test('It leaves the count at zero when recordForeignClearDone has nothing running', () => {
  const state = createState(settings)
  recordForeignClearDone(state, PERSON_ORIGIN)
  expect(state.foreignClearsRunning).toBe(0)
})

test('It leaves the count alone for the handoff own clear in recordForeignClearDone', () => {
  const state = createState(settings)
  recordForeignClearRunning(state, PERSON_ORIGIN)
  recordForeignClearDone(state, OWN_ORIGIN)
  expect(state.foreignClearsRunning).toBe(1)
})

test('It resolves whenForeignClearsSettled at once when no foreign clear runs', async () => {
  const state = createState(settings)
  await whenForeignClearsSettled(state)
  expect(state.foreignClearReleasers).toEqual([])
})

test('It keeps whenForeignClearsSettled pending while a foreign clear runs', async () => {
  const state = createState(settings)
  recordForeignClearRunning(state, PERSON_ORIGIN)
  const flag = settledFlag(whenForeignClearsSettled(state))
  await Promise.resolve()
  expect(flag.isSettled).toBe(false)
})

test('It resolves whenForeignClearsSettled once the running foreign clear is done', async () => {
  const state = createState(settings)
  recordForeignClearRunning(state, PERSON_ORIGIN)
  const wait = whenForeignClearsSettled(state)
  recordForeignClearDone(state, PERSON_ORIGIN)
  await wait
  expect(state.foreignClearReleasers).toEqual([])
})

test('It keeps whenForeignClearsSettled pending until the last of two foreign clears is done', async () => {
  const state = createState(settings)
  recordForeignClearRunning(state, PERSON_ORIGIN)
  recordForeignClearRunning(state, PERSON_ORIGIN)
  const flag = settledFlag(whenForeignClearsSettled(state))
  recordForeignClearDone(state, PERSON_ORIGIN)
  await Promise.resolve()
  expect(flag.isSettled).toBe(false)
})
