import { useSelectionCapability } from '@embedpdf/plugin-selection/react'
import { Highlighter } from 'lucide-react'
import { type CSSProperties, useState } from 'react'
import { Button } from './design-system/button'
import { Toolbar, ToolbarGroup, ToolbarSeparator } from './design-system/toolbar'
import {
  INITIAL_HIGHLIGHT_COLORS,
  highlightColorSemantics,
  type HighlightColor,
} from '../utils/highlightColors'
import type { PdfSelectionGeometry } from '../utils/pdfSync'

type SelectionPanelProps = {
  color: string;
  documentId: string;
  highlightColors: readonly HighlightColor[];
  onCreateHighlight: (payload: {
    color: string;
    geometry: PdfSelectionGeometry[];
    text: string;
  }) => Promise<void>;
  onColorChange: (color: string) => void;
}

export default function SelectionPanel({
  color,
  documentId,
  highlightColors,
  onCreateHighlight,
  onColorChange,
}: SelectionPanelProps) {
  const { provides: selectionCapability } = useSelectionCapability()
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')
  const colorOptions = highlightColors.length > 0 ? highlightColors : INITIAL_HIGHLIGHT_COLORS
  const selectedSemantics = highlightColorSemantics(colorOptions, color)

  const createHighlight = () => {
    if (!selectionCapability || isCreating) return

    const selection = selectionCapability.forDocument(documentId)
    const geometry = selection.getFormattedSelection() as PdfSelectionGeometry[]
    if (geometry.length === 0) return

    setIsCreating(true)
    setError('')
    selection.getSelectedText().wait(
      (textLines) => {
        const selectedText = textLines.join('\n').trim()
        onCreateHighlight({ color, geometry, text: selectedText }).then(
          () => {
            selection.clear()
            setIsCreating(false)
          },
          (reason) => {
            setError(reason instanceof Error ? reason.message : 'Could not create the highlight.')
            setIsCreating(false)
          },
        )
      },
      () => {
        setError('Could not read the selected text.')
        setIsCreating(false)
      },
    )
  }

  return (
    <Toolbar
      className="selection-menu"
      variant="floating"
      size="small"
      aria-label="Text selection actions"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ToolbarGroup className="color-swatches" role="radiogroup" aria-label="Highlight color">
        {colorOptions.map((option) => {
          const semantics = option.semantics.trim() || option.color
          return (
            <button
              key={option.color}
              className="color-swatch"
              type="button"
              role="radio"
              aria-checked={color === option.color}
              aria-label={`${semantics} highlight (${option.color})`}
              title={`${semantics} (${option.color})`}
              style={{ '--swatch-color': option.color } as CSSProperties}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => onColorChange(option.color)}
            />
          )
        })}
      </ToolbarGroup>
      <ToolbarSeparator />
      <Button
        className="selection-highlight-action"
        variant="primary"
        size="small"
        loading={isCreating}
        leadingIcon={<Highlighter aria-hidden="true" />}
        onPointerDown={(event) => event.preventDefault()}
        onClick={createHighlight}
      >
        Highlight {selectedSemantics}
      </Button>
      {error && <span className="selection-error" role="alert">{error}</span>}
    </Toolbar>
  )
}
