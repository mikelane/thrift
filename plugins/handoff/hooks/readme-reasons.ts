const REASON_ROW_KEY = '`trigger_values.reason`'

const withoutParentheses = (text: string): string => {
  const stripped = text.replace(/\([^()]*\)/g, '')
  return stripped === text ? text : withoutParentheses(stripped)
}

export type ReasonDrift = { missingFromReadme: string[]; missingFromUnion: string[] }

export const reasonDrift = (union: readonly string[], readme: readonly string[]): ReasonDrift => {
  const declared = new Set(union)
  const documented = new Set(readme)
  return {
    missingFromReadme: [...declared].filter(reason => !documented.has(reason)),
    missingFromUnion: [...documented].filter(reason => !declared.has(reason)),
  }
}

export const driftMessages = ({ missingFromReadme, missingFromUnion }: ReasonDrift): string[] => [
  ...missingFromReadme.map(reason => `DecisionReason has "${reason}", but the README trigger_values.reason row does not list it.`),
  ...missingFromUnion.map(reason => `The README trigger_values.reason row lists "${reason}", but DecisionReason does not have it.`),
]

// SAFETY: The README table is written by hand, and these valid shapes are not supported. Each one
// makes the check fail loudly (a missing row, or values the union does not have), never pass:
// a padded or double-backtick code span, a table with no leading pipe, `\|` inside a cell, and a
// fenced example row placed before the real row.
export const readmeReasons = (readme: string): string[] => {
  const rows = readme.split('\n').filter(line => line.split('|')[1]?.trim() === REASON_ROW_KEY)
  const [row, ...extraRows] = rows
  if (row === undefined) {
    throw new Error(`The README has no table row whose first cell is ${REASON_ROW_KEY}.`)
  }
  if (extraRows.length > 0) {
    throw new Error(`The README has more than one table row whose first cell is ${REASON_ROW_KEY}.`)
  }
  const valueCell = row.split('|')[2] ?? ''
  const listed = withoutParentheses(valueCell)
  const afterLeadIn = listed.slice(listed.indexOf(':') + 1)
  return [...afterLeadIn.matchAll(/`([^`]+)`/g)].map(match => match[1] as string)
}
