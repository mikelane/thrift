import { describe, expect, test } from 'claude-code/testing'

import { CONTINUE_PROMPT, decideContinue, type ContinueInput } from '../hooks/continue-decision'

const MID_FLIGHT: ContinueInput = {
  isEnabled: true,
  effectiveMode: 'ask',
  signal: 'weak',
  noteDelivery: 'appended',
  hasHeldPromptStartedTurn: false,
  isSameSession: true,
}

describe('decideContinue', () => {
  test('It submits after a weak-signal handoff whose note was appended', () => {
    expect(decideContinue(MID_FLIGHT)).toEqual({ submit: true })
  })

  test('It logs off when the setting is off', () => {
    expect(decideContinue({ ...MID_FLIGHT, isEnabled: false })).toEqual({ submit: false, fields: { continued: 'off' } })
  })

  test('It logs off when the plugin runs in off', () => {
    expect(decideContinue({ ...MID_FLIGHT, effectiveMode: 'off' })).toEqual({ submit: false, fields: { continued: 'off' } })
  })

  test('It skips with strong_signal after a strong signal', () => {
    expect(decideContinue({ ...MID_FLIGHT, signal: 'strong' })).toEqual({
      submit: false,
      fields: { continued: 'skipped', continue_skip: 'strong_signal' },
    })
  })

  test('It skips with strong_signal when the handoff was typed and carries no signal', () => {
    expect(decideContinue({ ...MID_FLIGHT, signal: 'none' })).toEqual({
      submit: false,
      fields: { continued: 'skipped', continue_skip: 'strong_signal' },
    })
  })

  test('It skips with note_not_appended when the note was submitted', () => {
    expect(decideContinue({ ...MID_FLIGHT, noteDelivery: 'submitted' })).toEqual({
      submit: false,
      fields: { continued: 'skipped', continue_skip: 'note_not_appended' },
    })
  })

  test('It skips with note_not_appended when the note was in_box', () => {
    expect(decideContinue({ ...MID_FLIGHT, noteDelivery: 'in_box' })).toEqual({
      submit: false,
      fields: { continued: 'skipped', continue_skip: 'note_not_appended' },
    })
  })

  test('It skips with note_not_appended when the note was not_carried', () => {
    expect(decideContinue({ ...MID_FLIGHT, noteDelivery: 'not_carried' })).toEqual({
      submit: false,
      fields: { continued: 'skipped', continue_skip: 'note_not_appended' },
    })
  })

  test('It skips with held_prompt_sent when a held prompt started a turn', () => {
    expect(decideContinue({ ...MID_FLIGHT, hasHeldPromptStartedTurn: true })).toEqual({
      submit: false,
      fields: { continued: 'skipped', continue_skip: 'held_prompt_sent' },
    })
  })

  test('It skips with session_moved when the session is no longer the fresh one', () => {
    expect(decideContinue({ ...MID_FLIGHT, isSameSession: false })).toEqual({
      submit: false,
      fields: { continued: 'skipped', continue_skip: 'session_moved' },
    })
  })

  test('It reports the setting off before any skip reason', () => {
    expect(decideContinue({ ...MID_FLIGHT, isEnabled: false, signal: 'strong', isSameSession: false })).toEqual({
      submit: false,
      fields: { continued: 'off' },
    })
  })
})

test('It tells Claude to continue from the handoff note', () => {
  expect(CONTINUE_PROMPT).toBe('Continue from the handoff note.')
})
