import type { BandState, Offer, Writing } from '../types'
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

const hintFor = ({ signal, hasHeldPrompt, isBusy }: Offer): string => {
  const { handoff, 'send-here': sendHere, 'not-now': dismiss } = HOTKEYS
  if (hasHeldPrompt) {
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

// classify() gives a weak signal whenever work is busy; a held prompt keeps its own signal. Once the work is no longer busy
// the band goes back to the signal it was raised on, so a band raised strong is not left weak by a busy redraw.
export const offerWithBusyState = (offer: Offer, contextTokens: number, isBusy: boolean, raisedSignal: Offer['signal']): Offer => ({
  ...offer,
  contextTokens,
  isBusy,
  signal: isBusy && !offer.hasHeldPrompt ? 'weak' : raisedSignal,
})

export const WRITING: Writing = { isWriting: true, stage: 'note' }

export const WAITING: Writing = { isWriting: true, stage: 'wait' }

export const WRITING_STATUS = 'Writing a handoff note — this takes a few seconds…'

export const WAITING_STATUS = 'Handoff note written. The handoff continues when the current turn ends. Your prompts stay held.'

export const statusText = ({ stage }: Writing): string => (stage === 'wait' ? WAITING_STATUS : WRITING_STATUS)

export const isWriting = (band: BandState): band is Writing => 'isWriting' in band

export const isSameOffer = (a: BandState, b: BandState): boolean =>
  !isWriting(a) &&
  !isWriting(b) &&
  a.signal === b.signal && a.contextTokens === b.contextTokens && a.hasHeldPrompt === b.hasHeldPrompt && a.isBusy === b.isBusy

const question = ({ signal, hasHeldPrompt, isBusy }: Offer): string => {
  if (hasHeldPrompt && isBusy) return 'Background work is still running, and its results would reach a fresh session without this conversation, so send it here?'
  if (hasHeldPrompt) return 'Hand off and send it in a fresh session, or send it here?'
  if (signal === 'strong') return 'Hand off to a fresh session now?'
  if (isBusy) return 'Background work is still running, and its results would reach a fresh session without this conversation, so compact instead?'
  return 'Compact, or hand off to a fresh session?'
}

const situation = ({ signal, contextTokens, hasHeldPrompt }: Offer): string => {
  const context = `Context is ${formatTokens(contextTokens)}`
  if (hasHeldPrompt) return `${context} and this prompt starts new work.`
  if (signal === 'strong') return `${context} and the task just finished.`
  return `${context}.`
}

export const bandMessage = (offer: Offer): string =>
  `${situation(offer)} Accuracy drops as context grows. ${question(offer)}`
