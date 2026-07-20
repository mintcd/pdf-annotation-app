import { defineNextSyncConfig } from '@mintcd/sync-engine/next'

export default defineNextSyncConfig({
  d1: {
    configPath: './wrangler.jsonc',
    binding: 'DB',
  },
  schema: {
    include: ['documents', 'annotations', 'highlight_colors'],
  },
  client: {
    databaseName: 'pdf-annotation-db',
  },
  server: {
    module: './utils/syncServer',
    exportName: 'syncServer',
  },
  routes: {
    appDir: './app',
    basePath: '/api/sync',
  },
  output: {
    config: './utils/engine.ts',
    serviceWorker: false,
  },
})
