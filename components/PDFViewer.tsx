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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PdfSource } from '../lib/pdfSource'
import { sourceForEmbedPdf } from '../lib/pdfSource'
import {
  ensurePdfDocument,
  highlightAnnotationFromRow,
  isPdfAnnotatorHighlight,
  positionFromAnnotation,
  positionFromGeometry,
  serializePdfPosition,
  syncTimestamp,
  type PdfAnnotationRow,
  type PdfDocumentRow,
  type PdfSelectionGeometry,
} from '../utils/pdfSync'
import AnnotationSidebar from './AnnotationSidebar'
import SelectionPanel, { HIGHLIGHT_COLORS } from './SelectionPanel'
import { usePdfSyncEngine } from './SyncEngineProvider'
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
  const sync = usePdfSyncEngine()
  const documentsTable = useMemo(() => sync.db.table('documents'), [sync.db])
  const annotationsTable = useMemo(() => sync.db.table('annotations'), [sync.db])
  const documents = sync.tables.documents as readonly PdfDocumentRow[]
  const liveAnnotations = sync.tables.annotations as readonly PdfAnnotationRow[]
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
    if (!sync.ready) return

    let active = true
    setDocumentRow(null)
    setDocumentError('')

    void ensurePdfDocument(source, documentsTable, documents).then(
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
  }, [documents, documentsTable, source, sync.ready])

  const annotationRows = useMemo(() => {
    if (!documentRow) return []
    return liveAnnotations
      .filter((annotation) => annotation.document_id === documentRow.id)
  }, [documentRow, liveAnnotations])

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
    const rowsById = new Map(annotationRows.map((row) => [row.id, row]))

    return annotationScope.onAnnotationEvent((event) => {
      if (event.type === 'loaded') return
      if (!isPdfAnnotatorHighlight(event.annotation, source.documentKey)) return
      if (localWriteIds.current.has(event.annotation.id)) return

      if (event.type === 'update') {
        const annotation = event.annotation as PdfHighlightAnnoObject
        const current = rowsById.get(annotation.id)
        if (!current) return

        const now = syncTimestamp()
        void annotationsTable.put({
          ...current,
          page_index: event.pageIndex,
          color: annotation.strokeColor ?? annotation.color ?? HIGHLIGHT_COLORS[0].value,
          comment: annotation.contents?.trim() || null,
          position: serializePdfPosition(positionFromAnnotation(annotation)),
          updated_at: now,
        })
      }

      if (event.type === 'delete') {
        void annotationsTable.delete({ id: event.annotation.id })
      }
    })
  }, [annotationRows, annotationScope, annotationsTable, documentRow, source.documentKey])

  const selectedAnnotationId = annotationState.selectedUids[0] ?? annotationState.selectedUid ?? null

  const persistenceStatus = useMemo<PersistenceStatus>(() => {
    if (!sync.ready || !documentRow || sync.phase === 'opening') return 'loading'
    if (documentError || sync.error || sync.phase === 'error') return 'error'
    if (sync.phase === 'syncing') return 'syncing'
    if (!sync.isOnline || sync.pendingProposalCount > 0 || sync.acceptedAwaitingConfirmationCount > 0) return 'queued'
    return 'synced'
  }, [
    documentError,
    documentRow,
    sync.acceptedAwaitingConfirmationCount,
    sync.error,
    sync.isOnline,
    sync.pendingProposalCount,
    sync.phase,
    sync.ready,
  ])

  const updateDocumentAnnotationCount = useCallback(async (nextCount: number) => {
    if (!documentRow) return
    await documentsTable.put({
      ...documentRow,
      number_of_annotations: Math.max(nextCount, 0),
      updated_at: syncTimestamp(),
    })
  }, [documentRow, documentsTable])

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
    const insertedRows: PdfAnnotationRow[] = geometry.map((item) => ({
      id: createRowId('annotation'),
      document_id: documentRow.id,
      page_index: item.pageIndex,
      text,
      created_at: now,
      updated_at: now,
      color,
      comment: null,
      position: serializePdfPosition(positionFromGeometry(item)),
    }))

    await Promise.all(insertedRows.map((row) => annotationsTable.put(row)))

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
    annotationsTable,
    documentRow,
    source.documentKey,
    updateDocumentAnnotationCount,
  ])

  const selectAnnotation = useCallback((annotation: PdfAnnotationRow) => {
    annotationScope?.selectAnnotation(annotation.page_index, annotation.id)
  }, [annotationScope])

  const changeAnnotationColor = useCallback(async (annotation: PdfAnnotationRow, color: string) => {
    await annotationsTable.put({
      ...annotation,
      color,
      updated_at: syncTimestamp(),
    })

    annotationScope?.syncAnnotationObject(annotation.id, {
      strokeColor: color,
      color,
      modified: new Date(),
    })
  }, [annotationScope, annotationsTable])

  const changeAnnotationComment = useCallback(async (annotation: PdfAnnotationRow, comment: string) => {
    const nextComment = comment.trim()
    await annotationsTable.put({
      ...annotation,
      comment: nextComment || null,
      updated_at: syncTimestamp(),
    })

    annotationScope?.syncAnnotationObject(annotation.id, {
      contents: nextComment || undefined,
      modified: new Date(),
    })
  }, [annotationScope, annotationsTable])

  const deleteAnnotation = useCallback(async (annotation: PdfAnnotationRow) => {
    localWriteIds.current.add(annotation.id)
    annotationScope?.deleteAnnotation(annotation.page_index, annotation.id)
    queueMicrotask(() => localWriteIds.current.delete(annotation.id))

    await annotationsTable.delete({ id: annotation.id })

    await updateDocumentAnnotationCount(annotationRows.length - 1)
  }, [annotationRows.length, annotationScope, annotationsTable, updateDocumentAnnotationCount])

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

function createRowId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`
}
