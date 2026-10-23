import 'pdfjs-dist/web/pdf_viewer.css'
import '../../../styles/global.css'
import './harness.css'
import { createPdfViewerController, type PdfTextSelection, type PdfViewerController, type PdfViewState } from '../../../lib/pdfViewerController'
import type { PdfOutlineNode } from '../../../lib/pdfGeometry'
import type { PdfSource } from '../../../lib/pdfSource'
import { serializePdfPosition, positionFromGeometry, type PdfAnnotationRow } from '../../../utils/pdfSync'
import { createBrowserPdf } from './sourcePdf'

const container = document.querySelector<HTMLDivElement>('#viewport')!
const pages = document.querySelector<HTMLDivElement>('#pages')!
const activeWorkers = new Set<Worker>()
const OriginalWorker = window.Worker
window.Worker = class extends OriginalWorker {
  constructor(...args: ConstructorParameters<typeof Worker>) {
    super(...args)
    activeWorkers.add(this)
  }
  terminate() {
    activeWorkers.delete(this)
    super.terminate()
  }
}

let bytes: Uint8Array
let localBuffer: ArrayBuffer
let abortController: AbortController | undefined
let controller: PdfViewerController | undefined
let state: PdfViewState = { currentPage: 1, totalPages: 0, zoom: 1 }
let selection: PdfTextSelection | null = null
let outline: PdfOutlineNode[] = []
let status: 'idle' | 'opening' | 'ready' | 'aborted' | 'error' = 'idle'
let events: { type: string; generation: number; detail?: unknown }[] = []
let errors: string[] = []
let selectedAnnotation: string | null = null
let generation = 0

async function open(kind: 'local' | 'remote' = 'local') {
  abortController?.abort()
  controller = undefined
  const currentGeneration = ++generation
  abortController = new AbortController()
  const signal = abortController.signal
  if (!bytes) {
    bytes = await createBrowserPdf()
    localBuffer = bytes.slice().buffer as ArrayBuffer
  }
  status = 'opening'
  selection = null
  outline = []
  errors = []
  state = { currentPage: 1, totalPages: 0, zoom: 1 }
  const source: PdfSource = kind === 'local'
    ? { kind, buffer: localBuffer, documentKey: 'browser-fixture', name: 'browser-fixture.pdf' }
    : { kind, originalUrl: 'https://fixture.example/document.pdf', documentKey: 'remote-fixture', name: 'remote-fixture.pdf' }
  const record = (type: string, detail?: unknown) => events.push({ type, generation: currentGeneration, detail })
  try {
    const created = await createPdfViewerController({
      container, viewerElement: pages, source, signal,
      onState: (next) => { state = next; record('state', next) },
      onSelection: (next) => { selection = next; record('selection', next) },
      onSelectAnnotation: (id) => { selectedAnnotation = id; record('annotation', id) },
      onOutline: (next) => { outline = next; record('outline', next) },
      onOutlineError: (error) => { errors.push(error); record('outline-error', error) },
      onNavigate: (from, to) => record('navigate', { from, to }),
      onError: (error) => { errors.push(error); record('error', error) },
    })
    if (signal.aborted) return
    controller = created
    status = 'ready'
  } catch (error) {
    if (signal.aborted) status = currentGeneration === generation ? 'aborted' : status
    else {
      errors.push(error instanceof Error ? error.message : String(error))
      status = 'error'
    }
  }
}

const api = {
  open,
  abort() { abortController?.abort(); controller = undefined; status = 'aborted' },
  snapshot() { return { state, selection, outline, status, events, errors, selectedAnnotation, generation, activeWorkers: activeWorkers.size, sourceByteLength: localBuffer?.byteLength ?? 0 } },
  sourceBytes() { return Array.from(bytes) },
  resetEvents() { events = [] },
  goToPage(page: number) { controller!.goToPage(page) },
  zoomIn() { controller!.zoomIn() },
  zoomOut() { controller!.zoomOut() },
  fitWidth() { controller!.fitWidth() },
  setScale(scale: number) { controller!.viewer.currentScale = scale },
  clearSelection() { controller!.clearSelection() },
  highlightSelection() {
    if (!selection) throw new Error('Select text before creating a highlight')
    const rows: PdfAnnotationRow[] = selection.geometry.map((geometry, index) => ({
      id: `highlight-${index}`, document_id: 'browser-fixture', page_index: geometry.pageIndex,
      text: selection!.text, color: '#87ceeb', comment: null,
      created_at: '2026-10-18T12:00:00.000Z', updated_at: '2026-10-18T12:00:00.000Z',
      position: serializePdfPosition(positionFromGeometry(geometry)),
    }))
    controller!.setHighlights(rows, null)
    return rows
  },
  pageMetrics(pageIndex: number) {
    const page = controller!.viewer.getPageView(pageIndex)
    return { width: page.viewport.width, height: page.viewport.height, rotation: page.viewport.rotation, viewBox: page.viewport.viewBox }
  },
}
export type ViewerHarness = typeof api
declare global { interface Window { pdfHarness: ViewerHarness } }
window.pdfHarness = api
