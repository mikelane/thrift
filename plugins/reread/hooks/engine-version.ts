const TESTED_PARTS = [2, 1, 311] as const

export const TESTED_THROUGH = TESTED_PARTS.join('.')

const RELEASE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/

const releaseParts = (version: string): number[] | null => {
  const match = RELEASE_VERSION_PATTERN.exec(version)
  return match === null ? null : match.slice(1).map(Number)
}

const isAfterTested = (release: readonly number[]): boolean => {
  const firstDifference = release.findIndex((part, index) => part !== TESTED_PARTS[index])
  return firstDifference !== -1 && (release[firstDifference] ?? 0) > (TESTED_PARTS[firstDifference] ?? 0)
}

// A development build (`2.1.311-dev`), a version that is not spelled as a release, and a release newer than the one the
// plugin was tested through all run as `off`: what Read returns there has not been checked.
export const isUntestedEngine = (base: string | undefined): boolean => {
  const release = base === undefined ? null : releaseParts(base)
  return release === null || isAfterTested(release)
}
