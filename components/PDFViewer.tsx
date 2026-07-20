'use client'

import { createPluginRegistration } from '@embedpdf/core'
import { EmbedPDF } from '@embedpdf/core/react'
import { usePdfiumEngine } from '@embedpdf/engines/react'
import {
  PdfActionType,
  type PdfAnnotationObject,
  type PdfHighlightAnnoObject,
  type PdfLinkTarget,
} from '@embedpdf/models'
import {
  AnnotationLayer,
  AnnotationPluginPackage,
  LockModeType,
  useAnnotation,
} from '@embedpdf/plugin-annotation/react'
import { BookmarkPluginPackage } from '@embedpdf/plugin-bookmark/react'
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
import {
  Scroller,
  ScrollPluginPackage,
  useScroll,
  useScrollCapability,
  type ScrollMetrics,
} from '@embedpdf/plugin-scroll/react'
import { SelectionLayer, SelectionPluginPackage } from '@embedpdf/plugin-selection/react'
import { Viewport, ViewportPluginPackage } from '@embedpdf/plugin-viewport/react'
import { useZoom, ZoomGestureWrapper, ZoomMode, ZoomPluginPackage } from '@embedpdf/plugin-zoom/react'
import { Minimize2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PdfSource } from '../lib/pdfSource'
import { sourceForEmbedPdf } from '../lib/pdfSource'
import {
  ensurePdfDocument,
  highlightAnnotationFromRow,
  isPdfAnnotatorHighlight,
  normalizePdfPosition,
  positionFromAnnotation,
  positionFromGeometry,
  serializePdfPosition,
  syncTimestamp,
  type PdfAnnotationRow,
  type PdfDocumentRow,
  type PdfSelectionGeometry,
} from '../utils/pdfSync'
import { FALLBACK_HIGHLIGHT_COLOR, type HighlightColor } from '../utils/highlightColors'
import { useHighlightColors } from '../hooks/useHighlightColors'
import AnnotationSidebar from './AnnotationSidebar'
import DocumentOutlineSidebar from './DocumentOutlineSidebar'
import SelectionPanel from './SelectionPanel'
import { usePdfSyncEngine } from './SyncEngineProvider'
import ViewerToolbar, { type PersistenceStatus } from './ViewerToolbar'

type PDFViewerProps = {
  chromeVisible?: boolean
  source: PdfSource
  initialAnnotationId?: string
  onChromeToggle?: () => void
}

type ActiveTouchGesture = {
  hasMoved: boolean
  isLongPress: boolean
  longPressTimer: number | null
  pointerId: number | null
  startX: number
  startY: number
  target: EventTarget | null
}

type ZoomScopeRef = { current: ReturnType<typeof useZoom>['provides'] }

type PdfRenderWindow = {
  currentPageIndex: number
  initialized: boolean
  visiblePageIndexes: ReadonlySet<number>
}

type PageJumpHistory = {
  entries: number[]
  index: number
}

type CreateHighlight = (input: {
  color: string
  geometry: PdfSelectionGeometry[]
  text: string
}) => Promise<void>

const TOUCH_PAN_THRESHOLD_PX = 7
const TOUCH_DOUBLE_PRESS_MAX_MS = 320
const TOUCH_DOUBLE_PRESS_MAX_DISTANCE_PX = 34
const TOUCH_LONG_PRESS_MS = 540
const TOUCH_MOUSE_SUPPRESSION_MS = 700
const PDF_SCROLL_BUFFER_PAGES = 2
const PDF_BITMAP_LOOKAHEAD_PAGES = 1
const PDF_INTERACTION_LOOKAHEAD_PAGES = 1
const PDF_LINK_CATEGORY = 'pdf-link'
const MAX_PAGE_JUMP_HISTORY = 50

export default function PDFViewer({
  chromeVisible = true,
  source,
  initialAnnotationId,
  onChromeToggle,
}: PDFViewerProps) {
  const documentOptions = useMemo(() => sourceForEmbedPdf(source), [source])
  const plugins = useMemo(
    () => [
      createPluginRegistration(DocumentManagerPluginPackage, {
        initialDocuments: [documentOptions],
      }),
      createPluginRegistration(ViewportPluginPackage),
      createPluginRegistration(ScrollPluginPackage, {
        defaultBufferSize: PDF_SCROLL_BUFFER_PAGES,
      }),
      createPluginRegistration(RenderPluginPackage),
      createPluginRegistration(InteractionManagerPluginPackage),
      createPluginRegistration(SelectionPluginPackage, {
        marquee: { enabled: false },
      }),
      createPluginRegistration(HistoryPluginPackage),
      createPluginRegistration(BookmarkPluginPackage),
      createPluginRegistration(AnnotationPluginPackage, {
        annotationAuthor: 'PDF Annotator',
        autoCommit: true,
        locked: {
          type: LockModeType.Include,
          categories: [PDF_LINK_CATEGORY],
        },
        tools: [
          {
            id: 'link',
            categories: [PDF_LINK_CATEGORY],
          },
        ],
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
                    chromeVisible={chromeVisible}
                    documentId={activeDocumentId}
                    initialAnnotationId={initialAnnotationId}
                    onChromeToggle={onChromeToggle}
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
  chromeVisible,
  documentId,
  initialAnnotationId,
  onChromeToggle,
  source,
}: {
  chromeVisible: boolean
  documentId: string
  initialAnnotationId?: string
  onChromeToggle?: () => void
  source: PdfSource
}) {
  const { provides: annotationScope, state: annotationState } = useAnnotation(documentId)
  const { provides: scroll, state: scrollState } = useScroll(documentId)
  const { provides: zoom } = useZoom(documentId)
  const renderWindow = usePdfRenderWindow(documentId)
  const sync = usePdfSyncEngine()
  const documentsTable = useMemo(() => sync.db.table('documents'), [sync.db])
  const annotationsTable = useMemo(() => sync.db.table('annotations'), [sync.db])
  const documents = sync.tables.documents as readonly PdfDocumentRow[]
  const liveAnnotations = sync.tables.annotations as readonly PdfAnnotationRow[]
  const highlightColors = useHighlightColors()
  const [documentRow, setDocumentRow] = useState<PdfDocumentRow | null>(null)
  const [documentError, setDocumentError] = useState('')
  const [highlightColor, setHighlightColor] = useState<string>(FALLBACK_HIGHLIGHT_COLOR)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelMode, setPanelMode] = useState<'outline' | 'annotations'>('annotations')
  const localWriteIds = useRef(new Set<string>())
  const initialSelectionHandled = useRef(false)
  const pdfViewportFrameRef = useRef<HTMLDivElement>(null)
  const syncFlushRef = useRef(sync.sync)
  const zoomRef = useRef(zoom)
  const touchZoomBaselineRef = useRef<number | null>(null)
  const currentPageRef = useRef(1)
  const [pageJumpHistory, setPageJumpHistory] = useState<PageJumpHistory>({
    entries: [],
    index: -1,
  })

  useEffect(() => {
    syncFlushRef.current = sync.sync
  }, [sync.sync])

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  useEffect(() => {
    currentPageRef.current = Math.max(scrollState.currentPage || 1, 1)
  }, [scrollState.currentPage])

  useEffect(() => {
    currentPageRef.current = 1
    setPageJumpHistory({ entries: [], index: -1 })
  }, [documentId])

  const recordPageJump = useCallback((targetPageNumber: number) => {
    const fromPage = Math.max(currentPageRef.current || 1, 1)
    if (!Number.isFinite(targetPageNumber)) return

    const toPage = Math.max(Math.trunc(targetPageNumber), 1)
    if (fromPage === toPage) return

    setPageJumpHistory((current) => addPageJumpHistoryEntry(current, fromPage, toPage))
  }, [])

  const navigatePageJumpHistory = useCallback((direction: 'back' | 'forward') => {
    if (!scroll) return

    let targetPageNumber: number | null = null

    setPageJumpHistory((current) => {
      const nextIndex = direction === 'back' ? current.index - 1 : current.index + 1
      const nextPage = current.entries[nextIndex]

      if (!Number.isInteger(nextPage)) return current
      targetPageNumber = nextPage

      return {
        ...current,
        index: nextIndex,
      }
    })

    if (!targetPageNumber) return
    currentPageRef.current = targetPageNumber
    scroll.scrollToPage({
      pageNumber: targetPageNumber,
      behavior: 'instant',
      alignY: 0,
    })
  }, [scroll])

  useEffect(() => {
    if (
      highlightColors.data.length > 0
      && !highlightColors.data.some((option) => option.color === highlightColor)
    ) {
      setHighlightColor(highlightColors.data[0]?.color ?? FALLBACK_HIGHLIGHT_COLOR)
    }
  }, [highlightColor, highlightColors.data])

  useEffect(() => {
    const frame = pdfViewportFrameRef.current
    if (!frame) return

    let activeTouchGesture: ActiveTouchGesture | null = null
    let lastTapAt = 0
    let lastTapX = 0
    let lastTapY = 0
    let suppressMouseUntil = 0
    let allowSyntheticSelectionDoubleClick = false
    const activeTouchPointers = new Set<number>()
    const supportsPointerEvents = typeof window.PointerEvent !== 'undefined'

    const clearLongPressTimer = () => {
      if (!activeTouchGesture?.longPressTimer) return
      window.clearTimeout(activeTouchGesture.longPressTimer)
      activeTouchGesture.longPressTimer = null
    }

    const resetTouchGesture = () => {
      clearLongPressTimer()
      activeTouchGesture = null
    }

    const beginTouchGesture = (
      clientX: number,
      clientY: number,
      target: EventTarget | null,
      pointerId: number | null = null,
    ) => {
      if (isInteractiveTouchTarget(target)) return

      resetTouchGesture()
      activeTouchGesture = {
        hasMoved: false,
        isLongPress: false,
        longPressTimer: null,
        pointerId,
        startX: clientX,
        startY: clientY,
        target,
      }

      activeTouchGesture.longPressTimer = window.setTimeout(() => {
        if (!activeTouchGesture || activeTouchGesture.hasMoved) return
        activeTouchGesture.isLongPress = true
        lastTapAt = 0
        allowSyntheticSelectionDoubleClick = true
        dispatchSyntheticDoubleClick(
          activeTouchGesture.target,
          activeTouchGesture.startX,
          activeTouchGesture.startY,
          frame,
        )
        allowSyntheticSelectionDoubleClick = false
        suppressMouseUntil = performance.now() + TOUCH_MOUSE_SUPPRESSION_MS
      }, TOUCH_LONG_PRESS_MS)
    }

    const updateTouchGesture = (clientX: number, clientY: number, event: Event) => {
      if (!activeTouchGesture || activeTouchGesture.isLongPress) return

      const deltaX = clientX - activeTouchGesture.startX
      const deltaY = clientY - activeTouchGesture.startY
      const distance = Math.hypot(deltaX, deltaY)

      if (distance >= TOUCH_PAN_THRESHOLD_PX) {
        activeTouchGesture.hasMoved = true
        clearLongPressTimer()
        lastTapAt = 0
      }

      stopTouchSelectionEvent(event)
    }

    const finishTouchGesture = (clientX: number, clientY: number, event: Event) => {
      if (!activeTouchGesture) return

      const wasTap = !activeTouchGesture.hasMoved && !activeTouchGesture.isLongPress
      const wasPan = activeTouchGesture.hasMoved
      const wasLongPress = activeTouchGesture.isLongPress
      clearLongPressTimer()

      if (wasTap) {
        const now = performance.now()
        const isDoublePress = lastTapAt > 0
          && now - lastTapAt <= TOUCH_DOUBLE_PRESS_MAX_MS
          && Math.hypot(clientX - lastTapX, clientY - lastTapY) <= TOUCH_DOUBLE_PRESS_MAX_DISTANCE_PX

        if (isDoublePress) {
          stopTouchSelectionEvent(event, { preventDefault: true })
          lastTapAt = 0
          suppressMouseUntil = now + TOUCH_MOUSE_SUPPRESSION_MS
          requestTouchDoublePressZoom(clientX, clientY, frame, zoomRef, touchZoomBaselineRef)
        } else {
          lastTapAt = now
          lastTapX = clientX
          lastTapY = clientY
        }
      }

      if (wasPan || wasLongPress) {
        suppressMouseUntil = performance.now() + TOUCH_MOUSE_SUPPRESSION_MS
        lastTapAt = 0
      }

      activeTouchGesture = null
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!isTouchPointer(event)) return

      activeTouchPointers.add(event.pointerId)
      if (!isPrimaryTouchPointer(event) || activeTouchPointers.size >= 2) {
        resetTouchGesture()
        lastTapAt = 0
        stopTouchSelectionEvent(event)
        return
      }

      beginTouchGesture(event.clientX, event.clientY, event.target, event.pointerId)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!isTouchPointer(event)) return

      if (activeTouchPointers.size >= 2) {
        stopTouchSelectionEvent(event)
        return
      }

      if (
        !isPrimaryTouchPointer(event)
        || activeTouchPointers.size !== 1
        || activeTouchGesture?.pointerId !== event.pointerId
      ) {
        return
      }

      updateTouchGesture(event.clientX, event.clientY, event)
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (!isTouchPointer(event)) return

      activeTouchPointers.delete(event.pointerId)

      if (activeTouchGesture?.pointerId === event.pointerId) {
        finishTouchGesture(event.clientX, event.clientY, event)
      } else if (activeTouchPointers.size === 0) {
        resetTouchGesture()
      }
    }

    const handlePointerCancel = (event: PointerEvent) => {
      if (!isTouchPointer(event)) return

      activeTouchPointers.delete(event.pointerId)
      if (activeTouchGesture?.pointerId === event.pointerId) {
        resetTouchGesture()
        lastTapAt = 0
      }
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length >= 2) {
        resetTouchGesture()
        lastTapAt = 0
        return
      }

      if (event.touches.length !== 1) return
      const touch = event.touches[0]
      beginTouchGesture(touch.clientX, touch.clientY, event.target)
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length >= 2) {
        resetTouchGesture()
        lastTapAt = 0
        return
      }

      const touch = event.touches[0]
      if (!touch) return
      updateTouchGesture(touch.clientX, touch.clientY, event)
    }

    const handleTouchEnd = (event: TouchEvent) => {
      if (event.touches.length > 0) {
        resetTouchGesture()
        lastTapAt = 0
        return
      }

      const touch = event.changedTouches[0]
      if (!touch) {
        resetTouchGesture()
        return
      }
      finishTouchGesture(touch.clientX, touch.clientY, event)
    }

    const handleTouchCancel = () => {
      resetTouchGesture()
      lastTapAt = 0
    }

    const handleSyntheticMouseEvent = (event: MouseEvent) => {
      if (allowSyntheticSelectionDoubleClick && event.type === 'dblclick') return
      if (performance.now() > suppressMouseUntil) return

      event.preventDefault()
      event.stopPropagation()
    }

    if (supportsPointerEvents) {
      frame.addEventListener('pointerdown', handlePointerDown, { passive: true, capture: true })
      frame.addEventListener('pointermove', handlePointerMove, { passive: false, capture: true })
      frame.addEventListener('pointerup', handlePointerUp, { passive: false, capture: true })
      frame.addEventListener('pointercancel', handlePointerCancel, { passive: true, capture: true })
    } else {
      frame.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true })
      frame.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true })
      frame.addEventListener('touchend', handleTouchEnd, { passive: false, capture: true })
      frame.addEventListener('touchcancel', handleTouchCancel, { passive: true, capture: true })
    }
    frame.addEventListener('click', handleSyntheticMouseEvent, { passive: false, capture: true })
    frame.addEventListener('dblclick', handleSyntheticMouseEvent, { passive: false, capture: true })
    frame.addEventListener('contextmenu', handleSyntheticMouseEvent, { passive: false, capture: true })

    return () => {
      resetTouchGesture()
      activeTouchPointers.clear()
      frame.removeEventListener('pointerdown', handlePointerDown, true)
      frame.removeEventListener('pointermove', handlePointerMove, true)
      frame.removeEventListener('pointerup', handlePointerUp, true)
      frame.removeEventListener('pointercancel', handlePointerCancel, true)
      frame.removeEventListener('touchstart', handleTouchStart, true)
      frame.removeEventListener('touchmove', handleTouchMove, true)
      frame.removeEventListener('touchend', handleTouchEnd, true)
      frame.removeEventListener('touchcancel', handleTouchCancel, true)
      frame.removeEventListener('click', handleSyntheticMouseEvent, true)
      frame.removeEventListener('dblclick', handleSyntheticMouseEvent, true)
      frame.removeEventListener('contextmenu', handleSyntheticMouseEvent, true)
    }
  }, [])

  const flushSync = useCallback((label: string) => {
    void syncFlushRef.current().catch((error) => {
      console.error(`Failed to flush ${label}`, error)
    })
  }, [])

  useEffect(() => {
    initialSelectionHandled.current = false
  }, [documentId, initialAnnotationId])

  useEffect(() => {
    setDocumentRow(null)
    setDocumentError('')
  }, [source.documentKey])

  useEffect(() => {
    if (!sync.ready) return

    let active = true
    setDocumentError('')

    void ensurePdfDocument(source, documentsTable, documents).then(
      ({ row, changed }) => {
        if (active) setDocumentRow(row)
        if (changed) flushSync('opened PDF document')
      },
      (error) => {
        if (!active) return
        setDocumentError(error instanceof Error ? error.message : String(error))
      },
    )

    return () => {
      active = false
    }
  }, [documents, documentsTable, flushSync, source, sync.ready])

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
    setPanelMode('annotations')
    annotationScope.selectAnnotation(annotation.page_index, annotation.id)
    scroll?.scrollToPage({ pageNumber: annotation.page_index + 1, behavior: 'instant' })
  }, [
    annotationRows,
    annotationScope,
    annotationState.byUid,
    initialAnnotationId,
    scroll,
  ])

  useEffect(() => {
    if (!annotationScope) return

    return annotationScope.onNavigate((event) => {
      const targetPageNumber = pageNumberFromLinkTarget(event.target)
      if (targetPageNumber) recordPageJump(targetPageNumber)
    })
  }, [annotationScope, recordPageJump])

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

        const nextPageIndex = event.pageIndex
        const nextColor = annotation.strokeColor ?? annotation.color ?? FALLBACK_HIGHLIGHT_COLOR
        const nextComment = annotation.contents?.trim() || null
        const nextPosition = serializePdfPosition(positionFromAnnotation(annotation))
        if (annotationRowHasPluginState(current, {
          color: nextColor,
          comment: nextComment,
          pageIndex: nextPageIndex,
          position: nextPosition,
        })) {
          return
        }

        const now = syncTimestamp()
        void annotationsTable.put({
          ...current,
          page_index: nextPageIndex,
          color: nextColor,
          comment: nextComment,
          position: nextPosition,
          updated_at: now,
        }).then(
          () => flushSync('updated PDF annotation'),
          (error) => console.error('Failed to save PDF annotation update', error),
        )
      }

      if (event.type === 'delete') {
        void annotationsTable.delete({ id: event.annotation.id }).then(
          () => flushSync('deleted PDF annotation'),
          (error) => console.error('Failed to save PDF annotation deletion', error),
        )
      }
    })
  }, [annotationRows, annotationScope, annotationsTable, documentRow, flushSync, source.documentKey])

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
    flushSync('updated PDF annotation count')
  }, [documentRow, documentsTable, flushSync])

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
    flushSync('updated PDF annotation color')

    annotationScope?.syncAnnotationObject(annotation.id, {
      strokeColor: color,
      color,
      modified: new Date(),
    })
  }, [annotationScope, annotationsTable, flushSync])

  const changeAnnotationComment = useCallback(async (annotation: PdfAnnotationRow, comment: string) => {
    const nextComment = comment.trim()
    await annotationsTable.put({
      ...annotation,
      comment: nextComment || null,
      updated_at: syncTimestamp(),
    })
    flushSync('updated PDF annotation comment')

    annotationScope?.syncAnnotationObject(annotation.id, {
      contents: nextComment || undefined,
      modified: new Date(),
    })
  }, [annotationScope, annotationsTable, flushSync])

  const deleteAnnotation = useCallback(async (annotation: PdfAnnotationRow) => {
    localWriteIds.current.add(annotation.id)
    annotationScope?.deleteAnnotation(annotation.page_index, annotation.id)
    queueMicrotask(() => localWriteIds.current.delete(annotation.id))

    await annotationsTable.delete({ id: annotation.id })

    await updateDocumentAnnotationCount(annotationRows.length - 1)
  }, [annotationRows.length, annotationScope, annotationsTable, updateDocumentAnnotationCount])

  const togglePanel = useCallback((mode: 'outline' | 'annotations') => {
    setPanelOpen((open) => {
      if (open && panelMode === mode) return false
      return true
    })
    setPanelMode(mode)
  }, [panelMode])

  const closePanel = useCallback(() => {
    setPanelOpen(false)
  }, [])

  return (
    <div className={`viewer-workspace ${panelOpen ? 'has-sidebar' : ''}`}>
      <div className="viewer-main">
        <ViewerToolbar
          annotationCount={annotationRows.length}
          annotationsOpen={panelOpen && panelMode === 'annotations'}
          canJumpBack={pageJumpHistory.index > 0}
          canJumpForward={
            pageJumpHistory.index >= 0
            && pageJumpHistory.index < pageJumpHistory.entries.length - 1
          }
          documentId={documentId}
          onJumpBack={() => navigatePageJumpHistory('back')}
          onJumpForward={() => navigatePageJumpHistory('forward')}
          onChromeToggle={onChromeToggle}
          onAnnotationsToggle={() => togglePanel('annotations')}
          onOutlineToggle={() => togglePanel('outline')}
          outlineOpen={panelOpen && panelMode === 'outline'}
          persistenceStatus={persistenceStatus}
        />

        {!chromeVisible && onChromeToggle && (
          <button
            className="viewer-fullscreen-exit"
            type="button"
            aria-label="Exit fullscreen"
            title="Exit fullscreen"
            data-touch-gesture-ignore
            onClick={onChromeToggle}
          >
            <Minimize2 size={18} aria-hidden="true" />
          </button>
        )}

        {documentError && (
          <div className="viewer-inline-error" role="alert">
            {documentError}
          </div>
        )}

        <div
          className="pdf-viewport-frame"
          ref={pdfViewportFrameRef}
        >
          <Viewport
            documentId={documentId}
            className="pdf-viewport"
            style={{ backgroundColor: '#f4f6f8' }}
          >
            <ZoomGestureWrapper className="pdf-zoom-gesture-wrapper" documentId={documentId}>
              <Scroller
                documentId={documentId}
                renderPage={({ pageIndex }) => (
                  <IncrementalPdfPage
                    color={highlightColor}
                    documentId={documentId}
                    highlightColors={highlightColors.data}
                    onColorChange={setHighlightColor}
                    onCreateHighlight={createHighlight}
                    pageIndex={pageIndex}
                    renderWindow={renderWindow}
                  />
                )}
              />
            </ZoomGestureWrapper>
          </Viewport>
        </div>
      </div>

      {panelOpen && (
        <>
          <button
            className="annotation-backdrop"
            type="button"
            aria-label={panelMode === 'outline' ? 'Close table of contents' : 'Close annotations'}
            onClick={closePanel}
          />
          {panelMode === 'outline' ? (
            <DocumentOutlineSidebar
              documentId={documentId}
              onClose={closePanel}
              onPageJump={recordPageJump}
            />
          ) : (
            <AnnotationSidebar
              annotations={annotationRows}
              documentId={documentId}
              highlightColors={highlightColors.data}
              onClose={closePanel}
              onColorChange={changeAnnotationColor}
              onCommentChange={changeAnnotationComment}
              onDelete={deleteAnnotation}
              onSelect={selectAnnotation}
              selectedId={selectedAnnotationId}
            />
          )}
        </>
      )}
    </div>
  )
}

function IncrementalPdfPage({
  color,
  documentId,
  highlightColors,
  onColorChange,
  onCreateHighlight,
  pageIndex,
  renderWindow,
}: {
  color: string
  documentId: string
  highlightColors: readonly HighlightColor[]
  onColorChange: (color: string) => void
  onCreateHighlight: CreateHighlight
  pageIndex: number
  renderWindow: PdfRenderWindow
}) {
  const distanceFromCurrentPage = Math.abs(pageIndex - renderWindow.currentPageIndex)
  const isVisible = renderWindow.visiblePageIndexes.has(pageIndex)
  const shouldRenderBitmap = !renderWindow.initialized
    || isVisible
    || distanceFromCurrentPage <= PDF_BITMAP_LOOKAHEAD_PAGES
  const shouldRenderInteractionLayers = !renderWindow.initialized
    || isVisible
    || distanceFromCurrentPage <= PDF_INTERACTION_LOOKAHEAD_PAGES
  const [bitmapRequested, setBitmapRequested] = useState(shouldRenderBitmap)

  useEffect(() => {
    if (shouldRenderBitmap) setBitmapRequested(true)
  }, [shouldRenderBitmap])

  return (
    <PagePointerProvider
      className={`pdf-page-touch-target${bitmapRequested ? '' : ' is-pending-render'}`}
      documentId={documentId}
      pageIndex={pageIndex}
    >
      <div className="pdf-render-slot">
        <div className="pdf-render-placeholder" aria-hidden="true" />
        {bitmapRequested && (
          <RenderLayer
            aria-hidden="true"
            className="pdf-render-layer"
            documentId={documentId}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            pageIndex={pageIndex}
            style={{ pointerEvents: 'none' }}
          />
        )}
      </div>

      {shouldRenderInteractionLayers && (
        <>
          <SelectionLayer
            documentId={documentId}
            pageIndex={pageIndex}
            selectionMenu={({ menuWrapperProps }) => (
              <div
                {...menuWrapperProps}
                className="selection-menu-anchor"
                style={menuWrapperProps.style}
              >
                <SelectionPanel
                  color={color}
                  documentId={documentId}
                  highlightColors={highlightColors}
                  onColorChange={onColorChange}
                  onCreateHighlight={onCreateHighlight}
                />
              </div>
            )}
          />
          <AnnotationLayer documentId={documentId} pageIndex={pageIndex} />
        </>
      )}
    </PagePointerProvider>
  )
}

function addPageJumpHistoryEntry(
  current: PageJumpHistory,
  fromPage: number,
  toPage: number,
): PageJumpHistory {
  const activeEntries = current.index >= 0
    ? current.entries.slice(0, current.index + 1)
    : []

  const nextEntries = [...activeEntries]
  if (nextEntries[nextEntries.length - 1] !== fromPage) {
    nextEntries.push(fromPage)
  }
  if (nextEntries[nextEntries.length - 1] !== toPage) {
    nextEntries.push(toPage)
  }

  const boundedEntries = nextEntries.slice(-MAX_PAGE_JUMP_HISTORY)

  return {
    entries: boundedEntries,
    index: boundedEntries.length - 1,
  }
}

function pageNumberFromLinkTarget(target: PdfLinkTarget): number | null {
  const pageIndex = target.type === 'destination'
    ? target.destination.pageIndex
    : target.action.type === PdfActionType.Goto || target.action.type === PdfActionType.RemoteGoto
      ? target.action.destination.pageIndex
      : null

  if (!Number.isInteger(pageIndex) || pageIndex < 0) return null
  return pageIndex + 1
}

function usePdfRenderWindow(documentId: string): PdfRenderWindow {
  const { provides: scrollCapability } = useScrollCapability()
  const [renderWindow, setRenderWindow] = useState<PdfRenderWindow>(() => ({
    currentPageIndex: 0,
    initialized: false,
    visiblePageIndexes: new Set([0]),
  }))

  useEffect(() => {
    if (!scrollCapability) return

    const scope = scrollCapability.forDocument(documentId)
    const updateRenderWindow = (next: PdfRenderWindow) => {
      setRenderWindow((current) => (
        samePdfRenderWindow(current, next) ? current : next
      ))
    }

    try {
      updateRenderWindow(pdfRenderWindowFromMetrics(scope.getMetrics()))
    } catch {
      updateRenderWindow({
        currentPageIndex: Math.max(scope.getCurrentPage() - 1, 0),
        initialized: false,
        visiblePageIndexes: new Set([Math.max(scope.getCurrentPage() - 1, 0)]),
      })
    }

    const unsubscribeScroll = scope.onScroll((metrics) => {
      updateRenderWindow(pdfRenderWindowFromMetrics(metrics))
    })
    const unsubscribePageChange = scope.onPageChange((event) => {
      setRenderWindow((current) => {
        const currentPageIndex = Math.max(event.pageNumber - 1, 0)
        const next = {
          ...current,
          currentPageIndex,
          visiblePageIndexes: current.initialized
            ? current.visiblePageIndexes
            : new Set([currentPageIndex]),
        }
        return samePdfRenderWindow(current, next) ? current : next
      })
    })

    return () => {
      unsubscribeScroll()
      unsubscribePageChange()
    }
  }, [documentId, scrollCapability])

  return renderWindow
}

function pdfRenderWindowFromMetrics(metrics: ScrollMetrics): PdfRenderWindow {
  const currentPageIndex = Math.max(metrics.currentPage - 1, 0)
  const visiblePages = metrics.visiblePages.length > 0 ? metrics.visiblePages : [metrics.currentPage]

  return {
    currentPageIndex,
    initialized: true,
    visiblePageIndexes: new Set(
      visiblePages.map((pageNumber) => Math.max(pageNumber - 1, 0)),
    ),
  }
}

function samePdfRenderWindow(left: PdfRenderWindow, right: PdfRenderWindow): boolean {
  if (
    left.currentPageIndex !== right.currentPageIndex
    || left.initialized !== right.initialized
    || left.visiblePageIndexes.size !== right.visiblePageIndexes.size
  ) {
    return false
  }

  for (const pageIndex of left.visiblePageIndexes) {
    if (!right.visiblePageIndexes.has(pageIndex)) return false
  }
  return true
}

function annotationNeedsSync(current: PdfAnnotationObject, next: PdfHighlightAnnoObject): boolean {
  if (current.type !== next.type) return true
  const currentHighlight = current as PdfHighlightAnnoObject
  const currentColor = currentHighlight.strokeColor ?? currentHighlight.color
  const nextColor = next.strokeColor ?? next.color

  return current.pageIndex !== next.pageIndex
    || current.rect !== next.rect && JSON.stringify(current.rect) !== JSON.stringify(next.rect)
    || JSON.stringify(currentHighlight.segmentRects ?? []) !== JSON.stringify(next.segmentRects)
    || currentColor !== nextColor
    || (current.contents ?? '') !== (next.contents ?? '')
}

function annotationRowHasPluginState(
  row: PdfAnnotationRow,
  state: {
    color: string
    comment: string | null
    pageIndex: number
    position: string
  },
): boolean {
  const position = normalizePdfPosition(row.position)
  const rowPosition = position ? serializePdfPosition(position) : row.position

  return row.page_index === state.pageIndex
    && row.color === state.color
    && (row.comment ?? null) === state.comment
    && rowPosition === state.position
}

function createRowId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`
}

function isInteractiveTouchTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest([
    '.selection-menu',
    'button',
    'input',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '[data-touch-gesture-ignore]',
  ].join(',')))
}

function isTouchPointer(event: PointerEvent): boolean {
  return event.pointerType === 'touch'
}

function isPrimaryTouchPointer(event: PointerEvent): boolean {
  return isTouchPointer(event) && event.isPrimary !== false
}

function stopTouchSelectionEvent(
  event: Event,
  options: { preventDefault?: boolean } = {},
) {
  if (options.preventDefault && event.cancelable) event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

function dispatchSyntheticDoubleClick(
  target: EventTarget | null,
  clientX: number,
  clientY: number,
  frame: HTMLElement,
) {
  const targetElement = target instanceof Element && frame.contains(target)
    ? target
    : document.elementFromPoint(clientX, clientY)

  if (!(targetElement instanceof Element) || !frame.contains(targetElement)) return

  targetElement.dispatchEvent(new MouseEvent('dblclick', {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 0,
    clientX,
    clientY,
    view: window,
  }))
}

function requestTouchDoublePressZoom(
  clientX: number,
  clientY: number,
  frame: HTMLElement,
  zoomRef: ZoomScopeRef,
  touchZoomBaselineRef: { current: number | null },
) {
  const zoomScope = zoomRef.current
  if (!zoomScope) return

  const viewport = frame.querySelector<HTMLElement>('.pdf-viewport') ?? frame
  const viewportRect = viewport.getBoundingClientRect()
  const center = {
    vx: clientX - viewportRect.left,
    vy: clientY - viewportRect.top,
  }
  const currentZoom = zoomScope.getState().currentZoomLevel || 1
  const baseline = touchZoomBaselineRef.current
  const shouldUnzoom = baseline !== null
    ? currentZoom > baseline * 1.15
    : currentZoom >= 2

  if (shouldUnzoom) {
    touchZoomBaselineRef.current = null
    zoomScope.requestZoom(ZoomMode.FitWidth, center)
    return
  }

  touchZoomBaselineRef.current = currentZoom
  zoomScope.requestZoom(Math.min(Math.max(currentZoom * 1.75, currentZoom + 0.65, 1.5), 3), center)
}
