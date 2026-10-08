import { expect, test } from 'claude-code/testing'

import {
  growTo200k,
  install,
  lastRecord,
  startSession,
  submitPerson,
  runStep,
  usageOf,
} from './helpers'

const prepared = async ($: Parameters<typeof startSession>[0], on: Parameters<typeof install>[1], branch: string | null = null) => {
  const world = install($, on)
  world.branch = branch
  await startSession($)
  await growTo200k($, world)
  return world
}

const promptRecords = (world: Awaited<ReturnType<typeof prepared>>) =>
  world.records.filter(record => record.trigger_values.point === 'prompt')

test('It records a strong shadow signal when a prompt names a new ticket in off mode', async ($, on) => {
  const world = await prepared($, on, 'alice/eng-1-start')
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2')
  expect(promptRecords(world)).toHaveLength(1)
  expect(lastRecord(world)).toMatchObject({
    mode: 'shadow',
    action: 'none',
    trigger_values: { point: 'prompt', signal: 'strong', setting: 'off' },
  })
})

test('It lets the prompt through in off mode', async ($, on) => {
  const world = await prepared($, on, 'alice/eng-1-start')
  await submitPerson($, 'start on ENG-1')
  const result = await submitPerson($, 'now ENG-2')
  expect(result).toMatchObject({ text: 'now ENG-2' })
  expect(world.effects).toContain('entered:composer:now ENG-2')
})

test('It does not call the first prompt that names work new work', async ($, on) => {
  const world = await prepared($, on, 'alice/eng-1-start')
  await submitPerson($, 'start on ENG-1')
  expect(promptRecords(world)).toHaveLength(0)
})

test('It does not call the same ticket again new work', async ($, on) => {
  const world = await prepared($, on, 'alice/eng-1-start')
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'keep going on ENG-1')
  expect(promptRecords(world)).toHaveLength(0)
})

test('It does not call UTF-8 then UTF-16 new work', async ($, on) => {
  const world = await prepared($, on, 'alice/eng-1-start')
  await submitPerson($, 'handle UTF-8')
  await submitPerson($, 'then UTF-16')
  expect(promptRecords(world)).toHaveLength(0)
})

test('It does not call a ticket new work outside a git repo with no tracker URL', async ($, on) => {
  const world = await prepared($, on, null)
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2')
  expect(promptRecords(world)).toHaveLength(0)
})

test('It learns a ticket prefix from a Linear URL outside a git repo', async ($, on) => {
  const world = await prepared($, on, null)
  await submitPerson($, 'start on https://linear.app/acme/issue/ENG-1/fix-it')
  await submitPerson($, 'now ENG-2')
  expect(promptRecords(world)).toHaveLength(1)
})

test('It learns a ticket prefix from a Jira URL in a later prompt', async ($, on) => {
  const world = await prepared($, on, null)
  await submitPerson($, 'start on PR #5')
  await submitPerson($, 'now https://acme.atlassian.net/browse/OPS-9')
  expect(promptRecords(world)).toHaveLength(1)
})

test('It calls a new pull request new work', async ($, on) => {
  const world = await prepared($, on)
  await submitPerson($, 'review PR #12')
  await submitPerson($, 'now pull request 13')
  expect(promptRecords(world)).toHaveLength(1)
})

test('It does not call a bare number new work', async ($, on) => {
  const world = await prepared($, on)
  await submitPerson($, 'review PR #12')
  await submitPerson($, 'now #13')
  expect(promptRecords(world)).toHaveLength(0)
})

test('It reads the git branch only when a prompt holds a ticket-shaped token', async ($, on) => {
  const world = await prepared($, on, 'alice/eng-1-start')
  await submitPerson($, 'no ticket here')
  await submitPerson($, 'still nothing')
  expect(world.gitCalls).toBe(0)
  await submitPerson($, 'now ENG-1')
  expect(world.gitCalls).toBe(1)
})

test('It records a none signal when a prompt names new work under the threshold', async ($, on) => {
  const world = install($, on)
  world.branch = 'alice/eng-1-start'
  await startSession($)
  await runStep($, world, { usage: usageOf(1_000, 0, 9_000) })
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2')
  expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { point: 'prompt', signal: 'none' } })
})

test('It records a weak signal when a prompt names new work while background work runs', async ($, on) => {
  const world = await prepared($, on, 'alice/eng-1-start')
  world.agents = [{ id: 'a1', description: 'd', type: 't', status: 'running' }]
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2')
  expect(lastRecord(world)).toMatchObject({ trigger_values: { point: 'prompt', signal: 'weak', is_background_busy: true } })
})

test('It treats bridge and sdk prompts as the person', async ($, on) => {
  const world = await prepared($, on, 'alice/eng-1-start')
  await submitPerson($, 'start on ENG-1', { kind: 'bridge' })
  await submitPerson($, 'now ENG-2', { kind: 'sdk' })
  expect(promptRecords(world)).toHaveLength(1)
})

test('It ignores a prompt from another session', async ($, on) => {
  const world = await prepared($, on, 'alice/eng-1-start')
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2', { kind: 'peer' })
  expect(promptRecords(world)).toHaveLength(0)
})

test('It ignores a prompt from a plugin', async ($, on) => {
  const world = await prepared($, on, 'alice/eng-1-start')
  await submitPerson($, 'start on ENG-1')
  await $.prompt.submit({ text: 'now ENG-2', wait: false, origin: { kind: 'plugin', name: 'other' } })
  expect(promptRecords(world)).toHaveLength(0)
})

test('It does not evaluate a prompt typed while a turn runs', async ($, on) => {
  const world = await prepared($, on, 'alice/eng-1-start')
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2', { turnId: 't1' })
  expect(promptRecords(world)).toHaveLength(0)
})

test('It does not evaluate a prompt that carries attachments', async ($, on) => {
  const world = await prepared($, on, 'alice/eng-1-start')
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2', { attachments: [{ type: 'image', mediaType: 'image/png' }] })
  expect(promptRecords(world)).toHaveLength(0)
})

test('It does not evaluate a prompt that carries context', async ($, on) => {
  const world = await prepared($, on, 'alice/eng-1-start')
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2', { context: ['a note'] })
  expect(promptRecords(world)).toHaveLength(0)
})

test('It evaluates a prompt with an empty attachment list', async ($, on) => {
  const world = await prepared($, on, 'alice/eng-1-start')
  await submitPerson($, 'start on ENG-1')
  await submitPerson($, 'now ENG-2', { attachments: [], context: [] })
  expect(promptRecords(world)).toHaveLength(1)
})

test('It forgets what a session named once it ends', async ($, on) => {
  const world = await prepared($, on, 'alice/eng-1-start')
  await submitPerson($, 'start on ENG-1')
  await $.session.end({ reason: 'clear', sessionId: 'old-session', resume: { id: 'old-session' } })
  await growTo200k($, world)
  await submitPerson($, 'now ENG-2')
  expect(promptRecords(world)).toHaveLength(0)
})

test('It only logs a prompt under -p even in act mode', { options: { handoffMode: 'act' } }, async ($, on) => {
  const world = install($, on)
  world.branch = 'alice/eng-1-start'
  await startSession($, false)
  await growTo200k($, world)
  await submitPerson($, 'start on ENG-1')
  const result = await submitPerson($, 'now ENG-2')
  expect(result).toMatchObject({ text: 'now ENG-2' })
  expect(lastRecord(world)).toMatchObject({ action: 'none', trigger_values: { point: 'prompt', signal: 'strong', setting: 'act' } })
})
