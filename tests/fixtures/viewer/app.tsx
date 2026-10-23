import { createRoot } from 'react-dom/client'
import PDFViewer from '../../../components/PDFViewer'
import '../../../components/design-system/styles/tokens.css'
import 'pdfjs-dist/web/pdf_viewer.css'
import '../../../styles/global.css'
import { createBrowserPdf } from './sourcePdf'
import { initializeSyncStub, receiveAnnotationPatch, stubSnapshot } from './syncStub'

declare global {
  interface Window {
    pdfAppHarness: { snapshot: typeof stubSnapshot; receiveAnnotationPatch: typeof receiveAnnotationPatch }
  }
}

const documentKey = 'react-fixture-document'
const seedSavedHighlight = new URLSearchParams(location.search).has('seed')
initializeSyncStub(documentKey, seedSavedHighlight)
const bytes = await createBrowserPdf()
const source = { kind: 'local' as const, documentKey, name: 'react-integration.pdf', buffer: new Uint8Array(bytes).buffer }
window.pdfAppHarness = { snapshot: stubSnapshot, receiveAnnotationPatch }
createRoot(document.getElementById('root')!).render(
  <main className="pdf-document-page">
    <PDFViewer source={source} initialAnnotationId={seedSavedHighlight ? 'existing-v1' : undefined} />
  </main>,
)
