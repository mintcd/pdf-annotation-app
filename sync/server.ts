// Application-owned authentication and authority policy. Created once.
import type { ResolvedSyncContext, SyncRequestScope } from "@mintcd/sync-engine/transport/http-server";
import { createCrudPolicy } from "@mintcd/sync-engine/records";
import type { SyncModel } from "../app/api/sync/route";
import { getEnv } from '../utils/env';
import { readTrustedSession } from '../lib/serverSession';
import { authorizeSync } from '../lib/syncAuthorization';

export async function resolveContext(request: Request, scope: SyncRequestScope): Promise<ResolvedSyncContext<{ readonly accountId: string }>> {
  return authorizeSync(request, scope, () => readTrustedSession(request, getEnv().DB));
}

// Field patches merge against confirmed rows; same-field writes follow authority order.
// Wrap or replace this policy with application-specific authorization/merge rules.
export function createPolicy(model: SyncModel) {
  return createCrudPolicy(model);
}
