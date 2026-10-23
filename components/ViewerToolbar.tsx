import {
  ChevronLeft,
  ChevronRight,
  Download,
  ListTree,
  Maximize2,
  MessageSquare,
  Redo2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, type BadgeTone } from './design-system/badge'
import { Button } from './design-system/button'
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
  ToolbarSpacer,
} from './design-system/toolbar'

export type PersistenceStatus = 'loading' | 'synced' | 'syncing' | 'queued' | 'error'

type ViewerToolbarProps = {
  annotationCount: number;
  annotationsOpen: boolean;
  canJumpBack: boolean;
  canJumpForward: boolean;
  currentPage: number;
  totalPages: number;
  zoom: number;
  onPageChange: (page: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onDownload: () => Promise<void>;
  downloading: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onChromeToggle?: () => void;
  onAnnotationsToggle: () => void;
  onJumpBack: () => void;
  onJumpForward: () => void;
  onOutlineToggle: () => void;
  outlineOpen: boolean;
  persistenceStatus: PersistenceStatus;
}

export default function ViewerToolbar({
  annotationCount,
  annotationsOpen,
  canJumpBack,
  canJumpForward,
  currentPage,
  totalPages,
  zoom,
  onPageChange,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onDownload,
  downloading,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onChromeToggle,
  onAnnotationsToggle,
  onJumpBack,
  onJumpForward,
  onOutlineToggle,
  outlineOpen,
  persistenceStatus,
}: ViewerToolbarProps) {
  const [pageDraft, setPageDraft] = useState('1')

  useEffect(() => {
    setPageDraft(String(Math.max(1, currentPage || 1)))
  }, [currentPage])

  const goToDraftPage = () => {
    if (totalPages < 1) return
    const pageNumber = Math.min(
      Math.max(Number.parseInt(pageDraft, 10) || 1, 1),
      Math.max(totalPages, 1),
    )
    onPageChange(pageNumber)
    setPageDraft(String(pageNumber))
  }

  const zoomPercent = Math.round((zoom || 1) * 100)
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
      <ToolbarGroup className="toolbar-group page-controls">
        <div className="jump-navigation-controls" role="group" aria-label="Jump navigation">
          <button
            className="icon-button"
            type="button"
            aria-label="Back to previous link or table of contents location"
            title="Back"
            disabled={!canJumpBack}
            onClick={onJumpBack}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Forward to next link or table of contents location"
            title="Forward"
            disabled={!canJumpForward}
            onClick={onJumpForward}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
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
          <span>of {Math.max(totalPages, 1)}</span>
        </label>
      </ToolbarGroup>

      {onChromeToggle && (
        <button
          className="icon-button fullscreen-toggle"
          type="button"
          aria-label="Enter fullscreen"
          title="Enter fullscreen"
          onClick={onChromeToggle}
        >
          <Maximize2 size={16} aria-hidden="true" />
        </button>
      )}

      <ToolbarSeparator className="toolbar-separator zoom-separator" />

      <ToolbarGroup className="toolbar-group zoom-controls">
        <button className="icon-button" type="button" aria-label="Zoom out" title="Zoom out" onClick={onZoomOut} disabled={totalPages < 1}>
          <ZoomOut size={17} aria-hidden="true" />
        </button>
        <span className="zoom-value" aria-label={`Zoom ${zoomPercent}%`}>{zoomPercent}%</span>
        <button className="icon-button" type="button" aria-label="Zoom in" title="Zoom in" onClick={onZoomIn} disabled={totalPages < 1}>
          <ZoomIn size={17} aria-hidden="true" />
        </button>
        <button
          className="icon-button fit-button"
          type="button"
          aria-label="Fit page width"
          title="Fit page width"
          onClick={onFitWidth}
          disabled={totalPages < 1}
        >
          <Maximize2 size={16} aria-hidden="true" />
        </button>
      </ToolbarGroup>

      <ToolbarSeparator className="toolbar-separator history-separator" />

      <ToolbarGroup className="toolbar-group history-controls">
        <button className="icon-button" type="button" aria-label="Undo" title="Undo" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={17} aria-hidden="true" />
        </button>
        <button className="icon-button" type="button" aria-label="Redo" title="Redo" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={17} aria-hidden="true" />
        </button>
      </ToolbarGroup>

      <ToolbarSpacer className="toolbar-spacer" />

      <Badge className="toolbar-save-status" tone={saveTone} size="small" dot title={saveLabel}>
        {saveLabel}
      </Badge>
      <Button
        className="toolbar-download"
        variant="secondary"
        size="small"
        leadingIcon={<Download aria-hidden="true" />}
        disabled={totalPages < 1 || downloading}
        loading={downloading}
        onClick={() => void onDownload()}
      >
        Download
      </Button>
      <Button
        className={`panel-toggle${outlineOpen ? ' is-active' : ''}`}
        variant={outlineOpen ? 'secondary' : 'ghost'}
        size="small"
        leadingIcon={<ListTree aria-hidden="true" />}
        aria-label={outlineOpen ? 'Close table of contents' : 'Open table of contents'}
        aria-expanded={outlineOpen}
        title={outlineOpen ? 'Close table of contents' : 'Open table of contents'}
        onClick={onOutlineToggle}
      >
        TOC
      </Button>
      <Button
        className={`panel-toggle${annotationsOpen ? ' is-active' : ''}`}
        variant={annotationsOpen ? 'secondary' : 'ghost'}
        size="small"
        leadingIcon={<MessageSquare aria-hidden="true" />}
        aria-label={annotationsOpen ? 'Close annotations panel' : 'Open annotations panel'}
        aria-expanded={annotationsOpen}
        title={annotationsOpen ? 'Close annotations' : 'Open annotations'}
        onClick={onAnnotationsToggle}
      >
        {annotationCount}
      </Button>
    </Toolbar>
  )
}
