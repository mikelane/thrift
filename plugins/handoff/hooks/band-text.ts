import type { Offer } from '../types'
import { formatTokens, type Button } from './signals'

export const BUTTON_LABELS: Readonly<Record<Button, string>> = {
  handoff: 'Hand off and clear',
  'handoff-send': 'Hand off and send it',
  'send-here': 'Send here',
  compact: 'Compact',
  'not-now': 'Not now',
}

export const BAND_HINT = 'Type a digit in an empty prompt to choose. Set handoffMode to act in /config to skip this.'

export type BandControl = {
  button: Button
  hotkey: string
  isPrimary: boolean
  isDismiss: boolean
}

const DISMISS_HOTKEY = '0'

export const bandControls = (buttons: readonly Button[]): readonly BandControl[] => {
  const actions = buttons.filter(button => button !== 'not-now')
  return buttons.map(button =>
    button === 'not-now'
      ? { button, hotkey: DISMISS_HOTKEY, isPrimary: false, isDismiss: true }
      : { button, hotkey: String(actions.indexOf(button) + 1), isPrimary: button === actions[0], isDismiss: false },
  )
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
