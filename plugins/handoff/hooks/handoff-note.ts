import { isComposerOrigin } from './prompt-plan'
import { isGroupOfOrigin, type HeldPrompt, type HeldPromptGroup } from './session-state'

export const HANDOFF_PROMPT = `Write a handoff for the next session, which will start fresh with only this note.
Cover, under short headings:
- The task and its goal.
- What is done: commits, branches, PRs, and files, with paths.
- Decisions made, and why.
- Open threads.
- The next concrete step.
- Facts the next session would otherwise rediscover.
Use plain Markdown, at most 400 words, and no preamble.`

export type NoteDelivery = 'appended' | 'submitted' | 'in_box' | 'not_carried'

export type Carried = Exclude<NoteDelivery, 'appended'>

export const turnAfterNoteLine = (oldSessionId: string): string =>
  `A turn ran in the previous session while or after this note was written, so the note may not cover it. To see that turn: ${resumeCommand(oldSessionId)}`

export const handoffMessage = (oldSessionId: string, note: string, hasTurnAfterNote: boolean): string => {
  const message = `Handoff from the previous session (${oldSessionId}), written by Claude just before a /clear:\n\n${note}`
  return hasTurnAfterNote ? `${message}\n\n${turnAfterNoteLine(oldSessionId)}` : message
}

// One wording for the session's state in every message that stops a handoff, so each outcome reads the same.
const COMPACTED_NOT_CLEARED = 'This session was compacted, not cleared.'

const sessionLeftLine = (hasCompacted: boolean): string => (hasCompacted ? COMPACTED_NOT_CLEARED : 'This session is unchanged.')

// The session that ended is the one that was compacted; the session the person sees now never was.
export const sessionEndedMessage = (hasCompacted: boolean, oldSessionId: string): string => {
  const message = 'The session ended before the handoff could clear, so it stopped. No note was carried over.'
  return hasCompacted ? `${message} The previous session was compacted. To reopen it: ${resumeCommand(oldSessionId)}` : message
}

export const clearFailedMessage = (hasCompacted: boolean): string =>
  `The handoff was written but /clear failed. ${sessionLeftLine(hasCompacted)} Type /handoff to try again.`

export const busyRefusalMessage = (hasCompacted: boolean): string =>
  `Background work is running, and a handoff would cut it off. ${sessionLeftLine(hasCompacted)} Type /handoff to hand off anyway.`

export const resumeCommand = (sessionId: string): string => `claude --resume ${sessionId}`

export const handedOffMessage = (oldSessionId: string): string =>
  `Handed off. This session starts from a note summarizing the previous one. To reopen the full previous conversation: ${resumeCommand(oldSessionId)}`

export const noteInBoxMessage = (oldSessionId: string): string =>
  `Handed off. The note summarizing the previous session is in your prompt box. Press Enter to send it. To reopen the full previous conversation: ${resumeCommand(oldSessionId)}`

export const noteNotCarriedMessage = (oldSessionId: string): string =>
  `The handoff note could not be added to this session. To reopen the full previous conversation: ${resumeCommand(oldSessionId)}`

export const FINAL_MESSAGES: Record<NoteDelivery, (oldSessionId: string) => string> = {
  appended: handedOffMessage,
  submitted: handedOffMessage,
  in_box: noteInBoxMessage,
  not_carried: noteNotCarriedMessage,
}

const PROMPT_SEPARATOR = '\n\n'

export const joinPrompts = (handoff: string, heldPrompts: string | undefined): string =>
  heldPrompts ? `${handoff}${PROMPT_SEPARATOR}${heldPrompts}` : handoff

// A group is the composer's only while every prompt in it is; one remote prompt keeps the whole group out of the box, because
// the box is where the person at this terminal reviews what they typed.
const groupOrigin = (groupSoFar: string, joining: string): string => (isComposerOrigin(groupSoFar) ? joining : groupSoFar)

// Prompts that follow the same origin are sent together, in arrival order; groups go in order of their first prompt.
export const groupHeldPrompts = (prompts: readonly HeldPrompt[]): HeldPromptGroup[] => {
  const groups: HeldPromptGroup[] = []
  for (const { text, isUnattended, origin } of prompts) {
    const index = groups.findIndex(group => isGroupOfOrigin(group, isUnattended))
    const group = groups[index]
    if (group === undefined) groups.push({ text, isUnattended, origin })
    else groups[index] = { text: `${group.text}${PROMPT_SEPARATOR}${text}`, isUnattended, origin: groupOrigin(group.origin, origin) }
  }
  return groups
}

// The note rides with the group that shares the handoff's own origin.
export const groupJoiningNote = (groups: readonly HeldPromptGroup[], handoffIsUnattended: boolean): HeldPromptGroup | undefined =>
  groups.find(group => isGroupOfOrigin(group, handoffIsUnattended))

// A note that was appended to the session leaves every group to send; a note that was sent as a prompt already carried its group.
export const groupsLeftToSend = (
  groups: readonly HeldPromptGroup[],
  handoffIsUnattended: boolean,
  noteDelivery: NoteDelivery,
): HeldPromptGroup[] =>
  noteDelivery === 'appended' ? [...groups] : groups.filter(group => !isGroupOfOrigin(group, handoffIsUnattended))

export const holdsPrompt = (draft: string, prompt: string): boolean => `\n${draft}\n`.includes(`\n${prompt}\n`)

export const withoutPrompt = (draft: string, prompt: string): string | null => {
  const padded = `\n${draft}\n`
  const promptStart = padded.indexOf(`\n${prompt}\n`)
  if (promptStart === -1) return null
  return `${padded.slice(0, promptStart)}${padded.slice(promptStart + prompt.length + 1)}`.slice(1, -1)
}
