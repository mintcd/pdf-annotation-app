import {
  syncSessionForUserId,
  syncSessionFromRequest,
} from '../../../../utils/syncIdentity'
import { findUserById } from '../_shared'

export const runtime = 'edge'

export async function GET(request: Request): Promise<Response> {
  const session = syncSessionFromRequest(request)
  let username: string | null = null

  if (session.authenticated) {
    try {
      username = (await findUserById(session.userId))?.username ?? null
    } catch (error) {
      console.warn('Failed to look up username for auth session', error)
    }
  }

  return Response.json(syncSessionForUserId(session.userId, username), {
    headers: {
      'cache-control': 'no-store',
    },
  })
}
