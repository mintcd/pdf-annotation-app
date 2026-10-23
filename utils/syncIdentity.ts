export const ANONYMOUS_USER_ID = 'anonymous'

export interface SyncSession {
  readonly userId: string
  readonly username: string | null
  readonly streamId: string
  readonly authenticated: boolean
}

export function streamIdForUserId(userId: string): string {
  return `user:${normalizeUserId(userId)}`
}

export function syncSessionForUserId(userId: string | undefined, username?: string | null): SyncSession {
  const normalized = normalizeUserId(userId ?? ANONYMOUS_USER_ID)
  return {
    userId: normalized,
    username: normalized === ANONYMOUS_USER_ID ? null : normalizeSessionUsername(username),
    streamId: streamIdForUserId(normalized),
    authenticated: normalized !== ANONYMOUS_USER_ID,
  }
}

export function normalizeUserId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128)
  return normalized === '' ? ANONYMOUS_USER_ID : normalized
}

function normalizeSessionUsername(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const username = normalizeUserId(value)
  return username === ANONYMOUS_USER_ID ? null : username
}
