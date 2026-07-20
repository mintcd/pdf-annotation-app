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
import { Scroller, ScrollPluginPackage, useScroll } from '@embedpdf/plugin-scroll/react'
import { SelectionLayer, SelectionPluginPackage } from '@embedpdf/plugin-selection/react'
import { Viewport, ViewportPluginPackage } from '@embedpdf/plugin-viewport/react'
import { useZoom, ZoomMode, ZoomPluginPackage } from '@embedpdf/plugin-zoom/react'
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
import AnnotationSidebar from './AnnotationSidebar'
import DocumentOutlineSidebar from './DocumentOutlineSidebar'
import SelectionPanel, { HIGHLIGHT_COLORS } from './SelectionPanel'
import { usePdfSyncEngine } from './SyncEngineProvider'
import ViewerToolbar, { type PersistenceStatus } from './ViewerToolbar'

type PDFViewerProps = {
  source: PdfSource
  initialAnnotationId?: string
}

type ActiveTouchGesture = {
  hasMoved: boolean
  isLongPress: boolean
  longPressTimer: number | null
  pointerId: number | 'touch'
  startScrollLeft: number
  startScrollTop: number
  startX: number
  startY: number
  target: EventTarget | null
  viewport: HTMLElement
}

type TouchGesturePoint = {
  clientX: number
  clientY: number
  target: EventTarget | null
}

type ActivePinchGesture = {
  hasZoomed: boolean
  startDistance: number
  startZoom: number
}

type ZoomScopeRef = { current: ReturnType<typeof useZoom>['provides'] }

const TOUCH_PAN_THRESHOLD_PX = 7
const TOUCH_DOUBLE_PRESS_MAX_MS = 320
const TOUCH_DOUBLE_PRESS_MAX_DISTANCE_PX = 34
const TOUCH_LONG_PRESS_MS = 540
const TOUCH_MOUSE_SUPPRESSION_MS = 700
const TOUCH_PINCH_THRESHOLD_PX = 6
const TOUCH_MIN_PINCH_DISTANCE_PX = 28

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
      createPluginRegistration(BookmarkPluginPackage),
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
  const { provides: zoom } = useZoom(documentId)
  const sync = usePdfSyncEngine()
  const documentsTable = useMemo(() => sync.db.table('documents'), [sync.db])
  const annotationsTable = useMemo(() => sync.db.table('annotations'), [sync.db])
  const documents = sync.tables.documents as readonly PdfDocumentRow[]
  const liveAnnotations = sync.tables.annotations as readonly PdfAnnotationRow[]
  const [documentRow, setDocumentRow] = useState<PdfDocumentRow | null>(null)
  const [documentError, setDocumentError] = useState('')
  const [highlightColor, setHighlightColor] = useState<string>(HIGHLIGHT_COLORS[0].value)
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelMode, setPanelMode] = useState<'outline' | 'annotations'>('annotations')
  const localWriteIds = useRef(new Set<string>())
  const initialSelectionHandled = useRef(false)
  const pdfViewportFrameRef = useRef<HTMLDivElement>(null)
  const syncFlushRef = useRef(sync.sync)
  const zoomRef = useRef(zoom)
  const touchZoomBaselineRef = useRef<number | null>(null)

  useEffect(() => {
    syncFlushRef.current = sync.sync
  }, [sync.sync])

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  useEffect(() => {
    const frame = pdfViewportFrameRef.current
    if (!frame) return

    let activeTouchGesture: ActiveTouchGesture | null = null
    let lastTapAt = 0
    let lastTapX = 0
    let lastTapY = 0
    let suppressMouseUntil = 0
    let allowSyntheticSelectionDoubleClick = false
    let activePinchGesture: ActivePinchGesture | null = null
    const activeTouchPoints = new Map<number, TouchGesturePoint>()

    const getViewport = () => frame.querySelector<HTMLElement>('.pdf-viewport') ?? frame

    const clearLongPressTimer = () => {
      if (!activeTouchGesture?.longPressTimer) return
      window.clearTimeout(activeTouchGesture.longPressTimer)
      activeTouchGesture.longPressTimer = null
    }

    const resetTouchGesture = () => {
      clearLongPressTimer()
      activeTouchGesture = null
    }

    const resetPinchGesture = () => {
      activePinchGesture = null
      lastTapAt = 0
    }

    const getPinchPoints = () => {
      const points = [...activeTouchPoints.values()]
      return points.length >= 2 ? [points[0], points[1]] as const : null
    }

    const beginPinchGesture = (points: readonly [TouchGesturePoint, TouchGesturePoint]) => {
      const zoomScope = zoomRef.current
      const distance = touchPointDistance(points[0], points[1])
      if (!zoomScope || distance < TOUCH_MIN_PINCH_DISTANCE_PX) return

      resetTouchGesture()
      lastTapAt = 0
      activePinchGesture = {
        hasZoomed: false,
        startDistance: distance,
        startZoom: zoomScope.getState().currentZoomLevel || 1,
      }
      suppressMouseUntil = performance.now() + TOUCH_MOUSE_SUPPRESSION_MS
    }

    const updatePinchGesture = (
      points: readonly [TouchGesturePoint, TouchGesturePoint],
      event: Event,
    ) => {
      if (!activePinchGesture) beginPinchGesture(points)
      if (!activePinchGesture) return

      stopTouchSelectionEvent(event)

      const distance = touchPointDistance(points[0], points[1])
      if (distance < TOUCH_MIN_PINCH_DISTANCE_PX) return
      const distanceDelta = Math.abs(distance - activePinchGesture.startDistance)
      if (!activePinchGesture.hasZoomed && distanceDelta < TOUCH_PINCH_THRESHOLD_PX) return

      activePinchGesture.hasZoomed = true
      suppressMouseUntil = performance.now() + TOUCH_MOUSE_SUPPRESSION_MS
      requestTouchPinchZoom(points, activePinchGesture, frame, zoomRef)
    }

    const beginTouchGesture = (
      pointerId: number | 'touch',
      clientX: number,
      clientY: number,
      target: EventTarget | null,
    ) => {
      if (isInteractiveTouchTarget(target)) return

      const viewport = getViewport()
      resetTouchGesture()
      activeTouchGesture = {
        hasMoved: false,
        isLongPress: false,
        longPressTimer: null,
        pointerId,
        startScrollLeft: viewport.scrollLeft,
        startScrollTop: viewport.scrollTop,
        startX: clientX,
        startY: clientY,
        target,
        viewport,
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

    const updateTouchPan = (clientX: number, clientY: number, event: Event) => {
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

      if (!activeTouchGesture.hasMoved) return
      activeTouchGesture.viewport.scrollLeft = activeTouchGesture.startScrollLeft - deltaX
      activeTouchGesture.viewport.scrollTop = activeTouchGesture.startScrollTop - deltaY
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
          event.preventDefault()
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

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return

      const zoomScope = zoomRef.current
      if (!zoomScope) return

      event.preventDefault()
      event.stopPropagation()

      const viewport = frame.querySelector<HTMLElement>('.pdf-viewport') ?? frame
      const viewportRect = viewport.getBoundingClientRect()
      const currentZoom = zoomScope.getState().currentZoomLevel
      const zoomDelta = wheelEventToZoomDelta(event, currentZoom)
      if (zoomDelta === 0) return

      zoomScope.requestZoomBy(zoomDelta, {
        vx: event.clientX - viewportRect.left,
        vy: event.clientY - viewportRect.top,
      })
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!isTouchPointer(event) || isInteractiveTouchTarget(event.target)) return

      activeTouchPoints.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
        target: event.target,
      })

      const pinchPoints = getPinchPoints()
      if (pinchPoints) {
        beginPinchGesture(pinchPoints)
        stopTouchSelectionEvent(event)
        return
      }

      if (!isPrimaryTouchPointer(event)) return
      beginTouchGesture(event.pointerId, event.clientX, event.clientY, event.target)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!isTouchPointer(event) || !activeTouchPoints.has(event.pointerId)) return

      activeTouchPoints.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
        target: event.target,
      })

      const pinchPoints = getPinchPoints()
      if (activePinchGesture || pinchPoints) {
        if (pinchPoints) updatePinchGesture(pinchPoints, event)
        return
      }

      if (!isPrimaryTouchPointer(event)) return
      if (activeTouchGesture?.pointerId !== event.pointerId) return
      updateTouchPan(event.clientX, event.clientY, event)
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (!isTouchPointer(event)) return

      if (activePinchGesture || activeTouchPoints.size >= 2) {
        activeTouchPoints.delete(event.pointerId)
        resetTouchGesture()
        resetPinchGesture()
        suppressMouseUntil = performance.now() + TOUCH_MOUSE_SUPPRESSION_MS
        stopTouchSelectionEvent(event)
        return
      }

      activeTouchPoints.delete(event.pointerId)
      if (!isPrimaryTouchPointer(event)) return
      if (activeTouchGesture?.pointerId !== event.pointerId) return
      finishTouchGesture(event.clientX, event.clientY, event)
    }

    const handlePointerCancel = (event: PointerEvent) => {
      if (!isTouchPointer(event)) return
      activeTouchPoints.delete(event.pointerId)
      resetPinchGesture()
      if (activeTouchGesture?.pointerId !== event.pointerId) return
      resetTouchGesture()
      lastTapAt = 0
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (typeof PointerEvent !== 'undefined') return

      if (event.touches.length >= 2) {
        const pinchPoints = touchListToPinchPoints(event.touches)
        if (!pinchPoints) return
        beginPinchGesture(pinchPoints)
        stopTouchSelectionEvent(event)
        return
      }

      if (event.touches.length !== 1) return
      const touch = event.touches[0]
      beginTouchGesture('touch', touch.clientX, touch.clientY, event.target)
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (typeof PointerEvent !== 'undefined') return

      if (event.touches.length >= 2) {
        const pinchPoints = touchListToPinchPoints(event.touches)
        if (pinchPoints) updatePinchGesture(pinchPoints, event)
        return
      }

      if (activeTouchGesture?.pointerId !== 'touch') return
      const touch = event.touches[0]
      if (!touch) return
      updateTouchPan(touch.clientX, touch.clientY, event)
    }

    const handleTouchEnd = (event: TouchEvent) => {
      if (typeof PointerEvent !== 'undefined') return

      if (activePinchGesture || event.touches.length >= 2) {
        resetTouchGesture()
        resetPinchGesture()
        suppressMouseUntil = performance.now() + TOUCH_MOUSE_SUPPRESSION_MS
        stopTouchSelectionEvent(event)
        return
      }

      if (activeTouchGesture?.pointerId !== 'touch') return
      const touch = event.changedTouches[0]
      if (!touch) {
        resetTouchGesture()
        return
      }
      finishTouchGesture(touch.clientX, touch.clientY, event)
    }

    const handleTouchCancel = () => {
      if (typeof PointerEvent !== 'undefined') return
      resetPinchGesture()
      if (activeTouchGesture?.pointerId !== 'touch') return
      resetTouchGesture()
      lastTapAt = 0
    }

    const handleSyntheticMouseEvent = (event: MouseEvent) => {
      if (allowSyntheticSelectionDoubleClick && event.type === 'dblclick') return
      if (performance.now() > suppressMouseUntil && !mouseEventCameFromTouch(event)) return

      event.preventDefault()
      event.stopPropagation()
    }

    frame.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    frame.addEventListener('pointerdown', handlePointerDown, { passive: false, capture: true })
    frame.addEventListener('pointermove', handlePointerMove, { passive: false, capture: true })
    frame.addEventListener('pointerup', handlePointerUp, { passive: false, capture: true })
    frame.addEventListener('pointercancel', handlePointerCancel, { passive: true, capture: true })
    frame.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true })
    frame.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true })
    frame.addEventListener('touchend', handleTouchEnd, { passive: false, capture: true })
    frame.addEventListener('touchcancel', handleTouchCancel, { passive: true, capture: true })
    frame.addEventListener('click', handleSyntheticMouseEvent, { passive: false, capture: true })
    frame.addEventListener('dblclick', handleSyntheticMouseEvent, { passive: false, capture: true })
    frame.addEventListener('contextmenu', handleSyntheticMouseEvent, { passive: false, capture: true })

    return () => {
      resetTouchGesture()
      activeTouchPoints.clear()
      resetPinchGesture()
      frame.removeEventListener('wheel', handleWheel, true)
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
        const nextColor = annotation.strokeColor ?? annotation.color ?? HIGHLIGHT_COLORS[0].value
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
          documentId={documentId}
          onAnnotationsToggle={() => togglePanel('annotations')}
          onOutlineToggle={() => togglePanel('outline')}
          outlineOpen={panelOpen && panelMode === 'outline'}
          persistenceStatus={persistenceStatus}
        />

        {documentError && (
          <div className="viewer-inline-error" role="alert">
            {documentError}
          </div>
        )}

        <div className="pdf-viewport-frame" ref={pdfViewportFrameRef}>
          <Viewport
            documentId={documentId}
            className="pdf-viewport"
            style={{ backgroundColor: '#f4f6f8' }}
          >
            <Scroller
              documentId={documentId}
              renderPage={({ pageIndex }) => (
                <PagePointerProvider
                  className="pdf-page-touch-target"
                  documentId={documentId}
                  pageIndex={pageIndex}
                >
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
                      <div
                        {...menuWrapperProps}
                        className="selection-menu-anchor"
                        style={menuWrapperProps.style}
                      >
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
            <DocumentOutlineSidebar documentId={documentId} onClose={closePanel} />
          ) : (
            <AnnotationSidebar
              annotations={annotationRows}
              documentId={documentId}
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

function isTouchPointer(event: PointerEvent): boolean {
  return event.pointerType === 'touch'
}

function isPrimaryTouchPointer(event: PointerEvent): boolean {
  return event.pointerType === 'touch' && event.isPrimary !== false
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

function stopTouchSelectionEvent(event: Event) {
  if (event.cancelable) event.preventDefault()
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

function requestTouchPinchZoom(
  points: readonly [TouchGesturePoint, TouchGesturePoint],
  pinchGesture: ActivePinchGesture,
  frame: HTMLElement,
  zoomRef: ZoomScopeRef,
) {
  const zoomScope = zoomRef.current
  if (!zoomScope) return

  const distance = touchPointDistance(points[0], points[1])
  if (pinchGesture.startDistance <= 0 || distance <= 0) return

  const viewport = frame.querySelector<HTMLElement>('.pdf-viewport') ?? frame
  const viewportRect = viewport.getBoundingClientRect()
  const midpoint = touchPointMidpoint(points[0], points[1])
  const nextZoom = pinchGesture.startZoom * (distance / pinchGesture.startDistance)

  zoomScope.requestZoom(nextZoom, {
    vx: midpoint.clientX - viewportRect.left,
    vy: midpoint.clientY - viewportRect.top,
  })
}

function touchPointDistance(first: TouchGesturePoint, second: TouchGesturePoint): number {
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)
}

function touchPointMidpoint(first: TouchGesturePoint, second: TouchGesturePoint): TouchGesturePoint {
  return {
    clientX: (first.clientX + second.clientX) / 2,
    clientY: (first.clientY + second.clientY) / 2,
    target: first.target,
  }
}

function touchListToPinchPoints(touches: TouchList): readonly [TouchGesturePoint, TouchGesturePoint] | null {
  const first = touches[0]
  const second = touches[1]
  if (!first || !second) return null

  return [
    {
      clientX: first.clientX,
      clientY: first.clientY,
      target: first.target,
    },
    {
      clientX: second.clientX,
      clientY: second.clientY,
      target: second.target,
    },
  ]
}

function mouseEventCameFromTouch(event: MouseEvent): boolean {
  const sourceCapabilities = (event as MouseEvent & {
    sourceCapabilities?: { firesTouchEvents?: boolean } | null
  }).sourceCapabilities

  return sourceCapabilities?.firesTouchEvents === true
}

function wheelEventToZoomDelta(event: WheelEvent, currentZoom: number): number {
  const deltaModeMultiplier = event.deltaMode === 1
    ? 16
    : event.deltaMode === 2
      ? window.innerHeight
      : 1
  const normalizedDeltaY = event.deltaY * deltaModeMultiplier
  if (!Number.isFinite(normalizedDeltaY) || normalizedDeltaY === 0) return 0

  const exponent = Math.max(-0.5, Math.min(0.5, -normalizedDeltaY * 0.0015))
  const targetZoom = currentZoom * Math.exp(exponent)
  return targetZoom - currentZoom
}
