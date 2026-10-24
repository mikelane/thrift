export const GLYPHS = {
  unicode: {
    context: '◔',
    fiveHour: '◷',
    weekly: '⧖',
    cost: '¢',
    refresh: '↻',
    mcpServers: '⬡',
    stale: '⚠',
    limitReached: '✕',
  },
  nerd: {
    context: '\u{F1C0}',
    fiveHour: '\u{F017}',
    weekly: '\u{F073}',
    cost: '\u{F155}',
    refresh: '\u{F021}',
    mcpServers: '\u{F1E6}',
    stale: '\u{F071}',
    limitReached: '\u{F05E}',
  },
} as const

export type GlyphSet = keyof typeof GLYPHS
export type GlyphSlot = keyof (typeof GLYPHS)['unicode']

export const asGlyphSet = (stored: unknown): GlyphSet => (stored === 'nerd' ? 'nerd' : 'unicode')

export const glyphFor = (set: GlyphSet, slot: GlyphSlot): string => GLYPHS[set][slot]

export const labelled = (set: GlyphSet, slot: GlyphSlot, text: string): string => `${glyphFor(set, slot)} ${text}`
