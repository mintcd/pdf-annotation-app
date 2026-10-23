import { getEnv } from '../../../utils/env'
import {
  ANONYMOUS_USER_ID,
  normalizeUserId,
  syncSessionForUserId,
  type SyncSession,
} from '../../../utils/syncIdentity'
import { isSameOriginRequest, issueSessionCookie, revokeSession } from '../../../lib/serverSession'

export class AuthRequestError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message)
  }
}

export type Credentials = {
  readonly username: string
  readonly password: string
}

export type UserRow = {
  readonly id: string
  readonly username: string
  readonly password_hash: string | null
}

export async function readCredentials(request: Request): Promise<Credentials> {
  assertSameOrigin(request)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new AuthRequestError('Enter username and password')
  }

  if (body === null || typeof body !== 'object') {
    throw new AuthRequestError('Enter username and password')
  }

  const record = body as Record<string, unknown>
  const rawUsername = record.username
  const rawPassword = record.password
  if (typeof rawUsername !== 'string' || typeof rawPassword !== 'string') {
    throw new AuthRequestError('Enter username and password')
  }

  const username = normalizeUsername(rawUsername)
  const password = rawPassword.trim()
  if (password === '') {
    throw new AuthRequestError('Enter username and password')
  }

  return { username, password }
}

export function normalizeUsername(value: string): string {
  const username = normalizeUserId(value)
  if (username === ANONYMOUS_USER_ID) {
    throw new AuthRequestError('Enter a username')
  }
  return username
}

export async function userIdForUsername(username: string): Promise<string> {
  return sha256Hex(normalizeUsername(username))
}

export async function hashPassword(password: string): Promise<string> {
  return sha256Hex(password)
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  return getEnv().DB.prepare(
    'SELECT id, username, password_hash FROM users WHERE username = ? LIMIT 1',
  )
    .bind(normalizeUsername(username))
    .first<UserRow>()
}

export async function findUserById(userId: string): Promise<UserRow | null> {
  return getEnv().DB.prepare(
    'SELECT id, username, password_hash FROM users WHERE id = ? LIMIT 1',
  )
    .bind(normalizeUserId(userId))
    .first<UserRow>()
}

export async function sessionResponse(
  request: Request,
  session: SyncSession,
  init: ResponseInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('cache-control', 'no-store')
  headers.set('set-cookie', await issueSessionCookie(request, getEnv().DB, session.userId))
  return Response.json(session, {
    ...init,
    headers,
  })
}

export async function signedOutResponse(request: Request, init: ResponseInit = {}): Promise<Response> {
  assertSameOrigin(request)
  const headers = new Headers(init.headers)
  headers.set('cache-control', 'no-store')
  headers.set(
    'set-cookie',
    await revokeSession(request, getEnv().DB),
  )
  return Response.json(syncSessionForUserId(undefined), {
    ...init,
    headers,
  })
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AuthRequestError) {
    return Response.json(
      { error: error.message },
      {
        status: error.status,
        headers: { 'cache-control': 'no-store' },
      },
    )
  }

  console.error('Authentication request failed', error)
  return Response.json(
    { error: 'Authentication failed' },
    {
      status: 500,
      headers: { 'cache-control': 'no-store' },
    },
  )
}

export function assertSameOrigin(request: Request): void {
  if (!isSameOriginRequest(request)) throw new AuthRequestError('Cross-origin request denied', 403)
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
