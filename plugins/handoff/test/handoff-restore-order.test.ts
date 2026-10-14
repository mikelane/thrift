import { describe, expect, test } from 'claude-code/testing'

import { groupHeldPrompts } from '../hooks/handoff-note'
import type { HeldPrompt } from '../hooks/session-state'
import { answered, bash, runCommand, completeTurn, dropOf, growTo200k, holdFork, install, lastRecord, startSession, submitPerson, writingTheNote, type World } from './helpers'
import { ACT, actHandoffWhileWritingTheNote, endTurn } from './wait-for-turn-helpers'

const HELD_FOR_HANDOFF = "A handoff is in progress, so your prompt is held. It is sent when the handoff ends, or, if the handoff fails and a person sent it, put in this terminal's prompt box. If that can't be done, it is kept another way, at worst in the transcript."

const entered = (world: World) => world.effects.filter(effect => effect.startsWith('entered:'))

type Arrival = { text: string; kind?: 'composer' | 'bridge' | 'scheduled-trigger' }

// One-shot callbacks, one per upcoming prompt.submit in order: each lets its prompt arrive while the restore is submitting.
const arriveDuringSubmits = ($: Parameters<typeof submitPerson>[0], world: World, arrivals: Arrival[]) => {
  const results: Array<Promise<unknown>> = []
  world.submitHooks = arrivals.map(({ text, kind = 'composer' }) => () => {
    results.push(submitPerson($, text, { kind }))
  })
  return results
}

describe('prompts that arrive while an abandoned handoff restores its held prompts', () => {
  test('It submits a scheduled prompt that arrives mid-restore after the held scheduled prompt', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    arriveDuringSubmits($, world, [{ text: 'late job', kind: 'scheduled-trigger' }])
    await failNote()
    expect([entered(world), world.box.text]).toEqual([['entered:plugin:nightly job', 'entered:plugin:late job'], ''])
  })

  test('It holds a prompt that arrives mid-restore instead of running it', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    const results = arriveDuringSubmits($, world, [{ text: 'late job', kind: 'scheduled-trigger' }])
    await failNote()
    expect([dropOf(await results[0]), entered(world), world.box.text]).toEqual([
      HELD_FOR_HANDOFF,
      ['entered:plugin:nightly job', 'entered:plugin:late job'],
      '',
    ])
  })

  test('It submits prompts that arrive mid-restore one by one in arrival order', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    arriveDuringSubmits($, world, [
      { text: 'late one', kind: 'scheduled-trigger' },
      { text: 'late two', kind: 'bridge' },
      { text: 'late three', kind: 'scheduled-trigger' },
    ])
    await failNote()
    expect([entered(world), world.box.text]).toEqual([
      ['entered:plugin:nightly job', 'entered:plugin:late one', 'entered:plugin+asUser:late two', 'entered:plugin:late three'],
      '',
    ])
  })

  test('It puts a person prompt that arrives mid-restore in the box after the held person prompt', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    arriveDuringSubmits($, world, [{ text: 'late' }])
    await failNote()
    expect([entered(world), world.box.text]).toEqual([['entered:plugin:nightly job'], 'held one\nlate'])
  })

  test('It lets a prompt through once the restore has finished', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await failNote()
    const after = await submitPerson($, 'after')
    expect([dropOf(after), entered(world), world.box.text]).toEqual([undefined, ['entered:plugin:nightly job', 'entered:composer:after'], ''])
  })

  test('It counts a prompt that arrived mid-restore in the record of the abandoned handoff', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    arriveDuringSubmits($, world, [{ text: 'late' }])
    await failNote()
    expect(lastRecord(world).trigger_values).toMatchObject({ held_groups: 2, held_unattended: true, held_restore: 'in_box' })
  })
})

const logs = (world: World) => world.effects.filter(effect => effect.startsWith('log:'))

const remoteCases = ['bridge', 'sdk', 'scheduled-trigger'] as const

// A scheduled prompt keeps the plugin's frame; a person's, from wherever they sent it, is read as their own words.
const SUBMITTED_AS = { bridge: 'plugin+asUser', sdk: 'plugin+asUser', 'scheduled-trigger': 'plugin' } as const

const HANDED_OFF = 'log:Handed off. This session starts from a note summarizing the previous one. To reopen the full previous conversation: claude --resume old-session'
const NOTE_NOT_ADDED = 'log:The handoff note could not be added to this session. To reopen the full previous conversation: claude --resume old-session'

describe('a held remote prompt that cannot be resubmitted', () => {
  for (const c of remoteCases) {
    test(`It keeps a ${c} prompt out of the box and in the transcript when its resubmit fails`, async ($, on) => {
      const { world, finishNote } = await writingTheNote($, on)
      await submitPerson($, 'from far away', { kind: c })
      world.submitDropped = true
      await finishNote()
      expect([entered(world), world.box.text, logs(world)]).toEqual([[], '', [HANDED_OFF, 'log:A prompt could not be sent, so here it is:\nfrom far away']])
    })
  }

  test('It puts a composer prompt in the box, not the transcript, when its resubmit fails', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'typed here')
    world.submitDropped = true
    await finishNote()
    expect([entered(world), world.box.text, logs(world)]).toEqual([[], 'typed here', [HANDED_OFF]])
  })

  test('It keeps a mixed group of composer and bridge prompts out of the box when its resubmit fails', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'typed here')
    await submitPerson($, 'from far away', { kind: 'bridge' })
    world.submitDropped = true
    await finishNote()
    expect([entered(world), world.effects.filter(effect => effect.startsWith('fill:')), logs(world)]).toEqual([
      [],
      [],
      [HANDED_OFF, 'log:A prompt could not be sent, so here it is:\ntyped here\n\nfrom far away'],
    ])
  })

  for (const c of remoteCases) {
    test(`It submits a ${c} prompt, and keeps it out of the box, when the handoff is abandoned`, async ($, on) => {
      const { world, failNote } = await writingTheNote($, on)
      await submitPerson($, 'from far away', { kind: c })
      await failNote()
      expect([entered(world), world.box.text]).toEqual([[`entered:${SUBMITTED_AS[c]}:from far away`], ''])
    })
  }
})

describe('groupHeldPrompts origin', () => {
  const typed = { text: 'a', isUnattended: false, origin: 'composer' } satisfies HeldPrompt
  const remote = { text: 'b', isUnattended: false, origin: 'bridge' } satisfies HeldPrompt

  test('It keeps the composer as the origin of a group of composer prompts', () => {
    expect(groupHeldPrompts([typed, typed]).map(group => group.origin)).toEqual(['composer'])
  })

  test('It gives a group the remote origin when a remote prompt joins a composer prompt', () => {
    expect(groupHeldPrompts([typed, remote]).map(group => group.origin)).toEqual(['bridge'])
  })

  test('It gives a group the remote origin when a composer prompt joins a remote prompt', () => {
    expect(groupHeldPrompts([remote, typed]).map(group => group.origin)).toEqual(['bridge'])
  })
})

const NOTE = 'Handoff from the previous session (old-session), written by Claude just before a /clear:\n\nThe handoff note.'

describe('the transcript wording for a note that could be neither sent nor put in the box', () => {
  const refuseEverything = (world: World) => {
    world.appendDenied = true
    world.submitDropped = true
    world.fillRefusal = 'dialog'
  }

  test('It calls a note that went alone the handoff note, not the prompt', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    refuseEverything(world)
    await finishNote()
    expect(logs(world)).toEqual([`log:The handoff note could not be sent or put in the prompt box. Here it is:\n${NOTE}`, NOTE_NOT_ADDED])
  })

  test('It names the note and the prompt apart when the note went with a held prompt', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    refuseEverything(world)
    await finishNote()
    expect(logs(world)).toEqual([
      `log:The handoff note could not be sent or put in the prompt box. Here it is:\n${NOTE}`,
      NOTE_NOT_ADDED,
      'log:Your prompt could not be sent or put in the prompt box. Here it is:\nheld one',
    ])
  })

  test('It does not say the box was tried for a bridge prompt that went apart from the note', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one', { kind: 'bridge' })
    refuseEverything(world)
    await finishNote()
    expect(logs(world)).toEqual([
      `log:The handoff note could not be sent or put in the prompt box. Here it is:\n${NOTE}`,
      NOTE_NOT_ADDED,
      'log:A prompt could not be sent, so here it is:\nheld one',
    ])
  })
})

describe('the transcript wording for a scheduled turn handoff note that could not be delivered', () => {
  const ACT = { options: { handoffMode: 'act' } } as const

  test('It says only that a scheduled note could not be sent, not that it went to the prompt box', ACT, async ($, on) => {
    const world = install($, on)
    await startSession($)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    world.appendDenied = true
    world.submitDropped = true
    await growTo200k($, world)
    await bash($, world, 'git commit -m x')
    await completeTurn($)
    await world.clock.settle()
    expect([logs(world), world.box.text]).toEqual([[`log:The handoff note could not be sent, so here it is:\n${NOTE}`, NOTE_NOT_ADDED], ''])
  })

  test('It names the note and a prompt, without the box, when a scheduled note and a held scheduled prompt cannot be sent', ACT, async ($, on) => {
    const world = install($, on)
    const fork = holdFork(world)
    await startSession($)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await growTo200k($, world)
    await bash($, world, 'git commit -m x')
    await completeTurn($)
    await world.clock.settle()
    await submitPerson($, 'second job', { kind: 'scheduled-trigger' })
    world.appendDenied = true
    world.submitDropped = true
    fork.release(answered('The handoff note.'))
    await world.clock.settle()
    expect([logs(world), world.box.text]).toEqual([[`log:The handoff note and a prompt could not be sent, so here they are:\n${NOTE}\n\nsecond job`, NOTE_NOT_ADDED], ''])
  })
})

const IMAGE = [{ type: 'image', mediaType: 'image/png' }] as const

const REFUSED_DURING_HANDOFF =
  'A handoff is in progress, and a prompt with attachments or context cannot be held. Send it again after the handoff.'

type TogetherArrival = { text: string; options?: Parameters<typeof submitPerson>[2] }

// Every arrival lands during the first submit of the restore, in the order given.
const arriveTogether = ($: Parameters<typeof submitPerson>[0], world: World, arrivals: TogetherArrival[]) => {
  world.submitHooks = [
    () => {
      arrivals.forEach(({ text, options }) => void submitPerson($, text, options))
    },
  ]
}

const LATE: TogetherArrival[] = [{ text: 'late typed' }, { text: 'late bridge', options: { kind: 'bridge' } }]
const RESTORED_IN_ORDER = [['entered:plugin:nightly job', 'entered:plugin+asUser:late bridge'], 'held one\nlate typed']

describe('restore order on every abandon reason', () => {
  test('It restores held and late prompts in order when the clear fails', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    world.clearThrows = true
    arriveTogether($, world, LATE)
    await finishNote()
    expect([entered(world), world.box.text]).toEqual(RESTORED_IN_ORDER)
  })

  test('It restores held and late prompts in order when the session ends before the clear', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await submitPerson($, 'held one')
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await $.session.end({ reason: 'resume', sessionId: 'old-session', resume: { id: 'old-session' } })
    arriveTogether($, world, LATE)
    await finishNote()
    expect([entered(world), world.box.text]).toEqual(RESTORED_IN_ORDER)
  })

  test('It restores held and late prompts in order when the handoff fails before the note', async ($, on) => {
    const world = install($, on)
    await startSession($)
    world.sessionIdDenials = 1
    await runCommand($, 'handoff')
    await submitPerson($, 'held one')
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    arriveTogether($, world, LATE)
    await world.clock.settle()
    expect([entered(world), world.box.text]).toEqual(RESTORED_IN_ORDER)
  })

  test('It restores held and late prompts in order when background work stops the handoff', ACT, async ($, on) => {
    const { world, finishNote } = await actHandoffWhileWritingTheNote($, on)
    await bash($, world, 'npm run dev', { result: { backgroundTaskId: 'bg1' } })
    await submitPerson($, 'held one')
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    arriveTogether($, world, LATE)
    await finishNote()
    await endTurn($, world)
    expect([entered(world), world.box.text]).toEqual(RESTORED_IN_ORDER)
  })
})

describe('the box placement of a prompt refused during a handoff', () => {
  test('It puts a refused person prompt that arrived mid-restore in the box after the held person prompt', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    await submitPerson($, 'held one')
    arriveTogether($, world, [{ text: 'late with image', options: { attachments: IMAGE } }])
    await failNote()
    expect([entered(world), world.box.text]).toEqual([['entered:plugin:nightly job'], 'held one\nlate with image'])
  })

  test('It keeps a held late person prompt ahead of a later refused one in the box', async ($, on) => {
    const { world, failNote } = await writingTheNote($, on)
    await submitPerson($, 'nightly job', { kind: 'scheduled-trigger' })
    arriveTogether($, world, [{ text: 'late typed' }, { text: 'late with image', options: { attachments: IMAGE } }])
    await failNote()
    expect([entered(world), world.box.text]).toEqual([['entered:plugin:nightly job'], 'late typed\nlate with image'])
  })

  test('It puts a person prompt refused while the note is written in front of the draft', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    const refused = await submitPerson($, 'with image', { attachments: IMAGE })
    world.box = { text: 'draft', cursor: 5 }
    await world.clock.settle()
    await finishNote()
    expect([dropOf(refused), entered(world), world.box.text]).toEqual([REFUSED_DURING_HANDOFF, [], 'with image\ndraft'])
  })

  test('It runs a prompt with an attachment and leaves the draft alone once the handoff has finished', async ($, on) => {
    const { world, finishNote } = await writingTheNote($, on)
    await finishNote()
    const result = await submitPerson($, 'with image', { attachments: IMAGE })
    world.box = { text: 'draft', cursor: 5 }
    await world.clock.settle()
    expect([dropOf(result), entered(world), world.box.text]).toEqual([undefined, ['entered:composer:with image'], 'draft'])
  })
})
