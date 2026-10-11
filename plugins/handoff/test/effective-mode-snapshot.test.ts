import { expect, test } from 'claude-code/testing'
import type { ModelForkResult } from 'claude-code'

import { answered, install, lastRecord, runCommand, startSession } from './helpers'

const ACT = { options: { handoffMode: 'act' } } as const

test('It logs the mode from the decision when session.start changes the mode during a handoff', ACT, async ($, on) => {
  const world = install($, on)
  const pending: { release: (result: ModelForkResult) => void } = { release: () => undefined }
  world.fork = () =>
    new Promise<ModelForkResult>(resolve => {
      pending.release = resolve
    })
  await runCommand($, 'handoff')
  await world.clock.settle()
  await startSession($)
  pending.release(answered('The handoff note.'))
  await world.clock.settle()
  expect(lastRecord(world).trigger_values).toMatchObject({ setting: 'act', effective_mode: 'off' })
})
