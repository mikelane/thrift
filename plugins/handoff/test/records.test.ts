import { expect, test } from 'claude-code/testing'

import {
  LOG_WRITER,
  decisionRecord,
  logLocation,
  type TriggerValues,
} from '../hooks/decision-record'
import { HANDOFF_PROMPT, handoffMessage, holdsPrompt, joinPrompts, resumeCommand, withoutPrompt } from '../hooks/handoff-note'

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
  ['none', 'off', 'turn-end', 'shadow'],
  ['none', 'ask', 'turn-end', 'active'],
  ['none', 'act', 'turn-end', 'active'],
  ['advised', 'off', 'turn-end', 'active'],
  ['cleared', 'off', 'command', 'active'],
  ['none', 'off', 'command', 'active'],
  ['untested_engine', 'off', 'turn-end', 'active'],
] as const

for (const [action, setting, point, expected] of modeCases) {
  test(`It returns ${expected} mode from decisionRecord for action ${action}, setting ${setting}, point ${point}`, () => {
    const record = decisionRecord({ ...baseRecord, action, triggerValues: { ...triggerValues, setting, point } })
    expect(record.mode).toBe(expected)
  })
}

test('It returns the record as one line of JSON ending in a newline from decisionRecord line', () => {
  const line = JSON.stringify(decisionRecord(baseRecord)) + '\n'
  expect(JSON.parse(line).session_id).toBe('abc')
})

const locationCases = [
  [undefined, '/home/u', { dir: '/home/u/.claude/thrift', file: '/home/u/.claude/thrift/decisions.jsonl' }],
  ['', '/home/u', { dir: '/home/u/.claude/thrift', file: '/home/u/.claude/thrift/decisions.jsonl' }],
  ['/data/thrift', '/home/u', { dir: '/data/thrift', file: '/data/thrift/decisions.jsonl' }],
  ['/data/thrift/', '/home/u', { dir: '/data/thrift', file: '/data/thrift/decisions.jsonl' }],
  ['/data/thrift', undefined, { dir: '/data/thrift', file: '/data/thrift/decisions.jsonl' }],
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

test('It asks for each part of a handoff in HANDOFF_PROMPT', () => {
  const asked = ['task', 'goal', 'done', 'decisions', 'open threads', 'next', 'rediscover']
  expect(asked.filter(part => !HANDOFF_PROMPT.toLowerCase().includes(part))).toEqual([])
})

test('It caps the note at 400 words in HANDOFF_PROMPT', () => {
  expect(HANDOFF_PROMPT).toContain('400 words')
})

test('It forbids a preamble in HANDOFF_PROMPT', () => {
  expect(HANDOFF_PROMPT).toContain('no preamble')
})

test('It names the old session and the note from handoffMessage', () => {
  const message = handoffMessage('old-id', 'The note.')
  expect(message).toStartWith('Handoff from the previous session (old-id), written by Claude just before a /clear')
  expect(message).toEndWith('The note.')
})

test('It returns the command that reopens the old session from resumeCommand', () => {
  expect(resumeCommand('old-id')).toBe('claude --resume old-id')
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
