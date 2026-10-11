import { describe, expect, test } from 'claude-code/testing'

import { recordFromEvaluation, snapshot, type Evaluation, type RecordState } from '../hooks/decision-record'

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0)

const state: RecordState = {
  mode: 'act',
  setting: 'ask',
  threshold: 150000,
  engineVersion: '2.1.295',
  contextTokens: 200000,
  cacheReadTokens: 180000,
}

const evaluation: Evaluation = {
  point: 'turn-end',
  signal: 'strong',
  isBusy: false,
  contextTokens: 200000,
  cacheReadTokens: 180000,
  action: 'advised',
}

const heldFields = { held_groups: 1, held_unattended: false, handoff_unattended: true, held_restore: 'in_box' } as const

describe('recordFromEvaluation', () => {
  test('It maps the evaluation and state onto the record fields', () => {
    expect(recordFromEvaluation(state, evaluation, NOW, 'abc')).toEqual({
      ts: '2026-10-11T12:00:00.000Z',
      session_id: 'abc',
      component: 'handoff',
      mode: 'active',
      action: 'advised',
      engine_version: '2.1.295',
      trigger_values: {
        point: 'turn-end',
        signal: 'strong',
        context_tokens: 200000,
        threshold: 150000,
        is_background_busy: false,
        setting: 'ask',
        cache_read_tokens: 180000,
        effective_mode: 'act',
      },
    })
  })

  const BASE_VALUES = {
    point: 'turn-end',
    signal: 'strong',
    context_tokens: 200000,
    threshold: 150000,
    is_background_busy: false,
    setting: 'ask',
    cache_read_tokens: 180000,
    effective_mode: 'act',
  } as const

  const optionalFields: ReadonlyArray<{ name: string; extra: Partial<Evaluation>; expected: object }> = [
    { name: 'a reason', extra: { reason: 'backoff' }, expected: { reason: 'backoff' } },
    { name: 'a note delivery', extra: { note: 'in_box' }, expected: { note: 'in_box' } },
    { name: 'held fields', extra: { heldFields }, expected: heldFields },
    { name: 'cleared_by person', extra: { clearedBy: 'person' }, expected: { cleared_by: 'person' } },
    { name: 'compacted_before_clear', extra: { compactedBeforeClear: true }, expected: { compacted_before_clear: true } },
    { name: 'cleared_by handoff', extra: { clearedBy: 'handoff' }, expected: { cleared_by: 'handoff' } },
  ]
  for (const { name, extra, expected } of optionalFields) {
    test(`It adds ${name} to trigger_values and nothing else when the evaluation has it`, () => {
      const { trigger_values } = recordFromEvaluation(state, { ...evaluation, ...extra }, NOW, 'abc')
      expect(trigger_values).toEqual({ ...BASE_VALUES, ...expected })
    })
  }

  // register.tsx passes compactedBeforeClear: false (not undefined) whenever no compaction ran before the clear.
  const absentFields: ReadonlyArray<{ name: string; extra: Partial<Evaluation> }> = [
    { name: 'compactedBeforeClear is false', extra: { compactedBeforeClear: false } },
    { name: 'clearedBy is undefined', extra: { clearedBy: undefined } },
    { name: 'reason is undefined', extra: { reason: undefined } },
    { name: 'note is undefined', extra: { note: undefined } },
    { name: 'heldFields is undefined', extra: { heldFields: undefined } },
  ]
  for (const { name, extra } of absentFields) {
    test(`It returns only the base trigger_values when ${name}`, () => {
      const { trigger_values } = recordFromEvaluation(state, { ...evaluation, ...extra }, NOW, 'abc')
      expect(trigger_values).toEqual(BASE_VALUES)
    })
  }

  const clearedHeld = { held_groups: 0, held_unattended: false, handoff_unattended: false, held_other_delivery: 'none' } as const

  // One row per DecisionAction, each with the fields that record type carries in register.tsx.
  const recordTypes: ReadonlyArray<{ action: Evaluation['action']; extra: Partial<Evaluation>; mode: string; values: object }> = [
    { action: 'none', extra: { reason: 'background_busy', compactedBeforeClear: true }, mode: 'active', values: { reason: 'background_busy', compacted_before_clear: true } },
    { action: 'advised', extra: {}, mode: 'active', values: {} },
    {
      action: 'cleared',
      extra: { note: 'appended', clearedBy: 'person', compactedBeforeClear: false, heldFields: clearedHeld },
      mode: 'active',
      values: { note: 'appended', cleared_by: 'person', ...clearedHeld },
    },
    { action: 'compacted', extra: {}, mode: 'active', values: {} },
    { action: 'untested_engine', extra: {}, mode: 'active', values: {} },
  ]
  for (const { action, extra, mode, values } of recordTypes) {
    test(`It builds the ${action} record with its own trigger_values`, () => {
      const record = recordFromEvaluation(state, { ...evaluation, action, ...extra }, NOW, 'abc')
      expect(record).toEqual({
        ts: '2026-10-11T12:00:00.000Z',
        session_id: 'abc',
        component: 'handoff',
        mode,
        action,
        engine_version: '2.1.295',
        trigger_values: { ...BASE_VALUES, ...values },
      })
    })
  }

  test('It reads the threshold, setting and mode from the state, not the evaluation', () => {
    const { trigger_values } = recordFromEvaluation({ ...state, threshold: 99000, setting: 'off', mode: 'off' }, evaluation, NOW, 'abc')
    expect(trigger_values).toMatchObject({ threshold: 99000, setting: 'off', effective_mode: 'off' })
  })

  test('It marks a none action in off mode as shadow', () => {
    const record = recordFromEvaluation({ ...state, mode: 'off' }, { ...evaluation, action: 'none' }, NOW, 'abc')
    expect(record.mode).toBe('shadow')
  })
})

describe('snapshot', () => {
  test('It copies the point, signal and busy flag and reads the sizes from the state', () => {
    expect(snapshot(state, 'prompt', 'weak', true)).toEqual({
      point: 'prompt',
      signal: 'weak',
      isBusy: true,
      contextTokens: 200000,
      cacheReadTokens: 180000,
    })
  })
})
