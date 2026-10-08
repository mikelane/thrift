export const TESTED_THROUGH = '2.1.295'

const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/

const core = (version: string): number[] | null => {
  const match = RELEASE.exec(version)
  return match ? match.slice(1).map(Number) : null
}

const isNewer = (candidate: readonly number[], reference: readonly number[]): boolean =>
  candidate.map((part, index) => Math.sign(part - Number(reference[index]))).find(order => order !== 0) === 1

export const isUntestedEngine = (base: string | undefined, testedThrough: string = TESTED_THROUGH): boolean => {
  const release = base === undefined ? null : core(base)
  const tested = core(testedThrough)
  return release === null || tested === null || isNewer(release, tested)
}
