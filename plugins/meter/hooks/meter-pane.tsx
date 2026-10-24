import type { EngineInterface, RenderInput } from 'claude-code'

import type { HeadlineReading } from '../types'
import { logFailure } from './engine-log'
import { ageLabel } from './format'
import { labelled } from './glyphs'
import type { GlyphSet } from './glyphs'
import { refreshMeter } from './meter-actions'
import {
  contextDetailText,
  contextRowText,
  costRowText,
  mcpServersRowText,
  topContextRowTexts,
  windowRowTexts,
} from './pane-text'
import { currentReading } from './reading-store'
import { windowView } from './window-view'

const NO_READING: HeadlineReading = { contextWindow: 0, rateLimits: [] }

export async function drawMeter($: EngineInterface, e: RenderInput<'Pane'>, set: GlyphSet) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const { headline, breakdown, isStale } = await currentReading($)
  const now = await $.clock.now()
  const utcOffsetMinutes = -new Date(now).getTimezoneOffset()
  const figures = headline ?? NO_READING
  const contextRow = contextRowText(figures, breakdown?.compactsAt, set)
  const costRow = costRowText(figures, set)
  const mcpServersRow = mcpServersRowText(breakdown?.mcpServers ?? [], set)

  return (
    <Box flexDirection="column">
      <Text color={contextRow.color}>{contextRow.text}</Text>
      <Box paddingLeft={2}>
        <Text dimColor>{contextDetailText(breakdown)}</Text>
      </Box>
      {figures.rateLimits.map(limit => (
        <Box flexDirection="column" marginTop={1}>
          {windowRowTexts(windowView(limit, now, utcOffsetMinutes), set).map((row, index) => (
            <Box paddingLeft={index === 0 ? 0 : 2}>
              <Text color={row.color}>{row.text}</Text>
            </Box>
          ))}
        </Box>
      ))}
      {costRow && (
        <Box marginTop={1}>
          <Text>{costRow}</Text>
        </Box>
      )}
      <Box marginTop={1} gap={1}>
        <Text>TOP CONTEXT</Text>
        <Button key="refresh" hotkey="r" label={labelled(set, 'refresh', '[r] refresh')} onPress={() => void logFailure($, refreshMeter($))} />
        {breakdown && <Text dimColor>{`· ${ageLabel(now - breakdown.takenAt)}`}</Text>}
        {isStale && <Text color="warning">{labelled(set, 'stale', 'stale')}</Text>}
      </Box>
      {topContextRowTexts(breakdown?.topRows ?? []).map(row => (
        <Text>{row}</Text>
      ))}
      {mcpServersRow && (
        <Box paddingLeft={2}>
          <Text dimColor>{mcpServersRow}</Text>
        </Box>
      )}
    </Box>
  )
}
