import { describe, expect, test } from 'claude-code/testing'

import { bytesOfBase64, pathHash, sha256Hex, sha256OfBytes } from '../hooks/hashing'

describe('sha256OfBytes', () => {
  test('It returns the SHA-256 of the bytes as lowercase hex', async () => {
    expect(await sha256OfBytes(new Uint8Array([0x61, 0x62, 0x63]))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  test('It returns different hashes for bytes that are not valid UTF-8 and differ only in those bytes', async () => {
    expect(await sha256OfBytes(new Uint8Array([0xff]))).not.toBe(await sha256OfBytes(new Uint8Array([0xfe])))
  })
})

describe('bytesOfBase64', () => {
  test('It returns the bytes that the base64 encodes', () => {
    expect([...bytesOfBase64('/w==')]).toEqual([0xff])
  })

  test('It returns the bytes of a multi-byte base64 string', () => {
    expect([...bytesOfBase64('YWJj')]).toEqual([0x61, 0x62, 0x63])
  })
})

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

  test('It returns the first 16 hex characters of the SHA-256 of the salt, a pipe and the path', async () => {
    expect(await pathHash('salt', '/work/a.ts')).toBe('1b4f8ccf1f5f0841')
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
