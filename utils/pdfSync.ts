import { PdfAnnotationSubtype, PdfBlendMode, type PdfHighlightAnnoObject, type Rect } from '@embedpdf/models'
import type { SyncTableClient } from '@mintcd/sync-engine/client'
import { type PdfSource } from '../lib/pdfSource'
import type { replicaSchema, Row } from './engine'

export const PDF_ANNOTATION_SOURCE = 'mintcd-pdf-annotator'

export type PdfDocumentRow = Row<'documents'>
export type PdfAnnotationRow = Row<'annotations'>
export type DocumentsTable = SyncTableClient<typeof replicaSchema, 'documents'>
export type AnnotationsTable = SyncTableClient<typeof replicaSchema, 'annotations'>

export type PdfSelectionGeometry = {
  pageIndex: number
  rect: Rect
  segmentRects: Rect[]
}

export type PdfAnnotationPosition = {
  version: 1
  kind: 'pdf-highlight'
  pageIndex: number
  rect: Rect
  segmentRects: Rect[]
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
): Promise<PdfDocumentRow> {
  const fields = documentSourceFields(source)

  const current = documents.find((document) => document.source_key === fields.source_key)
  if (current) {
    if (
      current.source_type !== fields.source_type
      || current.source_url !== fields.source_url
      || current.file_name !== fields.file_name
      || current.title !== fields.title
    ) {
      const updated = { ...current, ...fields, updated_at: syncTimestamp() }
      await documentsTable.put(updated)
      return updated
    }
    return current
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
  return row
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

export function positionFromAnnotation(annotation: PdfHighlightAnnoObject): PdfAnnotationPosition {
  return {
    version: 1,
    kind: 'pdf-highlight',
    pageIndex: annotation.pageIndex,
    rect: annotation.rect,
    segmentRects: annotation.segmentRects,
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
    rect: record.rect as Rect,
    segmentRects: record.segmentRects as Rect[],
  }
}

export function highlightAnnotationFromRow(
  row: PdfAnnotationRow,
  documentKey: string,
): PdfHighlightAnnoObject | null {
  const position = normalizePdfPosition(row.position)
  if (!position) return null

  return {
    type: PdfAnnotationSubtype.HIGHLIGHT,
    id: row.id,
    pageIndex: position.pageIndex,
    rect: position.rect,
    segmentRects: position.segmentRects,
    strokeColor: row.color,
    color: row.color,
    opacity: 1,
    blendMode: PdfBlendMode.Multiply,
    flags: ['print'],
    contents: row.comment ?? undefined,
    created: new Date(row.created_at),
    modified: new Date(row.updated_at),
    custom: {
      source: PDF_ANNOTATION_SOURCE,
      documentKey,
      text: row.text,
    },
  }
}

export function isPdfAnnotatorHighlight(annotation: { custom?: unknown }, documentKey: string): boolean {
  if (!annotation.custom || typeof annotation.custom !== 'object') return false
  const custom = annotation.custom as Record<string, unknown>
  return custom.source === PDF_ANNOTATION_SOURCE && custom.documentKey === documentKey
}

function isRect(value: unknown): value is Rect {
  if (!value || typeof value !== 'object') return false
  const rect = value as Rect
  return isNumber(rect.origin?.x)
    && isNumber(rect.origin?.y)
    && isNumber(rect.size?.width)
    && isNumber(rect.size?.height)
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
