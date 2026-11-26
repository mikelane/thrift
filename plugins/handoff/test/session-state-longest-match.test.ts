import { expect, test } from 'claude-code/testing'

import { createState, queueResubmittedPrompt, startMainTurn } from '../hooks/session-state'
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

test('It takes the only matching entry when others do not match', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, entry('other', false))
  queueResubmittedPrompt(state, entry('match', true))
  startMainTurn(state, 'a match here')
  expect(state.isTurnUnattended).toBe(true)
})
