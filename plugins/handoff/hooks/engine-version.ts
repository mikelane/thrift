const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/

export const isUntestedEngine = (base: string | undefined): boolean => base === undefined || !RELEASE_VERSION_PATTERN.test(base)
