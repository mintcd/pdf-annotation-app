'use client'

import {
  ArrowRight,
  Clock3,
  ExternalLink,
  FileSearch,
  FileText,
  Highlighter,
  Layers3,
  Lock,
  LogIn,
  LogOut,
  Menu,
  Search,
  Trash2,
  User,
  UserPlus,
  X,
} from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, type BadgeTone } from './design-system/badge'
import { Button } from './design-system/button'
import { Card } from './design-system/card'
import { IconButton } from './design-system/icon-button'
import { TextField } from './design-system/text-field'
import { createRemotePdfSource } from '../lib/pdfSource'
import type { PdfAnnotationRow, PdfDocumentRow } from '../utils/pdfSync'
import { usePdfSyncEngine } from './SyncEngineProvider'

type DocumentSummary = PdfDocumentRow & {
  annotations: PdfAnnotationRow[]
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently updated'

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function syncPresentation({
  accepted,
  error,
  isOnline,
  pending,
  phase,
  ready,
}: {
  accepted: number
  error: unknown
  isOnline: boolean
  pending: number
  phase: string
  ready: boolean
}) {
  const hasError = Boolean(error) || phase === 'error'
  const busy = phase === 'syncing' || phase === 'opening' || !ready
  const queued = pending > 0 || accepted > 0
  const label = hasError
    ? 'error'
    : busy
      ? phase === 'opening' ? 'opening' : 'syncing'
      : queued
        ? isOnline ? 'changes queued' : 'offline · changes queued'
        : 'synced'

  return {
    label,
    tone: (hasError ? 'danger' : busy || queued ? 'warning' : isOnline ? 'success' : 'neutral') as BadgeTone,
  }
}

function documentUrl(document: PdfDocumentRow): string | null {
  return document.source_type === 'remote' ? document.source_url : null
}

export default function Dashboard() {
  const sync = usePdfSyncEngine()

  if (!sync.sessionReady) {
    return <DashboardSessionLoading />
  }

  if (!sync.session.authenticated) {
    return <AuthDashboard sync={sync} />
  }

  return <AuthenticatedDashboard />
}

type DashboardSync = ReturnType<typeof usePdfSyncEngine>

function DashboardSessionLoading() {
  return (
    <div className="dashboard-shell dashboard-auth-shell">
      <main className="dashboard-auth-main">
        <section className="dashboard-auth-panel" aria-busy="true">
          <div className="dashboard-auth-brand">
            <span className="dashboard-brand-mark" aria-hidden="true"><Layers3 /></span>
            <span>
              <strong>Annotation Studio</strong>
              <small>Opening session</small>
            </span>
          </div>
          <p className="dashboard-auth-status">Loading...</p>
        </section>
      </main>
    </div>
  )
}

function AuthDashboard({ sync }: { sync: DashboardSync }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setAuthError(null)

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      })
      const body = await response.json().catch(() => ({})) as { error?: unknown }
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string'
            ? body.error
            : `Authentication failed with HTTP ${response.status}`,
        )
      }
      await sync.refreshSession()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Authentication failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="dashboard-shell dashboard-auth-shell">
      <main className="dashboard-auth-main">
        <section className="dashboard-auth-panel">
          <div className="dashboard-auth-brand">
            <span className="dashboard-brand-mark" aria-hidden="true"><Layers3 /></span>
            <span>
              <strong>Annotation Studio</strong>
              <small>Account</small>
            </span>
          </div>

          <div className="dashboard-auth-tabs" role="tablist" aria-label="Account mode">
            <button
              type="button"
              className={`dashboard-auth-tab${mode === 'login' ? ' is-selected' : ''}`}
              onClick={() => {
                setMode('login')
                setAuthError(null)
              }}
              aria-selected={mode === 'login'}
              role="tab"
            >
              <LogIn aria-hidden="true" />
              Login
            </button>
            <button
              type="button"
              className={`dashboard-auth-tab${mode === 'signup' ? ' is-selected' : ''}`}
              onClick={() => {
                setMode('signup')
                setAuthError(null)
              }}
              aria-selected={mode === 'signup'}
              role="tab"
            >
              <UserPlus aria-hidden="true" />
              Sign up
            </button>
          </div>

          <form className="dashboard-auth-form" onSubmit={submitAuth}>
            <TextField
              label="Username"
              autoComplete="username"
              value={username}
              leadingIcon={<User aria-hidden="true" />}
              required
              onChange={(event) => setUsername(event.target.value)}
            />
            <TextField
              label="Password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              leadingIcon={<Lock aria-hidden="true" />}
              required
              onChange={(event) => setPassword(event.target.value)}
            />

            {authError && (
              <p className="dashboard-auth-error" role="alert">
                {authError}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              fullWidth
              loading={submitting}
              leadingIcon={mode === 'login'
                ? <LogIn aria-hidden="true" />
                : <UserPlus aria-hidden="true" />}
            >
              {mode === 'login' ? 'Login' : 'Create account'}
            </Button>
          </form>
        </section>
      </main>
    </div>
  )
}

function AuthenticatedDashboard() {
  const sync = usePdfSyncEngine()
  const documentsTable = useMemo(() => sync.db.table('documents'), [sync.db])
  const annotationsTable = useMemo(() => sync.db.table('annotations'), [sync.db])
  const [newUrl, setNewUrl] = useState('')
  const [urlError, setUrlError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const documents = useMemo<DocumentSummary[]>(() => {
    const annotationRows = sync.tables.annotations as readonly PdfAnnotationRow[]
    return (sync.tables.documents as readonly PdfDocumentRow[])
      .map((document) => ({
        ...document,
        annotations: annotationRows
          .filter((annotation) => annotation.document_id === document.id)
          .sort((left, right) => left.page_index - right.page_index),
      }))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
  }, [sync.tables.annotations, sync.tables.documents])

  const filteredDocuments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return documents

    return documents.filter((document) => (
      document.title.toLowerCase().includes(query)
      || document.file_name.toLowerCase().includes(query)
      || document.source_url?.toLowerCase().includes(query)
      || document.annotations.some((annotation) => (
        annotation.text.toLowerCase().includes(query)
        || annotation.comment?.toLowerCase().includes(query)
      ))
    ))
  }, [documents, searchQuery])

  const selectedDocument = filteredDocuments.find((document) => document.id === selectedId)
    ?? filteredDocuments[0]
    ?? null
  const totalAnnotations = documents.reduce((total, document) => total + document.annotations.length, 0)
  const syncInfo = syncPresentation({
    accepted: sync.acceptedAwaitingConfirmationCount,
    error: sync.error,
    isOnline: sync.isOnline,
    pending: sync.pendingProposalCount,
    phase: sync.phase,
    ready: sync.ready,
  })
  const dataError = sync.error

  const openUrl = (rawUrl: string, annotationId?: string) => {
    try {
      const source = createRemotePdfSource(rawUrl)
      const params = new URLSearchParams({ url: source.originalUrl })
      if (annotationId) params.set('annotation', annotationId)
      window.location.assign(`/?${params.toString()}`)
    } catch (error) {
      setUrlError(error instanceof Error ? error.message : 'Enter a valid PDF URL.')
    }
  }

  const submitUrl = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setUrlError('')
    openUrl(newUrl)
  }

  const deleteDocument = async (document: DocumentSummary) => {
    if (!window.confirm(`Delete “${document.title}” and all of its annotations?`)) return

    setDeletingId(document.id)
    try {
      for (const annotation of document.annotations) {
        await annotationsTable.delete({ id: annotation.id })
      }
      await documentsTable.delete({ id: document.id })
      if (selectedId === document.id) setSelectedId(null)
    } finally {
      setDeletingId(null)
    }
  }

  async function signOut() {
    if (signingOut) return

    setSigningOut(true)
    setSignOutError(null)

    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      const body = await response.json().catch(() => ({})) as { error?: unknown }
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string'
            ? body.error
            : `Logout failed with HTTP ${response.status}`,
        )
      }

      await sync.refreshSession()
      setSidebarOpen(false)
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Unable to log out')
    } finally {
      setSigningOut(false)
    }
  }

  const sidebar = (
    <>
      <div className="dashboard-brand-row">
        <div className="dashboard-brand">
          <span className="dashboard-brand-mark" aria-hidden="true"><Layers3 /></span>
          <span>
            <strong>Annotation Studio</strong>
            <small>{totalAnnotations} highlights across {documents.length} PDFs</small>
          </span>
        </div>
        <IconButton
          className="dashboard-sidebar-close"
          label="Close library"
          size="small"
          onClick={() => setSidebarOpen(false)}
        >
          <X />
        </IconButton>
      </div>

      <div className="dashboard-sidebar-actions">
        <form className="dashboard-url-form" onSubmit={submitUrl}>
          <TextField
            label="Annotate a PDF"
            type="url"
            value={newUrl}
            error={urlError || undefined}
            placeholder="https://example.com/paper.pdf"
            leadingIcon={<FileText />}
            trailingElement={(
              <IconButton label="Open PDF" tone="primary" size="small" type="submit">
                <ArrowRight />
              </IconButton>
            )}
            onChange={(event) => {
              setNewUrl(event.target.value)
              if (urlError) setUrlError('')
            }}
          />
        </form>

        <TextField
          ref={searchRef}
          type="search"
          value={searchQuery}
          placeholder="Search PDFs, highlights, and notes"
          leadingIcon={<Search />}
          trailingElement={<kbd className="dashboard-shortcut">⌘ K</kbd>}
          aria-label="Search PDF library"
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </div>

      <div className="dashboard-library-heading">
        <span>LIBRARY</span>
        <Badge size="small">{filteredDocuments.length}</Badge>
      </div>

      <nav className="dashboard-library" aria-label="Annotated PDFs">
        {filteredDocuments.length === 0 ? (
          <div className="dashboard-sidebar-empty">
            {!sync.ready
              ? 'Loading your PDF library…'
              : searchQuery
                ? `No PDFs match “${searchQuery}”.`
                : 'PDFs appear here after you open them for annotation.'}
          </div>
        ) : filteredDocuments.map((document) => {
          const selected = selectedDocument?.id === document.id
          return (
            <button
              key={document.id}
              type="button"
              className={`dashboard-document-button${selected ? ' is-selected' : ''}`}
              aria-current={selected ? 'page' : undefined}
              onClick={() => {
                setSelectedId(document.id)
                setSidebarOpen(false)
              }}
            >
              <span className="dashboard-document-glyph" aria-hidden="true"><FileText /></span>
              <span className="dashboard-document-copy">
                <strong>{document.title}</strong>
                <small>{document.source_url ?? 'Local PDF'}</small>
              </span>
              <span className="dashboard-document-count">{document.annotations.length}</span>
            </button>
          )
        })}
      </nav>

      <div className="dashboard-sync">
        <div className="dashboard-sync-card">
          <span className="dashboard-sync-copy">
            <Badge tone={syncInfo.tone} size="small" dot>Sync · {syncInfo.label}</Badge>
            <span className="dashboard-account-label">Signed in as {sync.session.userId}</span>
          </span>
          <Button
            variant="ghost"
            size="small"
            loading={signingOut}
            leadingIcon={<LogOut aria-hidden="true" />}
            onClick={() => void signOut()}
          >
            Logout
          </Button>
        </div>
        {signOutError && (
          <p className="dashboard-sign-out-error" role="alert">
            {signOutError}
          </p>
        )}
      </div>
    </>
  )

  return (
    <div className="dashboard-shell">
      {dataError && (
        <div className="dashboard-error" role="alert">
          The local annotation library is unavailable: {String(dataError)}
        </div>
      )}

      {sidebarOpen && (
        <button
          className="dashboard-backdrop"
          type="button"
          aria-label="Close library"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`dashboard-sidebar${sidebarOpen ? ' is-open' : ''}`}>{sidebar}</aside>

      <main className="dashboard-main">
        <header className="dashboard-mobile-header">
          <IconButton label="Open library" size="small" onClick={() => setSidebarOpen(true)}>
            <Menu />
          </IconButton>
          <strong>Annotation Studio</strong>
          <span aria-hidden="true" />
        </header>

        {selectedDocument ? (
          <>
            <header className="dashboard-hero">
              <div className="dashboard-hero-copy">
                <p className="dashboard-eyebrow"><FileText /> Selected PDF</p>
                <h1>{selectedDocument.title}</h1>
                <p className="dashboard-hero-url" title={selectedDocument.source_url ?? undefined}>
                  {selectedDocument.source_url ?? 'This locally opened PDF is unavailable by URL.'}
                </p>
                <div className="dashboard-meta">
                  <Badge tone="blue"><Highlighter /> {selectedDocument.annotations.length} highlights</Badge>
                  <Badge><Clock3 /> Updated {formatUpdatedAt(selectedDocument.updated_at)}</Badge>
                </div>
              </div>
              <div className="dashboard-hero-actions">
                <Button
                  variant="primary"
                  leadingIcon={<ExternalLink />}
                  disabled={!documentUrl(selectedDocument)}
                  onClick={() => {
                    const url = documentUrl(selectedDocument)
                    if (url) openUrl(url)
                  }}
                >
                  Open PDF
                </Button>
                <Button
                  variant="danger"
                  leadingIcon={<Trash2 />}
                  loading={deletingId === selectedDocument.id}
                  onClick={() => void deleteDocument(selectedDocument)}
                >
                  Delete
                </Button>
              </div>
            </header>

            <section className="dashboard-content" aria-label="PDF annotations">
              <div className="dashboard-content-heading">
                <span>
                  <h2>Highlights & notes</h2>
                  <p>Everything captured in this PDF.</p>
                </span>
                <Badge>{selectedDocument.annotations.length}</Badge>
              </div>

              {selectedDocument.annotations.length === 0 ? (
                <Card className="dashboard-empty-annotations" variant="subtle">
                  <FileSearch aria-hidden="true" />
                  <h3>No highlights yet</h3>
                  <p>Open this PDF and select text to create the first annotation.</p>
                </Card>
              ) : (
                <div className="dashboard-annotation-grid">
                  {selectedDocument.annotations.map((annotation) => (
                    <Card
                      key={annotation.id}
                      className="dashboard-annotation-card"
                      variant="elevated"
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        const url = documentUrl(selectedDocument)
                        if (url) openUrl(url, annotation.id)
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        const url = documentUrl(selectedDocument)
                        if (url) openUrl(url, annotation.id)
                      }}
                    >
                      <div className="dashboard-annotation-topline">
                        <Badge tone="blue" size="small">Page {annotation.page_index + 1}</Badge>
                        <span
                          className="dashboard-highlight-color"
                          style={{ backgroundColor: annotation.color }}
                          aria-label={`Highlight color ${annotation.color}`}
                        />
                      </div>
                      <blockquote>{annotation.text || 'Selected text'}</blockquote>
                      {annotation.comment && <p className="dashboard-annotation-comment">{annotation.comment}</p>}
                      <span className="dashboard-annotation-open">Open highlight <ArrowRight /></span>
                    </Card>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="dashboard-empty">
            <Card className="dashboard-empty-card" variant="elevated" padding="large">
              <span className="dashboard-empty-visual" aria-hidden="true"><Layers3 /></span>
              <h1>{searchQuery ? 'No matching PDFs' : 'Your PDF annotation library'}</h1>
              <p>
                {searchQuery
                  ? 'Try a different title, URL, highlight, or note.'
                  : 'Paste a public PDF URL to open it, highlight text, and sync your notes.'}
              </p>
              {!searchQuery && (
                <form className="dashboard-empty-form" onSubmit={submitUrl}>
                  <TextField
                    type="url"
                    value={newUrl}
                    error={urlError || undefined}
                    placeholder="https://example.com/paper.pdf"
                    leadingIcon={<FileText />}
                    onChange={(event) => setNewUrl(event.target.value)}
                  />
                  <Button type="submit" trailingIcon={<ArrowRight />}>Open PDF</Button>
                </form>
              )}
            </Card>
          </section>
        )}
      </main>
    </div>
  )
}
