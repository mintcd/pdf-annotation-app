export const DEFAULT_GITHUB_DOCUMENTS_OWNER = 'mintcd'
export const DEFAULT_GITHUB_DOCUMENTS_REPO = 'documents'
export const DEFAULT_GITHUB_DOCUMENTS_BRANCH = 'main'
export const DEFAULT_GITHUB_DOCUMENTS_CDN_URL = 'https://cdn.mintcd.dev/'

export type GithubDocumentsConfig = {
  owner: string
  repo: string
  branch: string
  cdnUrl: string
  canUpload: boolean
}

export type GithubDocumentEntry = {
  type: 'dir' | 'file'
  name: string
  path: string
  size: number | null
  sha: string
  htmlUrl: string | null
  downloadUrl: string | null
  isPdf: boolean
  cdnUrl: string | null
}

export type GithubDocumentsListResponse = {
  config: GithubDocumentsConfig
  path: string
  entries: GithubDocumentEntry[]
}

export type GithubDocumentsUploadResponse = {
  config: GithubDocumentsConfig
  name: string
  path: string
  htmlUrl: string
  cdnUrl: string
  sha: string
}

export function normalizeGithubPath(value: string): string {
  const trimmed = value.replace(/\\/g, '/').trim()
  if (trimmed === '' || trimmed === '/') return ''

  const parts = trimmed
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error('GitHub folders cannot include . or .. segments.')
  }

  return parts.join('/')
}

export function joinGithubPath(folder: string, name: string): string {
  const normalizedFolder = normalizeGithubPath(folder)
  const cleanedName = name.replace(/\\/g, '/').split('/').filter(Boolean).at(-1)?.trim() ?? ''
  if (!cleanedName || cleanedName === '.' || cleanedName === '..') {
    throw new Error('Enter a valid file name.')
  }

  return normalizedFolder ? `${normalizedFolder}/${cleanedName}` : cleanedName
}

export function safeGithubPdfFileName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  const name = cleaned || 'document.pdf'
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`
}

export function encodeGithubPath(path: string): string {
  const normalized = normalizeGithubPath(path)
  return normalized.split('/').map(encodeURIComponent).join('/')
}

export function githubContentsApiUrl({
  owner,
  path,
  ref,
  repo,
}: {
  owner: string
  repo: string
  path: string
  ref?: string
}): string {
  const encodedPath = encodeGithubPath(path)
  const url = new URL(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${encodedPath ? `/${encodedPath}` : ''}`,
  )
  if (ref) url.searchParams.set('ref', ref)
  return url.toString()
}

export function githubBlobUrl({
  branch,
  owner,
  path,
  repo,
}: {
  owner: string
  repo: string
  branch: string
  path: string
}): string {
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${encodeURIComponent(branch)}/${encodeGithubPath(path)}`
}

export function githubCdnUrl(blobUrl: string, cdnUrl = DEFAULT_GITHUB_DOCUMENTS_CDN_URL): string {
  const url = new URL(cdnUrl)
  url.searchParams.set('file', blobUrl)
  return url.toString()
}

export function fileNameFromGithubLikeUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    const nestedFileUrl = url.searchParams.get('file')
    if (nestedFileUrl) return fileNameFromGithubLikeUrl(nestedFileUrl)

    const lastSegment = url.pathname.split('/').filter(Boolean).at(-1)
    if (!lastSegment) return null

    return decodeURIComponent(lastSegment)
  } catch {
    return null
  }
}

export function pathFromGithubBlobUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    const nestedFileUrl = url.searchParams.get('file')
    if (nestedFileUrl) return pathFromGithubBlobUrl(nestedFileUrl)
    if (url.hostname !== 'github.com') return null

    const parts = url.pathname.split('/').filter(Boolean)
    const blobIndex = parts.indexOf('blob')
    if (blobIndex < 0 || parts.length <= blobIndex + 2) return null

    return parts.slice(blobIndex + 2).map(decodeURIComponent).join('/')
  } catch {
    return null
  }
}
