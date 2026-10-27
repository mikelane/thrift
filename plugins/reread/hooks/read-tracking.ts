// What one Read left in a loop's context, kept so a repeat can be answered without the contents.
export type Tracked = {
  toolUseId: string
  realPath: string
  // How many prompts the person had sent when the read ran.
  turn: number
  size: number
  mtimeMs: number
  sha256: string
  startLine: number
  numLines: number
  totalLines: number
  // UTF-8 bytes of the text the model read, line numbers included.
  textBytes: number
  // The text the model read, as a SHA-256 and a length in UTF-16 code units: the conversation's copy of the result must still
  // begin with it, or the contents are no longer there to point at.
  modelTextSha256: string
  modelTextLength: number
  isFull: boolean
  // UTF-8 bytes of each line of the file, kept for a full read only: a range inside it sums its lines from here.
  lineBytes: readonly number[]
  // The requests this entry already answered with a stub; the next one for the same key gets the contents.
  stubbedKeys: Set<string>
}

// Loop id -> request key -> entry. The main loop is 'main'; a subagent or teammate is its agent id.
export type Reads = Map<string, Map<string, Tracked>>

export type ReadInput = { offset?: number; limit?: number; allow_large?: boolean }

export type ReadRequest = {
  key: string
  realPath: string
  isFull: boolean
  start: number
  limit: number | undefined
}

export type Found = { tracked: Tracked; key: string; match: 'exact' | 'inside_full' }

export type ResultLines = { startLine: number; numLines: number; totalLines: number; truncatedByTokenCap?: boolean }

const MAIN = 'main'

export const newReads = (): Reads => new Map()

export const contextOf = (agentId: string | undefined): string => agentId ?? MAIN

// Read starts at line 1 for an offset below 1, and reads to the end for a limit of zero or less, as with none (2.1.311).
export const requestOf = (realPath: string, { offset, limit: asked, allow_large }: ReadInput): ReadRequest => {
  const start = Math.max(offset ?? 1, 1)
  const limit = asked !== undefined && asked > 0 ? asked : undefined
  const isFull = start === 1 && limit === undefined
  const range = isFull ? 'full' : `${start}:${limit ?? 'end'}`
  return { key: `${realPath}|${range}${allow_large === true ? '+large' : ''}`, realPath, isFull, start, limit }
}

export const isFullResult = ({ startLine, numLines, totalLines, truncatedByTokenCap }: ResultLines): boolean =>
  startLine === 1 && numLines === totalLines && truncatedByTokenCap !== true

const entriesOf = (reads: Reads, context: string): Map<string, Tracked> => {
  const existing = reads.get(context)
  if (existing !== undefined) return existing
  const created = new Map<string, Tracked>()
  reads.set(context, created)
  return created
}

export const trackRead = (reads: Reads, context: string, key: string, tracked: Tracked): void => {
  entriesOf(reads, context).set(key, tracked)
}

const fullReadOf = (entries: Map<string, Tracked>, realPath: string): [string, Tracked] | undefined =>
  [...entries].find(([, tracked]) => tracked.realPath === realPath && tracked.isFull)

// A range is inside a full read when it starts at a line the file has: Read clamps a limit that runs past the end.
export const findTracked = (reads: Reads, context: string, request: ReadRequest): Found | undefined => {
  const entries = reads.get(context)
  const exact = entries?.get(request.key)
  if (exact !== undefined) return { tracked: exact, key: request.key, match: 'exact' }
  const full = entries === undefined ? undefined : fullReadOf(entries, request.realPath)
  if (full === undefined || request.start > full[1].totalLines) return undefined
  return { tracked: full[1], key: full[0], match: request.isFull ? 'exact' : 'inside_full' }
}

export const hasPath = (reads: Reads, context: string, realPath: string): boolean =>
  [...(reads.get(context)?.values() ?? [])].some(tracked => tracked.realPath === realPath)

const dropWhere = (entries: Map<string, Tracked>, shouldDrop: (tracked: Tracked) => boolean): number => {
  const doomed = [...entries].filter(([, tracked]) => shouldDrop(tracked)).map(([key]) => key)
  doomed.forEach(key => entries.delete(key))
  return doomed.length
}

export const dropPaths = (reads: Reads, realPaths: readonly string[]): number =>
  [...reads.values()].reduce((total, entries) => total + dropWhere(entries, tracked => realPaths.includes(tracked.realPath)), 0)

export const dropAll = (reads: Reads): number => {
  const total = [...reads.values()].reduce((count, entries) => count + entries.size, 0)
  reads.clear()
  return total
}

export const dropContext = (reads: Reads, context: string): number => {
  const dropped = reads.get(context)?.size ?? 0
  reads.delete(context)
  return dropped
}
