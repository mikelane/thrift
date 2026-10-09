import type { Offer } from '../types'
import { formatTokens, type Button, type Signal } from './signals'

export const BUTTON_LABELS: Readonly<Record<Button, string>> = {
  handoff: 'Hand off and clear',
  'handoff-send': 'Hand off and send it',
  'send-here': 'Send here',
  compact: 'Compact',
  'not-now': 'Not now',
}

const ACT_MODE_HINT = 'Set handoffMode to act in /config to skip this.'

const hintFor = ({ signal, heldPrompt, isBusy }: Offer): string => {
  if (heldPrompt) {
    return isBusy
      ? 'ctrl+x Tab, then Enter to send it here.'
      : 'ctrl+x Tab, then Enter to hand off and send it, or s to send it here.'
  }
  if (isBusy) return 'ctrl+x Tab, then Enter to compact. 0 to dismiss.'
  if (signal === 'strong') return 'ctrl+x Tab, then Enter to hand off. 0 to dismiss.'
  return 'ctrl+x Tab, then Enter to compact or h to hand off. 0 to dismiss.'
}

export const bandHint = (offer: Offer): string => `${hintFor(offer)} ${ACT_MODE_HINT}`

export type BandControl = {
  button: Button
  hotkey: string
  isPrimary: boolean
  isDismiss: boolean
}

// Actions take letters, which work only once the band holds focus; a bare digit in an empty prompt presses a
// band button, so the digit is reserved for the dismiss and cannot be hit by answering Claude's numbered questions.
const HOTKEYS: Readonly<Record<Button, string>> = {
  handoff: 'h',
  'handoff-send': 'h',
  'send-here': 's',
  compact: 'c',
  'not-now': '0',
}

// The highlight follows the plugin's own pick (compact for a weak signal), whatever the display order.
export const bandControls = (buttons: readonly Button[], signal: Signal): readonly BandControl[] => {
  const actions = buttons.filter(button => button !== 'not-now')
  const recommended = signal === 'weak' ? 'compact' : actions[0]
  return buttons.map(button => ({
    button,
    hotkey: HOTKEYS[button],
    isPrimary: button === recommended,
    isDismiss: button === 'not-now',
  }))
}

const question = ({ signal, heldPrompt, isBusy }: Offer): string => {
  if (heldPrompt) return 'Hand off and send it in a fresh session, or send it here?'
  if (signal === 'strong') return 'Hand off to a fresh session now?'
  if (isBusy) return 'A handoff would orphan that work, so compact instead?'
  return 'Hand off to a fresh session, or compact?'
}

const situation = ({ signal, contextTokens, heldPrompt, isBusy }: Offer): string => {
  const context = `Context is ${formatTokens(contextTokens)}`
  if (heldPrompt) return `${context} and this prompt starts new work.`
  if (signal === 'strong') return `${context} and the task just finished.`
  return isBusy ? `${context} and background work is still running.` : `${context}.`
}

export const bandMessage = (offer: Offer): string =>
  `${situation(offer)} Accuracy drops as context grows. ${question(offer)}`
