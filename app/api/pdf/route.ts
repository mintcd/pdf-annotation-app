const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 4

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }

  const [first, second] = parts
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
}

function assertSafeRemoteUrl(value: string | URL): URL {
  const url = value instanceof URL ? value : new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https PDF URLs are supported.')
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const isPrivateIpv6 = hostname === '::1'
    || hostname.startsWith('fc')
    || hostname.startsWith('fd')
    || hostname.startsWith('fe80:')

  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || isPrivateIpv4(hostname)
    || isPrivateIpv6
  ) {
    throw new Error('Private network addresses cannot be fetched.')
  }

  url.username = ''
  url.password = ''
  return url
}

async function fetchWithSafeRedirects(target: URL, range: string | null): Promise<Response> {
  let current = target

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(current, {
      headers: {
        Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1',
        ...(range ? { Range: range } : {}),
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    })

    if (!REDIRECT_STATUSES.has(response.status)) return response

    const location = response.headers.get('location')
    if (!location) throw new Error('The PDF host returned an invalid redirect.')
    current = assertSafeRemoteUrl(new URL(location, current))
  }

  throw new Error('The PDF URL redirected too many times.')
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url)
    const rawTarget = requestUrl.searchParams.get('url')
    if (!rawTarget) {
      return Response.json({ error: 'Missing PDF URL.' }, { status: 400 })
    }

    const target = assertSafeRemoteUrl(rawTarget)
    const upstream = await fetchWithSafeRedirects(target, request.headers.get('range'))
    if (!upstream.ok && upstream.status !== 206) {
      return Response.json(
        { error: `The PDF host returned ${upstream.status}.` },
        { status: upstream.status === 404 ? 404 : 502 },
      )
    }

    const headers = new Headers()
    for (const name of [
      'accept-ranges',
      'content-length',
      'content-range',
      'content-type',
      'etag',
      'last-modified',
    ]) {
      const value = upstream.headers.get(name)
      if (value) headers.set(name, value)
    }
    if (!headers.has('content-type')) headers.set('content-type', 'application/pdf')
    headers.set('cache-control', 'private, no-store')
    headers.set('x-content-type-options', 'nosniff')

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The PDF could not be fetched.'
    return Response.json({ error: message }, { status: 400 })
  }
}
