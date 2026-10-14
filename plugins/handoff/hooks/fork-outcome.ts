import type { ModelForkResult } from 'claude-code'

// The one non-answer that says why, and that a person can fix: the session has no reply to fork yet.
// Taken from the engine's declaration, so tsc fails here if the engine renames or drops that reason.
export type ForkReason = Extract<Extract<ModelForkResult, { isAnswered: false }>['reason'], 'nothing-to-fork'>

export type NoteOutcome = { note: string } | { note: null; forkReason?: ForkReason }

type ForkAnswer = { isAnswered: true; text: string } | { isAnswered: false; reason: string }

export const noteOutcome = (answer: ForkAnswer): NoteOutcome => {
  if (answer.isAnswered) {
    const note = answer.text.trim()
    return note === '' ? { note: null } : { note }
  }
  return answer.reason === 'nothing-to-fork' ? { note: null, forkReason: answer.reason } : { note: null }
}
