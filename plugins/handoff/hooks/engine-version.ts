export const TESTED_THROUGH = '2.1.295'

const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/

const core = (version: string): number[] | null => {
  const match = RELEASE.exec(version)
  return match ? match.slice(1).map(Number) : null
}

const isNewer = (candidate: readonly number[], reference: readonly number[]): boolean => {
  const differing = candidate.findIndex((part, index) => part !== reference[index])
  return differing !== -1 && (candidate[differing] as number) > (reference[differing] as number)
}

export const isUntestedEngine = (base: string | undefined, testedThrough: string = TESTED_THROUGH): boolean => {
  const release = base === undefined ? null : core(base)
  const tested = core(testedThrough)
  return release === null || tested === null || isNewer(release, tested)
}
