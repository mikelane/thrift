import type { EngineInterface, RenderInput } from 'claude-code'

import type { HeadlineReading } from '../types'
import { logFailure } from './engine-log'
import { ageLabel } from './format'
import { labelled } from './glyphs'
import type { GlyphSet } from './glyphs'
import { refreshMeter } from './meter-actions'
import {
  contextDetailText,
  contextGaugeText,
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
  const contextGauge = contextGaugeText(figures, breakdown?.compactsAt)
  const costRow = costRowText(figures, set)
  const mcpServersRow = mcpServersRowText(breakdown?.mcpServers ?? [], set)

  return (
    <Box flexDirection="column">
      <Text color={contextRow.color}>{contextRow.text}</Text>
      {contextGauge && <Text color={contextGauge.color}>{contextGauge.text}</Text>}
      <Text dimColor>{contextDetailText(breakdown)}</Text>
      {figures.rateLimits.map(limit => (
        <Box flexDirection="column" marginTop={1}>
          {windowRowTexts(windowView(limit, now, utcOffsetMinutes), set).map(row => (
            <Text color={row.color} dimColor={row.dim}>
              {row.text}
            </Text>
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
        <Button key="refresh" hotkey="r" label={labelled(set, 'refresh', 'refresh (r)')} onPress={() => void logFailure($, refreshMeter($))} />
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
