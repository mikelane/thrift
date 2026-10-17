import { describe, expect, test } from 'claude-code/testing'

import { leftoverStripFields } from '../hooks/decision-record'
import { answered, holdFork, lastRecord, runCommand, submitPerson, writingTheNote } from './helpers'
import type { World } from './helpers'

type Kit = Parameters<typeof submitPerson>[0]

// The first prompt is dropped and left in the box; the second is typed at once, so the engine submits the two joined.
const holdFiveThenSix = async (world: World, $: Kit) => {
  await submitPerson($, 'five')
  await submitPerson($, 'six')
  await world.clock.settle()
}

describe('leftover_strips on the record that ends a handoff', () => {
  test('It counts one strip on a cleared record after a joined prompt is held without its leftover', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await holdFiveThenSix(world, $)
    await finishNote()
    expect(lastRecord(world).trigger_values).toMatchObject({ leftover_strips: 1 })
  })

  test('It counts one strip on the none record of an abandon when the strip happened while holding', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await holdFiveThenSix(world, $)
    await failNote()
    expect(lastRecord(world).trigger_values).toMatchObject({ reason: 'no_handoff_written', leftover_strips: 1 })
  })

  test('It leaves leftover_strips off a cleared record when no prompt was stripped', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'five')
    await finishNote()
    expect(Object.keys(lastRecord(world).trigger_values)).not.toContain('leftover_strips')
  })

  test('It leaves leftover_strips off a none record when no prompt was stripped', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'five')
    await failNote()
    expect(Object.keys(lastRecord(world).trigger_values)).not.toContain('leftover_strips')
  })

  test('It counts two strips when two joined prompts were held in one handoff', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'five')
    await submitPerson($, 'six')
    await submitPerson($, 'seven')
    await world.clock.settle()
    await finishNote()
    expect(lastRecord(world).trigger_values).toMatchObject({ leftover_strips: 2 })
  })

  test('It leaves leftover_strips off the next handoff after a handoff that stripped', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await holdFiveThenSix(world, $)
    await finishNote()
    const secondFork = holdFork(world)
    await runCommand($, 'handoff')
    await world.clock.settle()
    secondFork.release(answered('Second note.'))
    await world.clock.settle()
    expect(Object.keys(lastRecord(world).trigger_values)).not.toContain('leftover_strips')
  })
})

describe('leftoverStripFields', () => {
  test('It returns the count when at least one prompt was stripped', () => {
    expect(leftoverStripFields(3)).toEqual({ leftover_strips: 3 })
  })

  test('It returns no field when no prompt was stripped', () => {
    expect(leftoverStripFields(0)).toEqual({})
  })
})
