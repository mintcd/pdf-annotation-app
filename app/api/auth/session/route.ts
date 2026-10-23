import { readTrustedSession } from '../../../../lib/serverSession'
import { getEnv } from '../../../../utils/env'
import { errorResponse } from '../_shared'

export const runtime = 'edge'

export async function GET(request: Request): Promise<Response> {
  try {
    const env = getEnv()
    const session = await readTrustedSession(request, env.DB)
    const deploymentVersion = __SYNC_PRODUCTION__
      ? env.CF_VERSION_METADATA?.id || __SYNC_DEPLOYMENT_VERSION__ : __SYNC_DEPLOYMENT_VERSION__
    return Response.json({ ...session, deploymentVersion }, {
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) { return errorResponse(error) }
}
