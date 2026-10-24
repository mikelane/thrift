import type { EngineInterface, Register } from 'claude-code'

import { registerMeterCommand } from './command-registration'
import { debug, logFailure } from './engine-log'
import { asGlyphSet } from './glyphs'
import { drawMeter } from './meter-pane'
import { openMeter, recordMeasure, reloadOpenMeter, restartMeterReading, runMeterCommand } from './meter-actions'
import { PANE_ID } from './pane-id'
import { isInteractiveSession, rememberInteractivity } from './session-store'

async function registerAndReload($: EngineInterface): Promise<void> {
  await registerMeterCommand($)
  await reloadOpenMeter($)
}

export const register: Register = (on, options) => {
  const glyphSet = asGlyphSet(options.meterGlyphs)
  const isAutoOpen = options.meterAutoOpen === true

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await logFailure($, rememberInteractivity($, e.isInteractive))
    if (!e.isInteractive) return started
    await registerMeterCommand($)
    // Opened in a later tick so the usage readings never hold up the start of the session.
    if (isAutoOpen) $.clock.after(0, () => void logFailure($, openMeter($, 'summary')))
    return started
  }).catch(($, e, next) => next(e))

  // /clear fires session.end with reason 'clear' and no session.start follows, so the command is registered again.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await logFailure($, restartMeterReading($))
      if (await isInteractiveSession($)) $.clock.after(0, () => void logFailure($, registerAndReload($)))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    await recordMeasure($, e)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'meter' }, ($, e) => runMeterCommand($, e.args)).catch(($, _e, next) => {
    debug($, `could not run /meter: ${next.error.message ?? next.error.kind}`)
    return { text: 'Could not run /meter.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e) => drawMeter($, e, glyphSet)).catch(($, e, next) =>
    next(e),
  )
}
