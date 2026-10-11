const TICKET_TOKEN = /\b([A-Za-z][A-Za-z0-9]{1,9})-(\d+)\b/g
const TICKET_URL = /https?:\/\/\S*?\/(?:issue|browse)\/([A-Za-z][A-Za-z0-9]{1,9})-\d+/gi
const PR_REFERENCE = /\b(?:pr|issue|pull request)\s*#?(\d+)\b/gi
const PR_URL = /\/(?:pull|issues)\/(\d+)\b/g

const unique = (values: Iterable<string>): string[] => [...new Set(values)]

export const ticketUrlPrefixes = (text: string): string[] =>
  unique([...text.matchAll(TICKET_URL)].map(([, prefix = '']) => prefix.toUpperCase()))

export const branchTicketPrefixes = (branch: string): string[] =>
  unique([...branch.matchAll(TICKET_TOKEN)].map(([, prefix = '']) => prefix.toUpperCase()))

export const hasTicketShapedToken = (text: string): boolean => new RegExp(TICKET_TOKEN.source).test(text)

export const workRefs = (text: string, prefixes: readonly string[]): string[] => {
  const known = new Set(prefixes.map(prefix => prefix.toUpperCase()))
  const tickets = [...text.matchAll(TICKET_TOKEN)]
    .map(([, prefix = '', digits = '']) => [prefix.toUpperCase(), digits] as const)
    .filter(([prefix]) => known.has(prefix))
    .map(([prefix, digits]) => `${prefix}-${digits}`)
  const pullRequests = [...text.matchAll(PR_REFERENCE), ...text.matchAll(PR_URL)].map(([, digits = '']) => `#${digits}`)
  return unique([...tickets, ...pullRequests])
}

export const namesNewWork = (text: string, seen: ReadonlySet<string>, prefixes: readonly string[]): boolean => {
  const named = workRefs(text, prefixes)
  return seen.size > 0 && named.length > 0 && named.every(ref => !seen.has(ref))
}
