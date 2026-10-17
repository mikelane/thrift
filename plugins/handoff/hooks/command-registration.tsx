import type { EngineInterface } from 'claude-code'

import { debug } from './engine-log'

export async function registerHandoffCommand($: EngineInterface): Promise<void> {
  try {
    await $.command.register({
      name: 'handoff',
      description: 'Write a handoff, clear, and continue in a fresh session',
    })
  } catch (error) {
    debug($, `could not register /handoff: ${String(error)}`)
  }
}
