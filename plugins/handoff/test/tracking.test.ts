import { expect, test } from 'claude-code/testing'

import { bash, completeTurn, growTo200k, install, lastRecord, notify, startSession, tool } from './helpers'

const finishingCommands = [
  'git commit -m "x"',
  'git push',
  'gh pr create --title t',
  'gh pr merge 5 --squash',
  'cd repo && git -C ../other commit -m x',
] as const

for (const command of finishingCommands) {
  test(`It records a strong signal after the main session runs ${command}`, async ($, on) => {
    const world = install($, on)
    await startSession($)
    await growTo200k($, world)
    await bash($, world, command)
    await completeTurn($)
    expect(lastRecord(world).trigger_values.signal).toBe('strong')
  })
}

const quietCommands = ['git status', 'git push --dry-run', 'echo "git commit -m x"', 'ls'] as const

for (const command of quietCommands) {
  test(`It records a weak signal after the main session runs ${command}`, async ($, on) => {
    const world = install($, on)
    await startSession($)
    await growTo200k($, world)
    await bash($, world, command)
    await completeTurn($)
    expect(lastRecord(world).trigger_values.signal).toBe('weak')
  })
}

test('It records a weak signal when the commit failed', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x', { mode: 'error' })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.signal).toBe('weak')
})

test('It records a weak signal when a plugin denied the commit', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x', { mode: 'deny' })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.signal).toBe('weak')
})

test('It records a weak signal when the commit ran in a subagent', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x', { agentId: 'sub-1' })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.signal).toBe('weak')
})

test('It records a weak signal when the push moved to the background', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git push', { result: { backgroundTaskId: 'bg1' } })
  await completeTurn($)
  expect(lastRecord(world).trigger_values).toMatchObject({ signal: 'weak', is_background_busy: true })
})

test('It keeps a finished task when a subagent turn completes before the main turn', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($, { agentId: 'sub-1' })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.signal).toBe('strong')
})

test('It forgets a finished task after the turn that ran it', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await completeTurn($)
  await completeTurn($)
  expect(lastRecord(world).trigger_values.signal).toBe('weak')
})

test('It marks background work busy for a Bash task id', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await bash($, world, 'sleep 100', { result: { backgroundTaskId: 'bg_1-a' } })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.is_background_busy).toBe(true)
})

test('It marks background work busy for a Monitor task id', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await tool($, world, 'Monitor', { command: 'tail -f log' }, { result: { taskId: 'mon1', timeoutMs: 0 } })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.is_background_busy).toBe(true)
})

const invalidIds = ['', 'has space', 'semi;colon', 'new\nline', 42, null] as const

for (const id of invalidIds) {
  test(`It ignores the background task id ${JSON.stringify(id)}`, async ($, on) => {
    const world = install($, on)
    await startSession($)
    await bash($, world, 'sleep 100', { result: { backgroundTaskId: id } })
    await completeTurn($)
    expect(lastRecord(world).trigger_values.is_background_busy).toBe(false)
  })
}

test('It ignores a result that is not an object when it looks for a task id', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await bash($, world, 'sleep 100', { result: 'text result' })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.is_background_busy).toBe(false)
})

test('It marks the task done when a task-notification prompt names it', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await bash($, world, 'sleep 100', { result: { backgroundTaskId: 'bg1' } })
  await notify($, 'bg1')
  await completeTurn($)
  expect(lastRecord(world).trigger_values.is_background_busy).toBe(false)
})

test('It keeps the task when a task-notification names another task', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await bash($, world, 'sleep 100', { result: { backgroundTaskId: 'bg1' } })
  await notify($, 'bg2')
  await completeTurn($)
  expect(lastRecord(world).trigger_values.is_background_busy).toBe(true)
})

test('It passes a task-notification prompt through unchanged', async ($, on) => {
  install($, on)
  await startSession($)
  expect(await notify($, 'bg1')).toMatchObject({ text: expect.stringContaining('bg1') })
})

test('It keeps the task when a task-notification carries no task id', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await bash($, world, 'sleep 100', { result: { backgroundTaskId: 'bg1' } })
  await $.prompt.submit({ text: 'no ids here', wait: false, origin: { kind: 'task-notification' } })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.is_background_busy).toBe(true)
})

const stoppers = [
  ['TaskStop', { task_id: 'bg1' }],
  ['TaskStop', { shell_id: 'bg1' }],
  ['KillShell', { shell_id: 'bg1' }],
  ['KillShell', { task_id: 'bg1' }],
] as const

for (const [name, input] of stoppers) {
  test(`It marks the task done when ${name} stops it with ${Object.keys(input)[0]}`, async ($, on) => {
    const world = install($, on)
    await startSession($)
    await bash($, world, 'sleep 100', { result: { backgroundTaskId: 'bg1' } })
    await tool($, world, name, input)
    await completeTurn($)
    expect(lastRecord(world).trigger_values.is_background_busy).toBe(false)
  })
}

test('It marks the task done even when the stop call failed', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await bash($, world, 'sleep 100', { result: { backgroundTaskId: 'bg1' } })
  await tool($, world, 'TaskStop', { task_id: 'bg1' }, { mode: 'error' })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.is_background_busy).toBe(false)
})

test('It ignores a stop call with an invalid task id', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await bash($, world, 'sleep 100', { result: { backgroundTaskId: 'bg1' } })
  await tool($, world, 'TaskStop', { task_id: 'bad id' })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.is_background_busy).toBe(true)
})

test('It ignores other tools', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await tool($, world, 'Read', { file_path: '/a' })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.is_background_busy).toBe(false)
})

const agentStatuses = [
  ['pending', true],
  ['running', true],
  ['waiting', true],
  ['idle', false],
  ['completed', false],
  ['failed', false],
  ['killed', false],
] as const

for (const [status, expected] of agentStatuses) {
  test(`It marks background work ${expected ? 'busy' : 'idle'} for an agent that is ${status}`, async ($, on) => {
    const world = install($, on)
    world.agents = [{ id: 'a1', description: 'd', type: 't', status }]
    await startSession($)
    await completeTurn($)
    expect(lastRecord(world).trigger_values.is_background_busy).toBe(expected)
  })
}

test('It marks background work busy when the agent list cannot be read', async ($, on) => {
  const world = install($, on)
  world.agentListThrows = true
  await startSession($)
  await completeTurn($)
  expect(lastRecord(world).trigger_values.is_background_busy).toBe(true)
})

test('It forgets tasks, finished work, and context at the end of a session', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await growTo200k($, world)
  await bash($, world, 'git commit -m x')
  await bash($, world, 'sleep 100', { result: { backgroundTaskId: 'bg1' } })
  await $.session.end({ reason: 'clear', sessionId: 'old-session', resume: { id: 'old-session' } })
  await completeTurn($)
  expect(lastRecord(world).trigger_values).toMatchObject({ context_tokens: 0, signal: 'none', is_background_busy: false })
})

test('It keeps a task busy when the stop call was denied before it ran', async ($, on) => {
  const world = install($, on)
  await startSession($)
  await bash($, world, 'sleep 100', { result: { backgroundTaskId: 'bg1' } })
  await tool($, world, 'TaskStop', { task_id: 'bg1' }, { mode: 'deny' })
  await completeTurn($)
  expect(lastRecord(world).trigger_values.is_background_busy).toBe(true)
})
