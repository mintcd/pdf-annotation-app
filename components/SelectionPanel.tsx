import { useSelectionCapability } from '@embedpdf/plugin-selection/react'
import { Highlighter } from 'lucide-react'
import { type CSSProperties, useState } from 'react'
import { Button } from './design-system/button'
import { Toolbar, ToolbarGroup, ToolbarSeparator } from './design-system/toolbar'
import type { PdfSelectionGeometry } from '../utils/pdfSync'

export const HIGHLIGHT_COLORS = [
  { name: 'Yellow', value: '#ffcd45' },
  { name: 'Blue', value: '#87ceeb' },
  { name: 'Green', value: '#90d8a4' },
  { name: 'Rose', value: '#ff8f9c' },
] as const

type SelectionPanelProps = {
  color: string;
  documentId: string;
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
  onCreateHighlight,
  onColorChange,
}: SelectionPanelProps) {
  const { provides: selectionCapability } = useSelectionCapability()
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')

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
        {HIGHLIGHT_COLORS.map((option) => (
          <button
            key={option.value}
            className="color-swatch"
            type="button"
            role="radio"
            aria-checked={color === option.value}
            aria-label={`${option.name} highlight`}
            title={option.name}
            style={{ '--swatch-color': option.value } as CSSProperties}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onColorChange(option.value)}
          />
        ))}
      </ToolbarGroup>
      <ToolbarSeparator />
      <Button
        variant="primary"
        size="small"
        loading={isCreating}
        leadingIcon={<Highlighter aria-hidden="true" />}
        onPointerDown={(event) => event.preventDefault()}
        onClick={createHighlight}
      >
        Highlight
      </Button>
      {error && <span className="selection-error" role="alert">{error}</span>}
    </Toolbar>
  )
}
