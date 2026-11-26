import type { EngineInterface, On } from 'claude-code'

import { takeDownBand, takeDownBandFromBeforeReload } from './band-controller'
import { forgetForeignClear, holdResume, recordForeignClear, recordForeignClearDone, recordForeignClearReturned, recordForeignClearRunning, recordResumeDispatch, recordSessionEnd, shouldHoldResume } from './clear-stage'
import { registerHandoffCommand } from './command-registration'
import { snapshotTrigger } from './decision-record'
import { debug, logFailure } from './engine-log'
import { isUntestedEngine } from './engine-version'
import { writeRecord } from './record-writer'
import { resetForNewSession, type SessionState } from './session-state'
import type { Mode } from './signals'
import { releaseTurnEndWaiter } from './turn-state'

async function readVersion($: EngineInterface) {
  try {
    const { version, base } = await $.session.version()
    return { engineVersion: base ?? version, base }
  } catch (error) {
    debug($, `could not read the engine version: ${String(error)}`)
    return { engineVersion: 'unknown', base: undefined }
  }
}

export const registerLifecycleHooks = (on: On, state: SessionState, setting: Mode) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await takeDownBandFromBeforeReload($, state)
    const { engineVersion, base } = await readVersion($)
    const isUntested = isUntestedEngine(base)
    state.engineVersion = engineVersion
    state.mode = e.isInteractive && !isUntested ? setting : 'off'
    if (e.isInteractive) await registerHandoffCommand($)
    if (isUntested) {
      await writeRecord($, state, { ...snapshotTrigger(state, 'session-start', 'none', false), action: 'untested_engine' })
    }
    return started
  }).catch(($, e, next) => next(e))

  // The engine skips the calling plugin's hook for the plugin's own clear (seen live on 2.1.302: the re-entry line), so the
  // handoff's own clear does not reach this hook. recordForeignClear still drops it by origin as a safeguard. The test kit
  // skips the whole plugin too, so only the pure tests cover the own-origin branch.
  // Counted from the note on, before next, since the clear's session end may come inside it (the kit's does). Core sets ref on a run it made; a
  // hook beneath that answers in the clear's place leaves it off, and a clear that throws ran nothing: no end is coming.
  // SAFETY: a hook beneath that calls next and then rewrites the output also leaves ref off. The end already spent the count,
  // so forgetting is a no-op, unless a second foreign clear is still pending, whose count it eats: that clear's end is then
  // taken for the handoff's, and a late turn after it goes unreported. Needs two queued clears and such a hook. No guard.
  on('command.run', { command: 'clear' }, async ($, e, next) => {
    recordForeignClear(state, e.origin)
    recordForeignClearRunning(state, e.origin)
    try {
      const clearOutput = await next(e)
      if (clearOutput.ref === undefined) forgetForeignClear(state)
      else recordForeignClearReturned(state, e.origin)
      return clearOutput
    } catch (error) {
      forgetForeignClear(state)
      throw error
    } finally {
      recordForeignClearDone(state, e.origin)
    }
  }).catch(($, e, next) => next(e))

  // Seen at dispatch, so a /resume the person typed during the compaction is known before the handoff queues its clear.
  // A resume that dispatches with the handoff's clear already queued is answered here and replayed after the clear returned
  // (replayHeldResumes in clear-window.tsx), so the clear runs in the session the handoff started in.
  on('command.run', { command: 'resume' }, ($, e, next) => {
    if (shouldHoldResume(state, e.origin)) {
      holdResume(state, e.args)
      return { text: 'The handoff is clearing this session first; your /resume runs right after.' }
    }
    recordResumeDispatch(state)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    recordSessionEnd(state, e.reason)
    await takeDownBand($, state)
    resetForNewSession(state)
    // A handoff waiting on a turn resumes in a later tick, so it never runs inside this hook.
    $.clock.after(0, () => releaseTurnEndWaiter(state))
    if (e.reason === 'clear') {
      $.clock.after(0, () => {
        void logFailure($, registerHandoffCommand($))
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}
