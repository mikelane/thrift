import { isHoldingForHandoff, type SessionState } from './session-state'

// Claude Code leaves a dropped prompt's text in the box and submits the next one typed after it, joined: `five` then `six` is
// submitted as `fivesix`. The plugin takes the leftover out in a later tick, but the next prompt can arrive before that tick
// has found the text there. Until a clear confirms the box is empty, the text the box holds is remembered, so the next prompt
// can be told from it. Only a handoff that is holding or sending has a leftover to watch.
export const noteBoxLeftover = (state: SessionState, boxText: string): void => {
  state.boxLeftover = boxText
}

// A strip can be wrong: the person cleared the box by hand and then typed text that starts like the leftover. The count goes in
// the record that ends the handoff, so a wrong strip can be told apart from a right one there.
export const noteLeftoverStrip = (state: SessionState): void => {
  state.leftoverStrips += 1
}

// Once the plugin has put a prompt in the box for the person to send, or found it already there, the box holds that prompt and
// not a leftover: text typed after it is sent with it on purpose, and is not stripped.
export const forgetBoxLeftover = (state: SessionState): void => {
  state.boxLeftover = null
}

export const noteBoxCleared = (state: SessionState, boxText: string): void => {
  if (state.boxLeftover === boxText) state.boxLeftover = null
}

// What the person typed: the submitted text without the leftover it was joined to. A submit that is only the leftover again is
// pressing Enter on the box, and stays whole.
export const typedAfterBoxLeftover = (state: SessionState, submitted: string): string => {
  const leftover = state.boxLeftover
  const isJoined = leftover !== null && isHoldingForHandoff(state) && submitted.length > leftover.length && submitted.startsWith(leftover)
  return isJoined ? submitted.slice(leftover.length) : submitted
}
