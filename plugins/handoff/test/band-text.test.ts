import { expect, test } from 'claude-code/testing'

import { BUTTON_LABELS, bandControls, bandHint, bandMessage, offerWithBusyState, clearsSession, isSameOffer, isWriting, WRITING } from '../hooks/band-text'
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
    { signal: 'strong', contextTokens: 152_400, heldPrompt: true, isBusy: true },
    'A handoff would orphan that work, so send it here?',
  ],
  [
    { signal: 'weak', contextTokens: 190_000, heldPrompt: false, isBusy: true },
    'A handoff would orphan that work, so compact instead?',
  ],
  [
    { signal: 'weak', contextTokens: 190_000, heldPrompt: false, isBusy: false },
    'Compact, or hand off to a fresh session?',
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

const hintCases = [
  [
    { signal: 'weak', contextTokens: 190_000, heldPrompt: false, isBusy: false },
    'ctrl+x Tab, then Enter to compact or h to hand off. 0 to dismiss.',
  ],
  [
    { signal: 'weak', contextTokens: 190_000, heldPrompt: false, isBusy: true },
    'ctrl+x Tab, then Enter to compact. 0 to dismiss.',
  ],
  [
    { signal: 'strong', contextTokens: 152_400, heldPrompt: false, isBusy: false },
    'ctrl+x Tab, then Enter to hand off. 0 to dismiss.',
  ],
  [
    { signal: 'strong', contextTokens: 152_400, heldPrompt: true, isBusy: false },
    'ctrl+x Tab, then Enter to hand off and send it, or s to send it here.',
  ],
  [
    { signal: 'strong', contextTokens: 152_400, heldPrompt: true, isBusy: true },
    'ctrl+x Tab, then Enter to send it here.',
  ],
] as const

for (const [offer, hint] of hintCases) {
  test(`It starts with "${hint}" from bandHint for ${JSON.stringify(offer)}`, () => {
    expect(bandHint(offer)).toStartWith(hint)
  })

  test(`It points to handoffMode act from bandHint for ${JSON.stringify(offer)}`, () => {
    expect(bandHint(offer)).toEndWith('Set handoffMode to act in /config to skip asking.')
  })
}

test('It never tells a held-prompt band to type 0 from bandHint', () => {
  expect(bandHint({ signal: 'strong', contextTokens: 152_400, heldPrompt: true, isBusy: false })).not.toContain('0')
})

const controlCases = [
  [['handoff', 'not-now'], ['h', '0'], 'handoff'],
  [['compact', 'handoff', 'not-now'], ['c', 'h', '0'], 'compact'],
  [['compact', 'not-now'], ['c', '0'], 'compact'],
  [['handoff-send', 'send-here'], ['h', 's'], 'handoff-send'],
  [['send-here'], ['s'], 'send-here'],
] as const

for (const [buttons, hotkeys, primary] of controlCases) {
  test(`It returns hotkeys ${hotkeys.join(',')} from bandControls for ${buttons.join(',')}`, () => {
    expect(bandControls(buttons).map(control => control.hotkey)).toEqual(hotkeys)
  })

  test(`It returns unique hotkeys from bandControls for ${buttons.join(',')}`, () => {
    const keys = bandControls(buttons).map(control => control.hotkey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test(`It marks only ${primary} primary from bandControls for ${buttons.join(',')}`, () => {
    expect(bandControls(buttons).filter(control => control.isPrimary).map(control => control.button)).toEqual([primary])
  })
}

test('It gives only Not now a digit hotkey from bandControls', () => {
  const digits = bandControls(['compact', 'handoff', 'not-now']).filter(control => /\d/.test(control.hotkey))
  expect(digits.map(control => control.button)).toEqual(['not-now'])
})

test('It marks Not now as the dismiss with hotkey 0 from bandControls', () => {
  const dismiss = bandControls(['handoff', 'not-now']).find(control => control.button === 'not-now')
  expect(dismiss).toEqual({ button: 'not-now', hotkey: '0', isPrimary: false, isDismiss: true })
})

test('It marks no held-prompt button as dismiss from bandControls', () => {
  expect(bandControls(['handoff-send', 'send-here']).some(control => control.isDismiss)).toBe(false)
})

const everyShape = [
  { signal: 'strong', heldPrompt: true, isBusy: false },
  { signal: 'strong', heldPrompt: true, isBusy: true },
  { signal: 'strong', heldPrompt: false, isBusy: false },
  { signal: 'weak', heldPrompt: false, isBusy: true },
  { signal: 'weak', heldPrompt: false, isBusy: false },
] as const

for (const shape of everyShape) {
  test(`It gives every button bandButtons returns a unique hotkey for ${JSON.stringify(shape)}`, () => {
    const hotkeys = bandControls(bandButtons(shape)).map(control => control.hotkey)
    expect(new Set(hotkeys).size).toBe(bandButtons(shape).length)
  })

  // Focus lands on the first button, so the primary must be first for every band bandButtons draws.
  test(`It lists the primary button first from bandControls for ${JSON.stringify(shape)}`, () => {
    expect(bandControls(bandButtons(shape))[0]?.isPrimary).toBe(true)
  })
}

const clearsSessionCases = [
  ['handoff', true],
  ['handoff-send', true],
  ['send-here', false],
  ['compact', false],
  ['not-now', false],
] as const

for (const [button, clears] of clearsSessionCases) {
  test(`It returns ${clears} for ${button} from clearsSession`, () => {
    expect(clearsSession(button)).toBe(clears)
  })
}

const strongOffer = { signal: 'strong', contextTokens: 150_000, heldPrompt: false, isBusy: false } as const

test('It returns a weak signal for a busy band with no held prompt from offerWithBusyState', () => {
  expect(offerWithBusyState(strongOffer, 160_000, true)).toEqual({ ...strongOffer, contextTokens: 160_000, isBusy: true, signal: 'weak' })
})

test('It keeps the signal of a busy band holding a prompt from offerWithBusyState', () => {
  const held = { ...strongOffer, heldPrompt: true }
  expect(offerWithBusyState(held, 160_000, true)).toEqual({ ...held, contextTokens: 160_000, isBusy: true })
})

test('It keeps the signal of a band that is not busy from offerWithBusyState', () => {
  expect(offerWithBusyState({ ...strongOffer, isBusy: true }, 160_000, false)).toEqual({ ...strongOffer, contextTokens: 160_000 })
})

test('It returns true for offers with equal fields from isSameOffer', () => {
  expect(isSameOffer(strongOffer, { ...strongOffer })).toBe(true)
})

const differingOffers = [
  { ...strongOffer, signal: 'weak' },
  { ...strongOffer, contextTokens: 1 },
  { ...strongOffer, heldPrompt: true },
  { ...strongOffer, isBusy: true },
] as const

for (const other of differingOffers) {
  test(`It returns false for ${JSON.stringify(other)} against a strong offer from isSameOffer`, () => {
    expect(isSameOffer(strongOffer, other)).toBe(false)
  })
}

test('It returns true for the writing state from isWriting', () => {
  expect(isWriting(WRITING)).toBe(true)
})

test('It returns false for an offer from isWriting', () => {
  expect(isWriting(strongOffer)).toBe(false)
})

test('It returns false when the first band is the writing state from isSameOffer', () => {
  expect(isSameOffer(WRITING, strongOffer)).toBe(false)
})

test('It returns false when the second band is the writing state from isSameOffer', () => {
  expect(isSameOffer(strongOffer, WRITING)).toBe(false)
})

test('It returns false for two writing states from isSameOffer', () => {
  expect(isSameOffer(WRITING, WRITING)).toBe(false)
})
