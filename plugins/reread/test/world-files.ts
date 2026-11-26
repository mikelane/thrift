import type { World } from './world'

const encoder = new TextEncoder()

let clockTick = 1

export const putFile = (world: World, path: string, text: string): void => {
  clockTick += 1
  world.files.set(path, { text, bytes: encoder.encode(text), mtimeMs: clockTick })
}

// Stores the file's exact bytes, which need not be valid UTF-8. The text the Read tool sees is the bytes decoded as UTF-8.
export const putFileBytes = (world: World, path: string, bytes: Uint8Array): void => {
  clockTick += 1
  world.files.set(path, { text: new TextDecoder().decode(bytes), bytes, mtimeMs: clockTick })
}

// Changes a file's content and leaves its size and mtime as they were.
export const rewriteKeepingStat = (world: World, path: string, text: string): void => {
  const file = world.files.get(path)
  if (file === undefined) throw new Error(`no file ${path}`)
  world.files.set(path, { text, bytes: encoder.encode(text), mtimeMs: file.mtimeMs })
}

// Changes a file's bytes and leaves its size and mtime as they were.
export const rewriteBytesKeepingStat = (world: World, path: string, bytes: Uint8Array): void => {
  const file = world.files.get(path)
  if (file === undefined) throw new Error(`no file ${path}`)
  world.files.set(path, { text: new TextDecoder().decode(bytes), bytes, mtimeMs: file.mtimeMs })
}

// Seven lines, each far longer than the stub context line, so that a repeat of any one or two of them is still worth a stub.
export const SEVEN_LINES = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'].map(name => `${name} ${'x'.repeat(200)}`).join('\n')

// Small enough that a stub would cost more than the contents.
export const TINY_FILE = 'one\ntwo\nthree\nfour\nfive\nsix\nseven'

// Far larger than the stub that would answer a repeat of it, in short lines: two of them are smaller than the stub.
export const LARGE_FILE = Array.from({ length: 40 }, (_, index) => `line ${index + 1} of a file that is long enough to be worth a stub`).join('\n')
