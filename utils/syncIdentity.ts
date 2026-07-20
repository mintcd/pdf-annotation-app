export const SYNC_USER_COOKIE = 'pdf_annotation_user_id'
export const ANONYMOUS_USER_ID = 'anonymous'

export interface SyncSession {
  readonly userId: string
  readonly streamId: string
  readonly authenticated: boolean
}

export function streamIdForUserId(userId: string): string {
  return `user:${normalizeUserId(userId)}`
}

export function syncSessionForUserId(userId: string | undefined): SyncSession {
  const normalized = normalizeUserId(userId ?? ANONYMOUS_USER_ID)
  return {
    userId: normalized,
    streamId: streamIdForUserId(normalized),
    authenticated: normalized !== ANONYMOUS_USER_ID,
  }
}

export function syncSessionFromRequest(request: Request): SyncSession {
  return syncSessionFromHeaderValues(
    request.headers.get('x-pdf-annotation-user-id'),
    request.headers.get('cookie'),
  )
}

export function syncSessionFromHeaderValues(
  userIdHeader: string | null,
  cookieHeader: string | null,
): SyncSession {
  return syncSessionForUserId(
    userIdHeader ?? readCookie(cookieHeader, SYNC_USER_COOKIE),
  )
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

function readCookie(header: string | null, name: string): string | undefined {
  if (header === null) return undefined

  for (const part of header.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=')
    if (rawKey === name) return decodeURIComponent(rawValue.join('='))
  }
  return undefined
}
