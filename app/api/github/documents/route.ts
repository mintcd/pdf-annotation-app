import {
  DEFAULT_GITHUB_DOCUMENTS_BRANCH,
  DEFAULT_GITHUB_DOCUMENTS_CDN_URL,
  DEFAULT_GITHUB_DOCUMENTS_OWNER,
  DEFAULT_GITHUB_DOCUMENTS_REPO,
  githubBlobUrl,
  githubCdnUrl,
  githubContentsApiUrl,
  joinGithubPath,
  normalizeGithubPath,
  safeGithubPdfFileName,
  type GithubDocumentEntry,
  type GithubDocumentsConfig,
} from '../../../../lib/githubDocuments'
import { getEnv, type Env } from '../../../../utils/env'
import { syncSessionFromRequest } from '../../../../utils/syncIdentity'

export const runtime = 'edge'

const GITHUB_API_VERSION = '2022-11-28'
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

class GithubDocumentsError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message)
  }
}

type GithubContentItem = {
  type?: unknown
  name?: unknown
  path?: unknown
  size?: unknown
  sha?: unknown
  html_url?: unknown
  download_url?: unknown
}

type GithubUploadResult = {
  content?: {
    name?: unknown
    path?: unknown
    sha?: unknown
    html_url?: unknown
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const env = getEnv()
    assertAuthorized(request, env)

    const config = githubDocumentsConfig(env)
    const requestUrl = new URL(request.url)
    const path = normalizeGithubPath(requestUrl.searchParams.get('path') ?? '')
    const token = githubDocumentsToken(env)

    const response = await githubFetch(
      githubContentsApiUrl({
        owner: config.owner,
        repo: config.repo,
        path,
        ref: config.branch,
      }),
      { method: 'GET' },
      token,
    )
    const payload = await response.json() as GithubContentItem | GithubContentItem[]
    const entries = (Array.isArray(payload) ? payload : [payload])
      .map((item) => githubEntryFromContent(config, item))
      .filter((entry): entry is GithubDocumentEntry => Boolean(entry))
      .sort(compareGithubEntries)

    return Response.json({ config, path, entries }, {
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    return githubDocumentsErrorResponse(error)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const env = getEnv()
    assertAuthorized(request, env)

    const config = githubDocumentsConfig(env)
    const token = githubDocumentsToken(env)
    if (!token) {
      throw new GithubDocumentsError('Set GITHUB_DOCUMENTS_TOKEN to enable GitHub uploads.', 503)
    }

    const formData = await request.formData()
    const file = uploadedFile(formData.get('file'))
    if (!file) throw new GithubDocumentsError('Choose a PDF to upload.')
    if (file.size <= 0) throw new GithubDocumentsError('Choose a non-empty PDF.')
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new GithubDocumentsError('GitHub uploads are limited to PDFs up to 100 MB.')
    }

    const fileName = safeGithubPdfFileName(file.name)
    if (!fileName.toLowerCase().endsWith('.pdf')) {
      throw new GithubDocumentsError('Only PDF uploads are supported.')
    }

    const folder = stringValue(formData.get('path'))
    const uploadPath = joinGithubPath(folder, fileName)
    await assertPathDoesNotExist(config, uploadPath, token)

    const content = await fileToBase64(file)
    const uploadResponse = await githubFetch(
      githubContentsApiUrl({
        owner: config.owner,
        repo: config.repo,
        path: uploadPath,
      }),
      {
        method: 'PUT',
        body: JSON.stringify({
          message: `Upload ${fileName}`,
          content,
          branch: config.branch,
        }),
      },
      token,
    )
    const result = await uploadResponse.json() as GithubUploadResult
    const htmlUrl = typeof result.content?.html_url === 'string'
      ? result.content.html_url
      : githubBlobUrl({
        owner: config.owner,
        repo: config.repo,
        branch: config.branch,
        path: uploadPath,
      })
    const sha = typeof result.content?.sha === 'string' ? result.content.sha : ''

    return Response.json({
      config,
      name: fileName,
      path: uploadPath,
      htmlUrl,
      cdnUrl: githubCdnUrl(htmlUrl, config.cdnUrl),
      sha,
    }, {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    return githubDocumentsErrorResponse(error)
  }
}

function githubDocumentsConfig(env: Env): GithubDocumentsConfig {
  const owner = envString(env, 'GITHUB_DOCUMENTS_OWNER', DEFAULT_GITHUB_DOCUMENTS_OWNER)
  const repo = envString(env, 'GITHUB_DOCUMENTS_REPO', DEFAULT_GITHUB_DOCUMENTS_REPO)
  const branch = envString(env, 'GITHUB_DOCUMENTS_BRANCH', DEFAULT_GITHUB_DOCUMENTS_BRANCH)
  const cdnUrl = envString(env, 'GITHUB_DOCUMENTS_CDN_URL', DEFAULT_GITHUB_DOCUMENTS_CDN_URL)

  return {
    owner,
    repo,
    branch,
    cdnUrl,
    canUpload: Boolean(githubDocumentsToken(env)),
  }
}

function githubDocumentsToken(env: Env): string | null {
  const value = env.GITHUB_DOCUMENTS_TOKEN
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function assertAuthorized(request: Request, env: Env): void {
  const session = syncSessionFromRequest(request)
  if (!session.authenticated) {
    throw new GithubDocumentsError('Sign in to use GitHub storage.', 401)
  }

  const allowedUserId = envString(env, 'GITHUB_DOCUMENTS_ALLOWED_USER_ID', '')
  if (allowedUserId && allowedUserId !== session.userId) {
    throw new GithubDocumentsError('This account is not allowed to use GitHub storage.', 403)
  }
}

function envString(env: Env, key: string, fallback: string): string {
  const value = env[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

async function githubFetch(url: string, init: RequestInit, token: string | null): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/vnd.github+json')
  headers.set('content-type', 'application/json')
  headers.set('user-agent', 'pdf-annotation-app')
  headers.set('x-github-api-version', GITHUB_API_VERSION)
  if (token) headers.set('authorization', `Bearer ${token}`)

  const response = await fetch(url, {
    ...init,
    headers,
  })
  if (response.ok) return response

  let message = `GitHub returned HTTP ${response.status}.`
  const body = await response.json().catch(() => null) as { message?: unknown } | null
  if (typeof body?.message === 'string') message = body.message
  throw new GithubDocumentsError(message, response.status === 404 ? 404 : 502)
}

function githubEntryFromContent(
  config: GithubDocumentsConfig,
  item: GithubContentItem,
): GithubDocumentEntry | null {
  const type = item.type === 'dir' ? 'dir' : item.type === 'file' ? 'file' : null
  const name = typeof item.name === 'string' ? item.name : ''
  const path = typeof item.path === 'string' ? item.path : ''
  const sha = typeof item.sha === 'string' ? item.sha : ''
  if (!type || !name || !path || !sha) return null

  const htmlUrl = typeof item.html_url === 'string'
    ? item.html_url
    : type === 'file'
      ? githubBlobUrl({
        owner: config.owner,
        repo: config.repo,
        branch: config.branch,
        path,
      })
      : null
  const isPdf = type === 'file' && name.toLowerCase().endsWith('.pdf')

  return {
    type,
    name,
    path,
    size: typeof item.size === 'number' ? item.size : null,
    sha,
    htmlUrl,
    downloadUrl: typeof item.download_url === 'string' ? item.download_url : null,
    isPdf,
    cdnUrl: isPdf && htmlUrl ? githubCdnUrl(htmlUrl, config.cdnUrl) : null,
  }
}

function compareGithubEntries(left: GithubDocumentEntry, right: GithubDocumentEntry): number {
  if (left.type !== right.type) return left.type === 'dir' ? -1 : 1
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
}

function uploadedFile(value: FormDataEntryValue | null): File | null {
  if (
    value
    && typeof value === 'object'
    && 'arrayBuffer' in value
    && 'name' in value
    && 'size' in value
  ) {
    return value as File
  }

  return null
}

function stringValue(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value : ''
}

async function assertPathDoesNotExist(
  config: GithubDocumentsConfig,
  path: string,
  token: string,
): Promise<void> {
  const response = await fetch(
    githubContentsApiUrl({
      owner: config.owner,
      repo: config.repo,
      path,
      ref: config.branch,
    }),
    {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'pdf-annotation-app',
        'x-github-api-version': GITHUB_API_VERSION,
      },
    },
  )

  if (response.status === 404) return
  if (response.ok) {
    throw new GithubDocumentsError('A file with that name already exists in this folder.', 409)
  }

  let message = `GitHub returned HTTP ${response.status}.`
  const body = await response.json().catch(() => null) as { message?: unknown } | null
  if (typeof body?.message === 'string') message = body.message
  throw new GithubDocumentsError(message, 502)
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

function githubDocumentsErrorResponse(error: unknown): Response {
  if (error instanceof GithubDocumentsError) {
    return Response.json(
      { error: error.message },
      {
        status: error.status,
        headers: { 'cache-control': 'no-store' },
      },
    )
  }

  console.error('GitHub documents request failed', error)
  return Response.json(
    { error: 'GitHub storage is unavailable.' },
    {
      status: 500,
      headers: { 'cache-control': 'no-store' },
    },
  )
}
