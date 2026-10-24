import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { debug } from './engine-log'

// Kept in the store, not a closure: the engine can start the plugin again mid-session, and no session.start follows.
const interactivity = atom({ plugin: 'meter', key: 'isInteractive' } as const, false, { shape: 'interactive-1' })

export async function rememberInteractivity($: EngineInterface, isInteractive: boolean): Promise<void> {
  await update($, interactivity, () => isInteractive)
}

export async function isInteractiveSession($: EngineInterface): Promise<boolean> {
  try {
    return await read($, interactivity)
  } catch (error) {
    debug($, `could not read whether the session is interactive: ${String(error)}`)
    return false
  }
}
