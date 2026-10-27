import { describe, expect, test } from 'claude-code/testing'

import { install, putFile, read, runTool } from './world'

const BIG_PATH = '/work/secret-project/big.ts'
const TINY_PATH = '/work/secret-project/tiny.ts'
const BIG_BODY = Array.from({ length: 40 }, (_, index) => `sentinel-big-body-${index + 1} is long enough to be worth a stub`).join('\n')
const TINY_BODY = 'sentinel-tiny-body'

const LEAKABLE = ['/work', 'secret-project', 'big.ts', 'tiny.ts', 'sentinel-big-body', 'sentinel-tiny-body']

const COMMON_REASONS = ['first_read', 'inside_full_read', 'exact_repeat', 'edit', 'bash', 'stub_not_smaller']

// An override needs a stub to have been sent, and off sends none.
const MODES = [
  ['act', [...COMMON_REASONS, 'override_after_stub']],
  ['ask', [...COMMON_REASONS, 'override_after_stub']],
  ['off', COMMON_REASONS],
] as const

describe('the decision log', () => {
  for (const [readMode, expectedReasons] of MODES) {
    test(`It holds no path and no file content after a broad run in ${readMode}`, { options: { readMode } }, async ($, on) => {
      const world = install($, on)
      putFile(world, BIG_PATH, BIG_BODY)
      putFile(world, TINY_PATH, TINY_BODY)

      await read($, BIG_PATH)
      await read($, BIG_PATH, { offset: 2, limit: 30 })
      await read($, BIG_PATH)
      await read($, BIG_PATH)
      await runTool($, 'Edit', { file_path: BIG_PATH })
      await read($, BIG_PATH)
      await runTool($, 'Bash', { command: 'ls' })
      await read($, BIG_PATH)
      await read($, TINY_PATH)
      await read($, TINY_PATH)

      const log = JSON.stringify(world.records)
      const reasons = world.records.map(record => record.trigger_values.reason)
      expect(expectedReasons.filter(reason => !reasons.includes(reason))).toEqual([])
      expect(LEAKABLE.filter(fragment => log.includes(fragment))).toEqual([])
    })
  }
})
