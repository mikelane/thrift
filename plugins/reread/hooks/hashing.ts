const encoder = new TextEncoder()

const hexOf = (digest: ArrayBuffer): string =>
  [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')

export const sha256Hex = async (text: string): Promise<string> => hexOf(await crypto.subtle.digest('SHA-256', encoder.encode(text)))

const PATH_HASH_LENGTH = 16

// The log names a file by this, never by its path: the salt lives in memory for one session, so the same file hashes to
// different values in different sessions and the hash cannot be looked up against a list of paths.
export const pathHash = async (salt: string, realPath: string): Promise<string> =>
  (await sha256Hex(`${salt}|${realPath}`)).slice(0, PATH_HASH_LENGTH)
