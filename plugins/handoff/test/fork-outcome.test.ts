import { expect, test } from 'claude-code/testing'

import { noteOutcome } from '../hooks/fork-outcome'

test('It returns the trimmed text as the note when the fork answered', () => {
  expect(noteOutcome({ isAnswered: true, text: '  The note.\n' })).toEqual({ note: 'The note.' })
})

test('It returns no note and no fork reason when the answer is only whitespace', () => {
  expect(noteOutcome({ isAnswered: true, text: ' \n ' })).toEqual({ note: null })
})

test('It returns no note and the nothing-to-fork reason when the session has no reply to fork', () => {
  expect(noteOutcome({ isAnswered: false, reason: 'nothing-to-fork' })).toEqual({ note: null, forkReason: 'nothing-to-fork' })
})

for (const reason of ['api-error', 'empty-reply', 'aborted']) {
  test(`It returns no note and no fork reason when the fork is unanswered with ${reason}`, () => {
    expect(noteOutcome({ isAnswered: false, reason })).toEqual({ note: null })
  })
}
