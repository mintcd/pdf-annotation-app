'use client'

import { useEffect } from 'react'

const RESIZE_OBSERVER_LOOP_MESSAGES = new Set([
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded',
])

export default function BrowserResizeObserverErrorGuard() {
  useEffect(() => {
    const isResizeObserverLoopMessage = (message: unknown) => (
      typeof message === 'string' && RESIZE_OBSERVER_LOOP_MESSAGES.has(message)
    )

    const handleError = (event: ErrorEvent) => {
      if (!isResizeObserverLoopMessage(event.message)) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const message = reason instanceof Error ? reason.message : reason
      if (!isResizeObserverLoopMessage(message)) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    window.addEventListener('error', handleError, true)
    window.addEventListener('unhandledrejection', handleUnhandledRejection, true)

    return () => {
      window.removeEventListener('error', handleError, true)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection, true)
    }
  }, [])

  return null
}
