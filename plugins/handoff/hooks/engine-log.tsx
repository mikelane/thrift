import type { EngineInterface } from 'claude-code'

// Declared as functions: the engine follows `$` past an import only into a function declaration, not a const arrow.
export function debug($: EngineInterface, line: string): void {
  return $.ui.log(`handoff: ${line}`, { to: 'debug' })
}

// SAFETY: every current caller catches its own engine failures, so no test reaches this catch.
// Keep it: it is the only guard against an unhandled rejection if a future caller forgets.
export function logFailure($: EngineInterface, work: Promise<unknown>): Promise<unknown> {
  return work.catch(error => debug($, `background work failed: ${String(error)}`))
}

export function announce($: EngineInterface, message: string): void {
  $.ui.log(message)
  $.ui.toast(message)
}

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
