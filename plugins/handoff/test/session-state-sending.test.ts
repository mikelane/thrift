import { expect, test } from 'claude-code/testing'

import {
  type BoxPlacement,
  type HandoffHold,
  type HeldPrompt,
  addHeldPrompt,
  beginSending,
  removeResubmittedPrompt,
  queueResubmittedPrompt,
  refusedPromptPlacement,
  beginHandoffHold,
  createState,
  isCarriedByHandoff,
  isHoldingForHandoff,
  startMainTurn,
  releaseCarried,
  resetForNewSession,
  takeHeldPrompts,
  takeLateArrivalsOrEndSending,
} from '../hooks/session-state'
import { settings, person, nightly } from './session-state-fixtures'

const sendingState = () => {
  const state = createState(settings)
  beginHandoffHold(state, person)
  takeHeldPrompts(state)
  beginSending(state)
  return state
}

test('It reports holding while sending from isHoldingForHandoff', () => {
  expect(isHoldingForHandoff(sendingState())).toBe(true)
})

test('It keeps the prompt the handoff carries watched through beginSending', () => {
  expect(isCarriedByHandoff(sendingState(), person.text)).toBe(true)
})

test('It watches no carried prompt after beginSending when the handoff carried none', () => {
  const state = createState(settings)
  beginHandoffHold(state, null)
  takeHeldPrompts(state)
  beginSending(state)
  expect(state.handoffHold).toEqual({ phase: 'sending', promptCarriedByHandoff: null, lateArrivals: [] })
})

test('It returns the number of prompts that arrived while sending from addHeldPrompt', () => {
  const state = sendingState()
  expect([addHeldPrompt(state, nightly), addHeldPrompt(state, person)]).toEqual([1, 2])
})

test('It returns the prompts that arrived while sending, oldest first, from takeLateArrivalsOrEndSending', () => {
  const state = sendingState()
  addHeldPrompt(state, nightly)
  addHeldPrompt(state, person)
  expect(takeLateArrivalsOrEndSending(state)).toEqual([nightly, person])
})

test('It keeps holding after takeLateArrivalsOrEndSending returned prompts, so more can still arrive', () => {
  const state = sendingState()
  addHeldPrompt(state, nightly)
  takeLateArrivalsOrEndSending(state)
  expect([addHeldPrompt(state, person), takeLateArrivalsOrEndSending(state)]).toEqual([1, [person]])
})

test('It ends the sending when takeLateArrivalsOrEndSending finds no prompt', () => {
  const state = sendingState()
  expect([takeLateArrivalsOrEndSending(state), state.handoffHold, isHoldingForHandoff(state)]).toEqual([[], { phase: 'idle' }, false])
})

test('It returns nothing from takeLateArrivalsOrEndSending when the handoff is not sending', () => {
  const state = createState(settings)
  beginHandoffHold(state, person)
  expect([takeLateArrivalsOrEndSending(state), state.handoffHold.phase]).toEqual([[], 'holding'])
})

test('It stops watching the carried prompt after releaseCarried while sending, and keeps holding', () => {
  const state = sendingState()
  releaseCarried(state)
  expect([isCarriedByHandoff(state, person.text), isHoldingForHandoff(state)]).toEqual([false, true])
})

test('It judges a turn start by the first queued resubmitted prompt whose text the turn contains', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, nightly)
  queueResubmittedPrompt(state, person)
  startMainTurn(state, 'nightly job')
  expect([state.isTurnUnattended, state.resubmittedPrompts]).toEqual([true, [person]])
})

test('It leaves the turn origin alone at a turn start when no resubmitted prompt is queued', () => {
  const state = createState(settings)
  state.isTurnUnattended = true
  startMainTurn(state, '')
  expect(state.isTurnUnattended).toBe(true)
})

test('It removes a prompt that did not enter from the queue in removeResubmittedPrompt', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, nightly)
  queueResubmittedPrompt(state, person)
  removeResubmittedPrompt(state, nightly)
  expect(state.resubmittedPrompts).toEqual([person])
})

test('It ignores a prompt that is not queued in removeResubmittedPrompt', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, person)
  removeResubmittedPrompt(state, nightly)
  expect(state.resubmittedPrompts).toEqual([person])
})

test('It leaves the queue alone at a turn start whose text matches no queued prompt', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, nightly)
  startMainTurn(state, '<task-notification>done</task-notification>')
  expect([state.isTurnUnattended, state.resubmittedPrompts]).toEqual([false, [nightly]])
})

test('It watches no carried prompt after beginSending from an idle hold', () => {
  const state = createState(settings)
  beginSending(state)
  expect(state.handoffHold).toEqual({ phase: 'sending', promptCarriedByHandoff: null, lateArrivals: [] })
})

test('It judges a turn start by a queued resubmitted prompt that the turn text frames', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, nightly)
  startMainTurn(state, 'The handoff plugin sent a message: nightly job')
  expect([state.isTurnUnattended, state.resubmittedPrompts]).toEqual([true, []])
})

test('It empties the queue of resubmitted prompts in resetForNewSession', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, nightly)
  resetForNewSession(state)
  expect(state.resubmittedPrompts).toEqual([])
})

test('It does not queue an empty text in queueResubmittedPrompt', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, { text: '', isUnattended: true, origin: 'scheduled-trigger', author: 'person' })
  expect(state.resubmittedPrompts).toEqual([])
})

test('It leaves a turn attended in startMainTurn when only an empty text was offered to the queue', () => {
  const state = createState(settings)
  queueResubmittedPrompt(state, { text: '', isUnattended: true, origin: 'scheduled-trigger', author: 'person' })
  startMainTurn(state, 'any turn at all')
  expect(state.isTurnUnattended).toBe(false)
})

test('It still queues a non-empty text in queueResubmittedPrompt', () => {
  const state = createState(settings)
  const prompt = { text: 'x', isUnattended: true, origin: 'scheduled-trigger', author: 'person' } satisfies HeldPrompt
  queueResubmittedPrompt(state, prompt)
  expect(state.resubmittedPrompts).toEqual([prompt])
})

const refusedPlacementCases: ReadonlyArray<readonly [HandoffHold, BoxPlacement]> = [
  [{ phase: 'idle' }, 'before_draft'],
  [{ phase: 'holding', heldPrompts: [], promptCarriedByHandoff: null }, 'before_draft'],
  [{ phase: 'delivering', promptCarriedByHandoff: 'go' }, 'before_draft'],
  [{ phase: 'sending', promptCarriedByHandoff: null, lateArrivals: [] }, 'after_draft'],
]

for (const [hold, placement] of refusedPlacementCases) {
  test(`It returns ${placement} from refusedPromptPlacement in the ${hold.phase} phase`, () => {
    expect(refusedPromptPlacement(hold)).toBe(placement)
  })
}
