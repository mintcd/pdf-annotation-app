import { useSelectionCapability, useSelectionPlugin } from '@embedpdf/plugin-selection/react'
import {
  glyphAt,
  sliceBounds,
  rectsWithinSlice,
  type SelectionPlugin,
  type SelectionRangeX,
} from '@embedpdf/plugin-selection'
import type { PdfPageGeometry, Rect } from '@embedpdf/models'
import { useCallback, useEffect, useRef, useState } from 'react'

type MobileSelectionHandlesProps = {
  documentId: string
}

type HandleDragState = {
  handle: 'start' | 'end'
  anchorPage: number
  anchorIndex: number
}

type ScreenPosition = {
  x: number
  y: number
  height: number
}

type HandleScreenPositions = {
  start: ScreenPosition | null
  end: ScreenPosition | null
}

// ---------------------------------------------------------------------------
// Action type constants (not publicly exported by @embedpdf/plugin-selection,
// but the reducer recognises them by string).
// ---------------------------------------------------------------------------
const SET_SELECTION = 'SELECTION/SET_SELECTION'
const SET_RECTS = 'SELECTION/SET_RECTS'
const SET_SLICES = 'SELECTION/SET_SLICES'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dispatchToPlugin(plugin: SelectionPlugin, action: { type: string; payload: any }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = (plugin as any).pluginStore
  if (store && typeof store.dispatch === 'function') {
    store.dispatch(action)
  }
}

function getDocumentScale(plugin: SelectionPlugin, documentId: string): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coreStore = (plugin as any).coreStore
  if (!coreStore || typeof coreStore.getState !== 'function') return 1
  const coreState = coreStore.getState()
  const doc = coreState?.core?.documents?.[documentId]
  return doc?.scale ?? 1
}

function rebuildRectsAndSlices(
  sel: SelectionRangeX,
  geometry: Record<number, PdfPageGeometry>,
): {
  rects: Record<number, Rect[]>
  slices: Record<number, { start: number; count: number }>
} {
  const rects: Record<number, Rect[]> = {}
  const slices: Record<number, { start: number; count: number }> = {}

  const startPage = Math.min(sel.start.page, sel.end.page)
  const endPage = Math.max(sel.start.page, sel.end.page)

  for (let page = startPage; page <= endPage; page++) {
    const geo = geometry[page]
    if (!geo) continue
    const bounds = sliceBounds(sel, geo, page)
    if (!bounds) continue
    rects[page] = rectsWithinSlice(geo, bounds.from, bounds.to)
    slices[page] = { start: bounds.from, count: bounds.to - bounds.from + 1 }
  }

  return { rects, slices }
}

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(pointer: coarse)').matches
}

/**
 * Find the page element for a given page index within the viewport frame.
 */
function findPageElement(
  viewportFrame: Element,
  pageIndex: number,
): HTMLElement | null {
  const pages = viewportFrame.querySelectorAll<HTMLElement>('.pdf-page-touch-target')
  // Pages are rendered in DOM order matching their page index in the scroller
  return pages[pageIndex] ?? null
}

/**
 * Convert a page-coordinate rect to a screen-space position using the page
 * element's bounding rect and the current scale.
 */
function pageRectToScreen(
  pageRect: Rect,
  pageEl: HTMLElement,
  scale: number,
): { x: number; y: number; height: number } {
  const domRect = pageEl.getBoundingClientRect()
  return {
    x: domRect.left + pageRect.origin.x * scale,
    y: domRect.top + pageRect.origin.y * scale,
    height: pageRect.size.height * scale,
  }
}

/**
 * Compute screen-space positions for the start and end selection handles.
 */
function computeScreenPositions(
  selection: SelectionRangeX,
  state: { rects: Record<number, Rect[]> },
  viewportFrame: Element,
  scale: number,
): HandleScreenPositions {
  const startRects = state.rects[selection.start.page]
  const endRects = state.rects[selection.end.page]

  let start: ScreenPosition | null = null
  let end: ScreenPosition | null = null

  if (startRects && startRects.length > 0) {
    const firstRect = startRects[0]
    const pageEl = findPageElement(viewportFrame, selection.start.page)
    if (pageEl) {
      start = pageRectToScreen(firstRect, pageEl, scale)
    }
  }

  if (endRects && endRects.length > 0) {
    const lastRect = endRects[endRects.length - 1]
    const pageEl = findPageElement(viewportFrame, selection.end.page)
    if (pageEl) {
      const pos = pageRectToScreen(lastRect, pageEl, scale)
      end = {
        x: pos.x + lastRect.size.width * scale,
        y: pos.y,
        height: pos.height,
      }
    }
  }

  return { start, end }
}

export default function MobileSelectionHandles({ documentId }: MobileSelectionHandlesProps) {
  const { provides: selectionCapability } = useSelectionCapability()
  const { plugin: selectionPlugin } = useSelectionPlugin()
  const [positions, setPositions] = useState<HandleScreenPositions>({ start: null, end: null })
  const [visible, setVisible] = useState(false)
  const dragRef = useRef<HandleDragState | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isTouch, setIsTouch] = useState(false)

  useEffect(() => {
    setIsTouch(isTouchDevice())
  }, [])

  const updatePositions = useCallback(() => {
    if (!selectionCapability || !selectionPlugin) return

    const scope = selectionCapability.forDocument(documentId)
    const state = scope.getState()
    if (!state.selection || !state.active) {
      setVisible(false)
      return
    }

    const container = containerRef.current
    if (!container) return

    const viewportFrame = container.closest('.pdf-viewport-frame')
    if (!viewportFrame) return

    const scale = getDocumentScale(selectionPlugin, documentId)
    const screenPos = computeScreenPositions(state.selection, state, viewportFrame, scale)

    if (screenPos.start || screenPos.end) {
      setPositions(screenPos)
      setVisible(true)
    } else {
      setVisible(false)
    }
  }, [documentId, selectionCapability, selectionPlugin])

  // Subscribe to selection changes
  useEffect(() => {
    if (!selectionCapability || !selectionPlugin || !isTouch) return

    const scope = selectionCapability.forDocument(documentId)

    updatePositions()
    const unsubscribe = scope.onSelectionChange(() => {
      requestAnimationFrame(updatePositions)
    })

    return unsubscribe
  }, [documentId, isTouch, selectionCapability, selectionPlugin, updatePositions])

  // Also update positions on scroll / zoom / resize
  useEffect(() => {
    if (!isTouch || !visible) return

    const container = containerRef.current
    if (!container) return

    const viewport = container.closest('.pdf-viewport')
    if (!viewport) return

    const onScroll = () => requestAnimationFrame(updatePositions)
    viewport.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })

    return () => {
      viewport.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [isTouch, visible, updatePositions])

  const onHandleTouchStart = useCallback((
    event: React.TouchEvent,
    handle: 'start' | 'end',
  ) => {
    if (!selectionCapability || !selectionPlugin) return

    event.stopPropagation()
    event.preventDefault()

    const scope = selectionCapability.forDocument(documentId)
    const state = scope.getState()
    if (!state.selection) return

    const anchor = handle === 'start' ? state.selection.end : state.selection.start
    dragRef.current = {
      handle,
      anchorPage: anchor.page,
      anchorIndex: anchor.index,
    }
  }, [documentId, selectionCapability, selectionPlugin])

  const onHandleTouchMove = useCallback((event: React.TouchEvent) => {
    if (!dragRef.current || !selectionPlugin || !selectionCapability) return

    event.stopPropagation()
    event.preventDefault()

    const touch = event.touches[0]
    if (!touch) return

    const container = containerRef.current
    if (!container) return

    const viewportFrame = container.closest('.pdf-viewport-frame')
    if (!viewportFrame) return

    const scope = selectionCapability.forDocument(documentId)
    const state = scope.getState()
    const scale = getDocumentScale(selectionPlugin, documentId)

    // Find which page element the touch is over
    const pageElements = viewportFrame.querySelectorAll<HTMLElement>('.pdf-page-touch-target')
    let targetPageIndex: number | null = null
    let pageRect: DOMRect | null = null

    for (let i = 0; i < pageElements.length; i++) {
      const rect = pageElements[i].getBoundingClientRect()
      if (touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
        targetPageIndex = i
        pageRect = rect
        break
      }
    }

    if (targetPageIndex === null || !pageRect) return

    const geo = state.geometry[targetPageIndex]
    if (!geo) return

    // Convert touch position to page coordinate space
    const pageX = (touch.clientX - pageRect.left) / scale
    const pageY = (touch.clientY - pageRect.top) / scale

    const glyphIndex = glyphAt(geo, { x: pageX, y: pageY }, 1.5)
    if (glyphIndex < 0) return

    const { anchorPage, anchorIndex } = dragRef.current
    const movingPointer = { page: targetPageIndex, index: glyphIndex }
    const anchorPointer = { page: anchorPage, index: anchorIndex }

    // Determine start and end based on document order
    let newSelection: SelectionRangeX
    if (
      movingPointer.page < anchorPointer.page
      || (movingPointer.page === anchorPointer.page && movingPointer.index <= anchorPointer.index)
    ) {
      newSelection = { start: movingPointer, end: anchorPointer }
    } else {
      newSelection = { start: anchorPointer, end: movingPointer }
    }

    dispatchToPlugin(selectionPlugin, {
      type: SET_SELECTION,
      payload: { documentId, selection: newSelection },
    })

    const { rects, slices } = rebuildRectsAndSlices(newSelection, state.geometry)

    dispatchToPlugin(selectionPlugin, {
      type: SET_RECTS,
      payload: { documentId, rects },
    })

    dispatchToPlugin(selectionPlugin, {
      type: SET_SLICES,
      payload: { documentId, slices },
    })

    // Update handle positions immediately during drag
    requestAnimationFrame(updatePositions)
  }, [documentId, selectionCapability, selectionPlugin, updatePositions])

  const onHandleTouchEnd = useCallback((event: React.TouchEvent) => {
    if (!dragRef.current) return
    event.stopPropagation()
    event.preventDefault()
    dragRef.current = null
  }, [])

  if (!isTouch || !visible) return null

  return (
    <div
      ref={containerRef}
      className="mobile-selection-handles"
      aria-hidden="true"
    >
      {positions.start && (
        <div
          className="selection-handle selection-handle-start"
          style={{
            left: `${positions.start.x}px`,
            top: `${positions.start.y}px`,
            height: `${positions.start.height}px`,
          }}
          onTouchStart={(e) => onHandleTouchStart(e, 'start')}
          onTouchMove={onHandleTouchMove}
          onTouchEnd={onHandleTouchEnd}
          onTouchCancel={onHandleTouchEnd}
        />
      )}
      {positions.end && (
        <div
          className="selection-handle selection-handle-end"
          style={{
            left: `${positions.end.x}px`,
            top: `${positions.end.y}px`,
            height: `${positions.end.height}px`,
          }}
          onTouchStart={(e) => onHandleTouchStart(e, 'end')}
          onTouchMove={onHandleTouchMove}
          onTouchEnd={onHandleTouchEnd}
          onTouchCancel={onHandleTouchEnd}
        />
      )}
    </div>
  )
}
