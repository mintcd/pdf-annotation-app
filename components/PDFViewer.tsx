'use client'

import { Minimize2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PdfSource } from '../lib/pdfSource'
import { createPdfViewerController, type PdfTextSelection, type PdfViewerController, type PdfViewState } from '../lib/pdfViewerController'
import type { PdfOutlineNode, PdfSelectionGeometry } from '../lib/pdfGeometry'
import { ensurePdfDocument, normalizePdfPosition, positionFromGeometry, serializePdfPosition, syncTimestamp, type PdfAnnotationRow, type PdfDocumentRow } from '../utils/pdfSync'
import { FALLBACK_HIGHLIGHT_COLOR } from '../utils/highlightColors'
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

type AnnotationChange = { before: PdfAnnotationRow | null; after: PdfAnnotationRow | null }
type PageHistory = { entries: number[]; index: number }

export default function PDFViewer(props: PDFViewerProps) {
  const sync = usePdfSyncEngine()
  return <PdfWorkspace key={`${sync.session.streamId}:${props.source.documentKey}`} {...props} />
}

function PdfWorkspace({ chromeVisible = true, source, initialAnnotationId, onChromeToggle }: PDFViewerProps) {
  const sync = usePdfSyncEngine()
  const documentsTable = useMemo(() => sync.db.table('documents'), [sync.db])
  const annotationsTable = useMemo(() => sync.db.table('annotations'), [sync.db])
  const documents = sync.tables.documents as readonly PdfDocumentRow[]
  const allAnnotations = sync.tables.annotations as readonly PdfAnnotationRow[]
  const colors = useHighlightColors()
  const [documentRow, setDocumentRow] = useState<PdfDocumentRow | null>(null)
  const [documentError, setDocumentError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [mutationError, setMutationError] = useState('')
  const [loading, setLoading] = useState(true)
  const [controller, setController] = useState<PdfViewerController | null>(null)
  const [view, setView] = useState<PdfViewState>({ currentPage: 1, totalPages: 0, zoom: 1 })
  const [selection, setSelection] = useState<PdfTextSelection | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [highlightColor, setHighlightColor] = useState(FALLBACK_HIGHLIGHT_COLOR)
  const [panel, setPanel] = useState<'outline' | 'annotations' | null>(null)
  const [outline, setOutline] = useState<PdfOutlineNode[]>([])
  const [outlineLoading, setOutlineLoading] = useState(true)
  const [outlineError, setOutlineError] = useState('')
  const [outlineEdited, setOutlineEdited] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [writing, setWriting] = useState(false)
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false })
  const [pageHistory, setPageHistory] = useState<PageHistory>({ entries: [], index: -1 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const flushRef = useRef(sync.sync)
  const past = useRef<AnnotationChange[][]>([])
  const future = useRef<AnnotationChange[][]>([])
  const writeQueue = useRef<Promise<unknown>>(Promise.resolve())
  const initialSelectionHandled = useRef(false)
  const mounted = useRef(true)
  flushRef.current = sync.sync

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const flushSync = useCallback(() => {
    void flushRef.current().catch((error) => console.error('PDF annotation sync failed', error))
  }, [])

  useEffect(() => {
    if (!sync.ready) return
    let active = true
    void ensurePdfDocument(source, documentsTable, documents).then(({ row, changed }) => {
      if (!active) return
      setDocumentRow(row)
      setDocumentError('')
      if (changed) flushSync()
    }).catch((error) => {
      if (active) setDocumentError(error instanceof Error ? error.message : 'Document sync could not be opened.')
    })
    return () => { active = false }
  }, [documents, documentsTable, flushSync, source, sync.ready])

  const annotationRows = useMemo(() => documentRow
    ? allAnnotations.filter((row) => row.document_id === documentRow.id)
    : [], [allAnnotations, documentRow])

  const recordJump = useCallback((fromPage: number, toPage: number) => {
    if (fromPage === toPage) return
    setPageHistory((current) => {
      const entries = current.entries.slice(0, current.index + 1)
      if (entries.at(-1) !== fromPage) entries.push(fromPage)
      entries.push(toPage)
      const bounded = entries.slice(-50)
      return { entries: bounded, index: bounded.length - 1 }
    })
  }, [])

  useEffect(() => {
    const container = viewportRef.current
    const viewerElement = pagesRef.current
    if (!container || !viewerElement) return
    const abort = new AbortController()
    setLoading(true)
    setLoadError('')
    void createPdfViewerController({
      container, viewerElement, source, signal: abort.signal,
      onState: setView,
      onSelection: setSelection,
      onSelectAnnotation: (id) => { setSelectedId(id); setPanel('annotations') },
      onOutline: (items) => { setOutline(items); setOutlineLoading(false) },
      onOutlineError: (message) => { setOutlineError(message); setOutlineLoading(false) },
      onNavigate: recordJump,
      onError: setLoadError,
    }).then((next) => {
      if (abort.signal.aborted) return
      setController(next)
      setLoading(false)
    }).catch((error) => {
      if (abort.signal.aborted) return
      setLoadError(error instanceof Error ? error.message : 'The PDF could not be opened.')
      setLoading(false)
      setOutlineLoading(false)
    })
    return () => { abort.abort() }
  }, [recordJump, source])

  useEffect(() => { controller?.setHighlights(annotationRows, selectedId) }, [annotationRows, controller, selectedId])
  useEffect(() => {
    if (!controller || !initialAnnotationId || initialSelectionHandled.current) return
    const row = annotationRows.find((item) => item.id === initialAnnotationId)
    if (!row) return
    initialSelectionHandled.current = true
    setSelectedId(row.id)
    setPanel('annotations')
    controller.goToPage(row.page_index + 1)
  }, [annotationRows, controller, initialAnnotationId])
  useEffect(() => {
    if (colors.data.length && !colors.data.some((option) => option.color === highlightColor)) setHighlightColor(colors.data[0].color)
  }, [colors.data, highlightColor])

  const persistenceStatus: PersistenceStatus = documentError || mutationError || sync.error || sync.phase === 'error'
    ? 'error'
    : !sync.ready || !documentRow || sync.phase === 'opening' ? 'loading'
      : sync.phase === 'syncing' ? 'syncing'
        : !sync.isOnline || sync.pendingProposalCount > 0 || sync.acceptedAwaitingConfirmationCount > 0 ? 'queued' : 'synced'

  const refreshHistory = () => {
    if (mounted.current) setHistoryState({ canUndo: past.current.length > 0, canRedo: future.current.length > 0 })
  }
  const enqueueWrite = (operation: () => Promise<void>) => {
    const pending = writeQueue.current.then(async () => {
      if (mounted.current) { setWriting(true); setMutationError('') }
      try { await operation() }
      catch (error) {
        if (mounted.current) setMutationError(error instanceof Error ? error.message : 'The annotation could not be saved.')
        throw error
      } finally { if (mounted.current) setWriting(false) }
    })
    writeQueue.current = pending.catch(() => undefined)
    return pending
  }
  const writeChanges = async (changes: AnnotationChange[]) => {
    if (!documentRow) throw new Error('Document sync is not ready yet.')
    const nextRows = new Map(annotationsTable.all().filter((row) => row.document_id === documentRow.id).map((row) => [row.id, row]))
    for (const { before, after } of changes) {
      if (after) { await annotationsTable.put(after); nextRows.set(after.id, after) }
      else if (before) { await annotationsTable.delete({ id: before.id }); nextRows.delete(before.id) }
    }
    const latestDocument = await documentsTable.get({ id: documentRow.id }) ?? documentRow
    await documentsTable.put({ ...latestDocument, number_of_annotations: nextRows.size, updated_at: syncTimestamp() })
    flushSync()
  }
  const commitChanges = async (changes: AnnotationChange[]) => {
    await writeChanges(changes)
    past.current = [...past.current, changes].slice(-50)
    future.current = []
    refreshHistory()
  }
  const createHighlight = (input: { color: string; geometry: PdfSelectionGeometry[]; text: string }) => enqueueWrite(async () => {
    if (!documentRow) throw new Error('Document sync is not ready yet.')
    const now = syncTimestamp()
    const changes = input.geometry.map((geometry): AnnotationChange => ({ before: null, after: {
      id: `annotation_${crypto.randomUUID()}`, document_id: documentRow.id, page_index: geometry.pageIndex,
      text: input.text, created_at: now, updated_at: now, color: input.color, comment: null,
      position: serializePdfPosition(positionFromGeometry(geometry)),
    } }))
    await commitChanges(changes)
  })
  const editAnnotation = (row: PdfAnnotationRow, patch: Partial<Pick<PdfAnnotationRow, 'color' | 'comment'>>) => enqueueWrite(async () => {
    const before = await annotationsTable.get({ id: row.id })
    if (!before) throw new Error('This annotation no longer exists.')
    const after = { ...before, ...patch, updated_at: syncTimestamp() }
    if (before.color === after.color && before.comment === after.comment) return
    await commitChanges([{ before, after }])
  }).catch(() => undefined)
  const deleteAnnotation = (row: PdfAnnotationRow) => enqueueWrite(async () => {
    const before = await annotationsTable.get({ id: row.id })
    if (!before) return
    await commitChanges([{ before, after: null }])
    if (mounted.current) setSelectedId((id) => id === row.id ? null : id)
  }).catch(() => undefined)
  const navigateHistory = (redo: boolean) => {
    void enqueueWrite(async () => {
      const origin = redo ? future.current : past.current
      const changes = origin.at(-1)
      if (!changes) return
      // A stale historical snapshot must not overwrite an incoming synced edit.
      const changedElsewhere = await Promise.all(changes.map(async ({ before, after }) => {
        const expected = redo ? before : after
        const id = (after ?? before)!.id
        return annotationContent(await annotationsTable.get({ id })) !== annotationContent(expected)
      }))
      if (changedElsewhere.some(Boolean)) {
        past.current = []
        future.current = []
        refreshHistory()
        throw new Error('This annotation changed elsewhere. Undo history was cleared to preserve the current annotation.')
      }
      await writeChanges(changes.map(({ before, after }) => {
        const row = redo ? after : before
        return { before: redo ? before : after, after: row ? { ...row, updated_at: syncTimestamp() } : null }
      }))
      origin.pop()
      const destination = redo ? past.current : future.current
      destination.push(changes)
      refreshHistory()
    }).catch(() => undefined)
  }
  const goToPage = (page: number) => {
    if (!controller) return
    const target = Math.min(view.totalPages, Math.max(1, Math.trunc(page)))
    recordJump(controller.viewer.currentPageNumber, target)
    controller.goToPage(target)
  }
  const navigateJumpHistory = (direction: number) => {
    const index = pageHistory.index + direction
    const target = pageHistory.entries[index]
    if (!target || !controller) return
    setPageHistory({ ...pageHistory, index })
    controller.goToPage(target)
  }
  const download = async () => {
    if (!controller || downloading) return
    setDownloading(true)
    setMutationError('')
    try {
      await writeQueue.current
      const { exportAnnotatedPdf } = await import('../lib/pdfExport')
      const rows = annotationsTable.all().filter((row) => row.document_id === documentRow?.id)
      const data = await exportAnnotatedPdf(await controller.getData(), rows, outlineEdited ? outline : undefined)
      const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'application/pdf' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = source.name
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (error) { setMutationError(error instanceof Error ? error.message : 'The PDF could not be downloaded.') }
    finally { if (mounted.current) setDownloading(false) }
  }
  const togglePanel = (mode: 'outline' | 'annotations') => setPanel((current) => current === mode ? null : mode)

  return (
    <section className="viewer-shell">
      <div className={`viewer-workspace${panel ? ' has-sidebar' : ''}`}>
        <div className="viewer-main">
          <ViewerToolbar currentPage={view.currentPage} totalPages={view.totalPages} zoom={view.zoom}
            annotationCount={annotationRows.length} annotationsOpen={panel === 'annotations'} outlineOpen={panel === 'outline'}
            canJumpBack={pageHistory.index > 0} canJumpForward={pageHistory.index >= 0 && pageHistory.index < pageHistory.entries.length - 1}
            onJumpBack={() => navigateJumpHistory(-1)} onJumpForward={() => navigateJumpHistory(1)}
            onPageChange={goToPage} onZoomIn={() => controller?.zoomIn()} onZoomOut={() => controller?.zoomOut()} onFitWidth={() => controller?.fitWidth()}
            onUndo={() => navigateHistory(false)} onRedo={() => navigateHistory(true)} canUndo={!writing && historyState.canUndo} canRedo={!writing && historyState.canRedo}
            onDownload={download} downloading={downloading || loading || !controller || !documentRow || !sync.ready}
            onChromeToggle={onChromeToggle} onAnnotationsToggle={() => togglePanel('annotations')} onOutlineToggle={() => togglePanel('outline')}
            persistenceStatus={persistenceStatus} />
          {(loadError || documentError || mutationError) && <div className="viewer-inline-error" role="alert">{loadError || documentError || mutationError}</div>}
          <div className="pdf-viewport-frame">
            <div ref={viewportRef} className="pdfjs-viewport" tabIndex={0} aria-label="PDF document" aria-busy={loading}><div ref={pagesRef} className="pdfViewer" /></div>
            {loading && <div className="pdfjs-loading" role="status">Opening PDF...</div>}
            <SelectionPanel color={highlightColor} selection={selection} highlightColors={colors.data} onCreateHighlight={createHighlight}
              onColorChange={setHighlightColor} onSelectionClear={() => controller?.clearSelection()} />
          </div>
          {!chromeVisible && onChromeToggle && <button className="viewer-fullscreen-exit" type="button" aria-label="Exit fullscreen" title="Exit fullscreen" onClick={onChromeToggle}><Minimize2 size={20} aria-hidden="true" /></button>}
        </div>
        {panel && <button className="annotation-backdrop" type="button" aria-label="Close side panel" onClick={() => setPanel(null)} />}
        {panel === 'annotations' && <AnnotationSidebar annotations={annotationRows} highlightColors={colors.data} onClose={() => setPanel(null)}
          onColorChange={(row, color) => editAnnotation(row, { color })} onCommentChange={(row, comment) => editAnnotation(row, { comment: comment.trim() || null })}
          onDelete={deleteAnnotation} onSelect={(row) => { setSelectedId(row.id); goToPage(row.page_index + 1) }} selectedId={selectedId} />}
        {panel === 'outline' && <DocumentOutlineSidebar outline={outline} loading={outlineLoading} error={outlineError} currentPage={view.currentPage} totalPages={view.totalPages}
          onClose={() => setPanel(null)} onPageJump={goToPage} onOutlineChange={(items) => { setOutline(items); setOutlineEdited(true) }} />}
      </div>
    </section>
  )
}

function annotationContent(row: PdfAnnotationRow | null | undefined): string {
  if (!row) return 'absent'
  // Timestamp-only changes are harmless; compare canonical values rather than
  // object property order or string-vs-object position serialization.
  return JSON.stringify([row.id, row.document_id, row.page_index, row.text,
    row.created_at, row.color, row.comment, normalizePdfPosition(row.position) ?? row.position])
}
