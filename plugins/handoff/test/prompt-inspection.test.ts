import { describe, expect, test } from 'claude-code/testing'

import { growTo200k, install, startSession, submitPerson, type World } from './helpers'

const promptRecords = (world: World) => world.records.filter(record => record.trigger_values.point === 'prompt')

describe('inspectPrompt', () => {
  test('It calls a ticket of the branch that the session has not seen new work', async ($, on) => {
    const world = install($, on)
    world.branch = 'alice/eng-1-start'
    await startSession($)
    await growTo200k($, world)
    await submitPerson($, 'start on ENG-1')
    await submitPerson($, 'now ENG-2')
    expect(promptRecords(world)).toHaveLength(1)
  })

  test('It does not call a ticket the session has seen new work', async ($, on) => {
    const world = install($, on)
    world.branch = 'alice/eng-1-start'
    await startSession($)
    await growTo200k($, world)
    await submitPerson($, 'start on ENG-1')
    await submitPerson($, 'keep going on ENG-1')
    expect(promptRecords(world)).toHaveLength(0)
  })

  test('It learns a ticket prefix from a tracker URL when there is no branch', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await growTo200k($, world)
    await submitPerson($, 'start on https://linear.app/acme/issue/ENG-1/fix-it')
    await submitPerson($, 'now ENG-2')
    expect(promptRecords(world)).toHaveLength(1)
  })

  test('It reads no branch for a prompt with no ticket-shaped token', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await submitPerson($, 'just talk')
    expect(world.gitCalls).toBe(0)
  })

  test('It treats a branch that cannot be read as no branch', async ($, on) => {
    const world = install($, on)
    world.gitThrows = true
    await startSession($)
    await growTo200k($, world)
    await submitPerson($, 'start on ENG-1')
    await submitPerson($, 'now ENG-2')
    expect(promptRecords(world)).toHaveLength(0)
  })

  test('It says why when the branch cannot be read', async ($, on) => {
    const world = install($, on)
    world.gitThrows = true
    await startSession($)
    await submitPerson($, 'start on ENG-1')
    expect(world.debugLines.some(line => line.startsWith('handoff: could not read the git branch'))).toBe(true)
  })
})
