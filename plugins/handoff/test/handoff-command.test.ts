import { describe, expect, test } from 'claude-code/testing'

import { ALREADY_PENDING } from '../hooks/handoff-note'
import { install, runCommand, startSession, writingTheNote } from './helpers'

describe('startHandoffCommand', () => {
  test('It replies that the handoff is being written', async ($, on) => {
    install($, on)
    await startSession($)
    expect(JSON.stringify(await runCommand($, 'handoff'))).toContain('Writing a handoff for a fresh session...')
  })

  test('It replies that a handoff is already pending when one is being written', async ($, on) => {
    await writingTheNote($, on)
    expect(JSON.stringify(await runCommand($, 'handoff'))).toContain(ALREADY_PENDING)
  })
})
