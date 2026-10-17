import type { SessionState } from './session-state'

// Once a session end decided the outcome, no clear will run: the wait is for delivering the note or for stopping.
const WAIT_STARTED_LINES = {
  none: 'waiting for a running turn to end before the handoff goes on',
  cleared_by_person: 'waiting for a running turn to end before delivering the note',
  other: 'waiting for a running turn to end before stopping the handoff',
} as const satisfies Record<'none' | NonNullable<SessionState['sessionEndBeforeClear']>, string>

export const waitStartedLine = (state: Pick<SessionState, 'sessionEndBeforeClear'>): string =>
  WAIT_STARTED_LINES[state.sessionEndBeforeClear ?? 'none']
