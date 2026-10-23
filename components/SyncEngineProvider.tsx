'use client'

import { createSyncConfig } from '@mintcd/sync-engine-vinext'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useSyncEngine } from '../sync/generated'
import {
  createSyncTables,
  emptySyncTablesSnapshot,
  unavailableSyncDatabase,
} from '../lib/syncTables'
import { syncSessionForUserId, type SyncSession } from '../utils/syncIdentity'

declare const __SYNC_DEPLOYMENT_VERSION__: string

const subscribeToNothing = () => () => undefined
const getEmptyTables = () => emptySyncTablesSnapshot

function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === 'undefined' ? true : navigator.onLine
  ))

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  return isOnline
}

function usePdfSyncEngineValue() {
  const [identity, setIdentity] = useState(() => ({
    session: syncSessionForUserId(undefined),
    ready: false,
    enabled: false,
    generation: 0,
    deploymentVersion: undefined as string | undefined,
  }))
  const [sessionError, setSessionError] = useState<unknown>()
  const identityRef = useRef(identity)
  identityRef.current = identity
  const sessionRequest = useRef(0)
  const isOnline = useOnlineStatus()

  const config = useMemo(() => identity.ready && identity.enabled && identity.session.authenticated
    ? createSyncConfig({
      accountId: identity.session.userId,
      streamId: identity.session.streamId,
      deploymentVersion: identity.deploymentVersion ?? __SYNC_DEPLOYMENT_VERSION__,
      // A successful session response is an authenticated application bootstrap.
      // The package resumes the existing identity for the same deployment.
      initialize: true,
    })
    : null, [identity.ready, identity.enabled, identity.session.userId, identity.session.streamId, identity.deploymentVersion, identity.generation])
  const runtime = useSyncEngine(config)
  const revokeRef = useRef(runtime.logoutSync)
  revokeRef.current = runtime.logoutSync
  const store = useMemo(() => runtime.engine ? createSyncTables(runtime.engine) : null, [runtime.engine])
  const materialized = useSyncExternalStore(
    store?.subscribe ?? subscribeToNothing,
    store?.getSnapshot ?? getEmptyTables,
    getEmptyTables,
  )

  const loadSession = useCallback(async (): Promise<{ session: SyncSession; deploymentVersion: string | undefined }> => {
    const response = await fetch('/api/auth/session', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`Session lookup failed with HTTP ${response.status}.`)
    const body = (await response.json()) as Partial<SyncSession> & { deploymentVersion?: unknown }
    if (typeof body.authenticated !== 'boolean') throw new Error('The session response is invalid.')
    const rawDeploymentVersion = body.deploymentVersion
    if (rawDeploymentVersion !== undefined && (
      typeof rawDeploymentVersion !== 'string' || !/^[A-Za-z0-9_.:/-]{1,128}$/.test(rawDeploymentVersion)
    )) throw new Error('The session deployment version is invalid.')
    const deploymentVersion = typeof rawDeploymentVersion === 'string' ? rawDeploymentVersion : undefined
    if (!body.authenticated) return { session: syncSessionForUserId(undefined), deploymentVersion }
    if (typeof body.userId !== 'string') throw new Error('The authenticated session has no account.')
    const session = syncSessionForUserId(body.userId, typeof body.username === 'string' ? body.username : null)
    if (!session.authenticated) throw new Error('The authenticated session has an invalid account.')
    return { session, deploymentVersion }
  }, [])

  const refreshSession = useCallback(async (): Promise<SyncSession> => {
    const request = ++sessionRequest.current
    const { session: nextSession, deploymentVersion } = await loadSession()
    if (request !== sessionRequest.current) return nextSession
    const current = identityRef.current
    if (current.enabled && (
      current.session.userId !== nextSession.userId || current.session.streamId !== nextSession.streamId
    )) {
      await revokeRef.current()
      if (request !== sessionRequest.current) return nextSession
    }
    setSessionError(undefined)
    setIdentity(previous => ({
      session: nextSession,
      ready: true,
      enabled: nextSession.authenticated,
      deploymentVersion,
      // Reauthentication gets a fresh config; previously revoked configs stay revoked.
      generation: previous.generation + (
        !previous.enabled || previous.deploymentVersion !== deploymentVersion ? 1 : 0
      ),
    }))
    return nextSession
  }, [loadSession])

  useEffect(() => {
    let cancelled = false
    void refreshSession().catch(error => {
      if (cancelled) return
      setSessionError(error)
      setIdentity(previous => ({ ...previous, ready: true, enabled: false }))
    })
    return () => { cancelled = true; ++sessionRequest.current }
  }, [refreshSession])

  const logoutSync = useCallback(async () => {
    ++sessionRequest.current
    await revokeRef.current()
    setIdentity(previous => ({ ...previous, enabled: false }))
  }, [])

  const synchronize = useCallback(async () => {
    if (!runtime.engine || !store) throw new Error('The local annotation library is not open.')
    const result = await runtime.engine.sync()
    await store.refresh()
    const error = store.getSnapshot().error
    if (error) throw error
    return result
  }, [runtime.engine, store])

  const error = sessionError ?? runtime.error ?? materialized.error
  const ready = identity.enabled && runtime.phase === 'ready' && materialized.ready
  const phase = error ? 'error'
    : !ready ? (identity.session.authenticated && identity.enabled ? 'opening' : 'idle')
      : runtime.status?.phase === 'syncing' || runtime.status?.phase === 'retrying' ? 'syncing'
        : 'ready'

  return useMemo(() => ({
    db: store?.db ?? unavailableSyncDatabase,
    tables: materialized.tables,
    ready,
    phase,
    error,
    sync: synchronize,
    pendingProposalCount: runtime.status?.replica.pendingCount ?? 0,
    acceptedAwaitingConfirmationCount: runtime.status?.replica.acceptedAwaitingCount ?? 0,
    isOnline,
    session: identity.session,
    sessionReady: identity.ready,
    refreshSession,
    logoutSync,
  }), [store, materialized, ready, phase, error, synchronize, runtime.status, isOnline, identity.session, identity.ready, refreshSession, logoutSync])
}

type PdfSyncEngineValue = ReturnType<typeof usePdfSyncEngineValue>
const SyncEngineContext = createContext<PdfSyncEngineValue | null>(null)

export default function SyncEngineProvider({ children }: { children: ReactNode }) {
  const sync = usePdfSyncEngineValue()
  return <SyncEngineContext.Provider value={sync}>{children}</SyncEngineContext.Provider>
}

export function usePdfSyncEngine(): PdfSyncEngineValue {
  const value = useContext(SyncEngineContext)
  if (!value) throw new Error('usePdfSyncEngine must be used inside SyncEngineProvider')
  return value
}
