'use client'

import { createPluginRegistration } from '@embedpdf/core'
import { EmbedPDF } from '@embedpdf/core/react'
import { usePdfiumEngine } from '@embedpdf/engines/react'
import type { PdfHighlightAnnoObject, PdfAnnotationObject } from '@embedpdf/models'
import {
  AnnotationLayer,
  AnnotationPluginPackage,
  useAnnotation,
} from '@embedpdf/plugin-annotation/react'
import {
  DocumentContent,
  DocumentManagerPluginPackage,
} from '@embedpdf/plugin-document-manager/react'
import { ExportPluginPackage } from '@embedpdf/plugin-export/react'
import { HistoryPluginPackage } from '@embedpdf/plugin-history/react'
import {
  InteractionManagerPluginPackage,
  PagePointerProvider,
} from '@embedpdf/plugin-interaction-manager/react'
import { RenderLayer, RenderPluginPackage } from '@embedpdf/plugin-render/react'
import { Scroller, ScrollPluginPackage, useScroll } from '@embedpdf/plugin-scroll/react'
import { SelectionLayer, SelectionPluginPackage } from '@embedpdf/plugin-selection/react'
import { Viewport, ViewportPluginPackage } from '@embedpdf/plugin-viewport/react'
import { ZoomMode, ZoomPluginPackage } from '@embedpdf/plugin-zoom/react'
import { eq, useLiveQuery, useSyncStatus } from '@mintcd/sync-engine'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PdfSource } from '../lib/pdfSource'
import { sourceForEmbedPdf } from '../lib/pdfSource'
import { db } from '../utils/engine'
import {
  ensurePdfDocument,
  highlightAnnotationFromRow,
  isPdfAnnotatorHighlight,
  positionFromAnnotation,
  positionFromGeometry,
  syncTimestamp,
  type PdfAnnotationRow,
  type PdfDocumentRow,
  type PdfSelectionGeometry,
} from '../utils/pdfSync'
import AnnotationSidebar from './AnnotationSidebar'
import SelectionPanel, { HIGHLIGHT_COLORS } from './SelectionPanel'
import ViewerToolbar, { type PersistenceStatus } from './ViewerToolbar'

type PDFViewerProps = {
  source: PdfSource
  initialAnnotationId?: string
}

export default function PDFViewer({ source, initialAnnotationId }: PDFViewerProps) {
  const documentOptions = useMemo(() => sourceForEmbedPdf(source), [source])
  const plugins = useMemo(
    () => [
      createPluginRegistration(DocumentManagerPluginPackage, {
        initialDocuments: [documentOptions],
      }),
      createPluginRegistration(ViewportPluginPackage),
      createPluginRegistration(ScrollPluginPackage),
      createPluginRegistration(RenderPluginPackage),
      createPluginRegistration(InteractionManagerPluginPackage),
      createPluginRegistration(SelectionPluginPackage, {
        marquee: { enabled: false },
      }),
      createPluginRegistration(HistoryPluginPackage),
      createPluginRegistration(AnnotationPluginPackage, {
        annotationAuthor: 'PDF Annotator',
        autoCommit: true,
      }),
      createPluginRegistration(ZoomPluginPackage, {
        defaultZoomLevel: ZoomMode.FitWidth,
      }),
      createPluginRegistration(ExportPluginPackage, {
        defaultFileName: source.name,
      }),
    ],
    [documentOptions, source.name],
  )
  const { engine, isLoading } = usePdfiumEngine()

  if (isLoading || !engine) {
    return <div className="viewer-state">Loading PDF engine...</div>
  }

  return (
    <section className="viewer-shell">
      <EmbedPDF engine={engine} plugins={plugins}>
        {({ activeDocumentId }) => {
          if (!activeDocumentId) return <div className="viewer-state">Opening document...</div>

          return (
            <DocumentContent documentId={activeDocumentId}>
              {({ isLoading: isDocumentLoading, isError, isLoaded }) => {
                if (isDocumentLoading) return <div className="viewer-state">Loading document...</div>
                if (isError) {
                  return (
                    <div className="viewer-state viewer-state-error">
                      The PDF could not be opened.
                    </div>
                  )
                }
                if (!isLoaded) return null

                return (
                  <SyncedPdfWorkspace
                    documentId={activeDocumentId}
                    initialAnnotationId={initialAnnotationId}
                    source={source}
                  />
                )
              }}
            </DocumentContent>
          )
        }}
      </EmbedPDF>
    </section>
  )
}

function SyncedPdfWorkspace({
  documentId,
  initialAnnotationId,
  source,
}: {
  documentId: string
  initialAnnotationId?: string
  source: PdfSource
}) {
  const { provides: annotationScope, state: annotationState } = useAnnotation(documentId)
  const { provides: scroll } = useScroll(documentId)
  const sync = useSyncStatus()
  const liveAnnotations = useLiveQuery(db.select().from('annotations'))
  const [documentRow, setDocumentRow] = useState<PdfDocumentRow | null>(null)
  const [documentError, setDocumentError] = useState('')
  const [highlightColor, setHighlightColor] = useState<string>(HIGHLIGHT_COLORS[0].value)
  const [panelOpen, setPanelOpen] = useState(true)
  const localWriteIds = useRef(new Set<string>())
  const initialSelectionHandled = useRef(false)

  useEffect(() => {
    initialSelectionHandled.current = false
  }, [documentId, initialAnnotationId])

  useEffect(() => {
    let active = true
    setDocumentRow(null)
    setDocumentError('')

    void ensurePdfDocument(source).then(
      (row) => {
        if (active) setDocumentRow(row)
      },
      (error) => {
        if (!active) return
        setDocumentError(error instanceof Error ? error.message : String(error))
      },
    )

    return () => {
      active = false
    }
  }, [source])

  const annotationRows = useMemo(() => {
    if (!documentRow) return []
    return ((liveAnnotations.data ?? []) as PdfAnnotationRow[])
      .filter((annotation) => annotation.document_id === documentRow.id)
  }, [documentRow, liveAnnotations.data])

  useEffect(() => {
    if (!annotationScope) return

    const rowsById = new Map(annotationRows.map((row) => [row.id, row]))

    for (const row of annotationRows) {
      const desired = highlightAnnotationFromRow(row, source.documentKey)
      if (!desired) continue

      const tracked = annotationState.byUid[row.id]
      if (!tracked) {
        annotationScope.importAnnotations([{ annotation: desired }])
      } else if (annotationNeedsSync(tracked.object, desired)) {
        annotationScope.syncAnnotationObject(row.id, desired)
      }
    }

    for (const [id, tracked] of Object.entries(annotationState.byUid)) {
      if (rowsById.has(id)) continue
      if (isPdfAnnotatorHighlight(tracked.object, source.documentKey)) {
        annotationScope.purgeAnnotation(tracked.object.pageIndex, id)
      }
    }
  }, [annotationRows, annotationScope, annotationState.byUid, source.documentKey])

  useEffect(() => {
    if (!initialAnnotationId || initialSelectionHandled.current || !annotationScope) return
    const annotation = annotationRows.find((row) => row.id === initialAnnotationId)
    if (!annotation || !annotationState.byUid[initialAnnotationId]) return

    initialSelectionHandled.current = true
    setPanelOpen(true)
    annotationScope.selectAnnotation(annotation.page_index, annotation.id)
    scroll?.scrollToPage({ pageNumber: annotation.page_index + 1, behavior: 'smooth' })
  }, [
    annotationRows,
    annotationScope,
    annotationState.byUid,
    initialAnnotationId,
    scroll,
  ])

  useEffect(() => {
    if (!annotationScope || !documentRow) return

    return annotationScope.onAnnotationEvent((event) => {
      if (event.type === 'loaded') return
      if (!isPdfAnnotatorHighlight(event.annotation, source.documentKey)) return
      if (localWriteIds.current.has(event.annotation.id)) return

      if (event.type === 'update') {
        const annotation = event.annotation as PdfHighlightAnnoObject
        const now = syncTimestamp()
        void db
          .update({
            page_index: event.pageIndex,
            color: annotation.strokeColor ?? annotation.color ?? HIGHLIGHT_COLORS[0].value,
            comment: annotation.contents?.trim() || null,
            position: positionFromAnnotation(annotation) as unknown as Record<string, unknown>,
            updated_at: now,
          })
          .from('annotations')
          .where(eq('id', annotation.id))
          .execute()
      }

      if (event.type === 'delete') {
        void db
          .delete()
          .from('annotations')
          .where(eq('id', event.annotation.id))
          .execute()
      }
    })
  }, [annotationScope, documentRow, source.documentKey])

  const selectedAnnotationId = annotationState.selectedUids[0] ?? annotationState.selectedUid ?? null

  const persistenceStatus = useMemo<PersistenceStatus>(() => {
    if (!documentRow || liveAnnotations.loading) return 'loading'
    if (documentError || liveAnnotations.error || sync.status === 'error') return 'error'
    if (sync.isSyncing) return 'syncing'
    if (!sync.isOnline || sync.status === 'offline' || (sync.pendingCount ?? 0) > 0) return 'queued'
    return 'synced'
  }, [
    documentError,
    documentRow,
    liveAnnotations.error,
    liveAnnotations.loading,
    sync.isOnline,
    sync.isSyncing,
    sync.pendingCount,
    sync.status,
  ])

  const updateDocumentAnnotationCount = useCallback(async (nextCount: number) => {
    if (!documentRow) return
    await db
      .update({
        number_of_annotations: Math.max(nextCount, 0),
        updated_at: syncTimestamp(),
      })
      .from('documents')
      .where(eq('id', documentRow.id))
      .execute()
  }, [documentRow])

  const createHighlight = useCallback(async ({
    color,
    geometry,
    text,
  }: {
    color: string
    geometry: PdfSelectionGeometry[]
    text: string
  }) => {
    if (!documentRow) throw new Error('Document sync is not ready yet.')

    const now = syncTimestamp()
    const result = await db
      .insert(geometry.map((item) => ({
        document_id: documentRow.id,
        page_index: item.pageIndex,
        text,
        created_at: now,
        updated_at: now,
        color,
        comment: null,
        position: positionFromGeometry(item) as unknown as Record<string, unknown>,
      })))
      .from('annotations')
      .execute()

    const insertedRows = result.rows as PdfAnnotationRow[]
    for (const row of insertedRows) {
      const annotation = highlightAnnotationFromRow(row, source.documentKey)
      if (!annotation) continue

      localWriteIds.current.add(annotation.id)
      annotationScope?.createAnnotation(annotation.pageIndex, annotation)
      queueMicrotask(() => localWriteIds.current.delete(annotation.id))
    }

    await updateDocumentAnnotationCount(annotationRows.length + insertedRows.length)
  }, [
    annotationRows.length,
    annotationScope,
    documentRow,
    source.documentKey,
    updateDocumentAnnotationCount,
  ])

  const selectAnnotation = useCallback((annotation: PdfAnnotationRow) => {
    annotationScope?.selectAnnotation(annotation.page_index, annotation.id)
  }, [annotationScope])

  const changeAnnotationColor = useCallback(async (annotation: PdfAnnotationRow, color: string) => {
    await db
      .update({ color, updated_at: syncTimestamp() })
      .from('annotations')
      .where(eq('id', annotation.id))
      .execute()

    annotationScope?.syncAnnotationObject(annotation.id, {
      strokeColor: color,
      color,
      modified: new Date(),
    })
  }, [annotationScope])

  const changeAnnotationComment = useCallback(async (annotation: PdfAnnotationRow, comment: string) => {
    const nextComment = comment.trim()
    await db
      .update({
        comment: nextComment || null,
        updated_at: syncTimestamp(),
      })
      .from('annotations')
      .where(eq('id', annotation.id))
      .execute()

    annotationScope?.syncAnnotationObject(annotation.id, {
      contents: nextComment || undefined,
      modified: new Date(),
    })
  }, [annotationScope])

  const deleteAnnotation = useCallback(async (annotation: PdfAnnotationRow) => {
    localWriteIds.current.add(annotation.id)
    annotationScope?.deleteAnnotation(annotation.page_index, annotation.id)
    queueMicrotask(() => localWriteIds.current.delete(annotation.id))

    await db
      .delete()
      .from('annotations')
      .where(eq('id', annotation.id))
      .execute()

    await updateDocumentAnnotationCount(annotationRows.length - 1)
  }, [annotationRows.length, annotationScope, updateDocumentAnnotationCount])

  return (
    <div className={`viewer-workspace ${panelOpen ? 'has-sidebar' : ''}`}>
      <div className="viewer-main">
        <ViewerToolbar
          annotationCount={annotationRows.length}
          documentId={documentId}
          onPanelToggle={() => setPanelOpen((open) => !open)}
          panelOpen={panelOpen}
          persistenceStatus={persistenceStatus}
        />

        {documentError && (
          <div className="viewer-inline-error" role="alert">
            {documentError}
          </div>
        )}

        <Viewport
          documentId={documentId}
          className="pdf-viewport"
          style={{ backgroundColor: '#f4f6f8' }}
        >
          <Scroller
            documentId={documentId}
            renderPage={({ pageIndex }) => (
              <PagePointerProvider documentId={documentId} pageIndex={pageIndex}>
                <RenderLayer
                  aria-hidden="true"
                  className="pdf-render-layer"
                  documentId={documentId}
                  draggable={false}
                  onDragStart={(event) => event.preventDefault()}
                  pageIndex={pageIndex}
                  style={{ pointerEvents: 'none' }}
                />
                <SelectionLayer
                  documentId={documentId}
                  pageIndex={pageIndex}
                  selectionMenu={({ menuWrapperProps }) => (
                    <div {...menuWrapperProps}>
                      <SelectionPanel
                        color={highlightColor}
                        documentId={documentId}
                        onColorChange={setHighlightColor}
                        onCreateHighlight={createHighlight}
                      />
                    </div>
                  )}
                />
                <AnnotationLayer documentId={documentId} pageIndex={pageIndex} />
              </PagePointerProvider>
            )}
          />
        </Viewport>
      </div>

      {panelOpen && (
        <>
          <button
            className="annotation-backdrop"
            type="button"
            aria-label="Close annotations"
            onClick={() => setPanelOpen(false)}
          />
          <AnnotationSidebar
            annotations={annotationRows}
            documentId={documentId}
            onClose={() => setPanelOpen(false)}
            onColorChange={changeAnnotationColor}
            onCommentChange={changeAnnotationComment}
            onDelete={deleteAnnotation}
            onSelect={selectAnnotation}
            selectedId={selectedAnnotationId}
          />
        </>
      )}
    </div>
  )
}

function annotationNeedsSync(current: PdfAnnotationObject, next: PdfHighlightAnnoObject): boolean {
  if (current.type !== next.type) return true
  const currentHighlight = current as PdfHighlightAnnoObject

  return current.pageIndex !== next.pageIndex
    || current.rect !== next.rect && JSON.stringify(current.rect) !== JSON.stringify(next.rect)
    || JSON.stringify(currentHighlight.segmentRects ?? []) !== JSON.stringify(next.segmentRects)
    || currentHighlight.strokeColor !== next.strokeColor
    || currentHighlight.color !== next.color
    || (current.contents ?? '') !== (next.contents ?? '')
}
