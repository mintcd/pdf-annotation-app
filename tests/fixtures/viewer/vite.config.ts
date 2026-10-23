import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: fileURLToPath(new URL('../../../public', import.meta.url)),
  resolve: {
    alias: [
      { find: /^\.\/SyncEngineProvider$/, replacement: fileURLToPath(new URL('./syncStub.tsx', import.meta.url)) },
      { find: /^\.\.\/components\/SyncEngineProvider$/, replacement: fileURLToPath(new URL('./syncStub.tsx', import.meta.url)) },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 4175,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('../../..', import.meta.url))] },
  },
  // Keep the browser harness independent of the app's Cloudflare and Tailwind build.
  css: { postcss: { plugins: [] } },
  plugins: [{
    name: 'viewer-test-server-cleanup',
    configureServer(server) {
      // Playwright's taskkill fallback can leave the Vite child alive on restricted Windows.
      // Only the test run that started this server may ask it to close.
      server.middlewares.use('/__viewer_test_shutdown', (request, response) => {
        const token = process.env.PDF_VIEWER_TEST_SERVER_TOKEN
        if (!token || request.headers['x-viewer-test-token'] !== token) {
          response.statusCode = 403
          response.end()
          return
        }
        response.end('closing')
        setTimeout(() => { void server.close().finally(() => process.exit(0)) }, 20)
      })
    },
  }],
})
