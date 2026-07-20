import {
  type GithubDocumentEntry,
  type GithubDocumentsConfig,
  type GithubDocumentsListResponse,
} from './githubDocuments'

const GITHUB_DOCUMENTS_REPLICA_KEY = 'pdf-annotation:github-documents-replica:v1'
const GITHUB_DOCUMENTS_REPLICA_VERSION = 1

export type GithubDocumentsFolderSnapshot = {
  path: string
  entries: GithubDocumentEntry[]
  fetchedAt: string
}

export type GithubDocumentsReplica = {
  version: 1
  config: GithubDocumentsConfig | null
  folders: Record<string, GithubDocumentsFolderSnapshot>
  updatedAt: string
}

export function createEmptyGithubDocumentsReplica(): GithubDocumentsReplica {
  return {
    version: GITHUB_DOCUMENTS_REPLICA_VERSION,
    config: null,
    folders: {},
    updatedAt: new Date(0).toISOString(),
  }
}

export function readGithubDocumentsReplica(): GithubDocumentsReplica | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(GITHUB_DOCUMENTS_REPLICA_KEY)
    if (!raw) return null
    return normalizeGithubDocumentsReplica(JSON.parse(raw))
  } catch (error) {
    console.warn('Failed to read GitHub documents replica', error)
    return null
  }
}

export function writeGithubDocumentsReplica(replica: GithubDocumentsReplica): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(GITHUB_DOCUMENTS_REPLICA_KEY, JSON.stringify(replica))
  } catch (error) {
    console.warn('Failed to write GitHub documents replica', error)
  }
}

export function folderSnapshotFromGithubReplica(
  replica: GithubDocumentsReplica | null,
  path: string,
): GithubDocumentsFolderSnapshot | null {
  return replica?.folders[normalizeReplicaPath(path)] ?? null
}

export function mergeGithubDocumentsFetch(
  current: GithubDocumentsReplica | null,
  response: GithubDocumentsListResponse,
): GithubDocumentsReplica {
  const now = new Date().toISOString()
  const path = normalizeReplicaPath(response.path)
  const base = current && sameGithubDocumentsConfig(current.config, response.config)
    ? current
    : createEmptyGithubDocumentsReplica()

  return {
    version: GITHUB_DOCUMENTS_REPLICA_VERSION,
    config: response.config,
    folders: {
      ...base.folders,
      [path]: {
        path,
        entries: response.entries,
        fetchedAt: now,
      },
    },
    updatedAt: now,
  }
}

function normalizeGithubDocumentsReplica(value: unknown): GithubDocumentsReplica | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<GithubDocumentsReplica>
  if (record.version !== GITHUB_DOCUMENTS_REPLICA_VERSION) return null
  if (!record.folders || typeof record.folders !== 'object') return null

  const folders: Record<string, GithubDocumentsFolderSnapshot> = {}
  for (const [path, snapshot] of Object.entries(record.folders)) {
    if (!snapshot || typeof snapshot !== 'object') continue
    const folder = snapshot as Partial<GithubDocumentsFolderSnapshot>
    if (!Array.isArray(folder.entries)) continue
    folders[normalizeReplicaPath(path)] = {
      path: normalizeReplicaPath(folder.path ?? path),
      entries: folder.entries.filter(isGithubDocumentEntry),
      fetchedAt: typeof folder.fetchedAt === 'string' ? folder.fetchedAt : new Date(0).toISOString(),
    }
  }

  return {
    version: GITHUB_DOCUMENTS_REPLICA_VERSION,
    config: isGithubDocumentsConfig(record.config) ? record.config : null,
    folders,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
  }
}

function normalizeReplicaPath(value: string): string {
  return value.split('/').filter(Boolean).join('/')
}

function sameGithubDocumentsConfig(
  left: GithubDocumentsConfig | null,
  right: GithubDocumentsConfig | null,
): boolean {
  return Boolean(left && right)
    && left.owner === right.owner
    && left.repo === right.repo
    && left.branch === right.branch
    && left.cdnUrl === right.cdnUrl
}

function isGithubDocumentsConfig(value: unknown): value is GithubDocumentsConfig {
  if (!value || typeof value !== 'object') return false
  const config = value as Partial<GithubDocumentsConfig>
  return typeof config.owner === 'string'
    && typeof config.repo === 'string'
    && typeof config.branch === 'string'
    && typeof config.cdnUrl === 'string'
    && typeof config.canUpload === 'boolean'
}

function isGithubDocumentEntry(value: unknown): value is GithubDocumentEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<GithubDocumentEntry>
  return (entry.type === 'dir' || entry.type === 'file')
    && typeof entry.name === 'string'
    && typeof entry.path === 'string'
    && typeof entry.sha === 'string'
    && typeof entry.isPdf === 'boolean'
}
