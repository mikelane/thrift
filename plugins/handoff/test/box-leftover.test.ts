import { expect, test } from 'claude-code/testing'

import {
  forgetBoxLeftover,
  noteBoxCleared,
  noteBoxLeftover,
  noteLeftoverStrip,
  typedAfterBoxLeftover,
} from '../hooks/box-leftover'
import { beginHandoffHold, beginSending, createState } from '../hooks/session-state'
import { settings } from './session-state-fixtures'

test('It returns the submitted text whole from typedAfterBoxLeftover when nothing is left in the box', () => {
  const state = createState(settings)
  beginHandoffHold(state, null)
  expect(typedAfterBoxLeftover(state, 'fivesix')).toBe('fivesix')
})

test('It returns only the part typed after the leftover from typedAfterBoxLeftover', () => {
  const state = createState(settings)
  beginSending(state)
  noteBoxLeftover(state, 'five')
  expect(typedAfterBoxLeftover(state, 'fivesix')).toBe('six')
})

test('It returns the submitted text whole from typedAfterBoxLeftover when it is only the leftover again', () => {
  const state = createState(settings)
  beginSending(state)
  noteBoxLeftover(state, 'five')
  expect(typedAfterBoxLeftover(state, 'five')).toBe('five')
})

test('It returns the submitted text whole from typedAfterBoxLeftover when it does not start with the leftover', () => {
  const state = createState(settings)
  beginSending(state)
  noteBoxLeftover(state, 'five')
  expect(typedAfterBoxLeftover(state, 'six')).toBe('six')
})

test('It returns the submitted text whole from typedAfterBoxLeftover once a clear confirmed the box empty', () => {
  const state = createState(settings)
  beginSending(state)
  noteBoxLeftover(state, 'five')
  noteBoxCleared(state, 'five')
  expect(typedAfterBoxLeftover(state, 'five six')).toBe('five six')
})

test('It keeps the leftover from noteBoxCleared when the clear was for other text', () => {
  const state = createState(settings)
  beginSending(state)
  noteBoxLeftover(state, 'fivesix')
  noteBoxCleared(state, 'five')
  expect(typedAfterBoxLeftover(state, 'fivesixseven')).toBe('seven')
})

test('It returns the submitted text whole from typedAfterBoxLeftover when no handoff is holding', () => {
  const state = createState(settings)
  noteBoxLeftover(state, 'five')
  expect(typedAfterBoxLeftover(state, 'fivesix')).toBe('fivesix')
})

test('It keeps the leftover when beginSending starts the delivery', () => {
  const state = createState(settings)
  beginHandoffHold(state, null)
  noteBoxLeftover(state, 'five')
  beginSending(state)
  expect(typedAfterBoxLeftover(state, 'fivesix')).toBe('six')
})

test('It forgets the leftover when forgetBoxLeftover is called', () => {
  const state = createState(settings)
  beginHandoffHold(state, null)
  noteBoxLeftover(state, 'five')
  forgetBoxLeftover(state)
  expect(typedAfterBoxLeftover(state, 'fivesix')).toBe('fivesix')
})

test('It forgets the leftover when beginHandoffHold starts a new hold', () => {
  const state = createState(settings)
  noteBoxLeftover(state, 'five')
  beginHandoffHold(state, null)
  expect(typedAfterBoxLeftover(state, 'fivesix')).toBe('fivesix')
})

test('It counts each strip noted with noteLeftoverStrip', () => {
  const state = createState(settings)
  noteLeftoverStrip(state)
  noteLeftoverStrip(state)
  expect(state.leftoverStrips).toBe(2)
})

test('It resets the strip count when beginHandoffHold starts a new hold', () => {
  const state = createState(settings)
  noteLeftoverStrip(state)
  beginHandoffHold(state, null)
  expect(state.leftoverStrips).toBe(0)
})

test('It keeps the strip count when beginSending starts the delivery', () => {
  const state = createState(settings)
  noteLeftoverStrip(state)
  beginSending(state)
  expect(state.leftoverStrips).toBe(1)
})
