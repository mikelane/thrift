import { type HeldPrompt } from '../hooks/session-state'

export const settings = { setting: 'ask', threshold: 120_000, compactBeforeClear: true } as const

export const person = { text: 'person says', isUnattended: false, origin: 'composer' } satisfies HeldPrompt

export const nightly = { text: 'nightly job', isUnattended: true, origin: 'scheduled-trigger' } satisfies HeldPrompt
