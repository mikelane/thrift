export const HANDOFF_PROMPT = `Write a handoff for the next session, which will start fresh with only this note.
Cover, under short headings:
- The task and its goal.
- What is done: commits, branches, PRs, and files, with paths.
- Decisions made, and why.
- Open threads.
- The next concrete step.
- Facts the next session would otherwise rediscover.
Use plain Markdown, at most 400 words, and no preamble.`

export const handoffMessage = (oldSessionId: string, note: string): string =>
  `Handoff from the previous session (${oldSessionId}), written by Claude just before a /clear:\n\n${note}`

export const resumeCommand = (sessionId: string): string => `claude --resume ${sessionId}`

export const joinPrompts = (handoff: string, held: string | undefined): string =>
  held ? `${handoff}\n\n${held}` : handoff

export const holdsPrompt = (draft: string, prompt: string): boolean => `\n${draft}\n`.includes(`\n${prompt}\n`)

export const withoutPrompt = (draft: string, prompt: string): string | null => {
  const padded = `\n${draft}\n`
  const at = padded.indexOf(`\n${prompt}\n`)
  if (at === -1) return null
  return `${padded.slice(0, at)}${padded.slice(at + prompt.length + 1)}`.slice(1, -1)
}
