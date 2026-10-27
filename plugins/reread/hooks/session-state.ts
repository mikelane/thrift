import type { ReadMode } from '../types'
import type { RecordSetting } from './decision-record'
import { dropAll, newReads, type Reads } from './read-tracking'

export type SessionState = {
  setting: ReadMode
  reads: Reads
  // Random, in memory, for one session: it keeps the logged path hash from being looked up against a list of paths.
  salt: string
  // The engine's version and the mode it allows, settled on first use and kept for the life of the plugin.
  engine?: Promise<RecordSetting>
}

export const createState = (setting: ReadMode): SessionState => ({ setting, reads: newReads(), salt: crypto.randomUUID() })

// A session ending drops everything the plugin tracked, whatever the reason: /clear, resume, branch and exit all leave a
// context the stubs would no longer point into.
export const endSession = (state: SessionState): number => {
  const dropped = dropAll(state.reads)
  state.salt = crypto.randomUUID()
  return dropped
}
