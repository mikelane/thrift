const TASK_ID = /^[A-Za-z0-9_-]+$/
const NOTIFIED_TASK = /<task-id>([^<]*)<\/task-id>/

export const validTaskId = (value: unknown): string | null =>
  typeof value === 'string' && TASK_ID.test(value) ? value : null

export const fieldOf = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined

export const notifiedTaskId = (promptText: string): string | null => validTaskId(NOTIFIED_TASK.exec(promptText)?.[1])
