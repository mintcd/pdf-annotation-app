import { useExport } from '@embedpdf/plugin-export/react'
import { useHistoryCapability } from '@embedpdf/plugin-history/react'
import { useScroll } from '@embedpdf/plugin-scroll/react'
import { useZoom, ZoomMode } from '@embedpdf/plugin-zoom/react'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge, type BadgeTone } from '../design-system/badge'
import { Button } from '../design-system/button'
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
  ToolbarSpacer,
} from '../design-system/toolbar'

export type PersistenceStatus = 'loading' | 'synced' | 'syncing' | 'queued' | 'error'

type ViewerToolbarProps = {
  annotationCount: number;
  documentId: string;
  onPanelToggle: () => void;
  panelOpen: boolean;
  persistenceStatus: PersistenceStatus;
}

export default function ViewerToolbar({
  annotationCount,
  documentId,
  onPanelToggle,
  panelOpen,
  persistenceStatus,
}: ViewerToolbarProps) {
  const { provides: scroll, state: scrollState } = useScroll(documentId)
  const { provides: zoom, state: zoomState } = useZoom(documentId)
  const { provides: exporter } = useExport(documentId)
  const { provides: historyCapability } = useHistoryCapability()
  const history = useMemo(
    () => historyCapability?.forDocument(documentId) ?? null,
    [documentId, historyCapability],
  )
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false })
  const [pageDraft, setPageDraft] = useState('1')

  useEffect(() => {
    setPageDraft(String(Math.max(1, scrollState.currentPage || 1)))
  }, [scrollState.currentPage])

  useEffect(() => {
    if (!history) return
    const update = () => {
      setHistoryState({ canUndo: history.canUndo(), canRedo: history.canRedo() })
    }
    update()
    return history.onHistoryChange(update)
  }, [history])

  const goToDraftPage = () => {
    if (!scroll) return
    const pageNumber = Math.min(
      Math.max(Number.parseInt(pageDraft, 10) || 1, 1),
      Math.max(scrollState.totalPages, 1),
    )
    scroll.scrollToPage({ pageNumber, behavior: 'smooth' })
    setPageDraft(String(pageNumber))
  }

  const zoomPercent = Math.round((zoomState.currentZoomLevel || 1) * 100)
  const saveLabel = persistenceStatus === 'loading'
    ? 'Loading annotations...'
    : persistenceStatus === 'error'
      ? 'Sync failed'
      : persistenceStatus === 'syncing'
        ? 'Syncing'
        : persistenceStatus === 'queued'
          ? 'Queued'
          : 'Synced'
  const saveTone: BadgeTone = persistenceStatus === 'error'
    ? 'danger'
    : persistenceStatus === 'syncing' || persistenceStatus === 'queued'
      ? 'warning'
      : persistenceStatus === 'synced'
        ? 'success'
        : 'neutral'

  return (
    <Toolbar className="viewer-toolbar" aria-label="PDF controls">
      <ToolbarGroup>
        <button
          className="icon-button"
          type="button"
          aria-label="Previous page"
          title="Previous page"
          disabled={!scroll || scrollState.currentPage <= 1}
          onClick={() => scroll?.scrollToPreviousPage('smooth')}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <label className="page-control">
          <span className="sr-only">Page number</span>
          <input
            value={pageDraft}
            inputMode="numeric"
            aria-label="Page number"
            onChange={(event) => setPageDraft(event.target.value.replace(/\D/g, ''))}
            onBlur={goToDraftPage}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') goToDraftPage()
            }}
          />
          <span>of {Math.max(scrollState.totalPages, 1)}</span>
        </label>
        <button
          className="icon-button"
          type="button"
          aria-label="Next page"
          title="Next page"
          disabled={!scroll || scrollState.currentPage >= scrollState.totalPages}
          onClick={() => scroll?.scrollToNextPage('smooth')}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <button className="icon-button" type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoom?.zoomOut()} disabled={!zoom}>
          <ZoomOut size={17} aria-hidden="true" />
        </button>
        <span className="zoom-value" aria-label={`Zoom ${zoomPercent}%`}>{zoomPercent}%</span>
        <button className="icon-button" type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoom?.zoomIn()} disabled={!zoom}>
          <ZoomIn size={17} aria-hidden="true" />
        </button>
        <button
          className="icon-button fit-button"
          type="button"
          aria-label="Fit page width"
          title="Fit page width"
          onClick={() => zoom?.requestZoom(ZoomMode.FitWidth)}
          disabled={!zoom}
        >
          <Maximize2 size={16} aria-hidden="true" />
        </button>
      </ToolbarGroup>

      <ToolbarSeparator className="history-separator" />

      <ToolbarGroup className="history-controls">
        <button className="icon-button" type="button" aria-label="Undo" title="Undo" disabled={!historyState.canUndo} onClick={() => history?.undo()}>
          <Undo2 size={17} aria-hidden="true" />
        </button>
        <button className="icon-button" type="button" aria-label="Redo" title="Redo" disabled={!historyState.canRedo} onClick={() => history?.redo()}>
          <Redo2 size={17} aria-hidden="true" />
        </button>
      </ToolbarGroup>

      <ToolbarSpacer />

      <Badge tone={saveTone} size="small" dot title={saveLabel}>{saveLabel}</Badge>
      <Button
        className="toolbar-download"
        variant="secondary"
        size="small"
        leadingIcon={<Download aria-hidden="true" />}
        disabled={!exporter}
        onClick={() => exporter?.download()}
      >
        Download
      </Button>
      <Button
        className={`panel-toggle${panelOpen ? ' is-active' : ''}`}
        variant={panelOpen ? 'secondary' : 'ghost'}
        size="small"
        leadingIcon={panelOpen
          ? <PanelRightClose aria-hidden="true" />
          : <PanelRightOpen aria-hidden="true" />}
        aria-label={panelOpen ? 'Close annotations panel' : 'Open annotations panel'}
        aria-expanded={panelOpen}
        title={panelOpen ? 'Close annotations' : 'Open annotations'}
        onClick={onPanelToggle}
      >
        {annotationCount}
      </Button>
    </Toolbar>
  )
}
