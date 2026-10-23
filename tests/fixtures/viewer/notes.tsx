import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import AnnotationSidebar from '../../../components/AnnotationSidebar'
import type { PdfAnnotationRow } from '../../../utils/pdfSync'

const initial: PdfAnnotationRow = {
  id: 'note-1', document_id: 'notes-fixture', page_index: 0, text: 'Selected text',
  comment: 'Original note', color: '#87ceeb', created_at: '2026-10-18T12:00:00.000Z', updated_at: '2026-10-18T12:00:00.000Z',
  position: JSON.stringify({ version: 1, kind: 'pdf-highlight', pageIndex: 0, rect: { origin: { x: 0, y: 0 }, size: { width: 10, height: 10 } }, segmentRects: [] }),
}
const saves: string[] = []

function NotesHarness() {
  const [annotation, setAnnotation] = useState(initial)
  window.notesHarness = {
    replace: (comment) => setAnnotation((current) => ({ ...current, comment })),
    saves: () => [...saves],
  }
  return <>
    <button type="button">Outside editor</button>
    <AnnotationSidebar annotations={[annotation]} highlightColors={[]} selectedId={annotation.id}
      onClose={() => undefined} onSelect={() => undefined} onColorChange={async () => undefined} onDelete={async () => undefined}
      onCommentChange={async (_row, comment) => { saves.push(comment); setAnnotation((current) => ({ ...current, comment })) }} />
  </>
}

declare global {
  interface Window { notesHarness: { replace: (comment: string) => void; saves: () => string[] } }
}
createRoot(document.getElementById('root')!).render(<NotesHarness />)
