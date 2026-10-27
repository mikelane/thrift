import type { ReadMode } from '../types'

const MODES: readonly ReadMode[] = ['off', 'ask', 'act']

export const asReadMode = (value: unknown): ReadMode => MODES.find(mode => mode === value) ?? 'off'
