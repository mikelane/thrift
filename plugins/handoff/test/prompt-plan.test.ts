import { expect, test } from 'claude-code/testing'

import {
  canHoldPrompt,
  carriesExtras,
  planPromptDuringHandoff,
  isPersonOrigin,
  isComposerOrigin,
  isUnattendedOrigin,
  planNewWorkPrompt,
  senderLabel,
} from '../hooks/prompt-plan'

const senderLabelCases = [
  ['composer', 'this terminal'],
  ['bridge', 'the bridge'],
  ['sdk', 'an SDK client'],
  ['scheduled-trigger', 'a scheduled task'],
  ['plugin', 'a sender outside this terminal'],
] as const

const composerCases = [
  ['composer', true],
  ['bridge', false],
  ['sdk', false],
  ['scheduled-trigger', false],
  ['plugin', false],
  ['', false],
] as const

const originCases = [
  ['composer', true, false],
  ['bridge', true, false],
  ['sdk', true, false],
  ['scheduled-trigger', true, true],
  ['task-notification', false, false],
  ['peer', false, false],
  ['peer-send-message', false, false],
  ['projects-relay', false, false],
  ['channel', false, false],
  ['coordinator', false, false],
  ['observer', false, false],
  ['observer-activity', false, false],
  ['auto-continuation', false, false],
  ['unclassified', false, false],
  ['slack-ping', false, false],
  ['plugin', false, false],
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
  [{ isCarried: true, isHolding: true, hasExtras: true }, 'drop-repeat'],
  [{ isCarried: true, isHolding: false, hasExtras: true }, 'drop-repeat'],
  [{ isCarried: true, isHolding: false, hasExtras: false }, 'drop-repeat'],
  [{ isCarried: false, isHolding: true, hasExtras: false }, 'hold'],
  [{ isCarried: false, isHolding: true, hasExtras: true }, 'refuse'],
  [{ isCarried: false, isHolding: false, hasExtras: false }, 'proceed'],
  [{ isCarried: false, isHolding: false, hasExtras: true }, 'proceed'],
] as const

for (const [input, expected] of duringHandoffCases) {
  test(`It returns ${expected} from planPromptDuringHandoff for ${JSON.stringify(input)}`, () => {
    expect(planPromptDuringHandoff(input)).toBe(expected)
  })
}

const canHoldCases = [
  [{ isNewWork: true, hasPendingAction: false, hasTurnId: false, hasExtras: false }, true],
  [{ isNewWork: false, hasPendingAction: false, hasTurnId: false, hasExtras: false }, false],
  [{ isNewWork: true, hasPendingAction: true, hasTurnId: false, hasExtras: false }, false],
  [{ isNewWork: true, hasPendingAction: false, hasTurnId: true, hasExtras: false }, false],
  [{ isNewWork: true, hasPendingAction: false, hasTurnId: false, hasExtras: true }, false],
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
  isComposer: true,
  ...overrides,
})

const newWorkCases = [
  ['below the threshold', { contextTokens: 100_000 }, 'none', 'none'],
  ['off mode past the threshold', { mode: 'off' }, 'strong', 'none'],
  ['ask mode past the threshold', {}, 'strong', 'hold'],
  ['act mode past the threshold', { mode: 'act' }, 'strong', 'handoff'],
  ['a remote prompt in ask mode past the threshold', { isComposer: false }, 'strong', 'none'],
  ['a remote prompt in act mode past the threshold', { isComposer: false, mode: 'act' }, 'strong', 'handoff'],
  ['ask mode with background work busy', { isBackgroundBusy: true }, 'weak', 'none'],
  ['act mode with background work busy', { mode: 'act', isBackgroundBusy: true }, 'weak', 'none'],
  ['an unattended prompt past the threshold', { isUnattended: true }, 'strong', 'handoff'],
  ['an unattended prompt with background work busy', { isUnattended: true, isBackgroundBusy: true }, 'weak', 'none'],
] as const

for (const [name, overrides, signal, action] of newWorkCases) {
  test(`It plans ${action} with a ${signal} signal for new work in ${name}`, () => {
    expect(planNewWorkPrompt(newWork(overrides))).toEqual({ signal, action })
  })
}

for (const [kind, isComposer] of composerCases) {
  test(`It returns ${isComposer} from isComposerOrigin for ${JSON.stringify(kind)}`, () => {
    expect(isComposerOrigin(kind)).toBe(isComposer)
  })
}

for (const [kind, label] of senderLabelCases) {
  test(`It returns ${JSON.stringify(label)} from senderLabel for ${JSON.stringify(kind)}`, () => {
    expect(senderLabel(kind)).toBe(label)
  })
}
