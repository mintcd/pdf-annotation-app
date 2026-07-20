import { useScroll } from '@embedpdf/plugin-scroll/react'
import { MessageSquare, Trash2, X } from 'lucide-react'
import { type CSSProperties, useMemo, useState } from 'react'
import { Badge } from './design-system/badge'
import { Button } from './design-system/button'
import { IconButton } from './design-system/icon-button'
import { Panel, PanelBody, PanelFooter, PanelHeader } from './design-system/panel'
import { AnnotationNoteEditor } from './AnnotationNoteEditor'
import {
  INITIAL_HIGHLIGHT_COLORS,
  type HighlightColor,
} from '../utils/highlightColors'
import type { PdfAnnotationRow } from '../utils/pdfSync'
import { normalizePdfPosition } from '../utils/pdfSync'

type AnnotationSidebarProps = {
  annotations: PdfAnnotationRow[]
  documentId: string
  highlightColors: readonly HighlightColor[]
  onClose: () => void
  onColorChange: (annotation: PdfAnnotationRow, color: string) => Promise<void>
  onCommentChange: (annotation: PdfAnnotationRow, comment: string) => Promise<void>
  onDelete: (annotation: PdfAnnotationRow) => Promise<void>
  onSelect: (annotation: PdfAnnotationRow) => void
  selectedId: string | null
}

export default function AnnotationSidebar({
  annotations,
  documentId,
  highlightColors,
  onClose,
  onColorChange,
  onCommentChange,
  onDelete,
  onSelect,
  selectedId,
}: AnnotationSidebarProps) {
  const { provides: scroll } = useScroll(documentId)
  const [draftComments, setDraftComments] = useState<Record<string, string>>({})
  const colorOptions = highlightColors.length > 0 ? highlightColors : INITIAL_HIGHLIGHT_COLORS

  const sortedAnnotations = useMemo(() => {
    return [...annotations].sort((left, right) => {
      if (left.page_index !== right.page_index) return left.page_index - right.page_index
      const leftY = normalizePdfPosition(left.position)?.rect.origin.y ?? 0
      const rightY = normalizePdfPosition(right.position)?.rect.origin.y ?? 0
      return leftY - rightY
    })
  }, [annotations])

  const selectAnnotation = (annotation: PdfAnnotationRow) => {
    onSelect(annotation)
    scroll?.scrollToPage({ pageNumber: annotation.page_index + 1, behavior: 'instant' })
  }

  return (
    <Panel as="aside" variant="glass" className="annotation-sidebar" aria-label="PDF annotations">
      <PanelHeader className="sidebar-header">
        <div>
          <strong>Annotations</strong>
          <Badge size="small">{annotations.length}</Badge>
        </div>
        <IconButton label="Close annotations" size="small" onClick={onClose}>
          <X aria-hidden="true" />
        </IconButton>
      </PanelHeader>

      <PanelBody className="annotation-panel-body">
        {sortedAnnotations.length === 0 ? (
          <div className="empty-state">
            <MessageSquare size={22} aria-hidden="true" />
            <p>No annotations yet.</p>
          </div>
        ) : (
          <div className="annotation-list">
            {sortedAnnotations.map((annotation) => {
              const selected = selectedId === annotation.id
              const commentValue = draftComments[annotation.id] ?? annotation.comment ?? ''

              return (
                <article
                  key={annotation.id}
                  className={`annotation-card ${selected ? 'is-selected' : ''}`}
                >
                  <button
                    className="annotation-summary"
                    type="button"
                    onClick={() => selectAnnotation(annotation)}
                  >
                    <span
                      className="annotation-color"
                      style={{ '--annotation-color': annotation.color } as CSSProperties}
                      aria-hidden="true"
                    />
                    <span>
                      <strong>Page {annotation.page_index + 1}</strong>
                      <small>{annotation.text || 'Selected text'}</small>
                    </span>
                  </button>

                  {selected && (
                    <div className="annotation-editor">
                      <div className="color-swatches" role="radiogroup" aria-label="Annotation color">
                        {colorOptions.map((option) => {
                          const semantics = option.semantics.trim() || option.color
                          return (
                            <button
                              key={option.color}
                              className="color-swatch"
                              type="button"
                              role="radio"
                              aria-checked={annotation.color === option.color}
                              aria-label={`${semantics} highlight (${option.color})`}
                              title={`${semantics} (${option.color})`}
                              style={{ '--swatch-color': option.color } as CSSProperties}
                              onClick={() => void onColorChange(annotation, option.color)}
                            />
                          )
                        })}
                      </div>

                      <AnnotationNoteEditor
                        value={commentValue}
                        label={`Note for page ${annotation.page_index + 1}`}
                        onBlur={(nextComment) => void onCommentChange(annotation, nextComment)}
                        onChange={(nextComment) => {
                          setDraftComments((current) => ({
                            ...current,
                            [annotation.id]: nextComment,
                          }))
                        }}
                      />

                      <Button
                        variant="danger"
                        size="small"
                        fullWidth
                        leadingIcon={<Trash2 aria-hidden="true" />}
                        onClick={() => void onDelete(annotation)}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </PanelBody>
      <PanelFooter className="sidebar-footer">
        Select a highlight to locate it on the page.
      </PanelFooter>
    </Panel>
  )
}
