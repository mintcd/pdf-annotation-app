import { syncSessionForUserId, type SyncSession } from '../utils/syncIdentity'

export const SESSION_COOKIE = 'pdf_annotation_session'
const MAX_AGE = 60 * 60 * 24 * 30

export function readSessionToken(request: Request): string | null {
  const match = request.headers.get('cookie')?.split(';')
    .map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))
  const token = match?.slice(SESSION_COOKIE.length + 1)
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null
}

export async function tokenHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function readTrustedSession(request: Request, database: D1Database): Promise<SyncSession> {
  const token = readSessionToken(request)
  if (!token) return syncSessionForUserId(undefined)
  const user = await database.prepare(
    'SELECT users.id, users.username FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id WHERE token_hash = ? AND expires_at > ? LIMIT 1',
  ).bind(await tokenHash(token), Date.now()).first<{ id: string; username: string }>()
  return syncSessionForUserId(user?.id, user?.username)
}

export async function issueSessionCookie(request: Request, database: D1Database, userId: string): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  await database.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await tokenHash(token), userId, Date.now() + MAX_AGE * 1000).run()
  return cookie(request, token, MAX_AGE)
}

export async function revokeSession(request: Request, database: D1Database): Promise<string> {
  const token = readSessionToken(request)
  if (token) await database.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await tokenHash(token)).run()
  return cookie(request, '', 0)
}

function cookie(request: Request, value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin')
  return request.headers.get('sec-fetch-site') !== 'cross-site'
    && (origin === null || origin === new URL(request.url).origin)
}
