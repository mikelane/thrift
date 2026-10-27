export const DECISION_REASONS = [
  'first_read',
  'exact_repeat',
  'inside_full_read',
  'changed',
  'different_range',
  'not_text',
  'pdf_pages',
  'error_result',
  'token_cap_truncated',
  'not_in_context',
  'plugin_call',
  'override_after_stub',
  'stub_not_smaller',
  'core_dedup',
  'unreadable',
  'untested_engine',
  'compaction',
  'clear',
  'edit',
  'bash',
] as const

export type DecisionReason = (typeof DECISION_REASONS)[number]
