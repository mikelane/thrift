import type { EngineInterface } from 'claude-code'

import { debug } from './engine-log'
import type { SessionState } from './session-state'

const BUSY_AGENT_STATUSES = new Set(['pending', 'running', 'waiting'])

export async function isBackgroundBusy($: EngineInterface, state: SessionState): Promise<boolean> {
  if (state.backgroundTasks.size > 0) return true
  try {
    return (await $.agent.list()).some(agent => BUSY_AGENT_STATUSES.has(agent.status))
  } catch (error) {
    debug($, `could not list agents, treating background work as busy: ${String(error)}`)
    return true
  }
}
