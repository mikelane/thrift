import type { EngineInterface } from 'claude-code'

// Declared as functions: the engine follows `$` past an import only into a function declaration, not a const arrow.
export function debug($: EngineInterface, line: string): void {
  return $.ui.log(`reread: ${line}`, { to: 'debug' })
}
