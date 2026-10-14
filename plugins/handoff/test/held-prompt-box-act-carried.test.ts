import { expect, test } from 'claude-code/testing'

import { answered, entered, holdFork, submitPerson } from './helpers'
import { ACT, ready } from './prompt-hold-fixtures'

// Act mode drops a prompt that names new work and carries it into the handoff. Claude Code leaves that dropped text in the
// box too, so a prompt typed while the note is written must not be held with the carried prompt in front of it.
test('It holds a prompt typed during an act-mode handoff as typed, not after the carried prompt', ACT, async ($, on) => {
  const world = await ready($, on)
  const fork = holdFork(world)
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  await submitPerson($, 'two')
  await world.clock.settle()
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  expect(entered(world)).toContain('entered:plugin:now ENG-2\n\ntwo')
})

