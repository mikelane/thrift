import { expect, test } from 'claude-code/testing'

import {
  LOG_WRITER,
  decisionRecord,
  logLocation,
  type TriggerValues,
} from '../hooks/decision-record'
import {
  HANDOFF_PROMPT,
  handedOffMessage,
  handoffMessage,
  holdsPrompt,
  turnAfterNoteLine,
  joinPrompts,
  noteInBoxMessage,
  noteNotCarriedMessage,
  resumeCommand,
  withoutPrompt,
} from '../hooks/handoff-note'

const triggerValues: TriggerValues = {
  point: 'turn-end',
  signal: 'strong',
  context_tokens: 160_000,
  threshold: 150_000,
  is_background_busy: false,
  setting: 'ask',
  cache_read_tokens: 120_000,
}

const baseRecord = {
  now: Date.UTC(2026, 9, 8, 20, 49, 10, 438),
  sessionId: 'abc',
  action: 'advised',
  engineVersion: '2.1.295',
  effectiveMode: 'ask',
  triggerValues,
} as const

test('It returns every field of the decision log from decisionRecord', () => {
  expect(decisionRecord(baseRecord)).toEqual({
    ts: '2026-10-08T20:49:10.438Z',
    session_id: 'abc',
    component: 'handoff',
    mode: 'active',
    action: 'advised',
    engine_version: '2.1.295',
    trigger_values: triggerValues,
  })
})

const modeCases = [
  ['none', 'off', 'off', 'turn-end', 'shadow'],
  ['none', 'ask', 'ask', 'turn-end', 'active'],
  ['none', 'act', 'act', 'turn-end', 'active'],
  ['none', 'act', 'off', 'turn-end', 'shadow'],
  ['none', 'ask', 'off', 'turn-end', 'shadow'],
  ['none', 'off', 'ask', 'turn-end', 'active'],
  ['advised', 'off', 'off', 'turn-end', 'active'],
  ['cleared', 'off', 'off', 'command', 'active'],
  ['none', 'off', 'off', 'command', 'active'],
  ['none', 'act', 'off', 'command', 'active'],
  ['untested_engine', 'act', 'off', 'turn-end', 'active'],
] as const

for (const [action, setting, effectiveMode, point, expected] of modeCases) {
  test(`It returns ${expected} mode from decisionRecord for action ${action}, setting ${setting}, effective mode ${effectiveMode}, point ${point}`, () => {
    const record = decisionRecord({ ...baseRecord, action, effectiveMode, triggerValues: { ...triggerValues, setting, point } })
    expect(record.mode).toBe(expected)
  })
}

test('It returns a record that survives a JSON round trip unchanged from decisionRecord', () => {
  const record = decisionRecord(baseRecord)
  expect(JSON.parse(JSON.stringify(record))).toEqual(record)
})

const locationCases = [
  [undefined, '/home/u', { dir: '/home/u/.claude/thrift', file: '/home/u/.claude/thrift/decisions.jsonl' }],
  ['', '/home/u', { dir: '/home/u/.claude/thrift', file: '/home/u/.claude/thrift/decisions.jsonl' }],
  ['/data/thrift', '/home/u', { dir: '/data/thrift', file: '/data/thrift/decisions.jsonl' }],
  ['/data/thrift/', '/home/u', { dir: '/data/thrift', file: '/data/thrift/decisions.jsonl' }],
  ['/data/thrift', undefined, { dir: '/data/thrift', file: '/data/thrift/decisions.jsonl' }],
  [undefined, '/home/u//', { dir: '/home/u/.claude/thrift', file: '/home/u/.claude/thrift/decisions.jsonl' }],
  [undefined, undefined, null],
  ['', '', null],
] as const

for (const [thriftHome, home, expected] of locationCases) {
  test(`It returns ${JSON.stringify(expected)} from logLocation for THRIFT_HOME ${JSON.stringify(thriftHome)} and HOME ${JSON.stringify(home)}`, () => {
    expect(logLocation(thriftHome, home)).toEqual(expected)
  })
}

test('It creates the log owner-only in LOG_WRITER', () => {
  expect(LOG_WRITER[2]).toStartWith('umask 077 && mkdir -p')
})

test('It appends to the file named by the second argument in LOG_WRITER', () => {
  expect(LOG_WRITER[2]).toEndWith('cat >> "$2"')
})

const handoffParts = ['task', 'goal', 'done', 'decisions', 'open threads', 'next', 'rediscover'] as const

for (const part of handoffParts) {
  test(`It asks for ${part} in HANDOFF_PROMPT`, () => {
    expect(HANDOFF_PROMPT.toLowerCase()).toContain(part)
  })
}

test('It caps the note at 400 words in HANDOFF_PROMPT', () => {
  expect(HANDOFF_PROMPT).toContain('400 words')
})

test('It forbids a preamble in HANDOFF_PROMPT', () => {
  expect(HANDOFF_PROMPT).toContain('no preamble')
})

test('It names the old session and the note from handoffMessage', () => {
  const message = handoffMessage('old-id', 'The note.', false)
  expect(message).toStartWith('Handoff from the previous session (old-id), written by Claude just before a /clear')
  expect(message).toEndWith('The note.')
})

test('It leaves the note as the last text of handoffMessage when no turn ran after it', () => {
  expect(handoffMessage('old-id', 'The note.', false)).toEndWith('The note.')
})

test('It adds the turn-after-note line after the note in handoffMessage when a turn ran after it', () => {
  expect(handoffMessage('old-id', 'The note.', true)).toEndWith(`The note.\n\n${turnAfterNoteLine('old-id')}`)
})

test('It says a turn ran after the note and points at the resume command from turnAfterNoteLine', () => {
  expect(turnAfterNoteLine('old-id')).toBe(
    'A turn ran in the previous session after this note was written, so the note may miss it. For what it did: claude --resume old-id',
  )
})

test('It returns the command that reopens the old session from resumeCommand', () => {
  expect(resumeCommand('old-id')).toBe('claude --resume old-id')
})

test('It leads with continuing here and ends with the resume command from handedOffMessage', () => {
  expect(handedOffMessage('old-id')).toBe(
    'Handed off. This session starts from a note summarizing the previous one. To reopen the full previous conversation: claude --resume old-id',
  )
})

test('It says the note is in the prompt box, to send with Enter, from noteInBoxMessage', () => {
  expect(noteInBoxMessage('old-id')).toBe(
    'Handed off. The note summarizing the previous session is in your prompt box. Press Enter to send it. To reopen the full previous conversation: claude --resume old-id',
  )
})

test('It says the note could not be added to this session, with the resume command, from noteNotCarriedMessage', () => {
  expect(noteNotCarriedMessage('old-id')).toBe(
    'The handoff note could not be added to this session. The previous conversation is unchanged: claude --resume old-id',
  )
})

const joinCases = [
  ['handoff', 'held prompt', 'handoff\n\nheld prompt'],
  ['handoff', undefined, 'handoff'],
  ['handoff', '', 'handoff'],
] as const

for (const [handoff, held, expected] of joinCases) {
  test(`It returns ${JSON.stringify(expected)} from joinPrompts for held ${JSON.stringify(held)}`, () => {
    expect(joinPrompts(handoff, held)).toBe(expected)
  })
}

const holdsCases = [
  ['fix it', 'fix it', true],
  ['fix it\nmore', 'fix it', true],
  ['first\nfix it', 'fix it', true],
  ['first\nfix it\nlast', 'fix it', true],
  ['one\ntwo', 'one\ntwo', true],
  ['prefix it', 'fix it', false],
  ['fix it now', 'fix it', false],
  ['', 'fix it', false],
] as const

for (const [draft, prompt, expected] of holdsCases) {
  test(`It returns ${expected} from holdsPrompt for draft ${JSON.stringify(draft)} and prompt ${JSON.stringify(prompt)}`, () => {
    expect(holdsPrompt(draft, prompt)).toBe(expected)
  })
}

const withoutCases = [
  ['fix it', 'fix it', ''],
  ['fix it\ndraft', 'fix it', 'draft'],
  ['first\nfix it', 'fix it', 'first'],
  ['first\nfix it\nlast', 'fix it', 'first\nlast'],
  ['one\ntwo\nthree', 'one\ntwo', 'three'],
  ['prefix it', 'fix it', null],
  ['fix it now', 'fix it', null],
  ['', 'fix it', null],
] as const

for (const [draft, prompt, expected] of withoutCases) {
  test(`It returns ${JSON.stringify(expected)} from withoutPrompt for draft ${JSON.stringify(draft)} and prompt ${JSON.stringify(prompt)}`, () => {
    expect(withoutPrompt(draft, prompt)).toBe(expected)
  })
}
