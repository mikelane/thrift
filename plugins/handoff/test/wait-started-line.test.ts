import { describe, expect, test } from 'claude-code/testing'

import { waitStartedLine } from '../hooks/wait-started-line'

describe('waitStartedLine', () => {
  test('It says the handoff goes on when no session end has been seen', () => {
    expect(waitStartedLine({ sessionEndBeforeClear: null })).toBe('waiting for a running turn to end before the handoff goes on')
  })

  test('It says the note is delivered when the person cleared', () => {
    expect(waitStartedLine({ sessionEndBeforeClear: 'cleared_by_person' })).toBe('waiting for a running turn to end before delivering the note')
  })

  test('It says the handoff stops when the session ended another way', () => {
    expect(waitStartedLine({ sessionEndBeforeClear: 'other' })).toBe('waiting for a running turn to end before stopping the handoff')
  })
})
