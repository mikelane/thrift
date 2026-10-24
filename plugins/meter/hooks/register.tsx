import type { Register } from 'claude-code'

import { registerMeterCommand } from './command-registration'
import { logFailure } from './engine-log'
import { asGlyphSet } from './glyphs'
import { drawMeter } from './meter-pane'
import { openMeter, recordMeasure, runMeterCommand } from './meter-actions'
import { PANE_ID } from './pane-id'

export const register: Register = (on, options) => {
  const glyphs = asGlyphSet(options.meterGlyphs)
  const isAutoOpen = options.meterAutoOpen === true

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (!e.isInteractive) return started
    await registerMeterCommand($)
    // Opened in a later tick so the usage readings never hold up the start of the session.
    if (isAutoOpen) $.clock.after(0, () => void logFailure($, openMeter($, 'summary')))
    return started
  }).catch(($, e, next) => next(e))

  // /clear fires session.end with reason 'clear' and no session.start follows, so the command is registered again.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') $.clock.after(0, () => void logFailure($, registerMeterCommand($)))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    await recordMeasure($, e)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'meter' }, ($, e) => runMeterCommand($, e.args)).catch(() => ({
    text: 'Could not run /meter.',
  }))

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e) => drawMeter($, e, glyphs)).catch(($, e, next) =>
    next(e),
  )
}
