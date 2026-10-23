import type { AppSyncTable } from '../lib/syncTables'
import type { PdfRect, PdfSelectionGeometry } from '../lib/pdfGeometry'
import { type PdfSource } from '../lib/pdfSource'
import type { Row } from './engine'

export type PdfDocumentRow = Row<'documents'>
export type PdfAnnotationRow = Row<'annotations'>
export type DocumentsTable = AppSyncTable<'documents'>
export type AnnotationsTable = AppSyncTable<'annotations'>



export type EnsurePdfDocumentResult = {
  row: PdfDocumentRow
  changed: boolean
}

export type PdfAnnotationPosition = {
  version: 1
  kind: 'pdf-highlight'
  pageIndex: number
  rect: PdfRect
  segmentRects: PdfRect[]
}

export function syncTimestamp(): string {
  return new Date().toISOString()
}

export function documentSourceFields(source: PdfSource) {
  return {
    source_key: source.documentKey,
    source_type: source.kind,
    source_url: source.kind === 'remote' ? source.originalUrl : null,
    file_name: source.name,
    title: source.name,
  }
}

export async function ensurePdfDocument(
  source: PdfSource,
  documentsTable: DocumentsTable,
  documents: readonly PdfDocumentRow[],
): Promise<EnsurePdfDocumentResult> {
  const fields = documentSourceFields(source)

  const current = documents.find((document) => document.source_key === fields.source_key)
  if (current) {
    if (
      current.source_type !== fields.source_type
      || current.source_url !== fields.source_url
      || current.file_name !== fields.file_name
    ) {
      const updated = {
        ...current,
        source_key: fields.source_key,
        source_type: fields.source_type,
        source_url: fields.source_url,
        file_name: fields.file_name,
        updated_at: syncTimestamp(),
      }
      await documentsTable.put(updated)
      return { row: updated, changed: true }
    }
    return { row: current, changed: false }
  }

  const now = syncTimestamp()
  const row: PdfDocumentRow = {
    id: fields.source_key,
    ...fields,
    created_at: now,
    updated_at: now,
    number_of_annotations: 0,
  }
  await documentsTable.put(row)
  return { row, changed: true }
}

export function positionFromGeometry(geometry: PdfSelectionGeometry): PdfAnnotationPosition {
  return {
    version: 1,
    kind: 'pdf-highlight',
    pageIndex: geometry.pageIndex,
    rect: geometry.rect,
    segmentRects: geometry.segmentRects,
  }
}

export function serializePdfPosition(position: PdfAnnotationPosition): string {
  return JSON.stringify(position)
}

export function normalizePdfPosition(value: PdfAnnotationRow['position']): PdfAnnotationPosition | null {
  let position: unknown = value
  if (typeof position === 'string') {
    try {
      position = JSON.parse(position)
    } catch {
      return null
    }
  }

  if (!position || typeof position !== 'object') return null
  const record = position as Partial<PdfAnnotationPosition>
  if (
    record.version !== 1
    || record.kind !== 'pdf-highlight'
    || !Number.isInteger(record.pageIndex)
    || record.pageIndex < 0
    || !isRect(record.rect)
    || !Array.isArray(record.segmentRects)
    || !record.segmentRects.every(isRect)
  ) {
    return null
  }

  return {
    version: 1,
    kind: 'pdf-highlight',
    pageIndex: record.pageIndex as number,
    rect: record.rect as PdfRect,
    segmentRects: record.segmentRects as PdfRect[],
  }
}

function isRect(value: unknown): value is PdfRect {
  if (!value || typeof value !== 'object') return false
  const rect = value as PdfRect
  return isNumber(rect.origin?.x)
    && isNumber(rect.origin?.y)
    && isNumber(rect.size?.width)
    && isNumber(rect.size?.height)
    && rect.size.width >= 0
    && rect.size.height >= 0
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
