import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { chromium, defineConfig, devices } from '@playwright/test'

const browserCandidates = [
  chromium.executablePath(),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
const executablePath = browserCandidates.find((candidate) => existsSync(candidate))
const serverToken = randomUUID()

export default defineConfig({
  testDir: './tests/browser',
  outputDir: './test-results',
  globalTeardown: './tests/fixtures/viewer/serverTeardown.ts',
  metadata: { viewerTestServerToken: serverToken },
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 12_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], browserName: 'chromium' } },
  ],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --config tests/fixtures/viewer/vite.config.ts',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { PDF_VIEWER_TEST_SERVER_TOKEN: serverToken },
  },
})
