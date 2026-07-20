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

type GithubDocumentsActionRequest = {
  action?: unknown
  path?: unknown
  entryPath?: unknown
  entryType?: unknown
  name?: unknown
}

type GithubRefResult = {
  object?: {
    sha?: unknown
  }
}

type GithubCommitResult = {
  sha?: unknown
  tree?: {
    sha?: unknown
  }
}

type GithubTreeItem = {
  path?: unknown
  mode?: unknown
  type?: unknown
  sha?: unknown
}

type GithubTreeResult = {
  sha?: unknown
  tree?: unknown
  truncated?: unknown
}

type GithubBlobResult = {
  sha?: unknown
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

    const contentType = request.headers.get('content-type') ?? ''
    if (contentType.toLowerCase().includes('application/json')) {
      return await handleGithubDocumentsAction(request, config, token)
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

async function handleGithubDocumentsAction(
  request: Request,
  config: GithubDocumentsConfig,
  token: string,
): Promise<Response> {
  const body = await request.json().catch(() => null) as GithubDocumentsActionRequest | null
  if (!body || typeof body !== 'object') {
    throw new GithubDocumentsError('Invalid GitHub storage action.')
  }

  const action = typeof body.action === 'string' ? body.action : ''
  const parentPath = normalizeGithubPath(typeof body.path === 'string' ? body.path : '')

  if (action === 'create-folder') {
    const name = safeGithubFolderName(typeof body.name === 'string' ? body.name : '')
    const folderPath = joinGithubPath(parentPath, name)
    await assertPathDoesNotExist(config, folderPath, token)
    const commitSha = await commitGithubTreeChanges({
      config,
      token,
      message: `Create folder ${folderPath}`,
      changes: [{
        path: joinGithubPath(folderPath, '.gitkeep'),
        content: '',
      }],
    })

    return Response.json({
      config,
      action,
      path: folderPath,
      parentPath,
      commitSha,
    }, {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    })
  }

  if (action === 'rename') {
    const entryPath = normalizeGithubPath(typeof body.entryPath === 'string' ? body.entryPath : '')
    const entryType = readGithubEntryType(body.entryType)
    assertDirectGithubChild(parentPath, entryPath)
    const name = entryType === 'file'
      ? safeGithubPdfFileName(typeof body.name === 'string' ? body.name : '')
      : safeGithubFolderName(typeof body.name === 'string' ? body.name : '')
    const nextPath = joinGithubPath(parentPath, name)
    if (nextPath === entryPath) {
      throw new GithubDocumentsError('Enter a different name.')
    }
    await assertPathDoesNotExist(config, nextPath, token)
    const commitSha = await renameGithubEntry({
      config,
      token,
      entryPath,
      entryType,
      nextPath,
    })

    return Response.json({
      config,
      action,
      path: nextPath,
      parentPath,
      commitSha,
    }, {
      headers: { 'cache-control': 'no-store' },
    })
  }

  if (action === 'delete') {
    const entryPath = normalizeGithubPath(typeof body.entryPath === 'string' ? body.entryPath : '')
    const entryType = readGithubEntryType(body.entryType)
    assertDirectGithubChild(parentPath, entryPath)
    const commitSha = await deleteGithubEntry({
      config,
      token,
      entryPath,
      entryType,
    })

    return Response.json({
      config,
      action,
      path: entryPath,
      parentPath,
      commitSha,
    }, {
      headers: { 'cache-control': 'no-store' },
    })
  }

  throw new GithubDocumentsError('Unsupported GitHub storage action.')
}

async function renameGithubEntry({
  config,
  entryPath,
  entryType,
  nextPath,
  token,
}: {
  config: GithubDocumentsConfig
  token: string
  entryPath: string
  entryType: 'dir' | 'file'
  nextPath: string
}): Promise<string> {
  const base = await readGithubBranchBase(config, token)
  const currentTree = await readGithubRecursiveTree(config, token, base.treeSha)
  const changes: GithubTreeChange[] = []

  if (entryType === 'file') {
    const file = currentTree.find((item) => item.path === entryPath && item.type === 'blob')
    if (!file) throw new GithubDocumentsError('GitHub file was not found.', 404)

    changes.push({
      path: nextPath,
      mode: file.mode,
      type: 'blob',
      sha: file.sha,
    })
    changes.push({
      path: entryPath,
      mode: file.mode,
      type: 'blob',
      sha: null,
    })
  } else {
    const oldPrefix = `${entryPath}/`
    const moved = currentTree.filter((item) => item.type === 'blob' && item.path.startsWith(oldPrefix))
    if (moved.length === 0) throw new GithubDocumentsError('GitHub folder was not found or is empty.', 404)

    for (const item of moved) {
      changes.push({
        path: `${nextPath}/${item.path.slice(oldPrefix.length)}`,
        mode: item.mode,
        type: 'blob',
        sha: item.sha,
      })
    }
    for (const item of moved) {
      changes.push({
        path: item.path,
        mode: item.mode,
        type: 'blob',
        sha: null,
      })
    }
  }

  return commitGithubTreeChanges({
    config,
    token,
    base,
    message: `Rename ${entryPath} to ${nextPath}`,
    changes,
  })
}

async function deleteGithubEntry({
  config,
  entryPath,
  entryType,
  token,
}: {
  config: GithubDocumentsConfig
  token: string
  entryPath: string
  entryType: 'dir' | 'file'
}): Promise<string> {
  const base = await readGithubBranchBase(config, token)
  const currentTree = await readGithubRecursiveTree(config, token, base.treeSha)
  const changes: GithubTreeChange[] = []

  if (entryType === 'file') {
    const file = currentTree.find((item) => item.path === entryPath && item.type === 'blob')
    if (!file) throw new GithubDocumentsError('GitHub file was not found.', 404)
    changes.push({
      path: entryPath,
      mode: file.mode,
      type: 'blob',
      sha: null,
    })
  } else {
    const oldPrefix = `${entryPath}/`
    const deleted = currentTree.filter((item) => item.type === 'blob' && item.path.startsWith(oldPrefix))
    if (deleted.length === 0) throw new GithubDocumentsError('GitHub folder was not found or is empty.', 404)
    for (const item of deleted) {
      changes.push({
        path: item.path,
        mode: item.mode,
        type: 'blob',
        sha: null,
      })
    }
  }

  return commitGithubTreeChanges({
    config,
    token,
    base,
    message: `Delete ${entryPath}`,
    changes,
  })
}

type GithubTreeChange = {
  path: string
  mode?: string
  type?: 'blob'
  sha?: string | null
  content?: string
}

type GithubBranchBase = {
  commitSha: string
  treeSha: string
}

type NormalizedGithubTreeItem = {
  path: string
  mode: string
  type: string
  sha: string
}

async function commitGithubTreeChanges({
  base,
  changes,
  config,
  message,
  token,
}: {
  config: GithubDocumentsConfig
  token: string
  message: string
  changes: GithubTreeChange[]
  base?: GithubBranchBase
}): Promise<string> {
  const resolvedBase = base ?? await readGithubBranchBase(config, token)
  const tree = await Promise.all(changes.map(async (change) => {
    if (change.content === undefined) return {
      path: change.path,
      mode: change.mode ?? '100644',
      type: change.type ?? 'blob',
      sha: change.sha ?? null,
    }

    const blobSha = await createGithubBlob(config, token, change.content)
    return {
      path: change.path,
      mode: '100644',
      type: 'blob',
      sha: blobSha,
    }
  }))
  const treeResponse = await githubFetch(
    githubRepoApiUrl(config, '/git/trees'),
    {
      method: 'POST',
      body: JSON.stringify({
        base_tree: resolvedBase.treeSha,
        tree,
      }),
    },
    token,
  )
  const treeBody = await treeResponse.json() as GithubTreeResult
  const treeSha = typeof treeBody.sha === 'string' ? treeBody.sha : ''
  if (!treeSha) throw new GithubDocumentsError('GitHub did not return a new tree SHA.', 502)

  const commitResponse = await githubFetch(
    githubRepoApiUrl(config, '/git/commits'),
    {
      method: 'POST',
      body: JSON.stringify({
        message,
        tree: treeSha,
        parents: [resolvedBase.commitSha],
      }),
    },
    token,
  )
  const commitBody = await commitResponse.json() as GithubCommitResult
  const commitSha = typeof commitBody.sha === 'string' ? commitBody.sha : ''
  if (!commitSha) throw new GithubDocumentsError('GitHub did not return a new commit SHA.', 502)

  await githubFetch(
    githubRepoApiUrl(config, `/git/refs/heads/${encodeURIComponent(config.branch)}`),
    {
      method: 'PATCH',
      body: JSON.stringify({ sha: commitSha }),
    },
    token,
  )

  return commitSha
}

async function readGithubBranchBase(
  config: GithubDocumentsConfig,
  token: string,
): Promise<GithubBranchBase> {
  const refResponse = await githubFetch(
    githubRepoApiUrl(config, `/git/ref/heads/${encodeURIComponent(config.branch)}`),
    { method: 'GET' },
    token,
  )
  const refBody = await refResponse.json() as GithubRefResult
  const commitSha = typeof refBody.object?.sha === 'string' ? refBody.object.sha : ''
  if (!commitSha) throw new GithubDocumentsError('GitHub branch ref did not include a commit SHA.', 502)

  const commitResponse = await githubFetch(
    githubRepoApiUrl(config, `/git/commits/${encodeURIComponent(commitSha)}`),
    { method: 'GET' },
    token,
  )
  const commitBody = await commitResponse.json() as GithubCommitResult
  const treeSha = typeof commitBody.tree?.sha === 'string' ? commitBody.tree.sha : ''
  if (!treeSha) throw new GithubDocumentsError('GitHub commit did not include a tree SHA.', 502)

  return { commitSha, treeSha }
}

async function readGithubRecursiveTree(
  config: GithubDocumentsConfig,
  token: string,
  treeSha: string,
): Promise<NormalizedGithubTreeItem[]> {
  const response = await githubFetch(
    `${githubRepoApiUrl(config, `/git/trees/${encodeURIComponent(treeSha)}`)}?recursive=1`,
    { method: 'GET' },
    token,
  )
  const body = await response.json() as GithubTreeResult
  if (body.truncated === true) {
    throw new GithubDocumentsError('GitHub tree is too large to edit safely from this UI.', 409)
  }
  if (!Array.isArray(body.tree)) {
    throw new GithubDocumentsError('GitHub did not return a tree listing.', 502)
  }

  return body.tree
    .map((item) => normalizeGithubTreeItem(item as GithubTreeItem))
    .filter((item): item is NormalizedGithubTreeItem => Boolean(item))
}

async function createGithubBlob(
  config: GithubDocumentsConfig,
  token: string,
  content: string,
): Promise<string> {
  const response = await githubFetch(
    githubRepoApiUrl(config, '/git/blobs'),
    {
      method: 'POST',
      body: JSON.stringify({
        content,
        encoding: 'utf-8',
      }),
    },
    token,
  )
  const body = await response.json() as GithubBlobResult
  const sha = typeof body.sha === 'string' ? body.sha : ''
  if (!sha) throw new GithubDocumentsError('GitHub did not return a blob SHA.', 502)
  return sha
}

function normalizeGithubTreeItem(item: GithubTreeItem): NormalizedGithubTreeItem | null {
  const path = typeof item.path === 'string' ? item.path : ''
  const mode = typeof item.mode === 'string' ? item.mode : ''
  const type = typeof item.type === 'string' ? item.type : ''
  const sha = typeof item.sha === 'string' ? item.sha : ''
  if (!path || !mode || !type || !sha) return null
  return { path, mode, type, sha }
}

function githubRepoApiUrl(config: GithubDocumentsConfig, path: string): string {
  return `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}${path}`
}

function safeGithubFolderName(value: string): string {
  const name = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  if (!name || name === '.' || name === '..') {
    throw new GithubDocumentsError('Enter a valid folder name.')
  }
  return name
}

function readGithubEntryType(value: unknown): 'dir' | 'file' {
  if (value === 'dir' || value === 'file') return value
  throw new GithubDocumentsError('GitHub entry type must be file or folder.')
}

function assertDirectGithubChild(parentPath: string, entryPath: string): void {
  if (!entryPath) throw new GithubDocumentsError('Choose a GitHub file or folder.')
  if (!parentPath) {
    if (!entryPath.includes('/')) return
    throw new GithubDocumentsError('Only direct children of the opened folder can be edited.')
  }

  const prefix = `${parentPath}/`
  if (!entryPath.startsWith(prefix)) {
    throw new GithubDocumentsError('Only direct children of the opened folder can be edited.')
  }

  const relative = entryPath.slice(prefix.length)
  if (!relative || relative.includes('/')) {
    throw new GithubDocumentsError('Only direct children of the opened folder can be edited.')
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
