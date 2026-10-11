import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelForkResult, On } from 'claude-code'

import { heldGroupFields } from '../hooks/decision-record'
import { answered, completeTurn, install, lastRecord, runCommand, startSession, startTurn, submitPerson, type World } from './helpers'

const SECRET_PROMPT = 'zebra-quartz-7731 rotate the staging credentials'

type HeldKind = 'person' | 'scheduled'

const SUBMISSIONS: Record<HeldKind, ($: Engine) => Promise<unknown>> = {
  person: $ => submitPerson($, SECRET_PROMPT),
  scheduled: $ => submitPerson($, `${SECRET_PROMPT} nightly`, { kind: 'scheduled-trigger' }),
}

const handoffWithHeld = async ($: Engine, on: On, held: readonly HeldKind[]) => {
  const world: World = install($, on)
  const pending: { release: (result: ModelForkResult) => void } = { release: () => undefined }
  world.fork = () =>
    new Promise<ModelForkResult>(resolve => {
      pending.release = resolve
    })
  await startSession($)
  await runCommand($, 'handoff')
  await world.clock.settle()
  for (const kind of held) await SUBMISSIONS[kind]($)
  const finishWith = async (result: ModelForkResult) => {
    pending.release(result)
    await world.clock.settle()
    return world
  }
  return {
    clearsWith: () => finishWith(answered('The handoff note.')),
    abandonsWith: () => finishWith({ isAnswered: false, reason: 'nothing-to-fork' }),
  }
}

const groupCases = [
  { name: 'nothing was held', held: [], groups: 0, unattended: false },
  { name: 'a person group was held', held: ['person'], groups: 1, unattended: false },
  { name: 'a scheduled group was held', held: ['scheduled'], groups: 1, unattended: true },
  { name: 'a person and a scheduled group were held', held: ['person', 'scheduled'], groups: 2, unattended: true },
] as const

describe('heldGroupFields', () => {
  for (const { name, held, groups, unattended } of groupCases) {
    test(`It returns held_groups ${groups} and held_unattended ${unattended} when ${name}`, () => {
      const heldGroups = held.map(kind => ({ text: kind, isUnattended: kind === 'scheduled' }))
      expect(heldGroupFields(heldGroups)).toEqual({ held_groups: groups, held_unattended: unattended })
    })
  }
})

describe('held-prompt fields on a cleared record', () => {
  for (const { name, held, groups, unattended } of groupCases) {
    test(`It records held_groups ${groups} and held_unattended ${unattended} when ${name}`, async ($, on) => {
      const { clearsWith } = await handoffWithHeld($, on, held)
      const record = lastRecordOf(await clearsWith(), 'cleared')
      expect(record.trigger_values).toMatchObject({ held_groups: groups, held_unattended: unattended })
    })
  }

  test('It keeps the held prompt text out of the serialized cleared record', async ($, on) => {
    const { clearsWith } = await handoffWithHeld($, on, ['person', 'scheduled'])
    const world = await clearsWith()
    expect(JSON.stringify(lastRecordOf(world, 'cleared'))).not.toContain('zebra-quartz-7731')
  })
})

describe('held-prompt fields on an abandoned record', () => {
  for (const { name, held, groups, unattended } of groupCases) {
    test(`It records held_groups ${groups} and held_unattended ${unattended} on a none record when ${name}`, async ($, on) => {
      const { abandonsWith } = await handoffWithHeld($, on, held)
      const record = lastRecordOf(await abandonsWith(), 'none')
      expect(record.trigger_values).toMatchObject({ held_groups: groups, held_unattended: unattended })
    })
  }

  test('It keeps the held prompt text out of the serialized none record', async ($, on) => {
    const { abandonsWith } = await handoffWithHeld($, on, ['person', 'scheduled'])
    const world = await abandonsWith()
    expect(JSON.stringify(lastRecordOf(world, 'none'))).not.toContain('zebra-quartz-7731')
  })
})

describe('records not written by a handoff', () => {
  test('It leaves the held-prompt fields off a turn-end none record', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await startTurn($)
    await completeTurn($)
    await world.clock.settle()
    const keys = Object.keys(lastRecord(world).trigger_values)
    expect(keys).not.toContain('held_groups')
    expect(keys).not.toContain('held_unattended')
  })
})

const lastRecordOf = (world: World, action: string) => {
  const record = world.records.filter(candidate => candidate.action === action).at(-1)
  if (record === undefined) throw new Error(`no ${action} record was written`)
  return record
}
