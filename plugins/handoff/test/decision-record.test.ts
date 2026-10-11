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

  const optionalFields: ReadonlyArray<{ name: string; extra: Partial<Evaluation>; expected: object }> = [
    { name: 'a reason', extra: { reason: 'backoff' }, expected: { reason: 'backoff' } },
    { name: 'a note delivery', extra: { note: 'in_box' }, expected: { note: 'in_box' } },
    { name: 'held fields', extra: { heldFields }, expected: heldFields },
  ]
  for (const { name, extra, expected } of optionalFields) {
    test(`It adds ${name} to trigger_values only when the evaluation has them`, () => {
      const { trigger_values } = recordFromEvaluation(state, { ...evaluation, ...extra }, NOW, 'abc')
      expect(trigger_values).toMatchObject(expected)
    })
  }

  test('It leaves out reason, note and held fields when the evaluation has none', () => {
    const { trigger_values } = recordFromEvaluation(state, evaluation, NOW, 'abc')
    expect(trigger_values).not.toHaveProperty('reason')
    expect(trigger_values).not.toHaveProperty('note')
    expect(trigger_values).not.toHaveProperty('held_groups')
  })

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
