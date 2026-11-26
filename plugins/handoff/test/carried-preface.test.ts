import { describe, expect, test } from 'claude-code/testing'

import { prefaceFor, withPreface } from '../hooks/carried-preface'

const SCHEDULED = "A scheduled task fired while the handoff was under way, so the handoff carried its prompt here. The task's prompt:"
const PEER = 'A message from another Claude session arrived while the handoff was under way, so the handoff carried it here:'

describe('prefaceFor', () => {
  test('It names a scheduled task for a scheduled-trigger origin', () => {
    expect(prefaceFor({ origin: 'scheduled-trigger', isUnattended: true })).toBe(SCHEDULED)
  })

  test('It names a scheduled task for an unattended prompt that borrowed another origin', () => {
    expect(prefaceFor({ origin: 'composer', isUnattended: true })).toBe(SCHEDULED)
  })

  test('It names another Claude session for a peer origin', () => {
    expect(prefaceFor({ origin: 'peer', isUnattended: false })).toBe(PEER)
  })

  test('It names another Claude session for a peer-send-message origin', () => {
    expect(prefaceFor({ origin: 'peer-send-message', isUnattended: false })).toBe(PEER)
  })

  test('It names a background task notification for a task-notification origin', () => {
    expect(prefaceFor({ origin: 'task-notification', isUnattended: false })).toBe(
      'A background task notification arrived while the handoff was under way, so the handoff carried it here:',
    )
  })

  test('It names the origin kind for any other origin', () => {
    expect(prefaceFor({ origin: 'channel', isUnattended: false })).toBe(
      'A prompt (channel) arrived while the handoff was under way, so the handoff carried it here:',
    )
  })
})

describe('withPreface', () => {
  test('It puts the preface, a blank line, then the prompt text', () => {
    expect(withPreface({ text: 'nightly job', origin: 'scheduled-trigger', isUnattended: true })).toBe(`${SCHEDULED}\n\nnightly job`)
  })
})
