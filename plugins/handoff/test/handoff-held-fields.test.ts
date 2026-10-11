import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelForkResult, On } from 'claude-code'

import { heldGroupFields, type DecisionAction } from '../hooks/decision-record'
import type { HeldPromptGroup } from '../hooks/session-state'
import {
  answered,
  growTo200k,
  install,
  lastRecord,
  runCommand,
  startSession,
  submitPerson,
  type LogRecord,
  type World,
} from './helpers'

const ASK = { options: { handoffMode: 'ask' } } as const
const COMPACTING = { options: { compactBeforeClear: true } } as const
const SECRET_PROMPT = 'zebra-quartz-7731 rotate the staging credentials'

type HeldKind = 'person' | 'person again' | 'scheduled'

const GROUP_OF: Record<HeldKind, HeldPromptGroup> = {
  person: { text: SECRET_PROMPT, isUnattended: false },
  'person again': { text: `${SECRET_PROMPT} again`, isUnattended: false },
  scheduled: { text: `${SECRET_PROMPT} nightly`, isUnattended: true },
}

const SUBMISSIONS: Record<HeldKind, ($: Engine) => Promise<unknown>> = {
  person: $ => submitPerson($, GROUP_OF.person.text),
  'person again': $ => submitPerson($, GROUP_OF['person again'].text),
  scheduled: $ => submitPerson($, GROUP_OF.scheduled.text, { kind: 'scheduled-trigger' }),
}

const holdFork = (world: World) => {
  const pending: { release: (result: ModelForkResult) => void } = { release: () => undefined }
  world.fork = () =>
    new Promise<ModelForkResult>(resolve => {
      pending.release = resolve
    })
  return pending
}

const handoffWithHeld = async ($: Engine, on: On, held: readonly HeldKind[]) => {
  const world = install($, on)
  const pending = holdFork(world)
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

const lastRecordOf = (world: World, action: DecisionAction): LogRecord => {
  const record = world.records.filter(candidate => candidate.action === action).at(-1)
  if (record === undefined) throw new Error(`no ${action} record was written`)
  return record
}

const groupCases = [
  { name: 'nothing was held', held: [], groupCount: 0, isUnattended: false },
  { name: 'a person group was held', held: ['person'], groupCount: 1, isUnattended: false },
  { name: 'a scheduled group was held', held: ['scheduled'], groupCount: 1, isUnattended: true },
  { name: 'a person and a scheduled group were held', held: ['person', 'scheduled'], groupCount: 2, isUnattended: true },
  { name: 'a scheduled and a person group were held', held: ['scheduled', 'person'], groupCount: 2, isUnattended: true },
] as const

describe('heldGroupFields', () => {
  for (const { name, held, groupCount, isUnattended } of groupCases) {
    test(`It returns held_groups ${groupCount} and held_unattended ${isUnattended} when ${name}`, () => {
      expect(heldGroupFields(held.map(kind => GROUP_OF[kind]))).toEqual({
        held_groups: groupCount,
        held_unattended: isUnattended,
      })
    })
  }
})

describe('held-prompt fields on a cleared record', () => {
  for (const { name, held, groupCount, isUnattended } of groupCases) {
    test(`It records held_groups ${groupCount} and held_unattended ${isUnattended} when ${name}`, async ($, on) => {
      const { clearsWith } = await handoffWithHeld($, on, held)
      const record = lastRecordOf(await clearsWith(), 'cleared')
      expect(record.trigger_values).toMatchObject({ held_groups: groupCount, held_unattended: isUnattended })
    })
  }

  test('It records held_groups 1 when two person prompts with different texts were held', async ($, on) => {
    const { clearsWith } = await handoffWithHeld($, on, ['person', 'person again'])
    const record = lastRecordOf(await clearsWith(), 'cleared')
    expect(record.trigger_values).toMatchObject({ held_groups: 1, held_unattended: false })
  })

  test('It records held_groups 1 on the cleared record when the handoff carries a held prompt', ASK, async ($, on) => {
    const world = install($, on)
    const pending = holdFork(world)
    world.branch = 'alice/eng-1-start'
    await startSession($)
    await growTo200k($, world)
    await submitPerson($, 'start on ENG-1')
    await submitPerson($, 'now ENG-2')
    await runCommand($, 'handoff')
    await world.clock.settle()
    expect(world.effects.filter(effect => effect.startsWith('entered:plugin:'))).toEqual([])
    pending.release(answered('The handoff note.'))
    await world.clock.settle()
    expect(lastRecordOf(world, 'cleared').trigger_values).toMatchObject({ held_groups: 1, held_unattended: false })
  })

  test('It keeps the held prompt text out of the serialized cleared record', async ($, on) => {
    const { clearsWith } = await handoffWithHeld($, on, ['person', 'scheduled'])
    const world = await clearsWith()
    expect(JSON.stringify(lastRecordOf(world, 'cleared'))).not.toContain('zebra-quartz-7731')
  })
})

describe('held-prompt fields on an abandoned record', () => {
  for (const { name, held, groupCount, isUnattended } of groupCases) {
    test(`It records held_groups ${groupCount} and held_unattended ${isUnattended} on a no_handoff_written none record when ${name}`, async ($, on) => {
      const { abandonsWith } = await handoffWithHeld($, on, held)
      const record = lastRecordOf(await abandonsWith(), 'none')
      expect(record.trigger_values).toMatchObject({
        reason: 'no_handoff_written',
        held_groups: groupCount,
        held_unattended: isUnattended,
      })
    })
  }

  test('It keeps the held prompt text out of the serialized none record', async ($, on) => {
    const { abandonsWith } = await handoffWithHeld($, on, ['person', 'scheduled'])
    const world = await abandonsWith()
    expect(JSON.stringify(lastRecordOf(world, 'none'))).not.toContain('zebra-quartz-7731')
  })
})

describe('records not written at the end of a handoff', () => {
  test('It leaves the held-prompt fields off a turn-end none record', async ($, on) => {
    const world = install($, on)
    await startSession($)
    await $.turn.start({ text: 'work', turnId: 't1' })
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await world.clock.settle()
    expect(Object.keys(lastRecord(world).trigger_values)).not.toContain('held_groups')
    expect(Object.keys(lastRecord(world).trigger_values)).not.toContain('held_unattended')
  })

  test('It leaves the held-prompt fields off a compaction_vetoed record written mid-handoff', COMPACTING, async ($, on) => {
    const world = install($, on)
    world.compact = async () => ({ skip: 'vetoed' })
    await startSession($)
    await runCommand($, 'handoff')
    await world.clock.settle()
    const record = lastRecordOf(world, 'none')
    expect(record.trigger_values.reason).toBe('compaction_vetoed')
    expect(Object.keys(record.trigger_values)).not.toContain('held_groups')
    expect(Object.keys(record.trigger_values)).not.toContain('held_unattended')
  })

  test('It leaves the held-prompt fields off a compaction_failed record written mid-handoff', COMPACTING, async ($, on) => {
    const world = install($, on)
    world.compact = async () => {
      throw new Error('compaction failed')
    }
    await startSession($)
    await runCommand($, 'handoff')
    await world.clock.settle()
    const record = lastRecordOf(world, 'none')
    expect(record.trigger_values.reason).toBe('compaction_failed')
    expect(Object.keys(record.trigger_values)).not.toContain('held_groups')
    expect(Object.keys(record.trigger_values)).not.toContain('held_unattended')
  })
})
