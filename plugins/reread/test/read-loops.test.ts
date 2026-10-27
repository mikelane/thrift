import { describe, expect, test } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'

import { install, isStub, lastRecord, putFile, read, SEVEN_LINES, triggerValues } from './world'

const ACT = { options: { readMode: 'act' } }

describe('the main loop and a subagent', () => {
  test('It does not answer a subagent from a read the main loop made', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts')
    const inAgent = await read($, '/work/a.ts', { agentId: 'agent-1' })
    expect(isStub(inAgent)).toBe(false)
  })

  test('It does not answer the main loop from a read a subagent made', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts', { agentId: 'agent-1' })
    const inMain = await read($, '/work/a.ts')
    expect(isStub(inMain)).toBe(false)
  })

  test('It answers a subagent from its own earlier read', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts', { agentId: 'agent-1' })
    const again = await read($, '/work/a.ts', { agentId: 'agent-1' })
    expect(isStub(again)).toBe(true)
  })

  test('It keeps two subagents apart', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts', { agentId: 'agent-1' })
    const other = await read($, '/work/a.ts', { agentId: 'agent-2' })
    expect(isStub(other)).toBe(false)
  })

  test('It records a subagent read as is_subagent', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts', { agentId: 'agent-1' })
    expect(triggerValues(world).is_subagent).toBe(true)
  })

  test('It checks a subagent stub against that subagent’s conversation', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts', { agentId: 'agent-1' })
    world.contexts.set('agent-1', [])
    const again = await read($, '/work/a.ts', { agentId: 'agent-1' })
    expect([isStub(again), triggerValues(world).reason]).toEqual([false, 'not_in_context'])
  })

  test('It passes when a subagent’s conversation cannot be read', ACT, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    await read($, '/work/a.ts', { agentId: 'agent-1' })
    world.deniedAgents.add('agent-1')
    const again = await read($, '/work/a.ts', { agentId: 'agent-1' })
    expect([isStub(again), triggerValues(world).reason]).toEqual([false, 'not_in_context'])
  })
})

// An inline plugin that raises a Read of its own, as a plugin's `$.tool.call` does.
const CALLER: Plugin = {
  name: 'caller',
  register(on) {
    on('prompt.submit', async ($, e, next) => {
      await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })
      return next(e)
    })
  },
}

describe('a Read raised by another plugin', () => {
  test('It is passed through and recorded as plugin_call', { options: { readMode: 'act' }, plugins: [CALLER] }, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    on('prompt.submit', (_$, e) => ({ text: e.text }))
    await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
    expect([world.readsThatRan.length, triggerValues(world).reason]).toEqual([1, 'plugin_call'])
  })

  test('It is not tracked, so the model’s first Read is still a first read', { options: { readMode: 'act' }, plugins: [CALLER] }, async ($, on) => {
    const world = install($, on)
    putFile(world, '/work/a.ts', SEVEN_LINES)
    on('prompt.submit', (_$, e) => ({ text: e.text }))
    await $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } })
    await read($, '/work/a.ts')
    expect(lastRecord(world).trigger_values.reason).toBe('first_read')
  })
})
