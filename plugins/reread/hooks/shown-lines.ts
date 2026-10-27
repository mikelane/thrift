import type { ResultLines } from './read-tracking'

// Read may give a CRLF file's lines with or without their carriage returns, so both sides are compared without them.
const withoutCarriageReturns = (text: string): string => text.replaceAll('\r\n', '\n')

// Whether the file's text holds, at the lines the result names, exactly the content the Read tool returned. The plugin reads the
// file after the tool ran, so this ties the hash it keeps to what the model read: a stat cannot see a same-size rewrite within one
// modified-time tick, nor a link that pointed elsewhere while the tool ran.
export const showsLines = (fileText: string, { startLine, numLines }: ResultLines, content: string): boolean =>
  withoutCarriageReturns(fileText)
    .split('\n')
    .slice(startLine - 1, startLine - 1 + numLines)
    .join('\n') === withoutCarriageReturns(content)
