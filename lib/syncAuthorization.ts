import { SyncHttpError, type ResolvedSyncContext, type SyncRequestScope } from '@mintcd/sync-engine/transport/http-server'
import type { SyncSession } from '../utils/syncIdentity'
import { isSameOriginRequest } from './serverSession'

export async function authorizeSync(
  request: Request,
  scope: SyncRequestScope,
  readSession: () => Promise<SyncSession>,
): Promise<ResolvedSyncContext<{ readonly accountId: string }>> {
  if (!isSameOriginRequest(request)) throw new SyncHttpError(403, 'cross-origin', 'Cross-origin sync is denied.')
  const session = await readSession()
  if (!session.authenticated) throw new SyncHttpError(401, 'sign-in-required', 'Sign in to synchronize your library.')
  if (scope.streamId !== session.streamId) throw new SyncHttpError(403, 'stream-forbidden', 'This stream belongs to another account.')
  return { streamId: session.streamId, context: { accountId: session.userId } }
}
