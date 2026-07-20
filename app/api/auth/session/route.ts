import { syncSessionFromRequest } from '../../../../utils/syncIdentity'

export const runtime = 'nodejs'

export function GET(request: Request): Response {
  return Response.json(syncSessionFromRequest(request), {
    headers: {
      'cache-control': 'no-store',
    },
  })
}
