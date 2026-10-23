import { existsSync } from 'node:fs'
import { chromium, defineConfig } from '@playwright/test'

const executablePath = [chromium.executablePath(),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync)

export default defineConfig({
  testDir: './tests/integration',
  outputDir: './sync-test-results',
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4176',
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  webServer: {
    command: 'vite --host 127.0.0.1 --port 4176 --strictPort',
    url: 'http://127.0.0.1:4176/api/auth/session',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // Never send integration writes to the production D1 binding.
    env: { CLOUDFLARE_VITE_FORCE_LOCAL: 'true' },
  },
})
