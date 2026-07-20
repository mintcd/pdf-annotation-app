import {
  createD1RowSyncAuthority,
  createRowSyncRouteServer,
  defineNextSyncServer,
  type D1DatabaseLike,
} from '@mintcd/sync-engine/next'
import { replicaSchema } from './engine'
import { getEnv } from './env'
import { syncSessionFromRequest } from './syncIdentity'

export const syncServer = defineNextSyncServer(
  createRowSyncRouteServer({
    schema: replicaSchema,
    resolveStream({ request }) {
      return syncSessionFromRequest(request).streamId
    },
    getAuthority({ resolvedStreamId }) {
      return createD1RowSyncAuthority({
        database: getEnv().DB as unknown as D1DatabaseLike,
        streamId: resolvedStreamId,
        schema: replicaSchema,
        tablePrefix: 'sync_engine_v2',
        projectRowsToApplicationTables: true,
      })
    },
    onError(error) {
      console.error('sync-engine route failed', error)
    },
  }),
)
