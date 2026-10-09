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

export const handoffMessage = (oldSessionId: string, note: string): string =>
  `Handoff from the previous session (${oldSessionId}), written by Claude just before a /clear:\n\n${note}`

export const resumeCommand = (sessionId: string): string => `claude --resume ${sessionId}`

export const handedOffMessage = (oldSessionId: string): string =>
  `Handed off. This session starts from a note summarizing the previous one. To reopen the full previous conversation: ${resumeCommand(oldSessionId)}`

export const noteInBoxMessage = (oldSessionId: string): string =>
  `Handed off. The note summarizing the previous session is in your prompt box. Press Enter to send it. To reopen the full previous conversation: ${resumeCommand(oldSessionId)}`

export const noteNotCarriedMessage = (oldSessionId: string): string =>
  `The handoff note could not be added to this session. The previous conversation is unchanged: ${resumeCommand(oldSessionId)}`

export const joinPrompts = (handoff: string, held: string | undefined): string =>
  held ? `${handoff}\n\n${held}` : handoff

const PROMPT_SEPARATOR = '\n\n'

export type HeldPrompt = { text: string; isUnattended: boolean }

// Prompts that follow the same origin are sent together, in arrival order; groups go in order of their first prompt.
export const groupHeldPrompts = (prompts: readonly HeldPrompt[]): HeldPrompt[] => {
  const groups: HeldPrompt[] = []
  for (const { text, isUnattended } of prompts) {
    const index = groups.findIndex(group => group.isUnattended === isUnattended)
    const group = groups[index]
    if (group === undefined) groups.push({ text, isUnattended })
    else groups[index] = { text: `${group.text}${PROMPT_SEPARATOR}${text}`, isUnattended }
  }
  return groups
}

export const holdsPrompt = (draft: string, prompt: string): boolean => `\n${draft}\n`.includes(`\n${prompt}\n`)

export const withoutPrompt = (draft: string, prompt: string): string | null => {
  const padded = `\n${draft}\n`
  const promptStart = padded.indexOf(`\n${prompt}\n`)
  if (promptStart === -1) return null
  return `${padded.slice(0, promptStart)}${padded.slice(promptStart + prompt.length + 1)}`.slice(1, -1)
}
