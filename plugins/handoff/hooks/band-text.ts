import type { Offer } from '../types'
import { formatTokens, type Button } from './signals'

export const BUTTON_LABELS: Readonly<Record<Button, string>> = {
  handoff: 'Hand off and clear',
  'handoff-send': 'Hand off and send it',
  'send-here': 'Send here',
  compact: 'Compact',
  'not-now': 'Not now',
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

const ACT_MODE_HINT = 'Set handoffMode to act in /config to skip asking.'

const hintFor = ({ signal, heldPrompt, isBusy }: Offer): string => {
  const { handoff, 'send-here': sendHere, 'not-now': dismiss } = HOTKEYS
  if (heldPrompt) {
    return isBusy
      ? 'ctrl+x Tab, then Enter to send it here.'
      : `ctrl+x Tab, then Enter to hand off and send it, or ${sendHere} to send it here.`
  }
  if (isBusy) return `ctrl+x Tab, then Enter to compact. ${dismiss} to dismiss.`
  if (signal === 'strong') return `ctrl+x Tab, then Enter to hand off. ${dismiss} to dismiss.`
  return `ctrl+x Tab, then Enter to compact or ${handoff} to hand off. ${dismiss} to dismiss.`
}

export const bandHint = (offer: Offer): string => `${hintFor(offer)} ${ACT_MODE_HINT}`

type BandControl = {
  button: Button
  hotkey: string
  isPrimary: boolean
  isDismiss: boolean
}

// The recommended button is the first action, so focus lands on the first button of every band.
export const bandControls = (buttons: readonly Button[]): readonly BandControl[] => {
  const recommended = buttons.find(button => button !== 'not-now')
  return buttons.map(button => ({
    button,
    hotkey: HOTKEYS[button],
    isPrimary: button === recommended,
    isDismiss: button === 'not-now',
  }))
}

const CLEARS_SESSION: Readonly<Record<Button, boolean>> = {
  handoff: true,
  'handoff-send': true,
  'send-here': false,
  compact: false,
  'not-now': false,
}

export const clearsSession = (button: Button): boolean => CLEARS_SESSION[button]

// classify() gives a weak signal whenever work is busy; a held prompt keeps its own signal.
export const offerWithBusyState = (offer: Offer, contextTokens: number, isBusy: boolean): Offer => ({
  ...offer,
  contextTokens,
  isBusy,
  signal: isBusy && !offer.heldPrompt ? 'weak' : offer.signal,
})

export const isSameOffer = (a: Offer, b: Offer): boolean =>
  a.signal === b.signal && a.contextTokens === b.contextTokens && a.heldPrompt === b.heldPrompt && a.isBusy === b.isBusy

const question = ({ signal, heldPrompt, isBusy }: Offer): string => {
  if (heldPrompt && isBusy) return 'A handoff would orphan that work, so send it here?'
  if (heldPrompt) return 'Hand off and send it in a fresh session, or send it here?'
  if (signal === 'strong') return 'Hand off to a fresh session now?'
  if (isBusy) return 'A handoff would orphan that work, so compact instead?'
  return 'Compact, or hand off to a fresh session?'
}

const situation = ({ signal, contextTokens, heldPrompt, isBusy }: Offer): string => {
  const context = `Context is ${formatTokens(contextTokens)}`
  if (heldPrompt) return `${context} and this prompt starts new work.`
  if (signal === 'strong') return `${context} and the task just finished.`
  return isBusy ? `${context} and background work is still running.` : `${context}.`
}

export const bandMessage = (offer: Offer): string =>
  `${situation(offer)} Accuracy drops as context grows. ${question(offer)}`
