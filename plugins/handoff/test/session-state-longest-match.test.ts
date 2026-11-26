import { expect, test } from 'claude-code/testing'

import { createState } from '../hooks/session-state'
import { queueResubmittedPrompt, startMainTurn } from '../hooks/turn-state'
import { settings } from './session-state-fixtures'

const entry = (text: string, isUnattended: boolean) => ({ text, isUnattended, origin: 'composer' as const, author: 'person' as const })

test('It takes the longest queued entry whose text the turn contains, not the first', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, entry('run', false))
  queueResubmittedPrompt(state, entry('run the nightly report', true))
  startMainTurn(state, 'frame: run the nightly report')
  expect(state.isTurnUnattended).toBe(true)
})

test('It leaves the shorter matching entry queued when the longer one is taken', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, entry('run', false))
  queueResubmittedPrompt(state, entry('run the nightly report', true))
  startMainTurn(state, 'frame: run the nightly report')
  expect(state.resubmittedPrompts.map(prompt => prompt.text)).toEqual(['run'])
})

test('It takes the earlier submitted entry when two matching entries are as long', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, entry('same text', true))
  queueResubmittedPrompt(state, entry('same text', false))
  startMainTurn(state, 'same text')
  expect(state.isTurnUnattended).toBe(true)
})

test('It keeps the longer entry when a shorter matching entry is queued after it', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, entry('run the nightly report', true))
  queueResubmittedPrompt(state, entry('run', false))
  startMainTurn(state, 'frame: run the nightly report')
  expect([state.isTurnUnattended, state.resubmittedPrompts.map(prompt => prompt.text)]).toEqual([true, ['run']])
})

test('It ignores a longer queued entry whose text the turn does not contain', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, entry('a much longer prompt that never ran', true))
  queueResubmittedPrompt(state, entry('run', false))
  startMainTurn(state, 'run')
  expect([state.isTurnUnattended, state.resubmittedPrompts.map(prompt => prompt.text)]).toEqual([false, ['a much longer prompt that never ran']])
})

test('It leaves the queue alone when the turn contains no queued entry', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, entry('queued', true))
  startMainTurn(state, 'something else')
  expect(state.resubmittedPrompts.map(prompt => prompt.text)).toEqual(['queued'])
})

test('It takes the only matching entry when others do not match', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, entry('other', false))
  queueResubmittedPrompt(state, entry('match', true))
  startMainTurn(state, 'a match here')
  expect(state.isTurnUnattended).toBe(true)
})
