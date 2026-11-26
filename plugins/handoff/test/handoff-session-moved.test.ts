import { describe, expect, test } from 'claude-code/testing'

import { handedOffMessage, noteInBoxMessage, noteInOtherSessionMessage } from '../hooks/handoff-note'
import { install, lastRecord, runCommand, startSession, writingTheNote } from './helpers'

const LOG_PREFIX = 'log:'
const TOAST_PREFIX = 'toast:'
const ELSEWHERE = noteInOtherSessionMessage('new-session')

type Engine = Parameters<typeof install>[0]
type On = Parameters<typeof install>[1]

const startedWorld = async ($: Engine, on: On) => {
  const world = install($, on)
  await startSession($)
  return world
}

const runHandoff = async ($: Engine, world: ReturnType<typeof install>) => {
  await runCommand($, 'handoff')
  await world.clock.settle()
  return world
}

// A /resume queued behind the clear switches the session once the note is in.
const handoffThenResume = async ($: Engine, on: On) => {
  const world = await startedWorld($, on)
  world.onAppended = async () => {
    world.sessionId = 'resumed-elsewhere'
  }
  return runHandoff($, world)
}

const handoffThatStays = async ($: Engine, on: On) => runHandoff($, await startedWorld($, on))

describe('a handoff that stays in the session it delivered to', () => {
  test('It leaves delivery_session_id off the record', async ($, on) => {
    const world = await handoffThatStays($, on)
    expect(lastRecord(world).trigger_values.delivery_session_id).toBeUndefined()
  })
})

describe('a /resume that switched sessions after the clear', () => {
  test('It logs exactly one line naming the session that holds the note', async ($, on) => {
    const world = await handoffThenResume($, on)
    expect(world.effects.filter(effect => effect === `${LOG_PREFIX}${ELSEWHERE}`)).toHaveLength(1)
  })

  test('It shows no handed-off or note-elsewhere toast', async ($, on) => {
    const world = await handoffThenResume($, on)
    expect(world.effects).not.toContain(`${TOAST_PREFIX}${handedOffMessage('old-session')}`)
    expect(world.effects).not.toContain(`${TOAST_PREFIX}${ELSEWHERE}`)
  })

  test('It leaves the handed-off line out of the resumed session', async ($, on) => {
    const world = await handoffThenResume($, on)
    expect(world.effects).not.toContain(`${LOG_PREFIX}${handedOffMessage('old-session')}`)
  })

  test('It writes a debug line naming the session of the note and the session the person is in', async ($, on) => {
    const world = await handoffThenResume($, on)
    expect(world.debugLines).toContain('session moved: the note went to new-session, and the person is now in resumed-elsewhere')
  })

  test('It records delivery_session_id, the session that holds the note', async ($, on) => {
    const world = await handoffThenResume($, on)
    expect(lastRecord(world).trigger_values.delivery_session_id).toBe('new-session')
  })

  test('It records reason session_moved and keeps the delivery fields', async ($, on) => {
    const world = await handoffThenResume($, on)
    expect(lastRecord(world)).toMatchObject({
      action: 'cleared',
      trigger_values: { reason: 'session_moved', note: 'appended', cleared_by: 'handoff' },
    })
  })
})

describe('a handoff that stayed in the fresh session', () => {
  test('It shows the handed-off line and toast', async ($, on) => {
    const world = await handoffThatStays($, on)
    expect(world.effects).toContain(`${LOG_PREFIX}${handedOffMessage('old-session')}`)
    expect(world.effects).toContain(`${TOAST_PREFIX}${handedOffMessage('old-session')}`)
  })

  test('It does not log the note-elsewhere line', async ($, on) => {
    const world = await handoffThatStays($, on)
    expect(world.effects).not.toContain(`${LOG_PREFIX}${ELSEWHERE}`)
  })

  test('It records no reason', async ($, on) => {
    const world = await handoffThatStays($, on)
    expect(lastRecord(world).trigger_values.reason).toBeUndefined()
  })
})

// Wording-independent: the message names whichever session holds the note, not a fixed one.
test('It words noteInOtherSessionMessage as the final copy, ending with the resume command', () => {
  expect(noteInOtherSessionMessage('session-a')).toBe('The handoff note went to session session-a, not this one. To open it: claude --resume session-a')
})

test('It names the session it is given in noteInOtherSessionMessage', () => {
  expect(noteInOtherSessionMessage('session-a')).toContain('session-a')
  expect(noteInOtherSessionMessage('session-b')).toContain('session-b')
  expect(noteInOtherSessionMessage('session-a')).not.toContain('session-b')
})

describe('a session id that cannot be read after the clear', () => {
  test('It shows the handed-off line because a move cannot be told', async ($, on) => {
    const world = await startedWorld($, on)
    world.onClearEnded = async () => {
      world.sessionIdDenials = 1
    }
    await runHandoff($, world)
    expect(world.debugLines.some(line => line.startsWith('could not read the session id for the delivery (append): '))).toBe(true)
    expect(world.effects).toContain(`${LOG_PREFIX}${handedOffMessage('old-session')}`)
    expect(lastRecord(world).trigger_values.reason).toBeUndefined()
  })
})

describe('a session id that cannot be read after the append is refused', () => {
  test('It names the submit read in the debug line', async ($, on) => {
    const world = await startedWorld($, on)
    Object.defineProperty(world, 'appendDenied', {
      get: () => {
        world.sessionIdDenials = 1
        return true
      },
    })
    await runHandoff($, world)
    expect(world.debugLines.some(line => line.startsWith('could not read the session id for the delivery (submit): '))).toBe(true)
  })
})

describe('a session id that cannot be read once the note is in, for hasSessionMovedFrom', () => {
  test('It shows the handed-off line and records no reason because the current session cannot be told', async ($, on) => {
    const world = await startedWorld($, on)
    // The delivery reads the id before the append, so a denial set once the note is in hits only the move check.
    world.onAppended = async () => {
      world.onAppended = undefined
      world.sessionIdDenials = 1
    }
    await runHandoff($, world)
    expect(world.sessionIdDenials).toBe(0)
    expect(world.debugLines.some(line => line.startsWith('could not read the session id for the move check: '))).toBe(true)
    expect(world.effects).toContain(`${LOG_PREFIX}${handedOffMessage('old-session')}`)
    expect(world.effects).not.toContain(`${LOG_PREFIX}${ELSEWHERE}`)
    expect(lastRecord(world).trigger_values.reason).toBeUndefined()
  })
})

// A person's /clear or /resume queued behind the handoff's clear runs before the note is appended, so the note goes into
// the session the person is in, and that is the session the record and the lines must name.
describe('a person session change that runs before the note is appended', () => {
  const personClearInDeliveryGap = async ($: Engine, on: On) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.onCommandRegistered = async () => {
      world.onCommandRegistered = undefined
      world.nextSessionId = 'person-session'
      await runCommand($, 'clear')
    }
    await finishNote()
    return world
  }

  const personResumeInDeliveryGap = async ($: Engine, on: On) => {
    const { world, finishNote } = await writingTheNote($, on)
    world.onCommandRegistered = async () => {
      world.onCommandRegistered = undefined
      world.sessionId = 'resumed-elsewhere'
    }
    await finishNote()
    return world
  }

  test('It does not record session_moved when a person clear put the note in the session the person is in', async ($, on) => {
    const world = await personClearInDeliveryGap($, on)
    expect(world.appended).toHaveLength(1)
    expect(world.sessionId).toBe('person-session')
    expect(lastRecord(world).trigger_values.reason).toBeUndefined()
  })

  test('It does not point at a session that does not hold the note after a person clear', async ($, on) => {
    const world = await personClearInDeliveryGap($, on)
    expect(world.effects).not.toContain(`${LOG_PREFIX}${ELSEWHERE}`)
  })

  test('It does not record session_moved when a person resume put the note in the resumed session', async ($, on) => {
    const world = await personResumeInDeliveryGap($, on)
    expect(world.appended).toHaveLength(1)
    expect(world.sessionId).toBe('resumed-elsewhere')
    expect(lastRecord(world).trigger_values.reason).toBeUndefined()
  })

  test('It shows the handed-off line in the resumed session that holds the note', async ($, on) => {
    const world = await personResumeInDeliveryGap($, on)
    expect(world.effects).toContain(`${LOG_PREFIX}${handedOffMessage('old-session')}`)
  })
})

describe('a /resume that moved the session after the note went to the prompt box', () => {
  const handoffWhoseNoteGoesToTheBox = async ($: Engine, on: On) => {
    const world = await startedWorld($, on)
    world.appendDenied = true
    world.submitDropped = true
    world.onFill = async () => {
      world.onFill = undefined
      world.sessionId = 'resumed-elsewhere'
    }
    return runHandoff($, world)
  }

  test('It does not say the note went to another session', async ($, on) => {
    const world = await handoffWhoseNoteGoesToTheBox($, on)
    expect(lastRecord(world).trigger_values.note).toBe('in_box')
    expect(world.effects).not.toContain(`${LOG_PREFIX}${ELSEWHERE}`)
  })

  test('It records no session_moved reason or delivery_session_id', async ($, on) => {
    const world = await handoffWhoseNoteGoesToTheBox($, on)
    expect(lastRecord(world).trigger_values.reason).toBeUndefined()
    expect(lastRecord(world).trigger_values.delivery_session_id).toBeUndefined()
  })

  test('It tells the person the note is in the prompt box, as it does without a move', async ($, on) => {
    const world = await handoffWhoseNoteGoesToTheBox($, on)
    expect(world.effects).toContain(`${LOG_PREFIX}${noteInBoxMessage('old-session')}`)
  })
})

// The append is refused, the note goes in as a prompt to the fresh session, and a /resume queued
// behind the clear runs once the prompt has entered. The session id reads 'resumed-elsewhere' from then on.
const submittedNoteThenResume = async ($: Engine, on: On) => {
  const world = install($, on)
  await startSession($)
  world.appendDenied = true
  let currentSessionId = world.sessionId
  Object.defineProperty(world, 'sessionId', {
    get: () => (world.effects.some(effect => effect.startsWith('entered:')) ? 'resumed-elsewhere' : currentSessionId),
    set: (value: string) => {
      currentSessionId = value
    },
  })
  await runCommand($, 'handoff')
  await world.clock.settle()
  return world
}

describe('a /resume that moved the session after the note was submitted as a prompt', () => {
  test('It records session_moved and names the session the note was submitted to', async ($, on) => {
    const world = await submittedNoteThenResume($, on)
    expect(lastRecord(world).trigger_values.note).toBe('submitted')
    expect(lastRecord(world).trigger_values.reason).toBe('session_moved')
    expect(lastRecord(world).trigger_values.delivery_session_id).toBe('new-session')
  })

  test('It does not show the handed-off line in the resumed session, which does not hold the note', async ($, on) => {
    const world = await submittedNoteThenResume($, on)
    expect(world.effects).not.toContain(`log:${handedOffMessage('old-session')}`)
  })
})

// A /resume runs while the append is refused, before the note is submitted: the note goes into the resumed session,
// which is the session the person is in, so nothing moved.
const resumeWhileAppendRefused = async ($: Engine, on: On) => {
  const world = install($, on)
  await startSession($)
  Object.defineProperty(world, 'appendDenied', {
    get: () => {
      world.sessionId = 'resumed-elsewhere'
      return true
    },
  })
  return runHandoff($, world)
}

describe('a /resume that runs between the refused append and the note submit', () => {
  test('It records no session_moved for a note submitted into the session the person is in', async ($, on) => {
    const world = await resumeWhileAppendRefused($, on)
    expect(lastRecord(world).trigger_values.note).toBe('submitted')
    expect(lastRecord(world).trigger_values.reason).toBeUndefined()
    expect(lastRecord(world).trigger_values.delivery_session_id).toBeUndefined()
  })

  test('It shows the handed-off line, not the note-elsewhere line', async ($, on) => {
    const world = await resumeWhileAppendRefused($, on)
    expect(world.effects).toContain(`${LOG_PREFIX}${handedOffMessage('old-session')}`)
    expect(world.effects).not.toContain(`${LOG_PREFIX}${ELSEWHERE}`)
  })
})

// Nothing carries the note (append refused, submit throws, box fill refused), and a /resume runs during the failed submit.
const notCarriedThenResume = async ($: Engine, on: On) => {
  const world = install($, on)
  await startSession($)
  world.appendDenied = true
  world.submitThrows = true
  world.fillRefusal = 'dialog'
  world.submitHooks = [
    () => {
      world.sessionId = 'resumed-elsewhere'
    },
  ]
  return runHandoff($, world)
}

describe('a /resume that moved the session after nothing could carry the note', () => {
  test('It records no session_moved for a note that is in no transcript', async ($, on) => {
    const world = await notCarriedThenResume($, on)
    expect(lastRecord(world).trigger_values.note).toBe('not_carried')
    expect(lastRecord(world).trigger_values.reason).toBeUndefined()
    expect(world.effects).not.toContain(`${LOG_PREFIX}${ELSEWHERE}`)
  })
})
