import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { PromptOrigin } from 'claude-code'

import { dropOf, entered, growTo200k, lastRecord, mountBand, submitPerson } from './helpers'
import { ASK, ACT, ready } from './prompt-hold-fixtures'

test('It drops a prompt that names new work and holds it in ask mode', ASK, async ($, on) => {
  const world = await ready($, on)
  const result = await submitPerson($, 'now ENG-2')
  await world.clock.settle()
  expect([dropOf(result), entered(world), world.box.text]).toEqual([
    'Held your prompt. Choose below, or press Enter again to send it here.',
    ['entered:composer:start on ENG-1'],
    'now ENG-2',
  ])
})

const HANDING_OFF_FIRST = 'Handing off first. Your prompt will be sent in the fresh session.'

const submitFrom = ($: Engine, origin: PromptOrigin, text: string) => $.prompt.submit({ text, wait: false, origin })

const STARTED = 'entered:composer:start on ENG-1'

// Every origin but the composer: none is held for the band. A scheduled prompt hands off first, as an unattended prompt does.
const notHeldCases: ReadonlyArray<{ origin: PromptOrigin; outcome: string; drop: string | undefined; entered: string[] }> = [
  { origin: { kind: 'bridge' }, outcome: 'runs it', drop: undefined, entered: [STARTED, 'entered:bridge:now ENG-2'] },
  { origin: { kind: 'sdk' }, outcome: 'runs it', drop: undefined, entered: [STARTED, 'entered:sdk:now ENG-2'] },
  { origin: { kind: 'task-notification' }, outcome: 'runs it', drop: undefined, entered: [STARTED, 'entered:task-notification:now ENG-2'] },
  { origin: { kind: 'peer' }, outcome: 'runs it', drop: undefined, entered: [STARTED, 'entered:peer:now ENG-2'] },
  { origin: { kind: 'peer-send-message' }, outcome: 'runs it', drop: undefined, entered: [STARTED, 'entered:peer-send-message:now ENG-2'] },
  { origin: { kind: 'projects-relay' }, outcome: 'runs it', drop: undefined, entered: [STARTED, 'entered:projects-relay:now ENG-2'] },
  { origin: { kind: 'coordinator' }, outcome: 'runs it', drop: undefined, entered: [STARTED, 'entered:coordinator:now ENG-2'] },
  { origin: { kind: 'observer' }, outcome: 'runs it', drop: undefined, entered: [STARTED, 'entered:observer:now ENG-2'] },
  { origin: { kind: 'observer-activity' }, outcome: 'runs it', drop: undefined, entered: [STARTED, 'entered:observer-activity:now ENG-2'] },
  { origin: { kind: 'auto-continuation' }, outcome: 'runs it', drop: undefined, entered: [STARTED, 'entered:auto-continuation:now ENG-2'] },
  { origin: { kind: 'unclassified' }, outcome: 'runs it', drop: undefined, entered: [STARTED, 'entered:unclassified:now ENG-2'] },
  { origin: { kind: 'slack-ping' }, outcome: 'runs it', drop: undefined, entered: [STARTED, 'entered:slack-ping:now ENG-2'] },
  { origin: { kind: 'channel', server: 'chat' }, outcome: 'runs it', drop: undefined, entered: [STARTED, 'entered:channel:now ENG-2'] },
  { origin: { kind: 'scheduled-trigger' }, outcome: 'hands off first', drop: HANDING_OFF_FIRST, entered: [STARTED] },
]

for (const c of notHeldCases) {
  test(`It holds nothing for the band and ${c.outcome} for a ${c.origin.kind} prompt that names new work in ask mode`, ASK, async ($, on) => {
    const world = await ready($, on)
    const result = await submitFrom($, c.origin, 'now ENG-2')
    expect([dropOf(result), entered(world), world.box.text, world.effects.includes('fill:now ENG-2')]).toEqual([c.drop, c.entered, '', false])
  })
}

test('It logs a none record at the prompt point for a bridge prompt that names new work in ask mode', ASK, async ($, on) => {
  const world = await ready($, on)
  await submitPerson($, 'now ENG-2', { kind: 'bridge' })
  expect(lastRecord(world)).toMatchObject({ action: 'none', mode: 'active', trigger_values: { point: 'prompt', signal: 'strong' } })
})

test('It still hands a bridge prompt that names new work off first in act mode', ACT, async ($, on) => {
  const world = await ready($, on)
  const result = await submitPerson($, 'now ENG-2', { kind: 'bridge' })
  expect([dropOf(result), entered(world)]).toEqual([HANDING_OFF_FIRST, ['entered:composer:start on ENG-1']])
  await world.clock.settle()
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
  expect(lastRecord(world)).toMatchObject({ mode: 'active', action: 'none', trigger_values: { point: 'button', reason: 'send_here' } })
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
  expect(lastRecord(world)).toMatchObject({ mode: 'active', action: 'cleared', trigger_values: { point: 'button' } })
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
