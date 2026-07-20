'use client'

import { useSyncEngine } from '@mintcd/sync-engine/react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { finalConfig } from '../utils/engine'
import {
  syncSessionForUserId,
  type SyncSession,
} from '../utils/syncIdentity'

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
  const [session, setSession] = useState(() => syncSessionForUserId(undefined))
  const [sessionReady, setSessionReady] = useState(false)
  const isOnline = useOnlineStatus()

  const loadSession = useCallback(async (): Promise<SyncSession> => {
    const response = await fetch('/api/auth/session', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) {
      throw new Error(`session endpoint returned HTTP ${response.status}`)
    }
    const body = (await response.json()) as Partial<SyncSession>
    return syncSessionForUserId(
      typeof body.userId === 'string' ? body.userId : undefined,
    )
  }, [])

  const refreshSession = useCallback(async (): Promise<SyncSession> => {
    const nextSession = await loadSession()
    setSession(nextSession)
    setSessionReady(true)
    return nextSession
  }, [loadSession])

  useEffect(() => {
    let cancelled = false
    void loadSession()
      .then((nextSession) => {
        if (cancelled) return
        setSession(nextSession)
        setSessionReady(true)
      })
      .catch((error) => {
        if (cancelled) return
        console.warn('Failed to resolve sync session; using signed-out state', error)
        setSession(syncSessionForUserId(undefined))
        setSessionReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [loadSession])

  const sync = useSyncEngine({
    config: finalConfig,
    streamId: session.streamId,
    enabled: sessionReady && session.authenticated,
    credentials: 'same-origin',
    initialSync: true,
    serviceWorker: false,
    syncOnMutation: true,
    onClientError(error) {
      console.error('Failed to open sync-engine client', error)
    },
    onSyncError(error) {
      console.error('Failed to sync PDF annotations', error)
    },
  })

  return useMemo(() => ({
    ...sync,
    isOnline,
    session,
    sessionReady,
    refreshSession,
  }), [
    isOnline,
    refreshSession,
    session,
    sessionReady,
    sync,
  ])
}

type PdfSyncEngineValue = ReturnType<typeof usePdfSyncEngineValue>

const SyncEngineContext = createContext<PdfSyncEngineValue | null>(null)

export default function SyncEngineProvider({ children }: { children: ReactNode }) {
  const sync = usePdfSyncEngineValue()

  return (
    <SyncEngineContext.Provider value={sync}>
      {children}
    </SyncEngineContext.Provider>
  )
}

export function usePdfSyncEngine(): PdfSyncEngineValue {
  const value = useContext(SyncEngineContext)
  if (!value) throw new Error('usePdfSyncEngine must be used inside SyncEngineProvider')
  return value
}
