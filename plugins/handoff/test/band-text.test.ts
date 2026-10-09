import { expect, test } from 'claude-code/testing'

import { BAND_HINT, BUTTON_LABELS, bandControls, bandMessage } from '../hooks/band-text'
import { bandButtons } from '../hooks/signals'

const messageCases = [
  [
    { signal: 'strong', contextTokens: 152_400, heldPrompt: true, isBusy: false },
    'Context is 152k and this prompt starts new work.',
  ],
  [
    { signal: 'strong', contextTokens: 152_400, heldPrompt: false, isBusy: false },
    'Context is 152k and the task just finished.',
  ],
  [
    { signal: 'weak', contextTokens: 190_000, heldPrompt: false, isBusy: true },
    'Context is 190k and background work is still running.',
  ],
  [
    { signal: 'weak', contextTokens: 190_000, heldPrompt: false, isBusy: false },
    'Context is 190k.',
  ],
] as const

for (const [offer, opening] of messageCases) {
  test(`It opens with "${opening}" from bandMessage for ${JSON.stringify(offer)}`, () => {
    expect(bandMessage(offer)).toStartWith(opening)
  })

  test(`It says accuracy drops as context grows from bandMessage for ${JSON.stringify(offer)}`, () => {
    expect(bandMessage(offer)).toContain('Accuracy drops as context grows.')
  })
}

const questionCases = [
  [
    { signal: 'strong', contextTokens: 152_400, heldPrompt: true, isBusy: false },
    'Hand off and send it in a fresh session, or send it here?',
  ],
  [
    { signal: 'strong', contextTokens: 152_400, heldPrompt: false, isBusy: false },
    'Hand off to a fresh session now?',
  ],
  [
    { signal: 'weak', contextTokens: 190_000, heldPrompt: false, isBusy: true },
    'A handoff would orphan that work, so compact instead?',
  ],
  [
    { signal: 'weak', contextTokens: 190_000, heldPrompt: false, isBusy: false },
    'Hand off to a fresh session, or compact?',
  ],
] as const

for (const [offer, question] of questionCases) {
  test(`It ends with "${question}" from bandMessage for ${JSON.stringify(offer)}`, () => {
    expect(bandMessage(offer)).toEndWith(question)
  })
}

test('It warns that a handoff would orphan background work from bandMessage', () => {
  const message = bandMessage({ signal: 'weak', contextTokens: 190_000, heldPrompt: false, isBusy: true })
  expect(message).toContain('orphan')
})

const labelCases = [
  ['handoff', 'Hand off and clear'],
  ['handoff-send', 'Hand off and send it'],
  ['send-here', 'Send here'],
  ['compact', 'Compact'],
  ['not-now', 'Not now'],
] as const

for (const [button, label] of labelCases) {
  test(`It returns ${label} from BUTTON_LABELS for ${button}`, () => {
    expect(BUTTON_LABELS[button]).toBe(label)
  })
}

test('It points to handoffMode act in BAND_HINT', () => {
  expect(BAND_HINT).toContain('handoffMode')
  expect(BAND_HINT).toContain('act')
})

test('It tells the person to type a digit in BAND_HINT', () => {
  expect(BAND_HINT).toContain('Type a digit')
})

const controlCases = [
  ['strong', ['handoff', 'not-now'], ['1', '0'], 'handoff'],
  ['weak', ['handoff', 'compact', 'not-now'], ['1', '2', '0'], 'compact'],
  ['weak', ['compact', 'not-now'], ['1', '0'], 'compact'],
  ['strong', ['handoff-send', 'send-here'], ['1', '2'], 'handoff-send'],
] as const

for (const [signal, buttons, hotkeys, primary] of controlCases) {
  test(`It returns hotkeys ${hotkeys.join(',')} from bandControls for ${signal} ${buttons.join(',')}`, () => {
    expect(bandControls(buttons, signal).map(control => control.hotkey)).toEqual(hotkeys)
  })

  test(`It returns unique hotkeys from bandControls for ${signal} ${buttons.join(',')}`, () => {
    const keys = bandControls(buttons, signal).map(control => control.hotkey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test(`It marks only ${primary} primary from bandControls for ${signal} ${buttons.join(',')}`, () => {
    expect(bandControls(buttons, signal).filter(control => control.isPrimary).map(control => control.button)).toEqual([primary])
  })
}

test('It marks Not now as the dismiss with hotkey 0 from bandControls', () => {
  const dismiss = bandControls(['handoff', 'not-now'], 'strong').find(control => control.button === 'not-now')
  expect(dismiss).toEqual({ button: 'not-now', hotkey: '0', isPrimary: false, isDismiss: true })
})

test('It marks no held-prompt button as dismiss from bandControls', () => {
  expect(bandControls(['handoff-send', 'send-here'], 'strong').some(control => control.isDismiss)).toBe(false)
})

const everyShape = [
  { signal: 'strong', heldPrompt: true, isBusy: false },
  { signal: 'strong', heldPrompt: false, isBusy: false },
  { signal: 'weak', heldPrompt: false, isBusy: true },
  { signal: 'weak', heldPrompt: false, isBusy: false },
] as const

for (const shape of everyShape) {
  test(`It gives every button bandButtons returns a unique hotkey for ${JSON.stringify(shape)}`, () => {
    const hotkeys = bandControls(bandButtons(shape), shape.signal).map(control => control.hotkey)
    expect(new Set(hotkeys).size).toBe(bandButtons(shape).length)
  })
}
