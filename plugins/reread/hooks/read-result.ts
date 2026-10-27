import type { ResultLines } from './read-tracking'

// What core's Read left, narrowed to what the plugin acts on. `text` is the result as the model read it.
type ReadOutcome =
  | { kind: 'text'; lines: ResultLines; modelText: string }
  | { kind: 'file_unchanged' }
  | { kind: 'not_text' }
  | { kind: 'error' }

// Only the keys this reads, so a result needs no cast to reach them.
type ReadAnswer = { readonly deny?: string; readonly isError?: boolean; readonly result?: unknown; readonly text?: string }

const fieldOf = (value: unknown, key: string): unknown => (typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined)

const numberAt = (value: unknown, key: string): number | undefined => {
  const found = fieldOf(value, key)
  return typeof found === 'number' ? found : undefined
}

const textLines = (file: unknown): ResultLines | undefined => {
  const startLine = numberAt(file, 'startLine')
  const numLines = numberAt(file, 'numLines')
  const totalLines = numberAt(file, 'totalLines')
  if (startLine === undefined || numLines === undefined || totalLines === undefined) return undefined
  return { startLine, numLines, totalLines, ...(fieldOf(file, 'truncatedByTokenCap') === true ? { truncatedByTokenCap: true } : {}) }
}

export const classifyReadResult = ({ deny, isError, result, text }: ReadAnswer): ReadOutcome => {
  if (deny !== undefined || isError === true) return { kind: 'error' }
  const type = fieldOf(result, 'type')
  if (type === 'file_unchanged') return { kind: 'file_unchanged' }
  const lines = type === 'text' ? textLines(fieldOf(result, 'file')) : undefined
  return lines === undefined ? { kind: 'not_text' } : { kind: 'text', lines, modelText: text ?? '' }
}
