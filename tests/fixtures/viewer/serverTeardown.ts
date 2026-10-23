import type { FullConfig } from '@playwright/test'

export default async function teardown(config: FullConfig) {
  try {
    // A reused server belongs to another run and rejects this run's token.
    await fetch('http://127.0.0.1:4175/__viewer_test_shutdown', {
      headers: { 'x-viewer-test-token': String(config.metadata.viewerTestServerToken) },
      signal: AbortSignal.timeout(3_000),
    })
  } catch { /* The server may already have stopped. */ }
}
