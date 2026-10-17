import { describe, expect, test } from 'claude-code/testing'

import { FINAL_MESSAGES } from '../hooks/handoff-note'
import { writingTheNote } from './helpers'

describe('announce', () => {
  test('It logs the final message of a handoff', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await finishNote()
    expect(world.effects).toContain(`log:${FINAL_MESSAGES.appended('old-session')}`)
  })

  test('It shows the final message of a handoff as a toast', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await finishNote()
    expect(world.effects).toContain(`toast:${FINAL_MESSAGES.appended('old-session')}`)
  })
})
