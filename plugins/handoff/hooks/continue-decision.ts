import type { NoteDelivery } from './handoff-note'
import type { Mode, Signal } from './signals'

export type ContinueSkip = 'strong_signal' | 'note_not_appended' | 'held_prompt_sent' | 'session_moved' | 'submit_failed'

export type ContinueFields =
  | { continued: 'off' }
  | { continued: 'submitted' }
  | { continued: 'skipped'; continue_skip: ContinueSkip }

export type ContinueDecision = { submit: true } | { submit: false; fields: ContinueFields }

export type ContinueInput = {
  isEnabled: boolean
  effectiveMode: Mode
  signal: Signal
  noteDelivery: NoteDelivery
  hasHeldPromptStartedTurn: boolean
  isSameSession: boolean
}

export const CONTINUE_PROMPT = 'Continue from the handoff note.'

const skipped = (reason: ContinueSkip): ContinueDecision => ({ submit: false, fields: { continued: 'skipped', continue_skip: reason } })

// Mid-flight work is a handoff that began on a weak signal. A typed /handoff carries no signal ('none'), so it is not
// mid-flight: the person who typed it is at the terminal.
export const decideContinue = ({
  isEnabled,
  effectiveMode,
  signal,
  noteDelivery,
  hasHeldPromptStartedTurn,
  isSameSession,
}: ContinueInput): ContinueDecision => {
  if (!isEnabled || effectiveMode === 'off') return { submit: false, fields: { continued: 'off' } }
  if (signal !== 'weak') return skipped('strong_signal')
  if (noteDelivery !== 'appended') return skipped('note_not_appended')
  if (hasHeldPromptStartedTurn) return skipped('held_prompt_sent')
  if (!isSameSession) return skipped('session_moved')
  return { submit: true }
}
