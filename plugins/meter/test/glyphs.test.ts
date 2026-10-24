import { expect, test } from 'claude-code/testing'

import { GLYPHS, asGlyphSet, glyphFor, labelled } from '../hooks/glyphs'

const codepoints = [
  ['unicode', 'context', 0x25d4],
  ['unicode', 'fiveHour', 0x25f7],
  ['unicode', 'weekly', 0x29d6],
  ['unicode', 'cost', 0x00a2],
  ['unicode', 'refresh', 0x21bb],
  ['unicode', 'mcpServers', 0x2b21],
  ['unicode', 'stale', 0x26a0],
  ['unicode', 'limitReached', 0x2715],
  ['nerd', 'context', 0xf1c0],
  ['nerd', 'fiveHour', 0xf017],
  ['nerd', 'weekly', 0xf073],
  ['nerd', 'cost', 0xf155],
  ['nerd', 'refresh', 0xf021],
  ['nerd', 'mcpServers', 0xf1e6],
  ['nerd', 'stale', 0xf071],
  ['nerd', 'limitReached', 0xf05e],
] as const

for (const [set, slot, code] of codepoints) {
  test(`It returns U+${code.toString(16).toUpperCase()} from glyphFor for ${set} ${slot}`, () => {
    expect(glyphFor(set, slot).codePointAt(0)).toBe(code)
  })

  test(`It returns exactly one code point from glyphFor for ${set} ${slot}`, () => {
    expect([...glyphFor(set, slot)]).toHaveLength(1)
  })
}

test('It holds the same slots in both sets in GLYPHS', () => {
  expect(Object.keys(GLYPHS.nerd)).toEqual(Object.keys(GLYPHS.unicode))
})

const glyphSetCases = [
  ['unicode', 'unicode'],
  ['nerd', 'nerd'],
  ['emoji', 'unicode'],
  [undefined, 'unicode'],
  [3, 'unicode'],
] as const

for (const [stored, expected] of glyphSetCases) {
  test(`It returns ${expected} from asGlyphSet for ${JSON.stringify(stored)}`, () => {
    expect(asGlyphSet(stored)).toBe(expected)
  })
}

test('It puts one space between the glyph and the text in labelled', () => {
  expect(labelled('unicode', 'fiveHour', '5-HOUR')).toBe('◷ 5-HOUR')
})
