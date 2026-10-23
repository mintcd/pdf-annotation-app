import { Highlighter } from 'lucide-react'
import { type CSSProperties, useState } from 'react'
import type { PdfSelectionGeometry } from '../lib/pdfGeometry'
import { Button } from './design-system/button'
import { Toolbar, ToolbarGroup, ToolbarSeparator } from './design-system/toolbar'
import {
  INITIAL_HIGHLIGHT_COLORS,
  highlightColorSemantics,
  type HighlightColor,
} from '../utils/highlightColors'


type SelectionPanelProps = {
  color: string;
  selection: { text: string; geometry: PdfSelectionGeometry[] } | null;
  highlightColors: readonly HighlightColor[];
  onCreateHighlight: (payload: {
    color: string;
    geometry: PdfSelectionGeometry[];
    text: string;
  }) => Promise<void>;
  onColorChange: (color: string) => void;
  onSelectionClear?: () => void;
}

export default function SelectionPanel({
  color,
  selection,
  highlightColors,
  onCreateHighlight,
  onColorChange,
  onSelectionClear,
}: SelectionPanelProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')
  const colorOptions = highlightColors.length > 0 ? highlightColors : INITIAL_HIGHLIGHT_COLORS
  const selectedSemantics = highlightColorSemantics(colorOptions, color)
  const createHighlight = async () => {
    if (!selection || selection.geometry.length === 0 || isCreating) return

    setIsCreating(true)
    setError('')
    try {
      await onCreateHighlight({ color, geometry: selection.geometry, text: selection.text.trim() })
      onSelectionClear?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the highlight.')
    } finally {
      setIsCreating(false)
    }
  }

  if (!selection) return null

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
              onClick={() => { onColorChange(option.color) }}
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
        onClick={() => void createHighlight()}
      >
        Highlight {selectedSemantics}
      </Button>
      {error && <span className="selection-error" role="alert">{error}</span>}
    </Toolbar>
  )
}
