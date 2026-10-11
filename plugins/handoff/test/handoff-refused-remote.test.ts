import { describe, expect, test } from 'claude-code/testing'

import { dropOf, submitPerson, writingTheNote } from './helpers'

const IMAGE = [{ type: 'image', mediaType: 'image/png' }] as const
const REFUSED_DURING_HANDOFF =
  'A handoff is in progress, and a prompt with attachments or context cannot be held. Send it again after the handoff.'
const keptInTranscript = (kind: string, text: string) =>
  `log:A prompt from ${kind}, which is not this terminal, was refused during the handoff, so it was not sent. Here it is:\n${text}`

describe('a prompt from a sender who is not at the terminal, refused during a handoff', () => {
  for (const kind of ['bridge', 'sdk', 'scheduled-trigger'] as const) {
    test(`It keeps a refused ${kind} prompt in the transcript`, async ($, on) => {
      const { world } = await writingTheNote($, on)
      await submitPerson($, 'look', { kind, attachments: IMAGE })
      await world.clock.settle()
      expect(world.effects).toContain(keptInTranscript(kind, 'look'))
    })

    test(`It leaves the prompt box alone for a refused ${kind} prompt`, async ($, on) => {
      const { world } = await writingTheNote($, on)
      world.box = { text: 'my draft', cursor: 8 }
      await submitPerson($, 'look', { kind, attachments: IMAGE })
      await world.clock.settle()
      expect(world.box.text).toBe('my draft')
    })

    test(`It answers a refused ${kind} prompt with the drop reason`, async ($, on) => {
      await writingTheNote($, on)
      expect(dropOf(await submitPerson($, 'look', { kind, attachments: IMAGE }))).toBe(REFUSED_DURING_HANDOFF)
    })
  }

  test('It still puts a refused composer prompt back in the box', async ($, on) => {
    const { world } = await writingTheNote($, on)
    await submitPerson($, 'look', { attachments: IMAGE })
    await world.clock.settle()
    expect(world.box.text).toBe('look')
  })
})
