import { expect, test } from 'claude-code/testing'

import { answered, bash, completeTurn, dropOf, entered, holdFork, lastRecord, mountBand, submitPerson } from './helpers'
import { ASK, ACT, NOTE_HEADING, ready } from './prompt-hold-fixtures'

test('It puts the prompt back in the box when the fork fails and someone is at the prompt', ACT, async ($, on) => {
  const world = await ready($, on)
  world.fork = async () => ({ isAnswered: false, reason: 'nothing-to-fork' })
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  expect(world.effects).toContain('fill:now ENG-2')
  expect(entered(world)).toEqual(['entered:composer:start on ENG-1'])
  expect(world.effects).not.toContain('clear')
})

test('It submits the prompt in the unchanged session when the fork fails and nobody is at the prompt', ACT, async ($, on) => {
  const world = await ready($, on)
  world.fork = async () => ({ isAnswered: false, reason: 'nothing-to-fork' })
  world.fillRefusal = 'no_composer'
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  expect(entered(world)).toContain('entered:plugin:now ENG-2')
})

test('It puts the prompt back in the box when /clear throws', ACT, async ($, on) => {
  const world = await ready($, on)
  world.clearThrows = true
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  expect(world.effects).toContain('fill:now ENG-2')
})

test('It submits the handoff joined to the held prompt when the append is refused', ACT, async ($, on) => {
  const world = await ready($, on)
  world.appendDenied = true
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  expect(entered(world)).toContain(`entered:plugin:${NOTE_HEADING}\n\nnow ENG-2`)
})

test('It drops only one of two prompts that name new work at once', ACT, async ($, on) => {
  const world = await ready($, on)
  const results = await Promise.all([submitPerson($, 'now ENG-2'), submitPerson($, 'now ENG-3')])
  await world.clock.settle()
  expect(results.filter(result => dropOf(result) !== undefined)).toHaveLength(1)
  expect(world.effects.filter(effect => effect === 'fork')).toHaveLength(1)
})

test('It holds a second prompt and sends it once with the first while the handoff note is written', ACT, async ($, on) => {
  const world = await ready($, on)
  const fork = holdFork(world)
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  const second = await submitPerson($, 'also ENG-3')
  expect(dropOf(second)).toBe("A handoff is in progress, so your prompt is held. It is sent when the handoff ends, or, if the handoff fails and a person sent it, put in this terminal's prompt box. If that can't be done, it is kept another way, at worst in the transcript.")
  fork.release(answered('The handoff note.'))
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'fork')).toHaveLength(1)
  expect(entered(world)).toEqual(['entered:composer:start on ENG-1', 'entered:plugin:now ENG-2\n\nalso ENG-3'])
})

test('It does not drop a prompt that carries attachments in act mode', ACT, async ($, on) => {
  const world = await ready($, on)
  const result = await submitPerson($, 'now ENG-2', { attachments: [{ type: 'image', mediaType: 'image/png' }] })
  expect(result).toMatchObject({ text: 'now ENG-2' })
  await world.clock.settle()
  expect(world.effects).not.toContain('fork')
})

test('It hands off for a scheduled prompt in ask mode without asking', ASK, async ($, on) => {
  const world = await ready($, on)
  const result = await submitPerson($, 'now ENG-2', { kind: 'scheduled-trigger' })
  expect(dropOf(result)).toBe('Handing off first. Your prompt will be sent in the fresh session.')
  await world.clock.settle()
  expect(entered(world)).toContain('entered:plugin:now ENG-2')
})

test('It does nothing for a scheduled prompt in off mode', async ($, on) => {
  await ready($, on)
  const result = await submitPerson($, 'now ENG-2', { kind: 'scheduled-trigger' })
  expect(result).toMatchObject({ text: 'now ENG-2' })
})

test('It resubmits a scheduled prompt in the unchanged session after a failed fork', ASK, async ($, on) => {
  const world = await ready($, on)
  world.fork = async () => ({ isAnswered: false, reason: 'nothing-to-fork' })
  await submitPerson($, 'now ENG-2', { kind: 'scheduled-trigger' })
  await world.clock.settle()
  expect(entered(world)).toContain('entered:plugin:now ENG-2')
  expect(world.effects).not.toContain('fill:now ENG-2')
})

test('It still runs a scheduled prompt when /clear throws', ASK, async ($, on) => {
  const world = await ready($, on)
  world.clearThrows = true
  await submitPerson($, 'now ENG-2', { kind: 'scheduled-trigger' })
  await world.clock.settle()
  expect(entered(world)).toContain('entered:plugin:now ENG-2')
})

test('It ignores a weak signal for a scheduled prompt', ASK, async ($, on) => {
  const world = await ready($, on)
  world.agents = [{ id: 'a1', description: 'd', type: 't', status: 'running' }]
  const result = await submitPerson($, 'now ENG-2', { kind: 'scheduled-trigger' })
  expect(result).toMatchObject({ text: 'now ENG-2' })
  await world.clock.settle()
  expect(world.effects).not.toContain('fork')
})

test('It hands off at the end of a scheduled turn that finished a task in ask mode', ASK, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'run the nightly job', { kind: 'scheduled-trigger' })
  await bash($, world, 'git commit -m nightly')
  await completeTurn($)
  await world.clock.settle()
  expect(world.effects).toContain('clear')
})

test('It offers a band at the end of a turn the person started', ASK, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'run the nightly job', { kind: 'scheduled-trigger' })
  await submitPerson($, 'and then this', { kind: 'composer' })
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  await world.clock.settle()
  expect(lastRecord(world).action).toBe('advised')
})

test('It clears the held prompt and the band when the session ends', ASK, async ($, on) => {
  await ready($, on)
  await submitPerson($, 'now ENG-2')
  await $.session.end({ reason: 'clear', sessionId: 'old-session', resume: { id: 'old-session' } })
  const band = await mountBand($)
  expect(await band.find({ text: 'engine band' })).toBeDefined()
  const result = await submitPerson($, 'now ENG-2')
  expect(result).toMatchObject({ text: 'now ENG-2' })
})

test('It does not refill the box when Send here was pressed before the refill ran', ASK, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  const band = await mountBand($)
  await band.press({ key: 'send-here' })
  await world.clock.settle()
  expect(entered(world)).toEqual(['entered:composer:start on ENG-1', 'entered:plugin:now ENG-2'])
  expect(world.box.text).toBe('')
})

test('It takes the held prompt out of a box that also holds a draft when Send here is pressed', ASK, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  world.box = { text: 'draft', cursor: 5 }
  await world.clock.settle()
  const band = await mountBand($)
  await band.press({ key: 'send-here' })
  await world.clock.settle()
  expect(world.box.text).toBe('draft')
})

test('It takes the held prompt out of a box that also holds a draft when Hand off and send it is pressed', ASK, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  world.box = { text: 'draft', cursor: 5 }
  await world.clock.settle()
  const band = await mountBand($)
  await band.press({ key: 'handoff-send' })
  await world.clock.settle()
  expect(world.box.text).toBe('draft')
})

test('It writes a held prompt to the transcript when nobody is at the box and it cannot be sent', ASK, async ($, on) => {
  const world = await ready($, on)
  world.fillRefusal = 'no_composer'
  world.submitThrows = true
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  expect(world.effects.filter(effect => effect.startsWith('log:') && effect.endsWith('\nnow ENG-2'))).toHaveLength(1)
})

test('It heads the transcript copy of an unsent prompt without a doubled plugin prefix', ASK, async ($, on) => {
  const world = await ready($, on)
  world.fillRefusal = 'no_composer'
  world.submitThrows = true
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  expect(world.effects).toContain('log:Your prompt could not be sent or put in the prompt box. Here it is:\nnow ENG-2')
})

test('It writes an unattended prompt to the transcript when it cannot be sent after the clear', ACT, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2', { kind: 'scheduled-trigger' })
  world.submitThrows = true
  await world.clock.settle()
  expect(world.effects).toContain('clear')
  expect(world.effects.filter(effect => effect.startsWith('log:') && effect.endsWith('\nnow ENG-2'))).toHaveLength(1)
})

test('It announces the note was not carried and not handed off when an unattended handoff can neither append nor send', ACT, async ($, on) => {
  const world = await ready($, on)
  world.appendDenied = true
  world.submitThrows = true
  await submitPerson($, 'now ENG-2', { kind: 'scheduled-trigger' })
  await world.clock.settle()
  const logged = world.effects.filter(effect => effect.startsWith('log:') && effect.includes('claude --resume'))
  expect(logged).toEqual([
    'log:The handoff note could not be added to this session. To reopen the full previous conversation: claude --resume old-session',
  ])
})

test('It writes an unattended prompt to the transcript when the handoff fails and it cannot be sent', ACT, async ($, on) => {
  const world = await ready($, on)
  world.fork = async () => ({ isAnswered: false, reason: 'nothing-to-fork' })
  await submitPerson($, 'now ENG-2', { kind: 'scheduled-trigger' })
  world.submitThrows = true
  await world.clock.settle()
  expect(world.effects).not.toContain('clear')
  expect(world.effects.filter(effect => effect.startsWith('log:') && effect.endsWith('\nnow ENG-2'))).toHaveLength(1)
})

test('It writes the held prompt to the transcript when a hook drops the send after the clear and nobody is at the box', ACT, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  world.submitDropped = true
  world.fillRefusal = 'no_composer'
  await world.clock.settle()
  expect(world.effects).toContain('clear')
  expect(world.effects.filter(effect => effect.startsWith('log:') && effect.endsWith('\nnow ENG-2'))).toHaveLength(1)
})

test('It writes the held prompt to the transcript when the send after the clear fails and nobody is at the box', ACT, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  world.submitThrows = true
  world.fillRefusal = 'no_composer'
  await world.clock.settle()
  expect(world.effects).toContain('clear')
  expect(world.effects.filter(effect => effect.startsWith('log:') && effect.endsWith('\nnow ENG-2'))).toHaveLength(1)
})
