import type { EngineInterface } from 'claude-code'

// Declared as functions: the engine follows `$` past an import only into a function declaration, not a const arrow.
export function debug($: EngineInterface, line: string): void {
  return $.ui.log(`meter: ${line}`, { to: 'debug' })
}

// Catches what background work leaves uncaught: a refused open, pane list or store write. It never rethrows.
export function logFailure($: EngineInterface, work: Promise<unknown>): Promise<unknown> {
  return work.catch(error => debug($, `background work failed: ${String(error)}`))
}
