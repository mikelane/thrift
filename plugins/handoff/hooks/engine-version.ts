const RELEASE = /^\d+\.\d+\.\d+$/

export const isUntestedEngine = (base: string | undefined): boolean => base === undefined || !RELEASE.test(base)
