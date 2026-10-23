import { expect, test, type CDPSession, type Page } from '@playwright/test'
import type {} from '../fixtures/viewer/harness'

async function snapshot(page: Page) {
  return page.evaluate(() => window.pdfHarness.snapshot())
}

async function openViewer(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => !!window.pdfHarness)
  await page.evaluate(() => window.pdfHarness.open())
  await expect.poll(async () => (await snapshot(page)).status).toBe('ready')
  await expect(page.locator('.page[data-page-number="1"] canvas').first()).toBeVisible()
  await expect(page.locator('.page[data-page-number="1"] .textLayer')).toContainText('Select this first page')
}

async function selectPageText(page: Page, pageNumber: number, fragment: string) {
  await page.evaluate(({ pageNumber, fragment }) => {
    const spans = Array.from(document.querySelectorAll(`.page[data-page-number="${pageNumber}"] .textLayer span`))
    const span = spans.find((item) => item.textContent?.includes(fragment))!
    if (!span?.firstChild) throw new Error(`Text span not found: ${fragment}`)
    const range = document.createRange()
    range.selectNodeContents(span)
    const selected = window.getSelection()!
    selected.removeAllRanges()
    selected.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, { pageNumber, fragment })
  await expect.poll(async () => (await snapshot(page)).selection?.text).toContain(fragment)
}

async function listenerCounts(cdp: CDPSession) {
  const result = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const container = getEventListeners(document.querySelector('#viewport'));
      const documentEvents = getEventListeners(document);
      return { wheel: (container.wheel || []).length, touchstart: (container.touchstart || []).length, selectionchange: (documentEvents.selectionchange || []).length };
    })()`,
    includeCommandLineAPI: true,
    returnByValue: true,
  })
  return result.result.value as { wheel: number; touchstart: number; selectionchange: number }
}

async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', coordinates: [number, number][]) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: coordinates.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })),
  })
}

test('renders with a real worker, converts outlines, navigates pages and follows internal links', async ({ page }) => {
  await openViewer(page)
  const first = await snapshot(page)
  expect(first.state.totalPages).toBe(3)
  expect(first.activeWorkers).toBe(1)
  expect(page.workers()).toHaveLength(1)
  expect(first.errors).toEqual([])
  await expect.poll(async () => (await snapshot(page)).outline).toEqual([
    { title: 'First chapter', pageIndex: 0, children: [{ title: 'Rotated child', pageIndex: 1, children: [] }] },
    { title: 'Last chapter', pageIndex: 2, children: [] },
  ])
  await page.evaluate(() => window.pdfHarness.goToPage(3))
  await expect.poll(async () => (await snapshot(page)).state.currentPage).toBe(3)
  await expect(page.locator('.page[data-page-number="3"] canvas').first()).toBeVisible()
  await page.evaluate(() => window.pdfHarness.goToPage(1))
  await expect.poll(async () => (await snapshot(page)).state.currentPage).toBe(1)
  const link = page.locator('.page[data-page-number="1"] .annotationLayer a')
  await expect(link).toBeVisible()
  await link.click()
  await expect.poll(async () => (await snapshot(page)).state.currentPage).toBe(3)
  await expect.poll(async () => (await snapshot(page)).events.some((event) => event.type === 'navigate' && (event.detail as { to?: number })?.to === 3)).toBe(true)
})

test('snapshots text selection and redraws aligned highlight geometry at a different zoom', async ({ page }) => {
  await openViewer(page)
  await selectPageText(page, 1, 'Select this first page')
  const selected = (await snapshot(page)).selection!
  expect(selected.geometry).toHaveLength(1)
  expect(selected.geometry[0].pageIndex).toBe(0)
  expect(selected.geometry[0].rect.size.width).toBeGreaterThan(100)
  await page.evaluate(() => window.pdfHarness.highlightSelection())
  const highlight = page.locator('.page[data-page-number="1"] .app-highlight').first()
  await expect(highlight).toBeVisible()
  const firstBox = await highlight.evaluate((element) => {
    const style = (element as HTMLElement).style
    return { width: Number.parseFloat(style.width), height: Number.parseFloat(style.height) }
  })
  const initialScale = (await snapshot(page)).state.zoom
  await page.evaluate(() => { window.pdfHarness.clearSelection(); window.pdfHarness.setScale(window.pdfHarness.snapshot().state.zoom * 1.7) })
  await expect.poll(async () => (await snapshot(page)).state.zoom).toBeCloseTo(initialScale * 1.7, 2)
  // PDF.js may replace the rendered page and our overlay between animation frames.
  // Read each new overlay atomically rather than retaining a transient DOM bounding box.
  await expect.poll(async () => Number.parseFloat(await highlight.evaluate((element) => (element as HTMLElement).style.width)) / firstBox.width).toBeCloseTo(1.7, 1)
  await expect.poll(async () => Number.parseFloat(await highlight.evaluate((element) => (element as HTMLElement).style.height)) / firstBox.height).toBeCloseTo(1.7, 1)
  await page.evaluate(() => window.pdfHarness.goToPage(1))
  await selectPageText(page, 1, 'Select this first page')
  const selectedAtZoom = (await snapshot(page)).selection!.geometry[0].rect
  expect(selectedAtZoom.origin.x).toBeCloseTo(selected.geometry[0].rect.origin.x, 0)
  expect(selectedAtZoom.origin.y).toBeCloseTo(selected.geometry[0].rect.origin.y, 0)
  expect(selectedAtZoom.size.width).toBeCloseTo(selected.geometry[0].rect.size.width, 0)
})

test('preserves selection coordinates on a rotated page with a nonzero crop box', async ({ page }) => {
  await openViewer(page)
  await page.evaluate(() => window.pdfHarness.goToPage(2))
  await expect(page.locator('.page[data-page-number="2"] .textLayer')).toContainText('Rotated cropped page')
  const metrics = await page.evaluate(() => window.pdfHarness.pageMetrics(1))
  expect(metrics.rotation).toBe(90)
  expect(metrics.viewBox).toEqual([40, 50, 540, 700])
  await selectPageText(page, 2, 'Rotated cropped page')
  const original = (await snapshot(page)).selection!.geometry[0]
  expect(original.pageIndex).toBe(1)
  expect(original.rect.origin.x).toBeCloseTo(80, 0)
  expect(original.rect.origin.y).toBeGreaterThan(70)
  await page.evaluate(() => { window.pdfHarness.highlightSelection(); window.pdfHarness.clearSelection(); window.pdfHarness.zoomIn() })
  await expect(page.locator('.page[data-page-number="2"] .app-highlight').first()).toBeVisible()
  await selectPageText(page, 2, 'Rotated cropped page')
  const zoomed = (await snapshot(page)).selection!.geometry[0]
  expect(zoomed.rect.origin.x).toBeCloseTo(original.rect.origin.x, 0)
  expect(zoomed.rect.origin.y).toBeCloseTo(original.rect.origin.y, 0)
  expect(zoomed.rect.size.width).toBeCloseTo(original.rect.size.width, 0)
})

test('multi-page selection highlights only text fragments including the intermediate page', async ({ page }) => {
  await openViewer(page)
  for (const pageNumber of [2, 3]) {
    await page.evaluate((pageNumber) => window.pdfHarness.goToPage(pageNumber), pageNumber)
    await expect(page.locator(`.page[data-page-number="${pageNumber}"] .textLayer span`).first()).toBeAttached()
  }
  await page.evaluate(() => {
    const first = Array.from(document.querySelectorAll('.page[data-page-number="1"] .textLayer span')).find((element) => element.textContent?.includes('Select this first'))!.firstChild!
    const last = Array.from(document.querySelectorAll('.page[data-page-number="3"] .textLayer span')).find((element) => element.textContent?.includes('Final page three'))!.firstChild!
    const range = document.createRange()
    range.setStart(first, 0)
    range.setEnd(last, last.textContent!.length)
    const selected = window.getSelection()!
    selected.removeAllRanges()
    selected.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  await expect.poll(async () => (await snapshot(page)).selection?.geometry.length).toBe(3)
  const selected = (await snapshot(page)).selection!
  expect(selected.text).toContain('Rotated cropped page text.')
  for (const geometry of selected.geometry) {
    expect(geometry.segmentRects.length).toBeGreaterThan(0)
    for (const rect of geometry.segmentRects) {
      expect(rect.size.height).toBeLessThan(30)
      expect(rect.size.width).toBeLessThan(500)
    }
  }
  await page.evaluate(() => window.pdfHarness.highlightSelection())
  await expect.poll(() => page.locator('.app-highlight').count()).toBe(selected.geometry.reduce((count, item) => count + item.segmentRects.length, 0))
})

test('ctrl-wheel zoom changes the PDF scale without browser viewport zoom', async ({ page }) => {
  await openViewer(page)
  const initialScale = (await snapshot(page)).state.zoom
  await page.mouse.move(190, 250)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Control')
  await expect.poll(async () => (await snapshot(page)).state.zoom).toBeGreaterThan(initialScale * 1.2)
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1)
  await page.evaluate(() => window.pdfHarness.fitWidth())
  await expect.poll(async () => (await snapshot(page)).state.zoom).toBeCloseTo(initialScale, 2)
})

test('upstream touch gestures pinch the PDF, pan with two fingers, and retain native one-finger scroll', async ({ page, context }, testInfo) => {
  test.skip(!testInfo.project.use.isMobile, 'CDP touch gestures require the mobile project.')
  await openViewer(page)
  const cdp = await context.newCDPSession(page)
  const initialScale = (await snapshot(page)).state.zoom
  await touch(cdp, 'touchStart', [[145, 280], [245, 280]])
  await touch(cdp, 'touchMove', [[120, 280], [270, 280]])
  await touch(cdp, 'touchMove', [[90, 280], [300, 280]])
  await touch(cdp, 'touchMove', [[55, 280], [335, 280]])
  await touch(cdp, 'touchEnd', [])
  await expect.poll(async () => (await snapshot(page)).state.zoom).toBeGreaterThan(initialScale * 1.3)
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1)
  const beforePan = await page.locator('#viewport').evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }))
  await touch(cdp, 'touchStart', [[120, 350], [220, 350]])
  await touch(cdp, 'touchMove', [[80, 290], [180, 290]])
  await touch(cdp, 'touchMove', [[50, 250], [150, 250]])
  await touch(cdp, 'touchEnd', [])
  const afterPan = await page.locator('#viewport').evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }))
  expect(afterPan.left).toBeGreaterThan(beforePan.left + 20)
  expect(afterPan.top).toBeGreaterThan(beforePan.top + 40)
  const beforeScroll = afterPan.top
  await touch(cdp, 'touchStart', [[190, 500]])
  await touch(cdp, 'touchMove', [[190, 460]])
  await touch(cdp, 'touchMove', [[190, 380]])
  await touch(cdp, 'touchMove', [[190, 280]])
  await touch(cdp, 'touchEnd', [])
  await expect.poll(async () => page.locator('#viewport').evaluate((element) => element.scrollTop)).toBeGreaterThan(beforeScroll + 30)
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1)
  await cdp.detach()
})

test('aborting removes listeners and its worker, then reopens the original undetached source', async ({ page, context }) => {
  await openViewer(page)
  const cdp = await context.newCDPSession(page)
  const originalByteLength = (await snapshot(page)).sourceByteLength
  expect(originalByteLength).toBeGreaterThan(100)
  const active = await listenerCounts(cdp)
  expect(active.wheel).toBeGreaterThan(0)
  expect(active.touchstart).toBeGreaterThan(0)
  expect(active.selectionchange).toBeGreaterThan(0)
  await page.evaluate(() => { window.pdfHarness.abort(); window.pdfHarness.resetEvents() })
  await expect.poll(async () => (await snapshot(page)).activeWorkers).toBe(0)
  const removed = await listenerCounts(cdp)
  expect(removed.wheel).toBe(0)
  expect(removed.touchstart).toBe(0)
  expect(removed.selectionchange).toBeLessThan(active.selectionchange)
  await page.locator('#viewport').dispatchEvent('wheel', { deltaY: -50, ctrlKey: true })
  await page.evaluate(() => document.dispatchEvent(new Event('selectionchange')))
  await page.waitForTimeout(50)
  expect((await snapshot(page)).events).toEqual([])
  await page.evaluate(() => window.pdfHarness.open())
  await expect.poll(async () => (await snapshot(page)).status).toBe('ready')
  await expect(page.locator('.page[data-page-number="1"] canvas').first()).toBeVisible()
  expect((await snapshot(page)).sourceByteLength).toBe(originalByteLength)
  expect((await snapshot(page)).activeWorkers).toBe(1)
  expect(await listenerCounts(cdp)).toEqual(active)
  await cdp.detach()
})

test('loads the existing remote proxy URL and aborts a pending open without stale callbacks', async ({ page }) => {
  await openViewer(page)
  const fixture = Buffer.from(await page.evaluate(() => window.pdfHarness.sourceBytes()))
  let releaseRequest: (() => void) | undefined
  let startedRequest: (() => void) | undefined
  const started = new Promise<void>((resolve) => { startedRequest = resolve })
  const release = new Promise<void>((resolve) => { releaseRequest = resolve })
  await page.route('**/api/pdf?url=*', async (route) => {
    startedRequest!()
    await release
    try { await route.fulfill({ status: 200, contentType: 'application/pdf', body: fixture }) } catch { /* An aborted request is expected in this case. */ }
  })
  await page.evaluate(() => { void window.pdfHarness.open('remote') })
  await started
  await page.evaluate(() => { window.pdfHarness.abort(); window.pdfHarness.resetEvents() })
  releaseRequest!()
  await expect.poll(async () => (await snapshot(page)).activeWorkers).toBe(0)
  await page.waitForTimeout(100)
  expect((await snapshot(page)).events).toEqual([])
  await page.unroute('**/api/pdf?url=*')
  let proxyUrl = ''
  await page.route('**/api/pdf?url=*', async (route) => {
    proxyUrl = route.request().url()
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: fixture })
  })
  await page.evaluate(() => window.pdfHarness.open('remote'))
  await expect.poll(async () => (await snapshot(page)).status).toBe('ready')
  await expect(page.locator('.page[data-page-number="1"] canvas').first()).toBeVisible()
  expect(new URL(proxyUrl).searchParams.get('url')).toBe('https://fixture.example/document.pdf')
  expect((await snapshot(page)).errors).toEqual([])
})
