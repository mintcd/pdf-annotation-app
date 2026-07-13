import { PdfAnnotationSubtype, PdfBlendMode, type PdfHighlightAnnoObject, type Rect } from '@embedpdf/models'
import { eq } from '@mintcd/sync-engine'
import { type PdfSource } from '../lib/pdfSource'
import { db } from './engine'

export const PDF_ANNOTATION_SOURCE = 'mintcd-pdf-annotator'

export type PdfDocumentRow = {
  id: string
  source_key: string
  source_type: string
  source_url: string | null
  file_name: string
  title: string
  created_at: string
  updated_at: string
  number_of_annotations: number | null
}

export type PdfAnnotationRow = {
  id: string
  document_id: string
  page_index: number
  text: string
  created_at: string
  updated_at: string
  color: string
  comment: string | null
  position: Record<string, unknown> | string | null
}

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

export async function ensurePdfDocument(source: PdfSource): Promise<PdfDocumentRow> {
  const fields = documentSourceFields(source)
  const existing = await db
    .select()
    .from('documents')
    .where(eq('source_key', fields.source_key))
    .execute() as PdfDocumentRow[]

  if (existing[0]) {
    const current = existing[0]
    if (
      current.source_type !== fields.source_type
      || current.source_url !== fields.source_url
      || current.file_name !== fields.file_name
      || current.title !== fields.title
    ) {
      await db
        .update({ ...fields, updated_at: syncTimestamp() })
        .from('documents')
        .where(eq('id', current.id))
        .execute()
    }
    return current
  }

  const now = syncTimestamp()
  const result = await db.insert({
    ...fields,
    created_at: now,
    updated_at: now,
    number_of_annotations: 0,
  }).from('documents').execute()

  const inserted = result.rows[0] as PdfDocumentRow | undefined
  if (!inserted) throw new Error(`Failed to create document row for ${source.name}`)
  return inserted
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
