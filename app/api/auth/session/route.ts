import { syncSessionFromRequest } from '../../../../utils/syncIdentity'

export const runtime = 'edge'

export function GET(request: Request): Response {
  return Response.json(syncSessionFromRequest(request), {
    headers: {
      'cache-control': 'no-store',
    },
  })
}
