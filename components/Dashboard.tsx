'use client'

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  Edit2,
  ExternalLink,
  FileSearch,
  FileText,
  Highlighter,
  Layers3,
  Lock,
  LogIn,
  LogOut,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Trash2,
  User,
  UserPlus,
  Folder,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react'
import { FaGithub } from 'react-icons/fa'
import {
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type RefObject,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Badge, type BadgeTone } from './design-system/badge'
import { Button } from './design-system/button'
import { Card } from './design-system/card'
import { IconButton } from './design-system/icon-button'
import { TextField } from './design-system/text-field'
import { AnnotationNoteEditor } from './AnnotationNoteEditor'
import { createRemotePdfSource } from '../lib/pdfSource'
import {
  pathFromGithubBlobUrl,
  type GithubDocumentEntry,
  type GithubDocumentsConfig,
  type GithubDocumentsListResponse,
  type GithubDocumentsUploadResponse,
} from '../lib/githubDocuments'
import {
  folderSnapshotFromGithubReplica,
  mergeGithubDocumentsFetch,
  readGithubDocumentsReplica,
  writeGithubDocumentsReplica,
  type GithubDocumentsReplica,
} from '../lib/githubDocumentsReplica'
import { syncTimestamp, type PdfAnnotationRow, type PdfDocumentRow } from '../utils/pdfSync'
import {
  FALLBACK_HIGHLIGHT_COLOR,
  SETTINGS_COLOR_GRID,
  normalizeHexColor,
  type HighlightColor,
} from '../utils/highlightColors'
import { useHighlightColors } from '../hooks/useHighlightColors'
import { usePdfSyncEngine } from './SyncEngineProvider'

type DocumentSummary = PdfDocumentRow & {
  annotations: PdfAnnotationRow[]
}

function documentRowFromSummary({ annotations: _annotations, ...document }: DocumentSummary): PdfDocumentRow {
  return document
}

type DocumentGroup = {
  key: string
  label: string
  documents: DocumentSummary[]
}

type EditingCommentState = {
  documentId: string
  annotationId: string
  comment: string
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

function toAbsoluteHttpUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  try {
    return new URL(trimmed).href
  } catch {
    try {
      return new URL(`https://${trimmed}`).href
    } catch {
      return null
    }
  }
}

function remotePdfOpenHref(rawUrl: string, annotationId?: string): string {
  const source = createRemotePdfSource(rawUrl)
  const params = new URLSearchParams({ url: source.originalUrl })
  if (annotationId) params.set('annotation', annotationId)
  return `/?${params.toString()}`
}

function safeRemotePdfOpenHref(rawUrl: string | null): string | null {
  if (!rawUrl) return null

  try {
    return remotePdfOpenHref(rawUrl)
  } catch {
    return null
  }
}

function documentLocation(document: PdfDocumentRow): { host: string; path: string } {
  const url = documentUrl(document)
  if (!url) return { host: 'Local PDFs', path: document.file_name }

  const githubPath = pathFromGithubBlobUrl(url)
  if (githubPath) {
    return { host: 'mintcd/documents', path: githubPath }
  }

  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname.replace(/^www\./, ''),
      path: `${parsed.pathname}${parsed.search}` || '/',
    }
  } catch {
    return { host: 'Remote PDFs', path: url }
  }
}

function groupDocumentsBySource(documents: DocumentSummary[]): DocumentGroup[] {
  const groups = new Map<string, DocumentGroup>()

  for (const document of documents) {
    const url = documentUrl(document)
    let key = 'local'
    let label = 'Local PDFs'

    if (url) {
      const githubPath = pathFromGithubBlobUrl(url)
      if (githubPath) {
        key = 'github:mintcd/documents'
        label = 'mintcd/documents'
      } else {
        try {
          const parsed = new URL(url)
          key = parsed.origin
          label = parsed.hostname.replace(/^www\./, '')
        } catch {
          key = 'remote'
          label = 'Remote PDFs'
        }
      }
    }

    const existing = groups.get(key)
    if (existing) {
      existing.documents.push(document)
    } else {
      groups.set(key, { key, label, documents: [document] })
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      documents: [...group.documents].sort((left, right) => (
        right.updated_at.localeCompare(left.updated_at)
        || left.title.localeCompare(right.title)
      )),
    }))
    .sort((left, right) => {
      if (left.key === 'local') return 1
      if (right.key === 'local') return -1
      return left.label.localeCompare(right.label)
    })
}

export default function DashboardV2() {
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
  const highlightColorsTable = useMemo(() => sync.db.table('highlight_colors'), [sync.db])
  const highlightColors = useHighlightColors()
  const [newUrl, setNewUrl] = useState('')
  const [urlError, setUrlError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [annotationActionId, setAnnotationActionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [savingTitle, setSavingTitle] = useState(false)
  const [editingComment, setEditingComment] = useState<EditingCommentState | null>(null)
  const [deleteDocumentPrompt, setDeleteDocumentPrompt] = useState<DocumentSummary | null>(null)
  const [deleteAnnotationPrompt, setDeleteAnnotationPrompt] = useState<{
    document: DocumentSummary
    annotation: PdfAnnotationRow
  } | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const [githubConfig, setGithubConfig] = useState<GithubDocumentsConfig | null>(null)
  const [githubEntries, setGithubEntries] = useState<GithubDocumentEntry[]>([])
  const [githubPath, setGithubPath] = useState('')
  const [githubLoading, setGithubLoading] = useState(false)
  const [githubError, setGithubError] = useState<string | null>(null)
  const [githubUploading, setGithubUploading] = useState(false)
  const [githubUploadError, setGithubUploadError] = useState<string | null>(null)
  const [githubUploadMessage, setGithubUploadMessage] = useState<string | null>(null)
  const githubReplicaRef = useRef<GithubDocumentsReplica | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const flushSync = (label: string) => {
    void sync.sync().catch((error) => {
      console.error(`Failed to flush ${label}`, error)
    })
  }

  const loadGithubDocuments = useCallback(async (path: string) => {
    const cached = folderSnapshotFromGithubReplica(githubReplicaRef.current, path)
    const cachedConfig = githubReplicaRef.current?.config ?? null
    if (cachedConfig) setGithubConfig(cachedConfig)
    if (cached) {
      setGithubEntries(cached.entries)
    } else {
      setGithubEntries([])
    }

    setGithubLoading(true)
    setGithubError(null)

    try {
      const params = new URLSearchParams()
      if (path) params.set('path', path)
      const response = await fetch(`/api/github/documents${params.toString() ? `?${params}` : ''}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      const body = await response.json().catch(() => ({})) as Partial<GithubDocumentsListResponse> & {
        error?: unknown
      }
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string'
            ? body.error
            : `GitHub storage returned HTTP ${response.status}`,
        )
      }

      if (!body.config || typeof body.path !== 'string' || !Array.isArray(body.entries)) {
        throw new Error('GitHub storage returned an invalid folder snapshot.')
      }

      const snapshot: GithubDocumentsListResponse = {
        config: body.config,
        path: body.path,
        entries: body.entries,
      }
      const nextReplica = mergeGithubDocumentsFetch(githubReplicaRef.current, snapshot)
      githubReplicaRef.current = nextReplica
      writeGithubDocumentsReplica(nextReplica)

      setGithubConfig(snapshot.config)
      setGithubEntries(snapshot.entries)
      setGithubPath(snapshot.path)
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : 'GitHub storage is unavailable.')
    } finally {
      setGithubLoading(false)
    }
  }, [])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSelectedId(null)
        window.requestAnimationFrame(() => searchRef.current?.focus())
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  useEffect(() => {
    const replica = readGithubDocumentsReplica()
    githubReplicaRef.current = replica
    const cachedConfig = replica?.config ?? null
    const cached = folderSnapshotFromGithubReplica(replica, githubPath)
    if (cachedConfig) setGithubConfig(cachedConfig)
    if (cached) setGithubEntries(cached.entries)
  }, [])

  useEffect(() => {
    void loadGithubDocuments(githubPath)
  }, [githubPath, loadGithubDocuments])

  const documents = useMemo<DocumentSummary[]>(() => {
    const annotationRows = sync.tables.annotations as readonly PdfAnnotationRow[]
    return (sync.tables.documents as readonly PdfDocumentRow[])
      .map((document) => ({
        ...document,
        annotations: annotationRows
          .filter((annotation) => annotation.document_id === document.id)
          .sort((left, right) => {
            if (left.page_index !== right.page_index) return left.page_index - right.page_index
            return left.created_at.localeCompare(right.created_at)
          }),
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

  const selectedDocument = selectedId
    ? documents.find((document) => document.id === selectedId) ?? null
    : null
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

  useEffect(() => {
    setEditingTitle(false)
    setDraftTitle(selectedDocument?.title ?? '')
    setEditingComment(null)
  }, [selectedDocument?.id, selectedDocument?.title])

  const openUrl = (rawUrl: string, annotationId?: string) => {
    try {
      const absoluteUrl = toAbsoluteHttpUrl(rawUrl)
      if (!absoluteUrl) throw new Error('Enter a valid PDF URL.')

      window.location.assign(remotePdfOpenHref(absoluteUrl, annotationId))
    } catch (error) {
      setUrlError(error instanceof Error ? error.message : 'Enter a valid PDF URL.')
    }
  }

  const submitUrl = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setUrlError('')
    openUrl(newUrl)
  }

  const openGithubEntry = (entry: GithubDocumentEntry) => {
    if (entry.type === 'dir') {
      setGithubUploadError(null)
      setGithubUploadMessage(null)
      setGithubPath(entry.path)
      return
    }
  }

  const refreshGithubDocuments = () => {
    void loadGithubDocuments(githubPath)
  }

  const uploadGithubPdf = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''
    if (!file || githubUploading) return

    setGithubUploadError(null)
    setGithubUploadMessage(null)
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setGithubUploadError('Choose a PDF file.')
      return
    }

    setGithubUploading(true)
    try {
      const formData = new FormData()
      formData.set('file', file)
      formData.set('path', githubPath)

      const response = await fetch('/api/github/documents', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
        body: formData,
      })
      const body = await response.json().catch(() => ({})) as Partial<GithubDocumentsUploadResponse> & {
        error?: unknown
      }
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string'
            ? body.error
            : `GitHub upload returned HTTP ${response.status}`,
        )
      }
      if (!body.cdnUrl || !body.name) {
        throw new Error('GitHub upload did not return a PDF URL.')
      }

      setGithubUploadMessage(`Uploaded ${body.name}`)
      await loadGithubDocuments(githubPath)
      openUrl(body.cdnUrl)
    } catch (error) {
      setGithubUploadError(error instanceof Error ? error.message : 'GitHub upload failed.')
    } finally {
      setGithubUploading(false)
    }
  }

  const saveDocumentTitle = async (document: DocumentSummary, title: string) => {
    const nextTitle = title.trim() || document.file_name
    setSavingTitle(true)

    try {
      await documentsTable.put({
        ...documentRowFromSummary(document),
        title: nextTitle,
        updated_at: syncTimestamp(),
      })
      flushSync('updated PDF title')
      setEditingTitle(false)
    } finally {
      setSavingTitle(false)
    }
  }

  const deleteDocument = async (document: DocumentSummary) => {
    setDeletingId(document.id)
    try {
      for (const annotation of document.annotations) {
        await annotationsTable.delete({ id: annotation.id })
      }
      await documentsTable.delete({ id: document.id })
      flushSync('deleted PDF document')
      if (selectedId === document.id) setSelectedId(null)
      setDeleteDocumentPrompt(null)
    } finally {
      setDeletingId(null)
    }
  }

  const deleteAnnotation = async (document: DocumentSummary, annotation: PdfAnnotationRow) => {
    setAnnotationActionId(annotation.id)
    try {
      await annotationsTable.delete({ id: annotation.id })
      await documentsTable.put({
        ...documentRowFromSummary(document),
        number_of_annotations: Math.max(document.annotations.length - 1, 0),
        updated_at: syncTimestamp(),
      })
      flushSync('deleted PDF annotation')
      setDeleteAnnotationPrompt(null)
    } finally {
      setAnnotationActionId(null)
    }
  }

  const saveAnnotationComment = async () => {
    if (!editingComment || !selectedDocument) return

    const annotation = selectedDocument.annotations.find((row) => row.id === editingComment.annotationId)
    if (!annotation) {
      setEditingComment(null)
      return
    }

    const nextComment = editingComment.comment.trim()
    setAnnotationActionId(annotation.id)
    try {
      await annotationsTable.put({
        ...annotation,
        comment: nextComment || null,
        updated_at: syncTimestamp(),
      })
      await documentsTable.put({
        ...documentRowFromSummary(selectedDocument),
        updated_at: syncTimestamp(),
      })
      flushSync('updated PDF annotation note')
      setEditingComment(null)
    } finally {
      setAnnotationActionId(null)
    }
  }

  const saveHighlightColor = async (input: HighlightColor, previousColor?: string) => {
    const color = normalizeHexColor(input.color)
    const semantics = input.semantics.trim()
    const previous = previousColor ? normalizeHexColor(previousColor) : null

    if (!color) throw new Error('Enter a valid hex color.')
    if (!semantics) throw new Error('Enter color semantics.')

    await highlightColorsTable.put({ color, semantics })
    if (previous && previous !== color) {
      await highlightColorsTable.delete({ color: previous })
    }
    flushSync('updated highlight color')
  }

  const deleteHighlightColor = async (color: string) => {
    if (highlightColors.data.length <= 1) {
      throw new Error('Keep at least one highlight color.')
    }

    const normalized = normalizeHexColor(color)
    if (!normalized) return

    await highlightColorsTable.delete({ color: normalized })
    flushSync('deleted highlight color')
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
      setSettingsOpen(false)
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : 'Unable to log out')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="dashboard-shell">
      {dataError && (
        <div className="dashboard-error" role="alert">
          The local annotation library is unavailable: {String(dataError)}
        </div>
      )}

      <main className="dashboard-main">
        {selectedDocument ? (
          <PdfDocumentDetail
            document={selectedDocument}
            deleting={deletingId === selectedDocument.id}
            editingComment={editingComment}
            editingTitle={editingTitle}
            draftTitle={draftTitle}
            savingAnnotationId={annotationActionId}
            savingTitle={savingTitle}
            onBack={() => setSelectedId(null)}
            onCancelTitleEdit={() => {
              setDraftTitle(selectedDocument.title)
              setEditingTitle(false)
            }}
            onDeleteAnnotation={(annotation) => {
              setDeleteAnnotationPrompt({ document: selectedDocument, annotation })
            }}
            onDeleteDocument={() => setDeleteDocumentPrompt(selectedDocument)}
            onDraftTitleChange={setDraftTitle}
            onOpenDocument={(annotationId) => {
              const url = documentUrl(selectedDocument)
              if (url) openUrl(url, annotationId)
            }}
            onSaveComment={() => void saveAnnotationComment()}
            onSaveTitle={(event) => {
              event.preventDefault()
              void saveDocumentTitle(selectedDocument, draftTitle)
            }}
            onStartCommentEdit={(annotation) => {
              setEditingComment({
                documentId: selectedDocument.id,
                annotationId: annotation.id,
                comment: annotation.comment ?? '',
              })
            }}
            onTitleEdit={() => setEditingTitle(true)}
            onUpdateDraftComment={(comment) => {
              setEditingComment((current) => current ? { ...current, comment } : current)
            }}
            onCancelCommentEdit={() => setEditingComment(null)}
          />
        ) : (
          <PdfLibrary
            documents={filteredDocuments}
            totalAnnotations={totalAnnotations}
            totalDocuments={documents.length}
            searchQuery={searchQuery}
            loading={!sync.ready}
            newUrl={newUrl}
            urlError={urlError}
            githubConfig={githubConfig}
            githubEntries={githubEntries}
            githubError={githubError}
            githubLoading={githubLoading}
            githubPath={githubPath}
            githubUploading={githubUploading}
            githubUploadError={githubUploadError}
            githubUploadMessage={githubUploadMessage}
            highlightColors={highlightColors.data}
            highlightColorsLoading={highlightColors.loading}
            highlightColorError={highlightColors.error ?? null}
            searchRef={searchRef}
            settingsOpen={settingsOpen}
            syncInfo={syncInfo}
            accountLabel={sync.session.username ?? 'Account'}
            signingOut={signingOut}
            signOutError={signOutError}
            onCloseSettings={() => setSettingsOpen(false)}
            onNewUrlChange={(value) => {
              setNewUrl(value)
              if (urlError) setUrlError('')
            }}
            onSearchChange={setSearchQuery}
            onSelectDocument={setSelectedId}
            onSettingsToggle={() => setSettingsOpen((open) => !open)}
            onSignOut={() => void signOut()}
            onSubmitUrl={submitUrl}
            onGithubEntryOpen={openGithubEntry}
            onGithubPathChange={setGithubPath}
            onGithubRefresh={refreshGithubDocuments}
            onGithubUpload={uploadGithubPdf}
            onSaveHighlightColor={saveHighlightColor}
            onDeleteHighlightColor={deleteHighlightColor}
          />
        )}
      </main>

      {deleteDocumentPrompt && (
        <ConfirmDialog
          title="Delete PDF"
          message={`Delete "${deleteDocumentPrompt.title}" and all of its annotations? This action cannot be undone.`}
          confirmLabel="Delete"
          busy={deletingId === deleteDocumentPrompt.id}
          onCancel={() => setDeleteDocumentPrompt(null)}
          onConfirm={() => deleteDocument(deleteDocumentPrompt)}
        />
      )}

      {deleteAnnotationPrompt && (
        <ConfirmDialog
          title="Delete annotation"
          message="Delete this highlight and its note? This action cannot be undone."
          confirmLabel="Delete"
          busy={annotationActionId === deleteAnnotationPrompt.annotation.id}
          onCancel={() => setDeleteAnnotationPrompt(null)}
          onConfirm={() => deleteAnnotation(deleteAnnotationPrompt.document, deleteAnnotationPrompt.annotation)}
        />
      )}
    </div>
  )
}

function PdfLibrary({
  documents,
  totalAnnotations,
  totalDocuments,
  searchQuery,
  loading,
  newUrl,
  urlError,
  githubConfig,
  githubEntries,
  githubError,
  githubLoading,
  githubPath,
  githubUploading,
  githubUploadError,
  githubUploadMessage,
  highlightColors,
  highlightColorsLoading,
  highlightColorError,
  searchRef,
  settingsOpen,
  syncInfo,
  accountLabel,
  signingOut,
  signOutError,
  onCloseSettings,
  onNewUrlChange,
  onSearchChange,
  onSelectDocument,
  onSettingsToggle,
  onSignOut,
  onSubmitUrl,
  onGithubEntryOpen,
  onGithubPathChange,
  onGithubRefresh,
  onGithubUpload,
  onSaveHighlightColor,
  onDeleteHighlightColor,
}: {
  documents: DocumentSummary[]
  totalAnnotations: number
  totalDocuments: number
  searchQuery: string
  loading: boolean
  newUrl: string
  urlError: string
  githubConfig: GithubDocumentsConfig | null
  githubEntries: GithubDocumentEntry[]
  githubError: string | null
  githubLoading: boolean
  githubPath: string
  githubUploading: boolean
  githubUploadError: string | null
  githubUploadMessage: string | null
  highlightColors: readonly HighlightColor[]
  highlightColorsLoading: boolean
  highlightColorError: string | null
  searchRef: RefObject<HTMLInputElement | null>
  settingsOpen: boolean
  syncInfo: { label: string; tone: BadgeTone }
  accountLabel: string
  signingOut: boolean
  signOutError: string | null
  onCloseSettings: () => void
  onNewUrlChange: (value: string) => void
  onSearchChange: (value: string) => void
  onSelectDocument: (id: string) => void
  onSettingsToggle: () => void
  onSignOut: () => void
  onSubmitUrl: (event: FormEvent<HTMLFormElement>) => void
  onGithubEntryOpen: (entry: GithubDocumentEntry) => void
  onGithubPathChange: (path: string) => void
  onGithubRefresh: () => void
  onGithubUpload: (event: ChangeEvent<HTMLInputElement>) => void
  onSaveHighlightColor: (input: HighlightColor, previousColor?: string) => Promise<void>
  onDeleteHighlightColor: (color: string) => Promise<void>
}) {
  const groups = useMemo(() => groupDocumentsBySource(documents), [documents])
  const hasDocuments = documents.length > 0

  return (
    <section className="dashboard-library-view" aria-label="All annotated PDFs">
      <div className="dashboard-library-view-inner">
        <header className="dashboard-library-hero">
          <div className="dashboard-library-topbar">
            <div className="dashboard-library-brand">
              <span className="dashboard-brand-mark" aria-hidden="true"><Layers3 /></span>
              <div>
                <h1 className="dashboard-library-title">All PDFs</h1>
                <p className="dashboard-library-summary">
                  {searchQuery
                    ? `${documents.length} result${documents.length === 1 ? '' : 's'} matching "${searchQuery}"`
                    : `${totalDocuments} PDF${totalDocuments === 1 ? '' : 's'} with ${totalAnnotations} highlight${totalAnnotations === 1 ? '' : 's'}`}
                </p>
              </div>
            </div>

            <div className="dashboard-settings">
              <IconButton
                className="dashboard-settings-button"
                label="Open settings"
                aria-expanded={settingsOpen}
                title="Settings"
                onClick={onSettingsToggle}
              >
                <Settings />
              </IconButton>

              {settingsOpen && (
                <DashboardSettingsWindow
                  accountLabel={accountLabel}
                  signOutError={signOutError}
                  signingOut={signingOut}
                  syncInfo={syncInfo}
                  highlightColors={highlightColors}
                  highlightColorsLoading={highlightColorsLoading}
                  highlightColorError={highlightColorError}
                  onClose={onCloseSettings}
                  onSignOut={onSignOut}
                  onSaveHighlightColor={onSaveHighlightColor}
                  onDeleteHighlightColor={onDeleteHighlightColor}
                />
              )}
            </div>
          </div>

          <div className="dashboard-library-controls">
            <form className="dashboard-library-url-form" onSubmit={onSubmitUrl}>
              <div className={`dashboard-control dashboard-url-control${urlError ? ' is-invalid' : ''}`}>
                <FileText aria-hidden="true" />
                <input
                  className="dashboard-input"
                  type="url"
                  value={newUrl}
                  placeholder="Paste a PDF URL"
                  aria-label="PDF URL to annotate"
                  aria-invalid={urlError ? true : undefined}
                  onChange={(event) => onNewUrlChange(event.target.value)}
                />
                <IconButton label="Open PDF" tone="primary" size="small" type="submit">
                  <ArrowRight />
                </IconButton>
              </div>
              {urlError && <p className="dashboard-field-error" role="alert">{urlError}</p>}
            </form>

            <label className="dashboard-control dashboard-library-search">
              <Search aria-hidden="true" />
              <input
                ref={searchRef}
                className="dashboard-input"
                type="search"
                value={searchQuery}
                placeholder="Search PDFs, highlights, and notes"
                aria-label="Search PDF annotations"
                onChange={(event) => onSearchChange(event.target.value)}
              />
              <kbd className="dashboard-shortcut">Ctrl K</kbd>
            </label>

            <div className="dashboard-library-sync" title={`Sync status: ${syncInfo.label}`}>
              <Badge tone={syncInfo.tone} size="small" dot>
                Sync · {syncInfo.label}
              </Badge>
            </div>
          </div>
        </header>

        <GithubStoragePanel
          config={githubConfig}
          entries={githubEntries}
          error={githubError}
          loading={githubLoading}
          path={githubPath}
          uploading={githubUploading}
          uploadError={githubUploadError}
          uploadMessage={githubUploadMessage}
          onEntryOpen={onGithubEntryOpen}
          onPathChange={onGithubPathChange}
          onRefresh={onGithubRefresh}
          onUpload={onGithubUpload}
        />

        {!hasDocuments ? (
          <LibraryEmptyState searchQuery={searchQuery} loading={loading} />
        ) : (
          <div className="dashboard-page-groups">
            {groups.map((group) => (
              <section key={group.key} className="dashboard-site-section">
                <div className="dashboard-site-heading">
                  <span className="dashboard-site-label">
                    <span className="dashboard-site-logo dashboard-site-logo-fallback" aria-hidden="true">
                      <FileText />
                    </span>
                    <h2 className="dashboard-site-title">{group.label}</h2>
                  </span>
                  <span className="dashboard-site-count">
                    {group.documents.length} PDF{group.documents.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="dashboard-page-grid">
                  {group.documents.map((document) => {
                    const location = documentLocation(document)
                    const notePreview = document.annotations
                      .map((annotation) => annotation.comment?.replace(/\s+/g, ' ').trim())
                      .find(Boolean)

                    return (
                      <button
                        key={document.id}
                        type="button"
                        className="dashboard-page-card"
                        onClick={() => onSelectDocument(document.id)}
                        aria-label={`Open annotations for ${document.title}`}
                      >
                        <span className="dashboard-page-card-top">
                          <span className="dashboard-page-card-icon" aria-hidden="true">
                            <FileText />
                          </span>
                          <span className="dashboard-page-card-count">
                            {document.annotations.length}
                          </span>
                        </span>
                        <span className="dashboard-page-card-title">{document.title}</span>
                        <span className="dashboard-page-card-url" title={document.source_url ?? document.file_name}>
                          {location.path}
                        </span>
                        {notePreview && (
                          <span className="dashboard-page-card-note">
                            {notePreview}
                          </span>
                        )}
                        <span className="dashboard-page-card-footer">
                          <span className="dashboard-page-card-date">
                            <Clock3 aria-hidden="true" />
                            {formatUpdatedAt(document.updated_at)}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function GithubStoragePanel({
  config,
  entries,
  error,
  loading,
  path,
  uploading,
  uploadError,
  uploadMessage,
  onEntryOpen,
  onPathChange,
  onRefresh,
  onUpload,
}: {
  config: GithubDocumentsConfig | null
  entries: GithubDocumentEntry[]
  error: string | null
  loading: boolean
  path: string
  uploading: boolean
  uploadError: string | null
  uploadMessage: string | null
  onEntryOpen: (entry: GithubDocumentEntry) => void
  onPathChange: (path: string) => void
  onRefresh: () => void
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  const visibleEntries = entries.filter((entry) => entry.type === 'dir' || entry.isPdf)
  const breadcrumbs = githubBreadcrumbs(path, config?.repo ?? 'documents')
  const canUpload = Boolean(config?.canUpload)
  const owner = config?.owner ?? 'mintcd'
  const repo = config?.repo ?? 'documents'
  const branch = config?.branch ?? 'main'

  return (
    <section className="dashboard-github-storage" aria-labelledby="dashboard-github-title">
      <div className="dashboard-github-header">
        <div className="dashboard-github-heading">
          <span className="dashboard-github-mark" aria-hidden="true">
            <FaGithub />
          </span>
          <div>
            <h2 id="dashboard-github-title">GitHub storage</h2>
            <p>{owner}/{repo} · {branch}</p>
          </div>
        </div>

        <div className="dashboard-github-actions">
          <IconButton
            label="Refresh GitHub files"
            title="Refresh"
            size="small"
            disabled={loading}
            onClick={onRefresh}
          >
            <RefreshCw aria-hidden="true" />
          </IconButton>
          <label
            className={`dashboard-github-upload${!canUpload || uploading ? ' is-disabled' : ''}`}
            aria-disabled={!canUpload || uploading}
            title={'Upload PDF'}
          >
            <Upload aria-hidden="true" />
            <span>{uploading ? 'Uploading' : 'Upload PDF'}</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              disabled={!canUpload || uploading}
              onChange={onUpload}
            />
          </label>
        </div>
      </div>

      {/* <div className="dashboard-github-selectors" aria-label="GitHub repository">
        <label>
          <span>Account</span>
          <select value={owner} disabled>
            <option value={owner}>{owner}</option>
          </select>
        </label>
        <label>
          <span>Repository</span>
          <select value={repo} disabled>
            <option value={repo}>{repo}</option>
          </select>
        </label>
      </div> */}

      <nav className="dashboard-github-breadcrumbs" aria-label="GitHub folder">
        {breadcrumbs.map((crumb, index) => (
          <button
            key={crumb.path || 'root'}
            type="button"
            className={index === breadcrumbs.length - 1 ? 'is-current' : ''}
            disabled={index === breadcrumbs.length - 1}
            onClick={() => onPathChange(crumb.path)}
          >
            {index === 0 ? <Folder aria-hidden="true" /> : null}
            <span>{crumb.label}</span>
          </button>
        ))}
      </nav>

      {(error || uploadError || uploadMessage || !canUpload) && (
        <div className="dashboard-github-statuses">
          {error && <p className="dashboard-github-status is-error" role="alert">{error}</p>}
          {uploadError && <p className="dashboard-github-status is-error" role="alert">{uploadError}</p>}
          {uploadMessage && <p className="dashboard-github-status is-success">{uploadMessage}</p>}
        </div>
      )}

      <div className="dashboard-github-list" aria-busy={loading}>
        {loading && visibleEntries.length === 0 ? (
          <div className="dashboard-github-empty">Loading GitHub files...</div>
        ) : visibleEntries.length === 0 ? (
          <div className="dashboard-github-empty">No PDF files here</div>
        ) : (
          visibleEntries.map((entry) => {
            const pdfHref = entry.type === 'file' ? safeRemotePdfOpenHref(entry.cdnUrl) : null
            const entryContent = (
              <>
                <span className="dashboard-github-entry-icon" aria-hidden="true">
                  {entry.type === 'dir' ? <Folder /> : <FileText />}
                </span>
                <span className="dashboard-github-entry-main">
                  <strong title={entry.path}>{entry.name}</strong>
                  <small>
                    {entry.type === 'dir' ? 'Folder' : formatFileSize(entry.size)}
                  </small>
                </span>
                {entry.type === 'file' && <ExternalLink aria-hidden="true" />}
              </>
            )

            if (pdfHref) {
              return (
                <a
                  key={entry.path}
                  className={`dashboard-github-entry is-${entry.type}`}
                  href={pdfHref}
                >
                  {entryContent}
                </a>
              )
            }

            return (
              <button
                key={entry.path}
                type="button"
                className={`dashboard-github-entry is-${entry.type}`}
                disabled={entry.type === 'file'}
                onClick={() => onEntryOpen(entry)}
              >
                {entryContent}
              </button>
            )
          })
        )}
      </div>
    </section>
  )
}

function githubBreadcrumbs(path: string, rootLabel: string): { label: string; path: string }[] {
  const parts = path.split('/').filter(Boolean)
  const crumbs = [{ label: rootLabel, path: '' }]
  let current = ''

  for (const part of parts) {
    current = current ? `${current}/${part}` : part
    crumbs.push({ label: part, path: current })
  }

  return crumbs
}

function formatFileSize(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'PDF'
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB']
  let size = value / 1024
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function DashboardSettingsWindow({
  accountLabel,
  signOutError,
  signingOut,
  syncInfo,
  highlightColors,
  highlightColorsLoading,
  highlightColorError,
  onClose,
  onSignOut,
  onSaveHighlightColor,
  onDeleteHighlightColor,
}: {
  accountLabel: string
  signOutError: string | null
  signingOut: boolean
  syncInfo: { label: string; tone: BadgeTone }
  highlightColors: readonly HighlightColor[]
  highlightColorsLoading: boolean
  highlightColorError: string | null
  onClose: () => void
  onSignOut: () => void
  onSaveHighlightColor: (input: HighlightColor, previousColor?: string) => Promise<void>
  onDeleteHighlightColor: (color: string) => Promise<void>
}) {
  const [draftColor, setDraftColor] = useState(FALLBACK_HIGHLIGHT_COLOR)
  const [draftSemantics, setDraftSemantics] = useState('')
  const [editingColor, setEditingColor] = useState<string | null>(null)
  const [busyColor, setBusyColor] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const normalizedDraftColor = normalizeHexColor(draftColor)
  const previewColor = normalizedDraftColor ?? FALLBACK_HIGHLIGHT_COLOR
  const isEditing = editingColor !== null
  const deleteDisabled = highlightColors.length <= 1 || busyColor !== null

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const resetDraft = () => {
    setDraftColor(FALLBACK_HIGHLIGHT_COLOR)
    setDraftSemantics('')
    setEditingColor(null)
    setFormError(null)
  }

  const editColor = (color: HighlightColor) => {
    setDraftColor(color.color)
    setDraftSemantics(color.semantics)
    setEditingColor(color.color)
    setFormError(null)
  }

  const submitColor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const color = normalizeHexColor(draftColor)
    const semantics = draftSemantics.trim()
    if (!color) {
      setFormError('Enter a valid hex color.')
      return
    }
    if (!semantics) {
      setFormError('Enter color semantics.')
      return
    }
    if (
      highlightColors.some((item) =>
        item.color === color && item.color !== editingColor,
      )
    ) {
      setFormError('That color already exists.')
      return
    }

    setBusyColor(editingColor ?? color)
    setFormError(null)
    try {
      await onSaveHighlightColor({ color, semantics }, editingColor ?? undefined)
      resetDraft()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to save color.')
    } finally {
      setBusyColor(null)
    }
  }

  const deleteColor = async (color: string) => {
    if (deleteDisabled) return

    setBusyColor(color)
    setFormError(null)
    try {
      await onDeleteHighlightColor(color)
      if (editingColor === color) resetDraft()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to delete color.')
    } finally {
      setBusyColor(null)
    }
  }

  return (
    <>
      <button
        type="button"
        className="dashboard-settings-scrim"
        aria-label="Close settings"
        onClick={onClose}
      />
      <div
        className="dashboard-settings-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-settings-title"
      >
        <header className="dashboard-settings-window-header">
          <div>
            <h2 id="dashboard-settings-title" className="dashboard-settings-window-title">Settings</h2>
            <p className="dashboard-settings-window-subtitle">Dashboard</p>
          </div>
          <IconButton
            className="dashboard-settings-close"
            label="Close settings"
            size="small"
            title="Close"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </IconButton>
        </header>

        <section className="dashboard-settings-account" aria-label="Account">
          <div className="dashboard-settings-user">
            <User aria-hidden="true" />
            <span>
              <span className="dashboard-settings-label">Signed in</span>
              <span className="dashboard-settings-value">{accountLabel}</span>
            </span>
          </div>
          <div className="dashboard-settings-sync">
            <Badge tone={syncInfo.tone} size="small" dot>Sync · {syncInfo.label}</Badge>
          </div>
          <Button
            variant="secondary"
            size="small"
            fullWidth
            loading={signingOut}
            leadingIcon={<LogOut aria-hidden="true" />}
            onClick={onSignOut}
          >
            Logout
          </Button>
          {signOutError && (
            <p className="dashboard-sign-out-error dashboard-settings-error" role="alert">
              {signOutError}
            </p>
          )}
        </section>

        <section className="dashboard-settings-colors" aria-labelledby="dashboard-settings-colors-title">
          <div className="dashboard-settings-section-heading">
            <h3 id="dashboard-settings-colors-title">Highlight colors</h3>
            <span>{highlightColors.length}</span>
          </div>

          <div className="dashboard-settings-color-list" aria-busy={highlightColorsLoading}>
            {highlightColorsLoading ? (
              <p className="dashboard-settings-muted">Loading colors...</p>
            ) : highlightColors.length === 0 ? (
              <p className="dashboard-settings-muted">No colors saved.</p>
            ) : (
              highlightColors.map((color) => (
                <div key={color.color} className="dashboard-settings-color-row">
                  <span
                    className="dashboard-settings-color-swatch"
                    style={{ '--highlight-color': color.color } as CSSProperties}
                    aria-hidden="true"
                  />
                  <span className="dashboard-settings-color-copy">
                    <span className="dashboard-settings-color-name">{color.semantics}</span>
                    <span className="dashboard-settings-color-hex">{color.color}</span>
                  </span>
                  <IconButton
                    className="dashboard-settings-row-action"
                    label={`Edit ${color.semantics}`}
                    title="Edit"
                    size="small"
                    disabled={busyColor !== null}
                    onClick={() => editColor(color)}
                  >
                    <Edit2 aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    className="dashboard-settings-row-action"
                    label={`Delete ${color.semantics}`}
                    title={highlightColors.length <= 1 ? 'Keep at least one color' : 'Delete'}
                    size="small"
                    disabled={deleteDisabled}
                    onClick={() => void deleteColor(color.color)}
                  >
                    <Trash2 aria-hidden="true" />
                  </IconButton>
                </div>
              ))
            )}
          </div>

          <form className="dashboard-settings-color-form" onSubmit={(event) => void submitColor(event)}>
            <div className="dashboard-settings-picker-grid" role="grid" aria-label="Color choices">
              {SETTINGS_COLOR_GRID.map((color) => {
                const selected = normalizedDraftColor === color
                return (
                  <button
                    key={color}
                    type="button"
                    className={`dashboard-settings-picker-swatch${selected ? ' is-selected' : ''}`}
                    style={{ '--highlight-color': color } as CSSProperties}
                    aria-label={`Choose ${color}`}
                    aria-pressed={selected}
                    onClick={() => setDraftColor(color)}
                  >
                    {selected && <Check aria-hidden="true" />}
                  </button>
                )
              })}
            </div>

            <div className="dashboard-settings-color-fields">
              <label className="dashboard-settings-field dashboard-settings-color-field">
                <span>Color</span>
                <span className="dashboard-settings-hex-row">
                  <input
                    type="color"
                    className="dashboard-settings-native-color"
                    value={previewColor}
                    aria-label="Pick highlight color"
                    onChange={(event) => setDraftColor(event.target.value)}
                  />
                  <input
                    className="dashboard-input dashboard-settings-hex-input"
                    value={draftColor}
                    placeholder="#87ceeb"
                    spellCheck={false}
                    aria-invalid={normalizedDraftColor === null}
                    onBlur={() => {
                      if (normalizedDraftColor) setDraftColor(normalizedDraftColor)
                    }}
                    onChange={(event) => setDraftColor(event.target.value)}
                  />
                </span>
              </label>

              <label className="dashboard-settings-field">
                <span>Semantics</span>
                <input
                  className="dashboard-input dashboard-settings-text-input"
                  value={draftSemantics}
                  placeholder="Reference"
                  onChange={(event) => setDraftSemantics(event.target.value)}
                />
              </label>
            </div>

            {(formError || highlightColorError) && (
              <p className="dashboard-settings-error" role="alert">
                {formError || highlightColorError}
              </p>
            )}

            <div className="dashboard-settings-actions">
              {isEditing && (
                <Button
                  variant="secondary"
                  size="small"
                  disabled={busyColor !== null}
                  leadingIcon={<X aria-hidden="true" />}
                  onClick={resetDraft}
                >
                  Cancel
                </Button>
              )}
              <Button
                type="submit"
                size="small"
                loading={busyColor !== null}
                leadingIcon={isEditing ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
              >
                {isEditing ? 'Save color' : 'Add color'}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </>
  )
}

function PdfDocumentDetail({
  document,
  deleting,
  editingComment,
  editingTitle,
  draftTitle,
  savingAnnotationId,
  savingTitle,
  onBack,
  onCancelCommentEdit,
  onCancelTitleEdit,
  onDeleteAnnotation,
  onDeleteDocument,
  onDraftTitleChange,
  onOpenDocument,
  onSaveComment,
  onSaveTitle,
  onStartCommentEdit,
  onTitleEdit,
  onUpdateDraftComment,
}: {
  document: DocumentSummary
  deleting: boolean
  editingComment: EditingCommentState | null
  editingTitle: boolean
  draftTitle: string
  savingAnnotationId: string | null
  savingTitle: boolean
  onBack: () => void
  onCancelCommentEdit: () => void
  onCancelTitleEdit: () => void
  onDeleteAnnotation: (annotation: PdfAnnotationRow) => void
  onDeleteDocument: () => void
  onDraftTitleChange: (value: string) => void
  onOpenDocument: (annotationId?: string) => void
  onSaveComment: () => void
  onSaveTitle: (event: FormEvent<HTMLFormElement>) => void
  onStartCommentEdit: (annotation: PdfAnnotationRow) => void
  onTitleEdit: () => void
  onUpdateDraftComment: (comment: string) => void
}) {
  const url = documentUrl(document)

  return (
    <>
      <header className="dashboard-page-hero">
        <div className="dashboard-page-hero-inner">
          <button type="button" className="dashboard-detail-back" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            All PDFs
          </button>

          <div className="dashboard-hero-layout">
            <div className="dashboard-hero-copy">
              <div className="dashboard-hero-title-row">
                <span className="dashboard-hero-logo dashboard-hero-logo-fallback" aria-hidden="true">
                  <FileText />
                </span>
                <div className="dashboard-hero-title-wrap">
                  {editingTitle ? (
                    <form className="dashboard-title-edit-form" onSubmit={onSaveTitle}>
                      <input
                        className="dashboard-input dashboard-title-input"
                        value={draftTitle}
                        onChange={(event) => onDraftTitleChange(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            onCancelTitleEdit()
                          }
                        }}
                        aria-label="PDF title"
                        disabled={savingTitle}
                        autoFocus
                      />
                      <IconButton
                        className="dashboard-title-action"
                        label="Save PDF title"
                        title="Save title"
                        type="submit"
                        disabled={savingTitle}
                      >
                        <Check aria-hidden="true" />
                      </IconButton>
                      <IconButton
                        className="dashboard-title-action"
                        label="Cancel title edit"
                        title="Cancel"
                        disabled={savingTitle}
                        onClick={onCancelTitleEdit}
                      >
                        <X aria-hidden="true" />
                      </IconButton>
                    </form>
                  ) : (
                    <>
                      <h1 className="dashboard-hero-title">{document.title}</h1>
                      <IconButton
                        className="dashboard-title-edit-button"
                        label={`Edit title for ${document.title}`}
                        title="Edit title"
                        size="small"
                        onClick={onTitleEdit}
                      >
                        <Edit2 aria-hidden="true" />
                      </IconButton>
                    </>
                  )}
                </div>
              </div>
              {url ? (
                <a
                  className="dashboard-hero-url"
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  title={url}
                >
                  <span>{url}</span>
                </a>
              ) : (
                <p className="dashboard-hero-url" title={document.file_name}>
                  <span>{document.file_name}</span>
                </p>
              )}
              <div className="dashboard-meta-row">
                <span className="dashboard-meta-chip">
                  <Highlighter aria-hidden="true" />
                  {document.annotations.length} highlight{document.annotations.length === 1 ? '' : 's'}
                </span>
                <span className="dashboard-meta-chip">
                  <Clock3 aria-hidden="true" />
                  Updated {formatUpdatedAt(document.updated_at)}
                </span>
              </div>
            </div>

            <div className="dashboard-hero-actions">
              <Button
                variant="primary"
                disabled={!url}
                trailingIcon={<ExternalLink aria-hidden="true" />}
                onClick={() => onOpenDocument()}
              >
                Open PDF
              </Button>
              <Button
                variant="danger"
                loading={deleting}
                leadingIcon={<Trash2 aria-hidden="true" />}
                onClick={onDeleteDocument}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="dashboard-content">
        <div className="dashboard-content-inner">
          <div className="dashboard-content-heading">
            <div>
              <h2 className="dashboard-content-title">Highlights & notes</h2>
              <p className="dashboard-content-description">Everything captured in this PDF.</p>
            </div>
            <span className="dashboard-result-count">{document.annotations.length}</span>
          </div>

          {document.annotations.length === 0 ? (
            <Card className="dashboard-empty-annotations" variant="subtle">
              <FileSearch aria-hidden="true" />
              <h3>No highlights yet</h3>
              <p>Open this PDF and select text to create the first annotation.</p>
            </Card>
          ) : (
            <div className="dashboard-detail-annotation-list">
              {document.annotations.map((annotation) => (
                <AnnotationDetailCard
                  key={annotation.id}
                  annotation={annotation}
                  disabled={!url}
                  editingComment={editingComment?.documentId === document.id
                    && editingComment.annotationId === annotation.id
                    ? editingComment
                    : null}
                  saving={savingAnnotationId === annotation.id}
                  onCancelCommentEdit={onCancelCommentEdit}
                  onDelete={() => onDeleteAnnotation(annotation)}
                  onOpen={() => onOpenDocument(annotation.id)}
                  onSaveComment={onSaveComment}
                  onStartCommentEdit={() => onStartCommentEdit(annotation)}
                  onUpdateDraftComment={onUpdateDraftComment}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function AnnotationDetailCard({
  annotation,
  disabled,
  editingComment,
  saving,
  onCancelCommentEdit,
  onDelete,
  onOpen,
  onSaveComment,
  onStartCommentEdit,
  onUpdateDraftComment,
}: {
  annotation: PdfAnnotationRow
  disabled: boolean
  editingComment: EditingCommentState | null
  saving: boolean
  onCancelCommentEdit: () => void
  onDelete: () => void
  onOpen: () => void
  onSaveComment: () => void
  onStartCommentEdit: () => void
  onUpdateDraftComment: (comment: string) => void
}) {
  return (
    <article className="dashboard-detail-annotation-card">
      <div className="dashboard-annotation-topline">
        <Badge tone="blue" size="small">Page {annotation.page_index + 1}</Badge>
        <span
          className="dashboard-highlight-color"
          style={{ '--highlight-color': annotation.color } as CSSProperties}
          aria-label={`Highlight color ${annotation.color}`}
        />
      </div>

      <blockquote>{annotation.text || 'Selected text'}</blockquote>

      {editingComment ? (
        <form
          className="dashboard-comment-edit-form"
          onSubmit={(event) => {
            event.preventDefault()
            onSaveComment()
          }}
        >
          <AnnotationNoteEditor
            value={editingComment.comment}
            label={`Note for page ${annotation.page_index + 1}`}
            placeholder="Add a note"
            disabled={saving}
            autoFocus
            onChange={onUpdateDraftComment}
            onEscape={onCancelCommentEdit}
          />
          <div className="dashboard-comment-actions">
            <Button
              type="button"
              variant="secondary"
              size="small"
              disabled={saving}
              leadingIcon={<X aria-hidden="true" />}
              onClick={onCancelCommentEdit}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="small"
              loading={saving}
              leadingIcon={<Check aria-hidden="true" />}
            >
              Save note
            </Button>
          </div>
        </form>
      ) : annotation.comment ? (
        <AnnotationNoteEditor
          className="dashboard-annotation-comment"
          value={annotation.comment}
          editing={false}
          label={`Note for page ${annotation.page_index + 1}`}
          onChange={() => undefined}
          onStartEditing={onStartCommentEdit}
        />
      ) : null}

      <div className="dashboard-annotation-actions">
        <button
          type="button"
          className="dashboard-inline-action"
          disabled={disabled}
          onClick={onOpen}
        >
          <ExternalLink aria-hidden="true" />
          Open highlight
        </button>
        <button
          type="button"
          className="dashboard-inline-action"
          onClick={onStartCommentEdit}
        >
          <MessageSquare aria-hidden="true" />
          {annotation.comment ? 'Edit note' : 'Add note'}
        </button>
        <button
          type="button"
          className="dashboard-inline-action dashboard-inline-action-danger"
          disabled={saving}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" />
          Delete
        </button>
      </div>
    </article>
  )
}

function LibraryEmptyState({
  searchQuery,
  loading,
}: {
  searchQuery: string
  loading: boolean
}) {
  return (
    <section className="dashboard-empty">
      <Card className="dashboard-empty-card" variant="elevated" padding="large">
        <span className="dashboard-empty-visual" aria-hidden="true">
          {searchQuery ? <Search /> : <FileText />}
        </span>
        <h2 className="dashboard-empty-title">
          {searchQuery ? 'Nothing found' : 'No annotated PDFs yet'}
        </h2>
        <p className="dashboard-empty-description">
          {searchQuery
            ? `No PDF, highlight, or note matches "${searchQuery}".`
            : loading
              ? 'Loading your PDF library...'
              : 'Paste a PDF URL to begin.'}
        </p>
      </Card>
    </section>
  )
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string
  message: string
  confirmLabel: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  return (
    <div className="dashboard-dialog-layer" role="presentation">
      <button
        type="button"
        className="dashboard-dialog-scrim"
        aria-label="Cancel"
        disabled={busy}
        onClick={onCancel}
      />
      <section
        className="dashboard-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-confirm-title"
      >
        <h2 id="dashboard-confirm-title">{title}</h2>
        <p>{message}</p>
        <div className="dashboard-dialog-actions">
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            leadingIcon={<Trash2 aria-hidden="true" />}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  )
}
