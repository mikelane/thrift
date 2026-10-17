import type { EngineInterface } from 'claude-code'

// Declared as functions: the engine follows `$` past an import only into a function declaration, not a const arrow.
export function debug($: EngineInterface, line: string) {
  return $.ui.log(`handoff: ${line}`, { to: 'debug' })
}

// SAFETY: every current caller catches its own engine failures, so no test reaches this catch.
// Keep it: it is the only guard against an unhandled rejection if a future caller forgets.
export function logFailure($: EngineInterface, work: Promise<unknown>) {
  return work.catch(error => debug($, `background work failed: ${String(error)}`))
}
