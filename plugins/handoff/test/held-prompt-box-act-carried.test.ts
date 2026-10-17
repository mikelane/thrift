import { expect, test } from 'claude-code/testing'

import { answered, entered, holdFork, lastRecord, submitPerson } from './helpers'
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
  expect(entered(world)).toContain('entered:plugin+asUser:now ENG-2\n\ntwo')
})

// The clear before the handoff can read the box before Claude Code has put the carried prompt back, as in #63; the next
// prompt is then submitted as the carried prompt with the new one after it.
const typingAfterLateCarriedPrompt = async ($: Parameters<typeof submitPerson>[0], on: Parameters<typeof ready>[1]) => {
  const world = await ready($, on)
  const fork = holdFork(world)
  await submitPerson($, 'now ENG-2')
  world.box = { text: '', cursor: 0 }
  await world.clock.settle()
  world.box = { text: 'now ENG-2', cursor: 9 }
  await submitPerson($, 'two')
  await world.clock.settle()
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  return world
}

test('It holds a prompt typed during an act-mode handoff as typed when the carried prompt came back to the box late', ACT, async ($, on) => {
  const world = await typingAfterLateCarriedPrompt($, on)
  expect(entered(world)).toContain('entered:plugin+asUser:now ENG-2\n\ntwo')
})

test('It leaves the box empty after an act-mode handoff whose carried prompt came back to the box late', ACT, async ($, on) => {
  const world = await typingAfterLateCarriedPrompt($, on)
  expect(world.box.text).toBe('')
})

test('It counts the strip on the cleared record when the carried prompt came back to the box late', ACT, async ($, on) => {
  const world = await typingAfterLateCarriedPrompt($, on)
  expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { leftover_strips: 1 } })
})

// Once the clear before the handoff took the carried prompt out, a prompt that starts like it is the person's own words.
test('It keeps the start of a prompt that repeats the carried one once the carried prompt was cleared from the box', ACT, async ($, on) => {
  const world = await ready($, on)
  const fork = holdFork(world)
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  await submitPerson($, 'now ENG-2 too')
  await world.clock.settle()
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  expect(entered(world)).toContain('entered:plugin+asUser:now ENG-2\n\nnow ENG-2 too')
})

// A bridge prompt was never typed in this terminal's box, so a composer prompt that starts like it is typed as it stands.
test('It keeps a composer prompt whole that starts with the bridge prompt an act-mode handoff carries', ACT, async ($, on) => {
  const world = await ready($, on)
  const fork = holdFork(world)
  await submitPerson($, 'now ENG-2', { kind: 'bridge' })
  await world.clock.settle()
  await submitPerson($, 'now ENG-2two')
  await world.clock.settle()
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  expect(entered(world)).toContain('entered:plugin+asUser:now ENG-2\n\nnow ENG-2two')
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

