import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  bash,
  completeTurn,
  dropOf,
  growTo200k,
  install,
  lastRecord,
  mountBand,
  startSession,
  submitPerson,
} from './helpers'

const ASK = { options: { handoffMode: 'ask' } } as const
const ACT = { options: { handoffMode: 'act' } } as const
const NOTE_HEADING = 'Handoff from the previous session (old-session), written by Claude just before a /clear:\n\nThe handoff note.'

const ready = async ($: Engine, on: On) => {
  const world = install($, on)
  world.branch = 'alice/eng-1-start'
  await startSession($)
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  return world
}

const entered = (world: Awaited<ReturnType<typeof ready>>) => world.effects.filter(effect => effect.startsWith('entered:'))

test('It drops a prompt that names new work and holds it in ask mode', ASK, async ($, on) => {
  const world = await ready($, on)
  const result = await submitPerson($, 'now ENG-2')
  expect(dropOf(result)).toBe('Held your prompt. Choose below, or press Enter again to send it here.')
  expect(entered(world)).toEqual(['entered:composer:start on ENG-1'])
})

test('It refills the box with the held prompt once the clock fires', ASK, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  expect(world.effects).not.toContain('fill:now ENG-2')
  await world.clock.settle()
  expect(world.effects).toContain('fill:now ENG-2')
})

test('It logs an advised record for a held prompt at the prompt point', ASK, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  expect(lastRecord(world)).toMatchObject({
    mode: 'active',
    action: 'advised',
    trigger_values: { point: 'prompt', signal: 'strong', setting: 'ask' },
  })
})

test('It offers Hand off and send it and Send here for a held prompt', ASK, async ($, on) => {
  await ready($, on)
  await submitPerson($, 'now ENG-2')
  const band = await mountBand($)
  const labels = (await band.findAll({ type: 'Button' })).map(button => button.props.label)
  expect(labels).toEqual(['Hand off and send it', 'Send here'])
  expect(await band.find({ text: 'Context is 200k and this prompt starts new work.' })).toBeDefined()
  expect(await band.find({ text: /^ctrl\+x Tab, then Enter to hand off and send it, or s to send it here\./ })).toBeDefined()
})

test('It sends the held prompt here when the person presses Enter again', ASK, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  const result = await submitPerson($, 'now ENG-2')
  expect(result).toMatchObject({ text: 'now ENG-2' })
  expect(entered(world)).toContain('entered:composer:now ENG-2')
})

test('It takes the band down when Enter sends the held prompt here', ASK, async ($, on) => {
  await ready($, on)
  await submitPerson($, 'now ENG-2')
  const band = await mountBand($)
  await submitPerson($, 'now ENG-2')
  expect(await band.find({ text: 'engine band' })).toBeDefined()
})

test('It evaluates an edited prompt as a new prompt and drops the hold', ASK, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  const result = await submitPerson($, 'now ENG-2 please, but carefully')
  expect(result).toMatchObject({ text: 'now ENG-2 please, but carefully' })
  expect(entered(world)).toContain('entered:composer:now ENG-2 please, but carefully')
})

test('It sends the held prompt in this session when Send here is pressed', ASK, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  const band = await mountBand($)
  await band.press({ key: 'send-here' })
  await world.clock.settle()
  expect(entered(world)).toContain('entered:plugin:now ENG-2')
  expect(world.effects).not.toContain('fork')
  expect(world.box.text).toBe('')
})

test('It logs none for Send here', ASK, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  const band = await mountBand($)
  await band.press({ key: 'send-here' })
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { point: 'button', reason: 'send_here' } })
})

test('It leaves a box the person has changed alone when Send here is pressed', ASK, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  world.box = { text: 'something else', cursor: 14 }
  const band = await mountBand($)
  await band.press({ key: 'send-here' })
  await world.clock.settle()
  expect(world.box.text).toBe('something else')
})

test('It hands off and sends the held prompt in the fresh session when Hand off and send it is pressed', ASK, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  const band = await mountBand($)
  await band.press({ key: 'handoff-send' })
  await world.clock.settle()
  const steps = world.effects.filter(effect => ['fork', 'clear', 'append', 'entered:plugin:now ENG-2'].includes(effect))
  expect(steps).toEqual(['fork', 'clear', 'append', 'entered:plugin:now ENG-2'])
  expect(world.box.text).toBe('')
  expect(lastRecord(world)).toMatchObject({ action: 'cleared', trigger_values: { point: 'button' } })
})

test('It refills the box with a draft the person typed after the prompt was held', ASK, async ($, on) => {
  const world = await ready($, on)
  world.box = { text: 'draft', cursor: 5 }
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  expect(world.box.text).toBe('now ENG-2\ndraft')
})

test('It does not fill again when the box already holds the prompt', ASK, async ($, on) => {
  const world = await ready($, on)
  world.box = { text: 'now ENG-2', cursor: 9 }
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  expect(world.effects.filter(effect => effect.startsWith('fill:'))).toEqual([])
})

test('It sends the held prompt on when the box will not take it', ASK, async ($, on) => {
  const world = await ready($, on)
  world.fillRefusal = 'dialog'
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  expect(entered(world)).toContain('entered:plugin:now ENG-2')
  const band = await mountBand($)
  expect(await band.find({ text: 'engine band' })).toBeDefined()
})

test('It does not hold a prompt when background work makes the signal weak', ASK, async ($, on) => {
  const world = await ready($, on)
  world.agents = [{ id: 'a1', description: 'd', type: 't', status: 'running' }]
  const result = await submitPerson($, 'now ENG-2')
  expect(result).toMatchObject({ text: 'now ENG-2' })
})

test('It drops the prompt, hands off, and resends it in the fresh session in act mode', ACT, async ($, on) => {
  const world = await ready($, on)
  const result = await submitPerson($, 'now ENG-2')
  expect(dropOf(result)).toBe('Handing off first. Your prompt will be sent in the fresh session.')
  expect(entered(world)).toEqual(['entered:composer:start on ENG-1'])
  await world.clock.settle()
  const steps = world.effects.filter(effect => ['fork', 'clear', 'append', 'entered:plugin:now ENG-2'].includes(effect))
  expect(steps).toEqual(['fork', 'clear', 'append', 'entered:plugin:now ENG-2'])
})

test('It logs a cleared record at the prompt point in act mode', ACT, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  expect(lastRecord(world)).toMatchObject({
    session_id: 'old-session',
    action: 'cleared',
    trigger_values: { point: 'prompt', signal: 'strong', setting: 'act' },
  })
})

test('It counts the resent prompt as work the fresh session already named', ACT, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  await growTo200k($, world)
  await submitPerson($, 'and ENG-3')
  await world.clock.settle()
  expect(world.records.filter(record => record.trigger_values.point === 'prompt')).toHaveLength(2)
})

test('It does not call the resent ticket new work in the fresh session', ACT, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  await growTo200k($, world)
  const result = await submitPerson($, 'keep going on ENG-2')
  expect(result).toMatchObject({ text: 'keep going on ENG-2' })
  expect(world.records.filter(record => record.trigger_values.point === 'prompt')).toHaveLength(1)
})

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

test('It lets a second prompt through while a handoff is scheduled', ACT, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  const second = await submitPerson($, 'also ENG-3')
  expect(second).toMatchObject({ text: 'also ENG-3' })
  await world.clock.settle()
  expect(world.effects.filter(effect => effect === 'fork')).toHaveLength(1)
  expect(entered(world)).toContain('entered:composer:also ENG-3')
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
  world.box = { text: 'draft', cursor: 5 }
  await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  const band = await mountBand($)
  await band.press({ key: 'send-here' })
  await world.clock.settle()
  expect(world.box.text).toBe('draft')
})

test('It takes the held prompt out of a box that also holds a draft when Hand off and send it is pressed', ASK, async ($, on) => {
  const world = await ready($, on)
  world.box = { text: 'draft', cursor: 5 }
  await submitPerson($, 'now ENG-2')
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
  expect(world.effects).toContain('log:Your prompt could not be sent or put back in the box. Here it is:\nnow ENG-2')
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
    'log:The handoff note could not be added to this session. The previous conversation is unchanged: claude --resume old-session',
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

test('It writes the held prompt to the transcript when the send after the clear fails and nobody is at the box', ACT, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2')
  world.submitThrows = true
  world.fillRefusal = 'no_composer'
  await world.clock.settle()
  expect(world.effects).toContain('clear')
  expect(world.effects.filter(effect => effect.startsWith('log:') && effect.endsWith('\nnow ENG-2'))).toHaveLength(1)
})
