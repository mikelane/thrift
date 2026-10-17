import type { EngineInterface } from 'claude-code'

export function announce($: EngineInterface, message: string): void {
  $.ui.log(message)
  $.ui.toast(message)
}
