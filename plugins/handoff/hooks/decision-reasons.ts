export const DECISION_REASONS = [
  'backoff',
  'compaction_vetoed',
  'compaction_failed',
  'no_handoff_written',
  'handoff_failed',
  'clear_failed',
  'session_ended',
  'band_failed',
  'not_now',
  'send_here',
  'background_busy',
] as const

export type DecisionReason = (typeof DECISION_REASONS)[number]
