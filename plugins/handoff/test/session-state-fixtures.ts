import { type HeldPrompt } from '../hooks/session-state'

export const settings = { setting: 'ask', threshold: 120_000, compactBeforeClear: true, continueAfterHandoff: false } as const

export const person = { text: 'person says', isUnattended: false, origin: 'composer', author: 'person' } satisfies HeldPrompt

export const nightly = { text: 'nightly job', isUnattended: true, origin: 'scheduled-trigger', author: 'person' } satisfies HeldPrompt
