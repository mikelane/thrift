const REASON_ROW_KEY = '`trigger_values.reason`'

const withoutParentheses = (text: string): string => {
  const stripped = text.replace(/\([^()]*\)/g, '')
  return stripped === text ? text : withoutParentheses(stripped)
}

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
