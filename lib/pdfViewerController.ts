import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import type { PDFViewer as PdfJsViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import type { PdfSource } from './pdfSource'
import { geometryFromSelectionRects, positionToViewportRects, type PdfOutlineNode, type PdfSelectionGeometry } from './pdfGeometry'
import { normalizePdfPosition, type PdfAnnotationRow } from '../utils/pdfSync'

export type PdfTextSelection = { text: string; geometry: PdfSelectionGeometry[] }
export type PdfViewState = { currentPage: number; totalPages: number; zoom: number }

type ViewerOptions = {
  container: HTMLDivElement
  viewerElement: HTMLDivElement
  source: PdfSource
  signal: AbortSignal
  onState: (state: PdfViewState) => void
  onSelection: (selection: PdfTextSelection | null) => void
  onSelectAnnotation: (id: string) => void
  onOutline: (outline: PdfOutlineNode[]) => void
  onOutlineError: (message: string) => void
  onNavigate: (fromPage: number, toPage: number) => void
  onError: (message: string) => void
}

export type PdfViewerController = {
  viewer: PdfJsViewer
  document: PDFDocumentProxy
  goToPage: (page: number) => void
  zoomIn: () => void
  zoomOut: () => void
  fitWidth: () => void
  setHighlights: (rows: readonly PdfAnnotationRow[], selectedId: string | null) => void
  clearSelection: () => void
  getData: () => Promise<Uint8Array>
}

/** Browser-only: the display module must initialize pdfjsLib before the viewer module. */
export async function createPdfViewerController(options: ViewerOptions): Promise<PdfViewerController> {
  const { container, viewerElement } = options
  const lifecycle = new AbortController()
  const signal = AbortSignal.any([options.signal, lifecycle.signal])
  const pdfjs = await import('pdfjs-dist')
  const { EventBus, PDFViewer, PDFLinkService, LinkTarget, PDFFindController } = await import('pdfjs-dist/web/pdf_viewer.mjs')
  signal.throwIfAborted()
  const assetBase = `/pdfjs/${pdfjs.version}/`
  pdfjs.GlobalWorkerOptions.workerSrc = `${assetBase}pdf.worker.min.mjs`
  const eventBus = new EventBus()
  const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer' })
  const findController = new PDFFindController({ eventBus, linkService })
  // v6 accepts abortSignal but its published options declaration omits it.
  const viewerOptions = {
    container, viewer: viewerElement, eventBus, linkService, findController,
    imageResourcesPath: `${assetBase}images/`,
    removePageBorders: true,
    // Forms are displayed read-only; app annotations have one persistence owner.
    annotationMode: pdfjs.AnnotationMode.ENABLE,
    annotationEditorMode: pdfjs.AnnotationEditorType.DISABLE,
    enableDetailCanvas: true,
    maxCanvasPixels: 8 * 1024 * 1024,
    supportsPinchToZoom: true,
    abortSignal: signal,
  }
  const viewer = new PDFViewer(viewerOptions)
  linkService.setViewer(viewer)
  let loadingTask: PDFDocumentLoadingTask | undefined
  let pdfDocument: PDFDocumentProxy | undefined
  let highlights: readonly PdfAnnotationRow[] = []
  let selectedId: string | null = null
  let paintFrame = 0
  let selectionFrame = 0
  let pinchRemainder = 1

  const reportState = () => {
    if (!signal.aborted) options.onState({ currentPage: viewer.currentPageNumber, totalPages: viewer.pagesCount, zoom: viewer.currentScale || 1 })
  }
  const clearSelection = () => {
    const selection = window.getSelection()
    if (selection?.anchorNode && viewerElement.contains(selection.anchorNode)) selection.removeAllRanges()
    options.onSelection(null)
  }
  const paintHighlights = () => {
    if (signal.aborted) return
    viewerElement.querySelectorAll('.app-highlight-layer').forEach((element) => element.remove())
    const byPage = new Map<number, PdfAnnotationRow[]>()
    for (const row of highlights) {
      const rows = byPage.get(row.page_index) ?? []
      rows.push(row)
      byPage.set(row.page_index, rows)
    }
    for (const [pageIndex, rows] of byPage) {
      const page = viewer.getPageView(pageIndex)
      if (!page?.pdfPage || !page.div.querySelector('canvas')) continue
      const layer = document.createElement('div')
      layer.className = 'app-highlight-layer'
      layer.setAttribute('aria-hidden', 'true')
      for (const row of rows) {
        const position = normalizePdfPosition(row.position)
        if (!position || position.pageIndex !== pageIndex) continue
        for (const rect of positionToViewportRects(position, page.viewport)) {
          const mark = document.createElement('span')
          mark.className = `app-highlight${selectedId === row.id ? ' is-selected' : ''}`
          mark.dataset.annotationId = row.id
          Object.assign(mark.style, { left: `${rect.origin.x}px`, top: `${rect.origin.y}px`, width: `${rect.size.width}px`, height: `${rect.size.height}px`, backgroundColor: row.color })
          layer.appendChild(mark)
        }
      }
      page.div.append(layer)
    }
  }
  const schedulePaint = () => {
    cancelAnimationFrame(paintFrame)
    paintFrame = requestAnimationFrame(paintHighlights)
  }
  const readSelection = () => {
    if (signal.aborted) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      options.onSelection(null)
      return
    }
    const range = selection.getRangeAt(0)
    if (!viewerElement.contains(range.startContainer) || !viewerElement.contains(range.endContainer)) {
      options.onSelection(null)
      return
    }
    const text = selection.toString().trim()
    const pages = Array.from(viewerElement.querySelectorAll<HTMLElement>('.page')).flatMap((element) => {
      const pageIndex = Number(element.dataset.pageNumber) - 1
      const page = viewer.getPageView(pageIndex)
      if (!page?.pdfPage || !element.querySelector('.textLayer')) return []
      return [{ pageIndex, viewport: page.viewport, bounds: element.getBoundingClientRect() }]
    })
    // A cross-page Range includes ancestor element boxes, which would shade
    // whole pages. Only the selected text-node fragments describe highlights.
    const rects: DOMRect[] = []
    const walker = document.createTreeWalker(viewerElement, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.parentElement?.closest('.textLayer') && range.intersectsNode(node)
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    })
    while (walker.nextNode()) {
      const node = walker.currentNode
      const fragment = document.createRange()
      fragment.selectNodeContents(node)
      if (node === range.startContainer) fragment.setStart(node, range.startOffset)
      if (node === range.endContainer) fragment.setEnd(node, range.endOffset)
      rects.push(...Array.from(fragment.getClientRects()))
    }
    const geometry = geometryFromSelectionRects(rects, pages)
    options.onSelection(text && geometry.length ? { text, geometry } : null)
  }
  document.addEventListener('selectionchange', () => {
    cancelAnimationFrame(selectionFrame)
    selectionFrame = requestAnimationFrame(readSelection)
  }, { signal })

  // Let PDF.js classify touch gestures, suppress jitter, and continue panning
  // after a pinch. Ordinary one-finger scrolling stays with the browser.
  const touchManager = new pdfjs.TouchManager({
    container,
    signal,
    isPinchingDisabled: () => !pdfDocument,
    onPinchStart: clearSelection,
    onPinching: (origin: number[], previousDistance: number, distance: number, dx: number, dy: number) => {
      const targetScale = Math.min(10, Math.max(0.1, viewer.currentScale * distance / previousDistance * pinchRemainder))
      const roundedScale = Math.round(targetScale * 100) / 100
      pinchRemainder = targetScale / roundedScale
      viewer.updateScale({ scaleFactor: roundedScale / viewer.currentScale, origin, pan: [dx, dy], drawingDelay: 250 })
    },
    onPanning: (dx: number, dy: number) => viewer.panBy(dx, dy),
    onPinchEnd: () => { pinchRemainder = 1; schedulePaint() },
  })
  container.addEventListener('wheel', (event) => {
    if ((!event.ctrlKey && !event.metaKey) || !pdfDocument) return
    event.preventDefault()
    const delta = event.deltaY * (event.deltaMode === 1 ? 30 : event.deltaMode === 2 ? container.clientHeight : 1)
    viewer.updateScale({ scaleFactor: Math.exp(-delta / 200), origin: [event.clientX, event.clientY], drawingDelay: 250 })
  }, { passive: false, signal })
  container.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || !['+', '=', '-', '0'].includes(event.key)) return
    event.preventDefault()
    if (event.key === '0') viewer.currentScaleValue = 'page-width'
    else viewer.updateScale({ steps: event.key === '-' ? -1 : 1 })
  }, { signal })
  container.addEventListener('click', (event) => {
    if (!window.getSelection()?.isCollapsed || (event.target as Element).closest('a, input, button, textarea')) return
    const pageElement = (event.target as Element).closest<HTMLElement>('.page')
    if (!pageElement) return
    const pageIndex = Number(pageElement.dataset.pageNumber) - 1
    const page = viewer.getPageView(pageIndex)
    if (!page?.viewport) return
    const bounds = pageElement.getBoundingClientRect()
    const x = (event.clientX - bounds.left) * page.viewport.width / bounds.width
    const y = (event.clientY - bounds.top) * page.viewport.height / bounds.height
    for (const row of highlights) {
      if (row.page_index !== pageIndex) continue
      const position = normalizePdfPosition(row.position)
      if (!position) continue
      if (positionToViewportRects(position, page.viewport).some((rect) => x >= rect.origin.x && y >= rect.origin.y && x <= rect.origin.x + rect.size.width && y <= rect.origin.y + rect.size.height)) {
        options.onSelectAnnotation(row.id)
        return
      }
    }
  }, { signal })
  const resizeObserver = new ResizeObserver(() => {
    if (signal.aborted || !pdfDocument) return
    if (['page-width', 'page-fit', 'auto'].includes(viewer.currentScaleValue)) viewer.currentScaleValue = viewer.currentScaleValue
    viewer.update()
    schedulePaint()
  })
  resizeObserver.observe(container)
  eventBus.on('pagechanging', reportState, { signal })
  eventBus.on('scalechanging', () => { reportState(); schedulePaint() }, { signal })
  eventBus.on('pagerendered', ({ error }: { error?: Error }) => {
    schedulePaint()
    if (error && !signal.aborted) options.onError(error.message || 'This page could not be rendered.')
  }, { signal })

  // Record PDF internal-link jumps without taking over PDF.js destination handling.
  const goToDestination = linkService.goToDestination.bind(linkService)
  linkService.goToDestination = async (destination) => {
    const previousPage = viewer.currentPageNumber
    await goToDestination(destination)
    if (!signal.aborted) options.onNavigate(previousPage, viewer.currentPageNumber)
  }
  const goToLinkPage = linkService.goToPage.bind(linkService)
  linkService.goToPage = (page) => {
    const previousPage = viewer.currentPageNumber
    goToLinkPage(page)
    if (!signal.aborted) options.onNavigate(previousPage, viewer.currentPageNumber)
  }
  let disposed = false
  const cleanup = () => {
    if (disposed) return
    disposed = true
    lifecycle.abort()
    touchManager.destroy()
    resizeObserver.disconnect()
    cancelAnimationFrame(paintFrame)
    cancelAnimationFrame(selectionFrame)
    viewer.setDocument(null)
    linkService.setDocument(null)
    void loadingTask?.destroy().catch(() => undefined)
    void viewer.l10n.destroy().catch(() => undefined)
  }
  signal.addEventListener('abort', cleanup, { once: true })
  try {
    loadingTask = pdfjs.getDocument({
      ...(options.source.kind === 'local'
        ? { data: new Uint8Array(options.source.buffer.slice(0)) }
        : { url: `/api/pdf?url=${encodeURIComponent(options.source.originalUrl)}` }),
      cMapUrl: `${assetBase}cmaps/`, cMapPacked: true,
      standardFontDataUrl: `${assetBase}standard_fonts/`,
      wasmUrl: `${assetBase}wasm/`, iccUrl: `${assetBase}iccs/`,
    })
    pdfDocument = await loadingTask.promise
    signal.throwIfAborted()
    const initialized = new Promise<void>((resolve, reject) => {
      eventBus.on('pagesinit', () => { viewer.currentScaleValue = 'page-width'; reportState(); resolve() }, { signal })
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    linkService.setDocument(pdfDocument)
    viewer.setDocument(pdfDocument)
    // The viewer reports first-page initialization failures on pagesPromise,
    // rather than dispatching pagesinit. Forward that rejection to our caller.
    void viewer.pagesPromise.catch((error: unknown) => lifecycle.abort(error))
    await initialized
    signal.throwIfAborted()
    void loadOutline(pdfDocument).then((outline) => {
      if (!signal.aborted) options.onOutline(outline)
    }).catch((error) => {
      if (!signal.aborted) options.onOutlineError(error instanceof Error ? error.message : 'The table of contents could not be loaded.')
    })
    return {
      viewer, document: pdfDocument,
      goToPage: (page) => viewer.scrollPageIntoView({ pageNumber: Math.min(viewer.pagesCount, Math.max(1, Math.trunc(page))) }),
      zoomIn: () => viewer.updateScale({ steps: 1 }),
      zoomOut: () => viewer.updateScale({ steps: -1 }),
      fitWidth: () => { viewer.currentScaleValue = 'page-width' },
      setHighlights: (rows, nextSelectedId) => { highlights = rows; selectedId = nextSelectedId; schedulePaint() },
      clearSelection,
      getData: () => pdfDocument.getData(),
    }
  } catch (error) {
    cleanup()
    throw error
  }
}

async function loadOutline(pdfDocument: PDFDocumentProxy): Promise<PdfOutlineNode[]> {
  const outline = await pdfDocument.getOutline()
  const convert = async (items: NonNullable<typeof outline>): Promise<PdfOutlineNode[]> => Promise.all(items.map(async (item) => {
    const node: PdfOutlineNode = { title: item.title, children: await convert(item.items) }
    if (item.url && /^https?:\/\//i.test(item.url)) node.uri = item.url
    let destination = item.dest
    if (typeof destination === 'string') destination = await pdfDocument.getDestination(destination)
    if (Array.isArray(destination) && destination.length) {
      const ref = destination[0]
      const index = typeof ref === 'number' ? ref : await pdfDocument.getPageIndex(ref)
      if (Number.isInteger(index) && index >= 0 && index < pdfDocument.numPages) node.pageIndex = index
    }
    return node
  }))
  return convert(outline ?? [])
}
