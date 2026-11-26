import { expect, test } from 'claude-code/testing'

import { withPreface } from '../hooks/carried-preface'
import { createState, queueResubmittedPrompt, startMainTurn } from '../hooks/session-state'
import { settings } from './session-state-fixtures'

test('It keeps a scheduled turn unattended when a person prompt queued before it is a word of the preface', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, { text: 'task', isUnattended: false, origin: 'composer', author: 'person' })
  const scheduled = { text: 'nightly report', isUnattended: true, origin: 'scheduled-trigger' as const, author: 'person' as const }
  queueResubmittedPrompt(state, { ...scheduled, text: withPreface(scheduled.text) })
  startMainTurn(state, withPreface(scheduled.text))
  expect(state.isTurnUnattended).toBe(true)
})
