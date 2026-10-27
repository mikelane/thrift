import type { RangeKind } from './decision-record'
import type { Found, ReadRequest } from './read-tracking'

// 0-based [from, to) over the file's lines that a request inside a full read asks for; Read clamps a limit past the end.
const linesAsked = ({ tracked }: Found, { start, limit }: ReadRequest): [number, number] => {
  const from = start - 1
  return [from, Math.min(limit === undefined ? tracked.totalLines : from + limit, tracked.totalLines)]
}

// An exact repeat costs what the original read cost. A range inside a full read sums its lines from the file's own text, which
// leaves out the line-number prefixes the model saw, so it is a lower bound.
export const grossBytesOf = (found: Found, request: ReadRequest): number => {
  if (found.match === 'exact') return found.tracked.textBytes
  const [from, to] = linesAsked(found, request)
  return found.tracked.lineBytes.slice(from, to).reduce((sum, bytes) => sum + bytes, 0)
}

export const coveredLines = (found: Found, request: ReadRequest): number => {
  if (found.match === 'exact') return found.tracked.numLines
  const [from, to] = linesAsked(found, request)
  return to - from
}

export const rangeKindOf = (found: Found, request: ReadRequest): RangeKind => {
  if (found.match === 'inside_full') return 'subrange'
  return request.isFull ? 'full' : 'range'
}
