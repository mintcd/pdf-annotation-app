import assert from 'node:assert/strict'
import test from 'node:test'
import { SyncHttpError } from '@mintcd/sync-engine/transport/http-server'
import type { SyncRequestScope } from '@mintcd/sync-engine/transport/http-server'
import {
  SESSION_COOKIE,
  issueSessionCookie,
  readSessionToken,
  readTrustedSession,
  revokeSession,
  tokenHash,
} from '../lib/serverSession'
import { authorizeSync } from '../lib/syncAuthorization'
import { syncSessionForUserId } from '../utils/syncIdentity'

interface StoredSession { userId: string; expiresAt: number }
interface Query { sql: string; values: readonly unknown[]; operation: 'first' | 'run' }
interface SessionStatement {
  bind(...values: unknown[]): SessionStatement
  first<Value>(): Promise<Value | null>
  run(): Promise<{ success: true }>
}

/** Models the session/user join and expiry boundary without a Worker runtime. */
function sessionDatabase() {
  const sessions = new Map<string, StoredSession>()
  const users = new Map<string, { id: string; username: string }>([
    ['alice', { id: 'alice', username: 'Alice' }],
    ['bob', { id: 'bob', username: 'Bob' }],
  ])
  const queries: Query[] = []
  const prepare = (sql: string, values: readonly unknown[] = []): SessionStatement => ({
    bind(...bound: unknown[]) { return prepare(sql, bound) },
    async first<Value>() {
      queries.push({ sql, values, operation: 'first' })
      assert.match(sql, /FROM auth_sessions JOIN users ON users\.id = auth_sessions\.user_id/)
      assert.match(sql, /WHERE token_hash = \? AND expires_at > \? LIMIT 1/)
      const stored = sessions.get(String(values[0]))
      const user = stored && stored.expiresAt > Number(values[1]) ? users.get(stored.userId) : undefined
      return (user ? { ...user } : null) as Value | null
    },
    async run() {
      queries.push({ sql, values, operation: 'run' })
      if (sql.startsWith('INSERT INTO auth_sessions')) {
        assert.match(sql, /\(token_hash, user_id, expires_at\) VALUES \(\?, \?, \?\)/)
        assert.equal(values.length, 3)
        sessions.set(String(values[0]), { userId: String(values[1]), expiresAt: Number(values[2]) })
      } else if (sql.startsWith('DELETE FROM auth_sessions')) {
        assert.match(sql, /WHERE token_hash = \?/)
        sessions.delete(String(values[0]))
      } else throw new Error(`Unexpected session mutation: ${sql}`)
      return { success: true }
    },
  })
  // Production consumes only prepare/bind/first/run; the cast is confined to this fake boundary.
  const database = { prepare } as unknown as D1Database
  return { database, sessions, users, queries }
}

const request = (headers: HeadersInit = {}, url = 'https://pdf.example/api/sync') => new Request(url, { headers })
const requestWithToken = (token: string, extra: Record<string, string> = {}) => request({ cookie: `${SESSION_COOKIE}=${token}`, ...extra })
const tokenFromCookie = (cookie: string) => cookie.slice(SESSION_COOKIE.length + 1).split(';')[0]
const statusCode = (status: number, code: string) => (error: unknown) => error instanceof SyncHttpError && error.status === status && error.code === code
const scopeFor = (streamId: string): SyncRequestScope => ({ protocolVersion: 1, contractVersion: 'pdf-annotation/1', streamId })

test('legacy user IDs, request headers and malformed cookies never authenticate or query sessions', async () => {
  const fake = sessionDatabase()
  for (const headers of [
    { 'x-user-id': 'alice' },
    { cookie: 'pdf_annotation_user_id=alice; userId=alice; user_id=alice; username=Alice', 'x-user-id': 'alice' },
    { cookie: `${SESSION_COOKIE}=alice`, 'x-user-id': 'alice' },
    { cookie: `${SESSION_COOKIE}=${'a'.repeat(63)}`, 'x-user-id': 'alice' },
    { cookie: `${SESSION_COOKIE}=${'a'.repeat(65)}`, 'x-user-id': 'alice' },
    { cookie: `${SESSION_COOKIE}=${'A'.repeat(64)}`, 'x-user-id': 'alice' },
    { cookie: `${SESSION_COOKIE}=${'%61'.repeat(64)}`, 'x-user-id': 'alice' },
  ]) {
    const input = request(headers)
    assert.equal(readSessionToken(input), null)
    assert.deepEqual(await readTrustedSession(input, fake.database), syncSessionForUserId(undefined))
  }
  assert.deepEqual(fake.queries, [])
  const unissued = await readTrustedSession(requestWithToken('a'.repeat(64), { 'x-user-id': 'alice' }), fake.database)
  assert.equal(unissued.authenticated, false)
  assert.equal(fake.queries.length, 1, 'well formed but unissued tokens still require a stored session')
})

test('issued tokens are random opaque secrets while only their hash and expiry are stored', async t => {
  const now = 1_800_000_000_000
  t.mock.method(Date, 'now', () => now)
  const fake = sessionDatabase()
  const firstCookie = await issueSessionCookie(request(), fake.database, 'alice')
  const secondCookie = await issueSessionCookie(request(), fake.database, 'alice')
  const first = tokenFromCookie(firstCookie)
  const second = tokenFromCookie(secondCookie)
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.match(second, /^[a-f0-9]{64}$/)
  assert.notEqual(first, second)
  assert.equal(first.includes('alice'), false)
  const hash = await tokenHash(first)
  assert.notEqual(hash, first)
  assert.equal(hash, await tokenHash(first))
  assert.equal(fake.sessions.has(first), false)
  assert.deepEqual(fake.sessions.get(hash), { userId: 'alice', expiresAt: now + 30 * 24 * 60 * 60 * 1000 })
  assert.equal(JSON.stringify(fake.queries).includes(first), false, 'the raw bearer token must never be stored')
  assert.match(firstCookie, /; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/)
  const httpCookie = await issueSessionCookie(request({}, 'http://localhost:3000/api/login'), fake.database, 'alice')
  assert.equal(httpCookie.includes('; Secure'), false)
})

test('trusted session lookup hashes tokens, joins the current user and rejects expiry or removed users', async t => {
  const now = 1_800_000_000_000
  t.mock.method(Date, 'now', () => now)
  const fake = sessionDatabase()
  const cookie = await issueSessionCookie(request(), fake.database, 'alice')
  const token = tokenFromCookie(cookie)
  const input = requestWithToken(token, { 'x-user-id': 'bob' })
  assert.deepEqual(await readTrustedSession(input, fake.database), syncSessionForUserId('alice', 'Alice'))
  const lookup = fake.queries.at(-1)!
  assert.deepEqual(lookup.values, [await tokenHash(token), now])
  const stored = fake.sessions.get(await tokenHash(token))!
  stored.expiresAt = now
  assert.equal((await readTrustedSession(input, fake.database)).authenticated, false, 'expiry is exclusive')
  stored.expiresAt = now + 1
  assert.equal((await readTrustedSession(input, fake.database)).authenticated, true)
  fake.users.delete('alice')
  assert.equal((await readTrustedSession(input, fake.database)).authenticated, false, 'a deleted user cannot keep authenticating through an old token')
})

test('revocation deletes the hashed token, invalidates lookup and expires the secure cookie', async () => {
  const fake = sessionDatabase()
  const issued = await issueSessionCookie(request(), fake.database, 'alice')
  const token = tokenFromCookie(issued)
  const input = requestWithToken(token)
  assert.equal((await readTrustedSession(input, fake.database)).authenticated, true)
  const expired = await revokeSession(input, fake.database)
  assert.equal(expired, `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`)
  assert.equal(fake.sessions.has(await tokenHash(token)), false)
  assert.equal((await readTrustedSession(input, fake.database)).authenticated, false)
  const deletion = fake.queries.find(query => query.sql.startsWith('DELETE'))!
  assert.deepEqual(deletion.values, [await tokenHash(token)])
  const before = fake.queries.length
  await revokeSession(request({ cookie: `${SESSION_COOKIE}=alice` }), fake.database)
  assert.equal(fake.queries.length, before, 'malformed tokens do not reach storage during logout')
})

test('sync authorization uses the trusted session account and requires the exact account stream', async () => {
  const session = syncSessionForUserId('alice', 'Alice')
  assert.equal(session.authenticated, true)
  const input = request({ origin: 'https://pdf.example', 'x-user-id': 'bob' })
  assert.deepEqual(await authorizeSync(input, scopeFor(session.streamId), async () => session), {
    streamId: session.streamId, context: { accountId: 'alice' },
  })
  for (const streamId of [syncSessionForUserId('bob').streamId, `${session.streamId}/other`, `${session.streamId} `]) {
    await assert.rejects(authorizeSync(input, scopeFor(streamId), async () => session), statusCode(403, 'stream-forbidden'))
  }
  await assert.rejects(authorizeSync(input, scopeFor(session.streamId), async () => syncSessionForUserId(undefined)), statusCode(401, 'sign-in-required'))
})

test('cross-origin sync is denied before looking up a session for either POST or bootstrap GET', async () => {
  const session = syncSessionForUserId('alice')
  let lookups = 0
  for (const method of ['GET', 'POST']) {
    for (const headers of [
      { origin: 'https://attacker.example' },
      { origin: 'https://pdf.example.attacker.example' },
      { origin: 'https://pdf.example', 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'cross-site' },
      { origin: 'null' },
    ]) {
      await assert.rejects(authorizeSync(new Request('https://pdf.example/api/sync', { method, headers }), scopeFor(session.streamId), async () => {
        lookups++
        return session
      }), statusCode(403, 'cross-origin'))
    }
  }
  assert.equal(lookups, 0)
})
