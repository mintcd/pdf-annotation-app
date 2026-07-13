'use client'

import { useSyncEngine } from '@mintcd/sync-engine'
import { finalConfig } from '../utils/engine'

export default function ServiceWorkerRegister() {
  useSyncEngine(finalConfig)

  return null
}
