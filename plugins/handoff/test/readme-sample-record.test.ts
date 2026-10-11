import { expect, test } from 'claude-code/testing'

import { recordFromEvaluation, type Evaluation, type RecordState } from '../hooks/decision-record'
import { findSampleDrift, parseReadmeSampleLine, rebuildSampleLine } from '../hooks/readme-sample-record'

const state: RecordState = {
  mode: 'act',
  setting: 'act',
  threshold: 150000,
  engineVersion: '2.1.295',
  contextTokens: 200000,
  cacheReadTokens: 180000,
}

const cleared: Evaluation = {
  point: 'turn-end',
  signal: 'strong',
  isBusy: false,
  contextTokens: 200000,
  cacheReadTokens: 180000,
  action: 'cleared',
  note: 'appended',
  clearedBy: 'handoff',
  compactedBeforeClear: true,
  heldFields: { held_groups: 0, held_unattended: false, handoff_unattended: false, held_other_delivery: 'none' },
}

const NOW = Date.UTC(2026, 9, 8, 20, 49, 10, 438)

const lineOf = (evaluation: Evaluation) => JSON.stringify(recordFromEvaluation(state, evaluation, NOW, 'abc'))

const readmeWith = (line: string) => `intro\n\n\`\`\`json\n${line}\n\`\`\`\n\n| Field | Values |\n`

test('It finds no drift when the README line is what recordFromEvaluation builds from its own fields', () => {
  expect(findSampleDrift(readmeWith(lineOf(cleared)), recordFromEvaluation)).toEqual([])
})

const evaluations: ReadonlyArray<readonly [string, Evaluation]> = [
  ['a reason', { ...cleared, action: 'none', reason: 'background_busy', note: undefined }],
  ['a person clear', { ...cleared, clearedBy: 'person' }],
  ['a held restore', { ...cleared, action: 'none', heldFields: { held_groups: 1, held_unattended: true, handoff_unattended: false, held_restore: 'in_box' } }],
]
for (const [name, evaluation] of evaluations) {
  test(`It rebuilds the line byte for byte for ${name}`, () => {
    const line = lineOf(evaluation)
    expect(rebuildSampleLine(line, recordFromEvaluation)).toBe(line)
  })
}

test('It reports drift when the README line orders keys differently from the builder', () => {
  const line = lineOf(cleared)
  const reordered = line.replace('"note":"appended","cleared_by":"handoff"', '"cleared_by":"handoff","note":"appended"')
  expect(reordered).not.toBe(line)
  expect(findSampleDrift(readmeWith(reordered), recordFromEvaluation)).toHaveLength(1)
})

test('It reports drift when the README line holds a key the builder never writes', () => {
  const extra = lineOf(cleared).replace('"effective_mode":"act"', '"effective_mode":"act","bogus":1')
  expect(findSampleDrift(readmeWith(extra), recordFromEvaluation)).toHaveLength(1)
})

test('It names both lines in the drift message', () => {
  const extra = lineOf(cleared).replace('"effective_mode":"act"', '"effective_mode":"act","bogus":1')
  const [message] = findSampleDrift(readmeWith(extra), recordFromEvaluation)
  expect(message).toContain(extra)
  expect(message).toContain(lineOf(cleared))
})

test('It returns the only line that starts with a record in parseReadmeSampleLine', () => {
  const line = lineOf(cleared)
  expect(parseReadmeSampleLine(readmeWith(line))).toBe(line)
})

test('It throws when the README has no sample record line', () => {
  expect(() => parseReadmeSampleLine('no record here')).toThrow('no sample record line')
})

test('It throws when the README has two sample record lines', () => {
  const line = lineOf(cleared)
  expect(() => parseReadmeSampleLine(`${line}\n${line}`)).toThrow('2 sample record lines')
})
