'use client'

import { useEffect, useMemo, useRef } from 'react'
import { usePdfSyncEngine } from '../components/SyncEngineProvider'
import {
  INITIAL_HIGHLIGHT_COLORS,
  normalizeHighlightColorRow,
  type HighlightColor,
  type HighlightColorRow,
} from '../utils/highlightColors'

export function useHighlightColors(): {
  readonly data: readonly HighlightColor[]
  readonly loading: boolean
  readonly error: string | undefined
} {
  const sync = usePdfSyncEngine()
  const table = useMemo(() => sync.db.table('highlight_colors'), [sync.db])
  const rows = sync.tables.highlight_colors as readonly HighlightColorRow[] | undefined
  const seedingRef = useRef(false)

  const colors = useMemo(
    () => (rows ?? [])
      .map((row) => normalizeHighlightColorRow(row as unknown as Record<string, unknown>)),
    [rows],
  )

  useEffect(() => {
    if (
      !sync.session.authenticated
      || !sync.ready
      || sync.phase === 'opening'
      || sync.phase === 'syncing'
      || rows === undefined
      || rows.length > 0
      || seedingRef.current
    ) return

    seedingRef.current = true
    void (async () => {
      try {
        for (const color of INITIAL_HIGHLIGHT_COLORS) {
          await table.put(color)
        }
        await sync.sync()
      } catch (error) {
        console.warn('Failed to seed highlight colors', error)
      } finally {
        seedingRef.current = false
      }
    })()
  }, [
    rows,
    sync,
    sync.phase,
    sync.ready,
    sync.session.authenticated,
    table,
  ])

  return {
    data: colors.length > 0 ? colors : INITIAL_HIGHLIGHT_COLORS,
    loading: !sync.ready || sync.phase === 'opening',
    error: sync.error == null ? undefined : String(sync.error),
  }
}
