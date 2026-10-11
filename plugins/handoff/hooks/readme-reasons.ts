const REASON_ROW_KEY = '`trigger_values.reason`'

const withoutParentheses = (text: string): string => {
  const stripped = text.replace(/\([^()]*\)/g, '')
  return stripped === text ? text : withoutParentheses(stripped)
}

const splitOnUnescapedPipes = (line: string): string[] => line.split(/(?<!\\)\|/)

type ReasonDrift = { missingFromReadme: string[]; missingFromUnion: string[] }

export const findReasonDrift = (declaredReasons: readonly string[], documentedReasons: readonly string[]): ReasonDrift => {
  const declared = new Set(declaredReasons)
  const documented = new Set(documentedReasons)
  return {
    missingFromReadme: [...declared].filter(reason => !documented.has(reason)),
    missingFromUnion: [...documented].filter(reason => !declared.has(reason)),
  }
}

export const formatDriftMessages = ({ missingFromReadme, missingFromUnion }: ReasonDrift): string[] => [
  ...missingFromReadme.map(
    reason => `"${reason}" is in DECISION_REASONS but not in the README's trigger_values.reason row. Add it to the row, or remove it from DECISION_REASONS.`,
  ),
  ...missingFromUnion.map(
    reason => `"${reason}" is in the README's trigger_values.reason row but not in DECISION_REASONS. Remove it from the row, or add it to DECISION_REASONS.`,
  ),
]

export const driftExitCode = (messages: readonly string[]): 0 | 1 => (messages.length === 0 ? 0 : 1)

// SAFETY: The README table is written by hand. The parser does not support these valid Markdown
// shapes: a padded or double-backtick code span, a table with no leading pipe, and a fenced example
// row above the real row. Each one makes the check fail (no row, two rows, or values
// DECISION_REASONS does not have), so a misread row can never pass. An escaped `\|` inside a cell
// does not split the cell.
export const parseReadmeReasons = (readme: string): string[] => {
  const rows = readme.split('\n').filter(line => splitOnUnescapedPipes(line)[1]?.trim() === REASON_ROW_KEY)
  const [row, ...extraRows] = rows
  if (row === undefined) {
    throw new Error(`The README has no table row whose first cell is ${REASON_ROW_KEY}. Add one that lists every value in DECISION_REASONS.`)
  }
  if (extraRows.length > 0) {
    throw new Error(`The README has ${rows.length} table rows whose first cell is ${REASON_ROW_KEY}. Keep one and delete the others.`)
  }
  const valueCell = splitOnUnescapedPipes(row)[2] ?? ''
  const listed = withoutParentheses(valueCell)
  const afterLeadIn = listed.slice(listed.indexOf(':') + 1)
  // SAFETY: the capture group always matches, so `value` is never undefined. The check only narrows the type.
  return [...afterLeadIn.matchAll(/`([^`]+)`/g)].flatMap(([, value]) => (value === undefined ? [] : [value]))
}
