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
    world,
    clearsWith: () => finishWith(answered('The handoff note.')),
    abandonsWith: () => finishWith({ isAnswered: false, reason: 'nothing-to-fork' }),
  }
}

// The secret must reach an effect first, or a test that it stays out of the record proves nothing.
const expectSecretTravelled = (world: World) => {
  expect(world.effects.join('\n')).toContain('zebra-quartz-7731')
}

const enteredTexts = (world: World): string[] =>
  world.effects.filter(effect => effect.startsWith('entered:plugin:')).map(effect => effect.slice('entered:plugin:'.length))

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
    expectSecretTravelled(world)
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

  test('It records held_groups 1 on the none record when the abandoned handoff carries a held prompt', ASK, async ($, on) => {
    const world = install($, on)
    const pending = holdFork(world)
    world.branch = 'alice/eng-1-start'
    await startSession($)
    await growTo200k($, world)
    await submitPerson($, 'start on ENG-1')
    await submitPerson($, 'now ENG-2')
    await runCommand($, 'handoff')
    await world.clock.settle()
    pending.release({ isAnswered: false, reason: 'nothing-to-fork' })
    await world.clock.settle()
    expect(lastRecordOf(world, 'none').trigger_values).toMatchObject({ reason: 'no_handoff_written', held_groups: 1, held_unattended: false })
  })

  test('It keeps the held prompt text out of the serialized none record', async ($, on) => {
    const { abandonsWith } = await handoffWithHeld($, on, ['person', 'scheduled'])
    const world = await abandonsWith()
    expectSecretTravelled(world)
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

describe('held_other_delivery on a cleared record', () => {
  const deliveryCases = [
    { name: 'nothing was held', held: [], expected: 'none' },
    { name: 'a person group was submitted after the appended note', held: ['person'], expected: 'submitted' },
    { name: 'a scheduled group was submitted after the appended note', held: ['scheduled'], expected: 'submitted' },
    { name: 'both groups were submitted after the appended note', held: ['person', 'scheduled'], expected: 'submitted' },
  ] as const

  for (const { name, held, expected } of deliveryCases) {
    test(`It records held_other_delivery ${expected} when ${name}`, async ($, on) => {
      const { clearsWith } = await handoffWithHeld($, on, held)
      expect(lastRecordOf(await clearsWith(), 'cleared').trigger_values.held_other_delivery).toBe(expected)
    })
  }

  test('It records held_other_delivery in_box when a refused person group goes back to the box', async ($, on) => {
    const { world, clearsWith } = await handoffWithHeld($, on, ['person'])
    world.submitDropped = true
    expect(lastRecordOf(await clearsWith(), 'cleared').trigger_values.held_other_delivery).toBe('in_box')
  })

  test('It records held_other_delivery not_carried when a refused scheduled group has no box to go to', async ($, on) => {
    const { world, clearsWith } = await handoffWithHeld($, on, ['scheduled'])
    world.submitDropped = true
    expect(lastRecordOf(await clearsWith(), 'cleared').trigger_values.held_other_delivery).toBe('not_carried')
  })

  test('It records held_other_delivery not_carried when a refused person group finds the box unavailable', async ($, on) => {
    const { world, clearsWith } = await handoffWithHeld($, on, ['person'])
    world.submitDropped = true
    world.fillRefusal = 'dialog'
    expect(lastRecordOf(await clearsWith(), 'cleared').trigger_values.held_other_delivery).toBe('not_carried')
  })

  test('It records the worse outcome when one group is submitted and the other is not carried', async ($, on) => {
    const { world, clearsWith } = await handoffWithHeld($, on, ['person', 'scheduled'])
    world.submitHooks = [undefined, () => {
      world.submitDropped = true
    }]
    expect(lastRecordOf(await clearsWith(), 'cleared').trigger_values.held_other_delivery).toBe('not_carried')
    expect(enteredTexts(world)).toEqual([SECRET_PROMPT])
  })

  test('It records held_other_delivery none when the note carried the only held group', async ($, on) => {
    const { world, clearsWith } = await handoffWithHeld($, on, ['person'])
    world.appendDenied = true
    expect(lastRecordOf(await clearsWith(), 'cleared').trigger_values).toMatchObject({ note: 'submitted', held_other_delivery: 'none' })
    expect(enteredTexts(world)).toHaveLength(1)
    expect(enteredTexts(world)[0]).toMatch(new RegExp(`\n\n${SECRET_PROMPT}$`))
  })

  test('It records the delivery of the group that did not ride with the note', async ($, on) => {
    const { world, clearsWith } = await handoffWithHeld($, on, ['person', 'scheduled'])
    world.appendDenied = true
    world.submitHooks = [undefined, () => {
      world.submitDropped = true
    }]
    const record = lastRecordOf(await clearsWith(), 'cleared')
    expect(record.trigger_values).toMatchObject({ note: 'submitted', held_other_delivery: 'not_carried' })
  })

  test('It keeps the held prompt text out of the serialized record when delivery fails', async ($, on) => {
    const { world, clearsWith } = await handoffWithHeld($, on, ['person', 'scheduled'])
    world.submitDropped = true
    const record = lastRecordOf(await clearsWith(), 'cleared')
    expectSecretTravelled(world)
    expect(JSON.stringify(record)).not.toContain('zebra-quartz-7731')
  })
})

describe('held_restore on an abandoned record', () => {
  const restoreCases = [
    { name: 'nothing was held', held: [], expected: 'none' },
    { name: 'a person group went back to the box', held: ['person'], expected: 'in_box' },
    { name: 'a scheduled group was submitted', held: ['scheduled'], expected: 'submitted' },
    { name: 'a person group went back to the box and a scheduled group was submitted', held: ['person', 'scheduled'], expected: 'in_box' },
  ] as const

  for (const { name, held, expected } of restoreCases) {
    test(`It records held_restore ${expected} when ${name}`, async ($, on) => {
      const { abandonsWith } = await handoffWithHeld($, on, held)
      expect(lastRecordOf(await abandonsWith(), 'none').trigger_values.held_restore).toBe(expected)
    })
  }

  test('It records held_restore submitted when the box refuses a person group', async ($, on) => {
    const { world, abandonsWith } = await handoffWithHeld($, on, ['person'])
    world.fillRefusal = 'dialog'
    expect(lastRecordOf(await abandonsWith(), 'none').trigger_values.held_restore).toBe('submitted')
  })

  test('It records held_restore not_carried when a scheduled group is refused', async ($, on) => {
    const { world, abandonsWith } = await handoffWithHeld($, on, ['scheduled'])
    world.submitDropped = true
    expect(lastRecordOf(await abandonsWith(), 'none').trigger_values.held_restore).toBe('not_carried')
  })

  test('It records held_restore not_carried when neither the box nor a submit takes a person group', async ($, on) => {
    const { world, abandonsWith } = await handoffWithHeld($, on, ['person'])
    world.fillRefusal = 'dialog'
    world.submitDropped = true
    expect(lastRecordOf(await abandonsWith(), 'none').trigger_values.held_restore).toBe('not_carried')
  })

  test('It leaves held_other_delivery off an abandoned record', async ($, on) => {
    const { abandonsWith } = await handoffWithHeld($, on, ['person'])
    expect(Object.keys(lastRecordOf(await abandonsWith(), 'none').trigger_values)).not.toContain('held_other_delivery')
  })

  test('It leaves held_restore off a cleared record', async ($, on) => {
    const { clearsWith } = await handoffWithHeld($, on, ['person'])
    expect(Object.keys(lastRecordOf(await clearsWith(), 'cleared').trigger_values)).not.toContain('held_restore')
  })

  test('It keeps the held prompt text out of the serialized record when the restore fails', async ($, on) => {
    const { world, abandonsWith } = await handoffWithHeld($, on, ['person', 'scheduled'])
    world.fillRefusal = 'dialog'
    world.submitDropped = true
    const record = lastRecordOf(await abandonsWith(), 'none')
    expectSecretTravelled(world)
    expect(JSON.stringify(record)).not.toContain('zebra-quartz-7731')
  })
})

describe('session_id on an abandoned record', () => {
  test('It records the session the handoff began in when a restore runs past a session change', async ($, on) => {
    const { world, abandonsWith } = await handoffWithHeld($, on, ['scheduled'])
    world.submitHooks = [
      () => {
        world.sessionId = world.nextSessionId
      },
    ]
    expect(lastRecordOf(await abandonsWith(), 'none').session_id).toBe('old-session')
  })
})

describe('handoff_unattended on the records that end a handoff', () => {
  const unattendedHandoff = async ($: Engine, on: On) => {
    const world = install($, on)
    const pending = holdFork(world)
    world.branch = 'alice/eng-1-start'
    await startSession($)
    await growTo200k($, world)
    await submitPerson($, 'start on ENG-1')
    await submitPerson($, 'now ENG-2', { kind: 'scheduled-trigger' })
    await world.clock.settle()
    return { world, pending }
  }

  test('It records handoff_unattended false on a cleared record of an attended handoff', async ($, on) => {
    const { clearsWith } = await handoffWithHeld($, on, ['person'])
    expect(lastRecordOf(await clearsWith(), 'cleared').trigger_values.handoff_unattended).toBe(false)
  })

  test('It records handoff_unattended false on an abandoned record of an attended handoff', async ($, on) => {
    const { abandonsWith } = await handoffWithHeld($, on, ['scheduled'])
    expect(lastRecordOf(await abandonsWith(), 'none').trigger_values.handoff_unattended).toBe(false)
  })

  test('It records handoff_unattended true on a cleared record of an unattended handoff', ASK, async ($, on) => {
    const { world, pending } = await unattendedHandoff($, on)
    pending.release(answered('The handoff note.'))
    await world.clock.settle()
    expect(lastRecordOf(world, 'cleared').trigger_values.handoff_unattended).toBe(true)
  })

  test('It records handoff_unattended true on an abandoned record of an unattended handoff', ASK, async ($, on) => {
    const { world, pending } = await unattendedHandoff($, on)
    pending.release({ isAnswered: false, reason: 'nothing-to-fork' })
    await world.clock.settle()
    expect(lastRecordOf(world, 'none').trigger_values.handoff_unattended).toBe(true)
  })
})
