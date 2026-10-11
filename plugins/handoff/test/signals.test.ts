import { expect, test } from 'claude-code/testing'

import {
  asMode,
  asThreshold,
  bandButtons,
  busyRefusalTrigger,
  classify,
  contextFromStep,
  formatTokens,
  respond,
} from '../hooks/signals'

const asModeCases = [
  ['off', 'off'],
  ['ask', 'ask'],
  ['act', 'act'],
  ['ACT', 'off'],
  ['', 'off'],
  [undefined, 'off'],
  [3, 'off'],
] as const

for (const [input, expected] of asModeCases) {
  test(`It returns ${expected} from asMode for ${JSON.stringify(input)}`, () => {
    expect(asMode(input)).toBe(expected)
  })
}

const formatTokensCases = [
  [0, '0k'],
  [499, '0k'],
  [500, '1k'],
  [152_400, '152k'],
  [1_500, '2k'],
  [1_999_600, '2000k'],
] as const

for (const [tokens, expected] of formatTokensCases) {
  test(`It returns ${expected} from formatTokens for ${tokens}`, () => {
    expect(formatTokens(tokens)).toBe(expected)
  })
}

const classifyCases = [
  [{ contextTokens: 149_999, isStoppingPoint: true, isBackgroundBusy: false }, 'none'],
  [{ contextTokens: 150_000, isStoppingPoint: true, isBackgroundBusy: false }, 'strong'],
  [{ contextTokens: 200_000, isStoppingPoint: true, isBackgroundBusy: false }, 'strong'],
  [{ contextTokens: 200_000, isStoppingPoint: false, isBackgroundBusy: false }, 'weak'],
  [{ contextTokens: 200_000, isStoppingPoint: true, isBackgroundBusy: true }, 'weak'],
  [{ contextTokens: 200_000, isStoppingPoint: false, isBackgroundBusy: true }, 'weak'],
  [{ contextTokens: 100, isStoppingPoint: true, isBackgroundBusy: true }, 'none'],
] as const

for (const [input, expected] of classifyCases) {
  test(`It returns ${expected} from classify for ${JSON.stringify(input)}`, () => {
    expect(classify({ ...input, threshold: 150_000 })).toBe(expected)
  })
}

const respondCases = [
  [{ mode: 'off', signal: 'strong', stoppingPoint: 'finished-task' }, { kind: 'none' }],
  [{ mode: 'off', signal: 'weak', stoppingPoint: null }, { kind: 'none' }],
  [{ mode: 'ask', signal: 'none', stoppingPoint: null }, { kind: 'none' }],
  [{ mode: 'act', signal: 'none', stoppingPoint: 'finished-task' }, { kind: 'none' }],
  [
    { mode: 'ask', signal: 'strong', stoppingPoint: 'finished-task' },
    { kind: 'advise', holdsPrompt: false, buttons: ['handoff', 'not-now'] },
  ],
  [{ mode: 'act', signal: 'strong', stoppingPoint: 'finished-task' }, { kind: 'handoff', holdsPrompt: false }],
  [
    { mode: 'ask', signal: 'strong', stoppingPoint: 'new-work' },
    { kind: 'advise', holdsPrompt: true, buttons: ['handoff-send', 'send-here'] },
  ],
  [{ mode: 'act', signal: 'strong', stoppingPoint: 'new-work' }, { kind: 'handoff', holdsPrompt: true }],
  [
    { mode: 'ask', signal: 'weak', stoppingPoint: null, isBackgroundBusy: true },
    { kind: 'advise', holdsPrompt: false, buttons: ['compact', 'not-now'] },
  ],
  [{ mode: 'act', signal: 'weak', stoppingPoint: null, isBackgroundBusy: true }, { kind: 'compact' }],
  [
    { mode: 'ask', signal: 'weak', stoppingPoint: 'finished-task', isBackgroundBusy: true },
    { kind: 'advise', holdsPrompt: false, buttons: ['compact', 'not-now'] },
  ],
  [
    { mode: 'ask', signal: 'weak', stoppingPoint: null },
    { kind: 'advise', holdsPrompt: false, buttons: ['compact', 'handoff', 'not-now'] },
  ],
  [{ mode: 'act', signal: 'weak', stoppingPoint: null }, { kind: 'compact' }],
  [{ mode: 'ask', signal: 'strong', stoppingPoint: 'finished-task', isUnattended: true }, { kind: 'handoff', holdsPrompt: false }],
  [{ mode: 'act', signal: 'strong', stoppingPoint: 'new-work', isUnattended: true }, { kind: 'handoff', holdsPrompt: true }],
  [{ mode: 'off', signal: 'strong', stoppingPoint: 'new-work', isUnattended: true }, { kind: 'none' }],
  [{ mode: 'ask', signal: 'weak', stoppingPoint: null, isUnattended: true }, { kind: 'none' }],
  [{ mode: 'act', signal: 'weak', stoppingPoint: null, isUnattended: true }, { kind: 'none' }],
] as const

for (const [input, expected] of respondCases) {
  test(`It returns ${JSON.stringify(expected)} from respond for ${JSON.stringify(input)}`, () => {
    expect(respond({ isBackgroundBusy: false, isUnattended: false, ...input })).toEqual(expected)
  })
}

const thresholdCases = [
  [150_000, 150_000],
  [80_000, 80_000],
  [2_000_000, 2_000_000],
  [79_999, 80_000],
  [10, 80_000],
  [2_000_001, 2_000_000],
  [Number.NaN, 150_000],
  [Number.POSITIVE_INFINITY, 150_000],
  ['200000', 150_000],
  [undefined, 150_000],
] as const

for (const [input, expected] of thresholdCases) {
  test(`It returns ${expected} from asThreshold for ${String(input)}`, () => {
    expect(asThreshold(input)).toBe(expected)
  })
}

const bandButtonCases = [
  [{ signal: 'strong', hasHeldPrompt: true, isBusy: false }, ['handoff-send', 'send-here']],
  [{ signal: 'strong', hasHeldPrompt: true, isBusy: true }, ['send-here']],
  [{ signal: 'strong', hasHeldPrompt: false, isBusy: false }, ['handoff', 'not-now']],
  [{ signal: 'weak', hasHeldPrompt: false, isBusy: true }, ['compact', 'not-now']],
  [{ signal: 'weak', hasHeldPrompt: false, isBusy: false }, ['compact', 'handoff', 'not-now']],
] as const

for (const [offer, expected] of bandButtonCases) {
  test(`It returns ${JSON.stringify(expected)} from bandButtons for ${JSON.stringify(offer)}`, () => {
    expect(bandButtons(offer)).toEqual(expected)
  })
}

const contextCases = [
  [{ input: 10, created: 20, read: 170, advisorCalls: 0, reported: undefined }, 200],
  [{ input: 10, created: 20, read: 170, advisorCalls: 0, reported: 150 }, 150],
  [{ input: 10, created: 20, read: 170, advisorCalls: 0, reported: 250 }, 200],
  [{ input: 10, created: 20, read: 170, advisorCalls: 1, reported: undefined }, 100],
  [{ input: 10, created: 20, read: 170, advisorCalls: 1, reported: 120 }, 100],
  [{ input: 10, created: 20, read: 170, advisorCalls: 1, reported: 90 }, 90],
  [{ input: 10, created: 20, read: 170, advisorCalls: 3, reported: undefined }, 50],
  [{ input: 1, created: 1, read: 1, advisorCalls: 1, reported: undefined }, 2],
  [{ input: 0, created: 0, read: 0, advisorCalls: 0, reported: undefined }, 0],
] as const

for (const [step, expected] of contextCases) {
  test(`It returns ${expected} from contextFromStep for ${JSON.stringify(step)}`, () => {
    expect(contextFromStep(step)).toBe(expected)
  })
}

const decidedTrigger = { point: 'turn-end', signal: 'strong', isBusy: false, contextTokens: 200_000, cacheReadTokens: 5 } as const

test('It marks the trigger busy in busyRefusalTrigger', () => {
  expect(busyRefusalTrigger(decidedTrigger).isBusy).toBe(true)
})

test('It makes the signal weak, as a busy session classifies, in busyRefusalTrigger', () => {
  expect(busyRefusalTrigger(decidedTrigger).signal).toBe('weak')
})

test('It keeps the other fields of the trigger in busyRefusalTrigger', () => {
  expect(busyRefusalTrigger(decidedTrigger)).toMatchObject({ point: 'turn-end', contextTokens: 200_000, cacheReadTokens: 5 })
})
