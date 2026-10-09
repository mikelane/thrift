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

export const turnAfterNoteLine = (oldSessionId: string): string =>
  `A turn ran in the previous session while or after this note was written, so the note may not cover it. To see that turn: ${resumeCommand(oldSessionId)}`

export const handoffMessage = (oldSessionId: string, note: string, hasTurnAfterNote: boolean): string => {
  const message = `Handoff from the previous session (${oldSessionId}), written by Claude just before a /clear:\n\n${note}`
  return hasTurnAfterNote ? `${message}\n\n${turnAfterNoteLine(oldSessionId)}` : message
}

export const resumeCommand = (sessionId: string): string => `claude --resume ${sessionId}`

export const handedOffMessage = (oldSessionId: string): string =>
  `Handed off. This session starts from a note summarizing the previous one. To reopen the full previous conversation: ${resumeCommand(oldSessionId)}`

export const noteInBoxMessage = (oldSessionId: string): string =>
  `Handed off. The note summarizing the previous session is in your prompt box. Press Enter to send it. To reopen the full previous conversation: ${resumeCommand(oldSessionId)}`

export const noteNotCarriedMessage = (oldSessionId: string): string =>
  `The handoff note could not be added to this session. The previous conversation is unchanged: ${resumeCommand(oldSessionId)}`

const PROMPT_SEPARATOR = '\n\n'

export const joinPrompts = (handoff: string, heldPrompts: string | undefined): string =>
  heldPrompts ? `${handoff}${PROMPT_SEPARATOR}${heldPrompts}` : handoff

// Prompts that follow the same origin are sent together, in arrival order; groups go in order of their first prompt.
export const groupHeldPrompts = (prompts: readonly HeldPrompt[]): HeldPromptGroup[] => {
  const groups: HeldPromptGroup[] = []
  for (const { text, isUnattended } of prompts) {
    const index = groups.findIndex(group => isGroupOfOrigin(group, isUnattended))
    const group = groups[index]
    if (group === undefined) groups.push({ text, isUnattended })
    else groups[index] = { text: `${group.text}${PROMPT_SEPARATOR}${text}`, isUnattended }
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
