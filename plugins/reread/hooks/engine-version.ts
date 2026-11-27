const MINIMUM_PARTS = [2, 1, 308] as const

export const MINIMUM_ENGINE = MINIMUM_PARTS.join('.')

const RELEASE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/

const releaseParts = (version: string): number[] | null => {
  const match = RELEASE_VERSION_PATTERN.exec(version)
  return match === null ? null : match.slice(1).map(Number)
}

const isBeforeMinimum = (release: readonly number[]): boolean => {
  const firstDifference = release.findIndex((part, index) => part !== MINIMUM_PARTS[index])
  return firstDifference !== -1 && (release[firstDifference] ?? 0) < (MINIMUM_PARTS[firstDifference] ?? 0)
}

// A release older than the oldest one the plugin was verified on, a development build (`2.1.332-dev`), and a version that
// is not spelled as a release all run as `off`: what Read returns there has not been checked. A newer release runs: the
// per-read checks fall back to an unchanged read when what Read returns no longer fits the stub.
export const isUnsupportedEngine = (base: string | undefined): boolean => {
  const release = base === undefined ? null : releaseParts(base)
  return release === null || isBeforeMinimum(release)
}
