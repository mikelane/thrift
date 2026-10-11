import { expect, test } from 'claude-code/testing'

import { isBackedOff, planTurnEnd } from '../hooks/turn-end-plan'

const THRESHOLD = 150_000

type TurnEndInput = Parameters<typeof planTurnEnd>[0]

const turnEnd = (overrides: Partial<TurnEndInput>): TurnEndInput => ({
  contextTokens: 200_000,
  threshold: THRESHOLD,
  hasFinishedTask: true,
  isBackgroundBusy: false,
  mode: 'ask',
  isUnattended: false,
  backoffFrom: null,
  ...overrides,
})

const planCases = [
  ['below the threshold', { contextTokens: 100_000 }, 'none', { kind: 'none' }],
  ['off mode past the threshold', { mode: 'off' }, 'strong', { kind: 'none' }],
  ['ask mode at a finished task', {}, 'strong', { kind: 'advise', holdsPrompt: false, buttons: ['handoff', 'not-now'] }],
  ['act mode at a finished task', { mode: 'act' }, 'strong', { kind: 'handoff', holdsPrompt: false }],
  [
    'ask mode mid-task',
    { hasFinishedTask: false },
    'weak',
    { kind: 'advise', holdsPrompt: false, buttons: ['compact', 'handoff', 'not-now'] },
  ],
  [
    'ask mode with background work busy',
    { isBackgroundBusy: true },
    'weak',
    { kind: 'advise', holdsPrompt: false, buttons: ['compact', 'not-now'] },
  ],
  ['act mode mid-task', { mode: 'act', hasFinishedTask: false }, 'weak', { kind: 'compact' }],
  ['an unattended turn at a finished task', { mode: 'act', isUnattended: true }, 'strong', { kind: 'handoff', holdsPrompt: false }],
  ['an unattended turn mid-task', { mode: 'act', isUnattended: true, hasFinishedTask: false }, 'weak', { kind: 'none' }],
  ['a weak signal inside the back-off window', { hasFinishedTask: false, backoffFrom: 170_000 }, 'weak', { kind: 'back-off' }],
  [
    'a weak signal past the back-off window',
    { hasFinishedTask: false, backoffFrom: 150_000 },
    'weak',
    { kind: 'advise', holdsPrompt: false, buttons: ['compact', 'handoff', 'not-now'] },
  ],
  [
    'a strong signal inside the back-off window',
    { backoffFrom: 170_000 },
    'strong',
    { kind: 'advise', holdsPrompt: false, buttons: ['handoff', 'not-now'] },
  ],
] as const

for (const [name, overrides, signal, outcome] of planCases) {
  test(`It plans ${outcome.kind} with a ${signal} signal for ${name}`, () => {
    expect(planTurnEnd(turnEnd(overrides))).toEqual({ signal, outcome })
  })
}

const backoffCases = [
  [null, 200_000, false],
  [100_000, 149_999, true],
  [100_000, 150_000, false],
  [100_000, 150_001, false],
  [0, 49_999, true],
  [0, 50_000, false],
] as const

for (const [backoffFrom, contextTokens, expected] of backoffCases) {
  test(`It returns ${expected} from isBackedOff for backoffFrom ${backoffFrom} and context ${contextTokens}`, () => {
    expect(isBackedOff({ backoffFrom, contextTokens })).toBe(expected)
  })
}
