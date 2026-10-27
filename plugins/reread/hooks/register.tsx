import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.end', async ($, e, next) => next(e)).catch(($, e, next) => next(e))
}
