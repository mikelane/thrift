import type { Offer } from '../types'
import { formatTokens, type Button } from './signals'

export const BUTTON_LABELS: Readonly<Record<Button, string>> = {
  handoff: 'Hand off and clear',
  'handoff-send': 'Hand off and send it',
  'send-here': 'Send here',
  compact: 'Compact',
  'not-now': 'Not now',
}

export const BAND_HINT = 'Set handoffMode to act in /config to do this without asking.'

const question = ({ signal, heldPrompt, isBusy }: Offer): string => {
  if (heldPrompt) return 'Hand off and send it in a fresh session, or send it here?'
  if (signal === 'strong') return 'Hand off to a fresh session now?'
  if (isBusy) return 'A handoff would orphan it, so compact instead?'
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
