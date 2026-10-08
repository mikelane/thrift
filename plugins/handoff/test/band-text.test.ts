import { expect, test } from 'claude-code/testing'

import { BAND_HINT, BUTTON_LABELS, bandMessage } from '../hooks/band-text'

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
