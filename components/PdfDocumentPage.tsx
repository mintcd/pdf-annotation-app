'use client'

import { ArrowLeft, ExternalLink, FileText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from './design-system/button'
import { IconButton } from './design-system/icon-button'
import { createRemotePdfSource } from '../lib/pdfSource'
import type { PdfDocumentRow } from '../utils/pdfSync'
import PDFViewer from './PDFViewer'
import { usePdfSyncEngine } from './SyncEngineProvider'

type PdfDocumentPageProps = {
  url: string
  initialAnnotationId?: string
}

export default function PdfDocumentPage({ url, initialAnnotationId }: PdfDocumentPageProps) {
  const sync = usePdfSyncEngine()
  const [chromeVisible, setChromeVisible] = useState(true)
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
  const source = result.source
  const documentRow = useMemo(() => {
    if (!source) return null

    const documents = sync.tables.documents as readonly PdfDocumentRow[]
    return documents.find((document) => document.source_key === source.documentKey) ?? null
  }, [source, sync.tables.documents])
  const documentTitle = source ? documentRow?.title ?? source.name : 'PDF Annotation Studio'

  useEffect(() => {
    setChromeVisible(true)
  }, [source?.documentKey])

  useEffect(() => {
    if (!source || !sync.session.authenticated) return

    const previousTitle = document.title
    document.title = documentTitle

    return () => {
      document.title = previousTitle
    }
  }, [documentTitle, source, sync.session.authenticated])

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

  return (
    <main className={`pdf-document-page${chromeVisible ? '' : ' is-chrome-hidden'}`}>
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
            <strong>{documentTitle}</strong>
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

      <PDFViewer
        source={source}
        initialAnnotationId={initialAnnotationId}
        onChromeToggle={() => setChromeVisible((visible) => !visible)}
      />
    </main>
  )
}
