export function retiredSyncEndpoint(): Response {
  return Response.json({ error: 'This sync protocol has been retired. Reload the app to use /api/sync.' }, {
    status: 410, headers: { 'cache-control': 'no-store' },
  })
}
