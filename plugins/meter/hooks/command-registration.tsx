import type { EngineInterface } from 'claude-code'

import { debug } from './engine-log'

export async function registerMeterCommand($: EngineInterface): Promise<void> {
  try {
    await $.command.register({
      name: 'meter',
      description: 'Open or close the usage meter pane. /meter refresh takes a full count',
    })
  } catch (error) {
    debug($, `could not register /meter: ${String(error)}`)
  }
}
