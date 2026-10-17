import { describe, expect, test } from 'claude-code/testing'

import { bash, completeTurn, install, lastRecord, startSession } from './helpers'

describe('isBackgroundBusy', () => {
  test('It returns true for a tracked background task without asking for the agent list', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await bash($, world, 'sleep 100', { result: { backgroundTaskId: 'bg1' } })
    world.agentListThrows = true
    await completeTurn($)
    expect(world.debugLines.some(line => line.includes('could not list agents'))).toBe(false)
  })

  test('It returns true for a running agent', async ($, on) => {
    const world = install($, on)
    world.agents = [{ id: 'a1', description: 'd', type: 't', status: 'running' }]
    await startSession($)
    await completeTurn($)
    expect(lastRecord(world).trigger_values.is_background_busy).toBe(true)
  })

  test('It returns false for a completed agent', async ($, on) => {
    const world = install($, on)
    world.agents = [{ id: 'a1', description: 'd', type: 't', status: 'completed' }]
    await startSession($)
    await completeTurn($)
    expect(lastRecord(world).trigger_values.is_background_busy).toBe(false)
  })

  test('It says why it treats background work as busy when the agent list cannot be read', async ($, on) => {
    const world = install($, on)
    world.agentListThrows = true
    await startSession($)
    await completeTurn($)
    expect(world.debugLines.some(line => line.startsWith('handoff: could not list agents, treating background work as busy: '))).toBe(true)
  })
})
