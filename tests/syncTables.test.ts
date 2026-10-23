import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSyncTables,
  SyncAuthorityRejectionError,
  type AppSyncEngine,
} from '../lib/syncTables'
import type { Row, TableName } from '../utils/engine'

function documentRow(id: string, title = id): Row<'documents'> {
  return {
    id, source_key: id, source_type: 'remote', source_url: `https://example.test/${id}.pdf`,
    file_name: `${id}.pdf`, title, created_at: '2026-10-18T12:00:00Z',
    updated_at: '2026-10-18T12:00:00Z', number_of_annotations: 0,
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function fakeEngine(seed: readonly Row<'documents'>[] = []) {
  const records: Record<TableName, Map<string, Record<string, unknown>>> = {
    documents: new Map(seed.map(row => [row.id, { ...row }])),
    annotations: new Map(),
    highlight_colors: new Map(),
  }
  let revision = 0
  const subscribers = new Set<(status: unknown) => void>()
  const mutations: { type: string; table: TableName; key: readonly string[]; data?: unknown }[] = []
  const queries: { collection: TableName; limit: number; cursor?: { offset: number } }[] = []
  const resolutionRequests: { limit?: number; after?: string }[] = []
  const rejections: { status: 'rejected'; operationId: string; reason: { code: string; message: string } }[] = []
  let queryHook: ((input: typeof queries[number]) => Promise<void> | void) | undefined
  let getHook: (() => Promise<void>) | undefined
  let mutationError: Error | undefined

  const snapshot = () => ({
    phase: 'idle' as const,
    replica: {
      streamId: 'user:test', clientId: 'client:test', revision,
      confirmedSequence: 0, headSequence: 0, nextClientSequence: 1,
      pendingCount: 0, acceptedAwaitingCount: 0, resolutionCount: rejections.length,
    },
  })
  function changed(notify = true) {
    ++revision
    if (notify) for (const subscriber of subscribers) subscriber(snapshot())
  }
  const input = {
    getSnapshot: snapshot,
    status: async () => snapshot(),
    subscribe(listener: (status: unknown) => void) {
      subscribers.add(listener)
      return () => { subscribers.delete(listener) }
    },
    async query(query: typeof queries[number]) {
      queries.push(query)
      await queryHook?.(query)
      const rows = [...records[query.collection].values()].sort((a, b) => String(a.id ?? a.color).localeCompare(String(b.id ?? b.color)))
      const offset = query.cursor?.offset ?? 0
      return {
        rows: rows.slice(offset, offset + query.limit).map(row => ({ ...row })),
        status: snapshot().replica,
        ...(offset + query.limit < rows.length ? { nextCursor: { offset: offset + query.limit } } : {}),
      }
    },
    async get(table: TableName, key: readonly string[]) {
      await getHook?.()
      const row = records[table].get(key[0])
      return { row: row ? { ...row } : undefined, status: snapshot().replica }
    },
    from(table: TableName) {
      return {
        async insert(row: Record<string, unknown>) {
          if (mutationError) throw mutationError
          const key = String(row[table === 'highlight_colors' ? 'color' : 'id'])
          assert.equal(records[table].has(key), false, 'duplicate inserts must be serialized')
          records[table].set(key, { ...row })
          mutations.push({ type: 'insert', table, key: [key], data: { ...row } })
          changed()
        },
        async update(key: readonly string[], patch: Record<string, unknown>) {
          if (mutationError) throw mutationError
          const current = records[table].get(key[0])
          assert.ok(current)
          records[table].set(key[0], { ...current, ...patch })
          mutations.push({ type: 'update', table, key, data: patch })
          changed()
        },
        async delete(key: readonly string[]) {
          if (mutationError) throw mutationError
          records[table].delete(key[0])
          mutations.push({ type: 'delete', table, key })
          changed()
        },
      }
    },
    async readResolutions(options: { limit?: number; after?: string } = {}) {
      resolutionRequests.push(options)
      const limit = options.limit ?? 64
      assert.ok(limit <= 64, 'resolution pages must respect the replica proposal limit, independent of collection query pages')
      const offset = options.after ? rejections.findIndex(decision => decision.operationId === options.after) + 1 : 0
      const decisions = rejections.slice(offset, offset + limit)
      return {
        decisions, status: snapshot().replica,
        ...(offset + limit < rejections.length ? { nextAfter: decisions.at(-1)!.operationId } : {}),
      }
    },
  }
  return {
    engine: input as unknown as AppSyncEngine,
    records, mutations, queries, resolutionRequests, rejections, subscribers, changed,
    queryHook(value: typeof queryHook) { queryHook = value },
    getHook(value: typeof getHook) { getHook = value },
    mutationError(value: typeof mutationError) { mutationError = value },
  }
}

test('hydrates every bounded page and stays unavailable until the complete snapshot is ready', async t => {
  const fixture = fakeEngine(Array.from({ length: 520 }, (_, index) => documentRow(String(index).padStart(4, '0'))))
  fixture.records.highlight_colors.set('#87ceeb', { color: '#87ceeb', semantics: 'Reference' })
  const gate = deferred()
  fixture.queryHook(async input => { if (input.collection === 'documents' && !input.cursor) await gate.promise })
  const store = createSyncTables(fixture.engine)
  t.after(() => store.stop())
  store.start()
  const loading = store.refresh()
  assert.equal(store.getSnapshot().ready, false)
  gate.resolve()
  await loading
  assert.equal(store.getSnapshot().ready, true)
  assert.equal(store.getSnapshot().tables.documents.length, 520)
  assert.equal(store.db.table('documents').all().length, 520)
  assert.equal(store.db.table('highlight_colors').all().length, 1)
  assert.equal(fixture.queries.filter(query => query.collection === 'documents').length, 3)
  assert.ok(fixture.queries.every(query => query.limit <= 250))
})

test('put reads durable data, patches only changed non-key fields, and refreshes all before resolving', async t => {
  const fixture = fakeEngine([documentRow('existing', 'Before')])
  const store = createSyncTables(fixture.engine)
  t.after(() => store.stop())
  store.start()
  await store.refresh()
  const table = store.db.table('documents')
  await table.put({ ...documentRow('existing', 'Before'), title: 'After' })
  assert.deepEqual(fixture.mutations, [{ type: 'update', table: 'documents', key: ['existing'], data: { title: 'After' } }])
  assert.equal(table.all()[0].title, 'After')
  await table.put(documentRow('existing', 'After'))
  assert.equal(fixture.mutations.length, 1, 'an unchanged row must not enqueue an empty update')
  await table.delete({ id: 'existing' })
  assert.equal(table.all().length, 0)
  assert.equal(store.getSnapshot().tables.documents.length, 0)
})

test('concurrent puts of a missing key serialize and fresh get sees changes outside the cached snapshot', async t => {
  const fixture = fakeEngine()
  const store = createSyncTables(fixture.engine)
  t.after(() => store.stop())
  store.start()
  await store.refresh()
  const table = store.db.table('documents')
  await Promise.all([table.put(documentRow('new', 'First')), table.put(documentRow('new', 'Second'))])
  assert.deepEqual(fixture.mutations.map(mutation => mutation.type), ['insert', 'update'])
  assert.equal(table.all()[0].title, 'Second')
  fixture.records.documents.set('new', documentRow('new', 'Incoming'))
  fixture.changed(false)
  assert.equal(table.all()[0].title, 'Second')
  assert.equal((await table.get({ id: 'new' }))?.title, 'Incoming')
  await store.refresh()
  assert.equal(table.all()[0].title, 'Incoming')
})

test('retries a collection snapshot if revisions change between its pages', async t => {
  const fixture = fakeEngine(Array.from({ length: 251 }, (_, index) => documentRow(String(index).padStart(4, '0'), 'Before')))
  let changed = false
  fixture.queryHook(input => {
    if (input.collection === 'documents' && input.cursor && !changed) {
      changed = true
      for (const [key, row] of fixture.records.documents) fixture.records.documents.set(key, { ...row, title: 'After' })
      fixture.changed()
    }
  })
  const store = createSyncTables(fixture.engine)
  t.after(() => store.stop())
  store.start()
  await store.refresh()
  assert.ok(changed)
  assert.equal(store.getSnapshot().tables.documents.length, 251)
  assert.ok(store.getSnapshot().tables.documents.every(row => row.title === 'After'))
  assert.equal(store.getSnapshot().revision, 1)
})

test('a commit during snapshot publication cannot get lost while the old refresh promise settles', async t => {
  const fixture = fakeEngine([documentRow('existing', 'Before')])
  const store = createSyncTables(fixture.engine)
  t.after(() => store.stop())
  let incoming = false
  const unsubscribe = store.subscribe(() => {
    if (incoming || !store.getSnapshot().ready) return
    incoming = true
    fixture.records.documents.set('existing', documentRow('existing', 'Incoming'))
    fixture.changed()
  })
  t.after(unsubscribe)
  await store.refresh()
  assert.ok(incoming)
  assert.equal(store.getSnapshot().revision, 1)
  assert.equal(store.db.table('documents').all()[0].title, 'Incoming')
})

test('a stopped account cannot publish an unfinished load or finish a queued write', async () => {
  const fixture = fakeEngine([documentRow('account-one')])
  const gate = deferred()
  fixture.queryHook(async input => { if (input.collection === 'documents') await gate.promise })
  const store = createSyncTables(fixture.engine)
  store.start()
  const loading = store.refresh()
  store.stop()
  gate.resolve()
  await loading
  assert.equal(store.getSnapshot().ready, false)
  assert.equal(fixture.subscribers.size, 0)
  await assert.rejects(store.db.table('documents').get({ id: 'account-one' }), /not open/)

  fixture.queryHook(undefined)
  store.start()
  await store.refresh()
  const readGate = deferred()
  const readStarted = deferred()
  fixture.getHook(async () => { readStarted.resolve(); await readGate.promise })
  const pending = store.db.table('documents').put(documentRow('account-one', 'Must not write'))
  await readStarted.promise
  store.stop()
  readGate.resolve()
  await assert.rejects(pending, /not open/)
  assert.equal(fixture.mutations.length, 0)
})

test('storage and enqueue failures remain visible and failed writes reject their caller', async t => {
  const fixture = fakeEngine()
  const store = createSyncTables(fixture.engine)
  t.after(() => store.stop())
  const storageError = new Error('IndexedDB read failed')
  fixture.queryHook(() => { throw storageError })
  store.start()
  await assert.rejects(store.refresh(), error => error === storageError)
  assert.equal(store.getSnapshot().ready, false)
  assert.equal(store.getSnapshot().error, storageError)
  fixture.queryHook(undefined)
  await store.refresh()
  const enqueueError = new Error('Device storage is full')
  fixture.mutationError(enqueueError)
  await assert.rejects(store.db.table('documents').put(documentRow('failed')), error => error === enqueueError)
  assert.equal(store.getSnapshot().error, enqueueError)
  assert.equal(store.db.table('documents').all().length, 0)
})

test('authority rejection notices surface with their operation identity and message', async t => {
  const fixture = fakeEngine()
  fixture.rejections.push({ status: 'rejected', operationId: 'rejected-op', reason: { code: 'invalid-title', message: 'A title is required.' } })
  const store = createSyncTables(fixture.engine)
  t.after(() => store.stop())
  store.start()
  await store.refresh()
  const error = store.getSnapshot().error
  assert.ok(error instanceof SyncAuthorityRejectionError)
  assert.equal(error.operationId, 'rejected-op')
  assert.equal(error.code, 'invalid-title')
  assert.equal(error.message, 'A title is required.')
})

test('resolution hydration follows every engine-bounded page without imposing collection query limits', async t => {
  const fixture = fakeEngine()
  for (let index = 0; index < 130; index += 1) {
    fixture.rejections.push({
      status: 'rejected', operationId: `rejected-${String(index).padStart(3, '0')}`,
      reason: { code: 'invalid-title', message: `Rejected title ${index}` },
    })
  }
  const store = createSyncTables(fixture.engine)
  t.after(() => store.stop())
  store.start()
  await store.refresh()
  assert.equal(store.getSnapshot().ready, true)
  assert.equal(fixture.resolutionRequests.length, 3)
  assert.ok(fixture.resolutionRequests.every(request => request.limit === undefined))
  assert.deepEqual(fixture.resolutionRequests.map(request => request.after), [undefined, 'rejected-063', 'rejected-127'])
  const error = store.getSnapshot().error
  assert.ok(error instanceof SyncAuthorityRejectionError)
  assert.equal(error.operationId, 'rejected-129')
})
