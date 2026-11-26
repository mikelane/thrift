import { describe, expect, test } from 'claude-code/testing'

import { carriedText, withPreface } from '../hooks/carried-preface'

const SCHEDULED = "A scheduled task the person set up fired while the handoff was under way. The handoff plugin is passing its prompt on. The prompt:"

describe('withPreface', () => {
  test('It puts the scheduled preface, a blank line, then the prompt text', () => {
    expect(withPreface('nightly job')).toBe(`${SCHEDULED}\n\nnightly job`)
  })
})

describe('carriedText', () => {
  test('It prefaces a person-authored prompt submitted without asUser', () => {
    expect(carriedText({ text: 'nightly job', author: 'person' }, false)).toBe(`${SCHEDULED}\n\nnightly job`)
  })

  test('It leaves a person-authored prompt bare when it is submitted asUser', () => {
    expect(carriedText({ text: 'my words', author: 'person' }, true)).toBe('my words')
  })

  test('It leaves the plugin-authored prompt bare when it is submitted without asUser', () => {
    expect(carriedText({ text: 'the note', author: 'plugin' }, false)).toBe('the note')
  })
})
