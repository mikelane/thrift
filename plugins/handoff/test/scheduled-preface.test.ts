import { describe, expect, test } from 'claude-code/testing'

import { submissionTextFor, withScheduledPreface } from '../hooks/scheduled-preface'

const SCHEDULED = "A scheduled task the person set up fired while the handoff was under way. The handoff plugin is passing its prompt on. The prompt:"

describe('withScheduledPreface', () => {
  test('It puts the scheduled preface, a blank line, then the prompt text', () => {
    expect(withScheduledPreface('nightly job')).toBe(`${SCHEDULED}\n\nnightly job`)
  })
})

describe('submissionTextFor', () => {
  test('It prefaces a person-authored prompt submitted without asUser', () => {
    expect(submissionTextFor({ text: 'nightly job', author: 'person' }, false)).toBe(`${SCHEDULED}\n\nnightly job`)
  })

  test('It leaves a person-authored prompt bare when it is submitted asUser', () => {
    expect(submissionTextFor({ text: 'my words', author: 'person' }, true)).toBe('my words')
  })

  test('It leaves the plugin-authored prompt bare when it is submitted without asUser', () => {
    expect(submissionTextFor({ text: 'the note', author: 'plugin' }, false)).toBe('the note')
  })
})
