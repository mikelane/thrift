const REASON_ROW_KEY = '`trigger_values.reason`'

const withoutParentheses = (text: string): string => {
  const stripped = text.replace(/\([^()]*\)/g, '')
  return stripped === text ? text : withoutParentheses(stripped)
}

export const readmeReasons = (readme: string): string[] => {
  const row = readme.split('\n').find(line => line.split('|')[1]?.trim() === REASON_ROW_KEY)
  if (row === undefined) {
    throw new Error(`The README has no table row whose first cell is ${REASON_ROW_KEY}.`)
  }
  const valueCell = row.split('|')[2] ?? ''
  const listed = withoutParentheses(valueCell)
  const afterLeadIn = listed.slice(listed.indexOf(':') + 1)
  return [...afterLeadIn.matchAll(/`([^`]+)`/g)].map(match => match[1] as string)
}
