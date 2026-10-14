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

// A bridge prompt was never typed in this terminal's box, so a line there that matches it is the person's own draft.
test('It leaves the box alone when an act-mode handoff carries a bridge prompt', ACT, async ($, on) => {
  const world = await ready($, on)
  const fork = holdFork(world)
  world.box = { text: 'now ENG-2', cursor: 9 }
  await submitPerson($, 'now ENG-2', { kind: 'bridge' })
  await world.clock.settle()
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  expect(world.box.text).toBe('now ENG-2')
})

