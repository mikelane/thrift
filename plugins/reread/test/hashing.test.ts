import { describe, expect, test } from 'claude-code/testing'

import { pathHash, sha256Hex } from '../hooks/hashing'

describe('sha256Hex', () => {
  test('It returns the SHA-256 of the text as lowercase hex', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  test('It hashes the UTF-8 bytes of the text', async () => {
    expect(await sha256Hex('é')).toBe('4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c')
  })

  test('It returns different hashes for different text', async () => {
    expect(await sha256Hex('a')).not.toBe(await sha256Hex('b'))
  })
})

describe('pathHash', () => {
  test('It returns 16 hex characters', async () => {
    expect(await pathHash('salt', '/work/a.ts')).toMatch(/^[0-9a-f]{16}$/)
  })

  test('It returns the same hash for the same salt and path', async () => {
    expect(await pathHash('salt', '/work/a.ts')).toBe(await pathHash('salt', '/work/a.ts'))
  })

  test('It returns a different hash for a different salt', async () => {
    expect(await pathHash('one', '/work/a.ts')).not.toBe(await pathHash('two', '/work/a.ts'))
  })

  test('It returns a different hash for a different path', async () => {
    expect(await pathHash('salt', '/work/a.ts')).not.toBe(await pathHash('salt', '/work/b.ts'))
  })

  test('It does not contain the path', async () => {
    expect(await pathHash('salt', '/work/a.ts')).not.toContain('work')
  })
})
