'use client'

import { ArrowLeft, ExternalLink, FileText } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from './design-system/button'
import { IconButton } from './design-system/icon-button'
import { createRemotePdfSource } from '../lib/pdfSource'
import PDFViewer from './PDFViewer'
import { usePdfSyncEngine } from './SyncEngineProvider'

type PdfDocumentPageProps = {
  url: string
  initialAnnotationId?: string
}

export default function PdfDocumentPage({ url, initialAnnotationId }: PdfDocumentPageProps) {
  const sync = usePdfSyncEngine()
  const result = useMemo(() => {
    try {
      return { source: createRemotePdfSource(url), error: '' }
    } catch (error) {
      return {
        source: null,
        error: error instanceof Error ? error.message : 'That PDF URL is not valid.',
      }
    }
  }, [url])

  if (!result.source) {
    return (
      <main className="document-error-page">
        <div className="document-error-card" role="alert">
          <span className="document-error-icon" aria-hidden="true"><FileText /></span>
          <h1>That PDF cannot be opened</h1>
          <p>{result.error}</p>
          <Button variant="primary" onClick={() => window.location.assign('/')}>
            Return to dashboard
          </Button>
        </div>
      </main>
    )
  }

  if (!sync.sessionReady) {
    return (
      <main className="document-error-page">
        <div className="document-error-card" aria-busy="true">
          <span className="document-error-icon" aria-hidden="true"><FileText /></span>
          <h1>Opening your session</h1>
          <p>Loading...</p>
        </div>
      </main>
    )
  }

  if (!sync.session.authenticated) {
    return (
      <main className="document-error-page">
        <div className="document-error-card" role="alert">
          <span className="document-error-icon" aria-hidden="true"><FileText /></span>
          <h1>Sign in to annotate PDFs</h1>
          <p>Your PDF annotations sync to your account.</p>
          <Button variant="primary" onClick={() => window.location.assign('/')}>
            Go to login
          </Button>
        </div>
      </main>
    )
  }

  const source = result.source

  return (
    <main className="pdf-document-page">
      <header className="document-header">
        <IconButton
          label="Back to dashboard"
          title="Back to dashboard"
          onClick={() => window.location.assign('/')}
        >
          <ArrowLeft aria-hidden="true" />
        </IconButton>

        <div className="document-identity">
          <span className="document-mark" aria-hidden="true"><FileText /></span>
          <span>
            <strong>{source.name}</strong>
            <small title={source.originalUrl}>{source.originalUrl}</small>
          </span>
        </div>

        <Button
          variant="secondary"
          size="small"
          leadingIcon={<ExternalLink aria-hidden="true" />}
          onClick={() => window.open(source.originalUrl, '_blank', 'noopener,noreferrer')}
        >
          Original PDF
        </Button>
      </header>

      <PDFViewer source={source} initialAnnotationId={initialAnnotationId} />
    </main>
  )
}
