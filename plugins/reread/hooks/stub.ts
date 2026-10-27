import type { Savings } from './decision-record'

const encoder = new TextEncoder()

export const utf8Bytes = (text: string): number => encoder.encode(text).length

export const lineByteLengths = (text: string): number[] => text.split('\n').map(line => utf8Bytes(line) + 1)

// Core's own result for a file it already showed: it validates this against Read's output schema and renders it.
export const stubResult = (filePath: string) => ({ type: 'file_unchanged' as const, file: { filePath } })

export const stubContextLine = (filePath: string, turn: number, lines: number): string =>
  `reread: ${filePath} is unchanged since you read it at turn ${turn} (same content, ${lines} ${lines === 1 ? 'line' : 'lines'}). ` +
  'Its contents are earlier in this conversation. Read it again only if you need it in full.'

// The stub's cost is counted as its result as JSON plus the context line: a hook cannot see how core renders the result.
export const savingsOf = (grossBytes: number, result: ReturnType<typeof stubResult>, contextLine: string): Savings => ({
  grossBytes,
  stubBytes: utf8Bytes(JSON.stringify(result)) + utf8Bytes(contextLine),
})

// A stub is only worth sending when it is smaller than the text the model would otherwise read.
export const stubIsSmaller = ({ grossBytes, stubBytes }: Savings): boolean => stubBytes < grossBytes
