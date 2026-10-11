import { expect, test } from 'claude-code/testing'

import {
  canHoldPrompt,
  carriesExtras,
  duringHandoffAction,
  isPersonOrigin,
  isUnattendedOrigin,
  planNewWorkPrompt,
} from '../hooks/prompt-plan'

const originCases = [
  ['composer', true, false],
  ['bridge', true, false],
  ['sdk', true, false],
  ['scheduled-trigger', true, true],
  ['task-notification', false, false],
  ['', false, false],
] as const

for (const [kind, isPerson, isUnattended] of originCases) {
  test(`It returns ${isPerson} from isPersonOrigin for ${JSON.stringify(kind)}`, () => {
    expect(isPersonOrigin(kind)).toBe(isPerson)
  })

  test(`It returns ${isUnattended} from isUnattendedOrigin for ${JSON.stringify(kind)}`, () => {
    expect(isUnattendedOrigin(kind)).toBe(isUnattended)
  })
}

const extrasCases = [
  [{}, false],
  [{ attachments: [], context: [] }, false],
  [{ attachments: ['a'] }, true],
  [{ context: ['c'] }, true],
  [{ attachments: ['a'], context: ['c'] }, true],
] as const

for (const [prompt, expected] of extrasCases) {
  test(`It returns ${expected} from carriesExtras for ${JSON.stringify(prompt)}`, () => {
    expect(carriesExtras(prompt)).toBe(expected)
  })
}

const duringHandoffCases = [
  [{ isCarried: true, isHolding: true, hasExtras: false }, 'drop-repeat'],
  [{ isCarried: true, isHolding: false, hasExtras: true }, 'drop-repeat'],
  [{ isCarried: false, isHolding: true, hasExtras: false }, 'hold'],
  [{ isCarried: false, isHolding: true, hasExtras: true }, 'refuse'],
  [{ isCarried: false, isHolding: false, hasExtras: false }, 'proceed'],
  [{ isCarried: false, isHolding: false, hasExtras: true }, 'proceed'],
] as const

for (const [input, expected] of duringHandoffCases) {
  test(`It returns ${expected} from duringHandoffAction for ${JSON.stringify(input)}`, () => {
    expect(duringHandoffAction(input)).toBe(expected)
  })
}

const canHoldCases = [
  [{ isNewWork: true, hasPending: false, hasTurnId: false, hasExtras: false }, true],
  [{ isNewWork: false, hasPending: false, hasTurnId: false, hasExtras: false }, false],
  [{ isNewWork: true, hasPending: true, hasTurnId: false, hasExtras: false }, false],
  [{ isNewWork: true, hasPending: false, hasTurnId: true, hasExtras: false }, false],
  [{ isNewWork: true, hasPending: false, hasTurnId: false, hasExtras: true }, false],
] as const

for (const [input, expected] of canHoldCases) {
  test(`It returns ${expected} from canHoldPrompt for ${JSON.stringify(input)}`, () => {
    expect(canHoldPrompt(input)).toBe(expected)
  })
}

type NewWorkInput = Parameters<typeof planNewWorkPrompt>[0]

const newWork = (overrides: Partial<NewWorkInput>): NewWorkInput => ({
  contextTokens: 200_000,
  threshold: 150_000,
  isBackgroundBusy: false,
  mode: 'ask',
  isUnattended: false,
  ...overrides,
})

const newWorkCases = [
  ['below the threshold', { contextTokens: 100_000 }, 'none', 'record'],
  ['off mode past the threshold', { mode: 'off' }, 'strong', 'record'],
  ['ask mode past the threshold', {}, 'strong', 'hold'],
  ['act mode past the threshold', { mode: 'act' }, 'strong', 'handoff'],
  ['ask mode with background work busy', { isBackgroundBusy: true }, 'weak', 'record'],
  ['act mode with background work busy', { mode: 'act', isBackgroundBusy: true }, 'weak', 'record'],
  ['an unattended prompt past the threshold', { isUnattended: true }, 'strong', 'handoff'],
  ['an unattended prompt with background work busy', { isUnattended: true, isBackgroundBusy: true }, 'weak', 'record'],
] as const

for (const [name, overrides, signal, action] of newWorkCases) {
  test(`It plans ${action} with a ${signal} signal for new work in ${name}`, () => {
    expect(planNewWorkPrompt(newWork(overrides))).toEqual({ signal, action })
  })
}
