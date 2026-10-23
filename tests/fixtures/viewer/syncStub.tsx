import { useMemo, useSyncExternalStore } from 'react'
import type { PdfAnnotationRow, PdfDocumentRow } from '../../../utils/pdfSync'
import type { HighlightColorRow } from '../../../utils/highlightColors'

type StubTables = {
  documents: PdfDocumentRow[]
  annotations: PdfAnnotationRow[]
  highlight_colors: HighlightColorRow[]
}
type TableName = keyof StubTables
type StubRow<Name extends TableName> = StubTables[Name][number]
type Write = { table: TableName; operation: 'put' | 'delete'; key: string }

const storageKey = 'pdf-react-integration-fixture'
let tables: StubTables = { documents: [], annotations: [], highlight_colors: [] }
const listeners = new Set<() => void>()
const writes: Write[] = []
let syncCalls = 0

function keyOf(row: unknown): string {
  const value = row as { id?: string; color?: string }
  return value.id ?? value.color
}

function publish(next: StubTables) {
  tables = next
  localStorage.setItem(storageKey, JSON.stringify(tables))
  listeners.forEach((listener) => listener())
}

const clients = new Map<TableName, unknown>()
function table<Name extends TableName>(name: Name) {
  type Client = {
    all: () => StubRow<Name>[]
    get: (key: Partial<StubRow<Name>>) => StubRow<Name> | undefined
    put: (row: StubRow<Name>) => Promise<void>
    delete: (key: Partial<StubRow<Name>>) => Promise<void>
  }
  if (!clients.has(name)) {
    const client: Client = {
      all: () => tables[name] as StubRow<Name>[],
      get: (key) => (tables[name] as StubRow<Name>[]).find((row) => keyOf(row) === keyOf(key)),
      async put(row) {
        const key = keyOf(row)
        const rows = (tables[name] as StubRow<Name>[]).filter((existing) => keyOf(existing) !== key)
        writes.push({ table: name, operation: 'put', key })
        publish({ ...tables, [name]: [...rows, structuredClone(row)] })
      },
      async delete(key) {
        writes.push({ table: name, operation: 'delete', key: keyOf(key) })
        publish({ ...tables, [name]: (tables[name] as StubRow<Name>[]).filter((row) => keyOf(row) !== keyOf(key)) })
      },
    }
    clients.set(name, client)
  }
  return clients.get(name) as Client
}

const db = { table }
const sync = async () => { syncCalls += 1 }
const session = { streamId: 'fixture-stream', authenticated: true, userId: 'fixture-user', username: 'Fixture' }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }
const getSnapshot = () => tables

/** Test-only local row store: deliberately supplies no real sync transport or authority. */
export function usePdfSyncEngine() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => ({
    db, tables: snapshot, sync, session, ready: true, isOnline: true,
    phase: 'idle', error: null, pendingProposalCount: 0, acceptedAwaitingConfirmationCount: 0,
  }), [snapshot])
}

export function initializeSyncStub(documentKey: string, seedSavedHighlight: boolean) {
  writes.length = 0
  syncCalls = 0
  const saved = localStorage.getItem(storageKey)
  if (saved) { tables = JSON.parse(saved); return }
  tables = { documents: [], annotations: [], highlight_colors: [] }
  if (!seedSavedHighlight) return
  const now = '2026-10-18T10:00:00.000Z'
  const rect = { origin: { x: 60, y: 75 }, size: { width: 170, height: 18 } }
  tables = {
    documents: [{
      id: documentKey, source_key: documentKey, source_type: 'local', source_url: null,
      file_name: 'react-integration.pdf', title: 'react-integration.pdf',
      created_at: now, updated_at: now, number_of_annotations: 1,
    }],
    annotations: [{
      id: 'existing-v1', document_id: documentKey, page_index: 0,
      text: 'Existing v1 highlight', color: '#87ceeb', comment: 'Saved earlier',
      created_at: now, updated_at: now,
      position: JSON.stringify({ version: 1, kind: 'pdf-highlight', pageIndex: 0, rect, segmentRects: [rect] }),
    }],
    highlight_colors: [],
  }
}

export function stubSnapshot() {
  return structuredClone({ tables, writes, syncCalls })
}

/** Publish an incoming-row projection without recording a local table write. */
export function receiveAnnotationPatch(id: string, patch: Partial<PdfAnnotationRow>) {
  publish({ ...tables, annotations: tables.annotations.map((row) => row.id === id ? { ...row, ...patch } : row) })
}
