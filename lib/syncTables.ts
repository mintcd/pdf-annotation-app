import type { useSyncEngine } from '../sync/generated'
import type { Row, TableName } from '../utils/engine'

export type AppSyncEngine = NonNullable<ReturnType<typeof useSyncEngine>['engine']>
export type AppSyncTables = { readonly [Name in TableName]: readonly Row<Name>[] }
export type AppSyncKey<Name extends TableName> = Name extends 'highlight_colors'
  ? { readonly color: string }
  : { readonly id: string }

export interface AppSyncTable<Name extends TableName> {
  all(): readonly Row<Name>[]
  get(key: AppSyncKey<Name>): Promise<Row<Name> | undefined>
  put(row: Row<Name>): Promise<void>
  delete(key: AppSyncKey<Name>): Promise<void>
}

export interface AppSyncDatabase {
  table<Name extends TableName>(name: Name): AppSyncTable<Name>
}

export interface SyncTablesSnapshot {
  readonly tables: AppSyncTables
  readonly ready: boolean
  readonly revision: number
  readonly error: unknown
}

const tableNames = ['documents', 'annotations', 'highlight_colors'] as const
const pageSize = 250
const maximumSnapshotAttempts = 8

export const emptySyncTablesSnapshot: SyncTablesSnapshot = Object.freeze({
  tables: Object.freeze({
    documents: Object.freeze([]),
    annotations: Object.freeze([]),
    highlight_colors: Object.freeze([]),
  }),
  ready: false,
  revision: -1,
  error: undefined,
})

function primaryField(name: TableName): 'id' | 'color' {
  return name === 'highlight_colors' ? 'color' : 'id'
}

function recordKey(name: TableName, value: unknown): [string] {
  const key = (value as Record<string, unknown>)[primaryField(name)]
  if (typeof key !== 'string' || key.length === 0) throw new Error(`A ${name} primary key is required.`)
  return [key]
}

function unavailable(): never {
  throw new Error('The local annotation library is not open.')
}

export const unavailableSyncDatabase: AppSyncDatabase = {
  table() {
    return {
      all: () => [],
      get: async () => unavailable(),
      put: async () => unavailable(),
      delete: async () => unavailable(),
    }
  },
}

export class SyncAuthorityRejectionError extends Error {
  constructor(readonly operationId: string, readonly code: string, message: string) {
    super(message)
    this.name = 'SyncAuthorityRejectionError'
  }
}

// Retain the table-facing UI while all durable reads and writes pass through
// the generated engine's collection API.
export function createSyncTables(engine: AppSyncEngine) {
  let snapshot = emptySyncTablesSnapshot
  const listeners = new Set<() => void>()
  let active = false
  let generation = 0
  let cleanupTicket = 0
  let unsubscribeEngine: (() => void) | undefined
  let refreshPromise: Promise<void> | undefined
  let requestedRevision = -1
  let writes = Promise.resolve()

  function assertActive() { if (!active) unavailable() }

  function publish(next: SyncTablesSnapshot) {
    snapshot = Object.freeze(next)
    for (const listener of listeners) {
      try { listener() } catch { /* Observers cannot invalidate a persisted write. */ }
    }
  }

  function report(error: unknown, expectedGeneration: number) {
    if (active && generation === expectedGeneration) publish({ ...snapshot, error })
  }

  async function readTable<Name extends TableName>(name: Name, revision: number) {
    const rows: Row<Name>[] = []
    let cursor: Parameters<AppSyncEngine['query']>[0]['cursor']
    do {
      const page = await engine.query({ collection: name, limit: pageSize, ...(cursor ? { cursor } : {}) })
      if (page.status.revision !== revision) return undefined
      rows.push(...page.rows as Row<Name>[])
      cursor = page.nextCursor
    } while (cursor)
    return Object.freeze(rows.map(row => Object.freeze({ ...row as Record<string, unknown> }))) as unknown as readonly Row<Name>[]
  }

  async function readRejection(revision: number) {
    let after: string | undefined
    let rejection: SyncAuthorityRejectionError | undefined
    do {
      // Resolution pages use the replica's configured proposal limit (64 by
      // default), independently of the larger collection-query page size.
      const page = await engine.readResolutions(after ? { after } : {})
      if (page.status.revision !== revision) return { consistent: false } as const
      for (const decision of page.decisions) {
        if (decision.status === 'rejected') {
          rejection = new SyncAuthorityRejectionError(decision.operationId, decision.reason.code, decision.reason.message)
        }
      }
      after = page.nextAfter
    } while (after)
    return { consistent: true, rejection } as const
  }

  function refresh(): Promise<void> {
    try { assertActive() } catch (error) { return Promise.reject(error) }
    requestedRevision = Math.max(requestedRevision, engine.getSnapshot().replica.revision)
    const waitForLatest = (work: Promise<void>) => work.then(() => {
      // A commit can land after the final snapshot read but before this promise
      // settles. Its invalidation must join a new read rather than the old one.
      if (active && snapshot.revision < requestedRevision) return refresh()
    })
    if (refreshPromise) return waitForLatest(refreshPromise)
    const expectedGeneration = generation
    const work = (async () => {
      for (let attempt = 0; attempt < maximumSnapshotAttempts; attempt += 1) {
        const before = (await engine.status()).replica.revision
        const [documents, annotations, highlightColors, resolution] = await Promise.all([
          readTable('documents', before),
          readTable('annotations', before),
          readTable('highlight_colors', before),
          readRejection(before),
        ])
        if (!active || generation !== expectedGeneration) return
        const after = (await engine.status()).replica.revision
        if (!active || generation !== expectedGeneration) return
        if (
          documents === undefined || annotations === undefined || highlightColors === undefined
          || !resolution.consistent || before !== after || after < requestedRevision
        ) continue
        if (after >= snapshot.revision) {
          publish({
            tables: Object.freeze({ documents, annotations, highlight_colors: highlightColors }),
            ready: true,
            revision: after,
            error: resolution.rejection,
          })
        }
        return
      }
      throw new Error('The annotation library changed repeatedly while loading. Retry synchronization.')
    })()
    const owned = work.catch(error => {
      report(error, expectedGeneration)
      throw error
    }).finally(() => {
      if (refreshPromise === owned) refreshPromise = undefined
    })
    refreshPromise = owned
    return waitForLatest(owned)
  }

  function start() {
    if (active) return
    active = true
    const expectedGeneration = ++generation
    unsubscribeEngine = engine.subscribe(status => {
      if (!active || generation !== expectedGeneration) return
      if (status.replica.revision > snapshot.revision) void refresh().catch(() => undefined)
    })
    void refresh().catch(() => undefined)
  }

  function stop() {
    active = false
    ++generation
    unsubscribeEngine?.()
    unsubscribeEngine = undefined
    refreshPromise = undefined
    requestedRevision = -1
  }

  function enqueueWrite(operation: (assertCurrent: () => void) => Promise<void>): Promise<void> {
    const expectedGeneration = generation
    const assertCurrent = () => {
      assertActive()
      if (generation !== expectedGeneration) unavailable()
    }
    const next = writes.then(async () => {
      assertCurrent()
      await operation(assertCurrent)
      assertCurrent()
      await refresh()
    }).catch(error => {
      report(error, expectedGeneration)
      throw error
    })
    writes = next.catch(() => undefined)
    return next
  }

  const tables = new Map<TableName, AppSyncTable<TableName>>()
  const db: AppSyncDatabase = {
    table<Name extends TableName>(name: Name): AppSyncTable<Name> {
      if (!tableNames.includes(name)) throw new Error(`Unknown annotation table: ${name}`)
      let table = tables.get(name) as AppSyncTable<Name> | undefined
      if (!table) {
        table = {
          all: () => snapshot.tables[name],
          async get(key) {
            assertActive()
            const expectedGeneration = generation
            try {
              const result = await engine.get(name, recordKey(name, key))
              assertActive()
              if (generation !== expectedGeneration) unavailable()
              return result.row as Row<Name> | undefined
            } catch (error) {
              report(error, expectedGeneration)
              throw error
            }
          },
          put(row) {
            const requested = { ...row as Record<string, unknown> }
            return enqueueWrite(async assertCurrent => {
              const key = recordKey(name, requested)
              const { row: current } = await engine.get(name, key)
              assertCurrent()
              // The generated runtime validates the erased collection union here.
              const collection = engine.from(name) as unknown as {
                insert(row: unknown): Promise<unknown>
                update(key: readonly [string], patch: Record<string, unknown>): Promise<unknown>
              }
              if (!current) { await collection.insert(requested); return }
              const primary = primaryField(name)
              const currentFields = current as Record<string, unknown>
              const patch = Object.fromEntries(Object.entries(requested).filter(([field, value]) => (
                field !== primary && !Object.is(value, currentFields[field])
              )))
              if (Object.keys(patch).length) await collection.update(key, patch)
            })
          },
          delete(key) {
            const address = recordKey(name, key)
            return enqueueWrite(async () => { await engine.from(name).delete(address) })
          },
        }
        tables.set(name, table as AppSyncTable<TableName>)
      }
      return table as AppSyncTable<Name>
    },
  }

  return {
    db,
    getSnapshot: () => snapshot,
    refresh,
    start,
    stop,
    subscribe(listener: () => void) {
      ++cleanupTicket
      listeners.add(listener)
      start()
      return () => {
        listeners.delete(listener)
        if (listeners.size) return
        const ticket = ++cleanupTicket
        queueMicrotask(() => { if (ticket === cleanupTicket && !listeners.size) stop() })
      }
    },
  }
}
