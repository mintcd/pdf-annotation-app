import { expect, test, type Page } from '@playwright/test'

type Descriptor = { databaseName: string; clientId: string; deploymentVersion: string; accountId: string; streamId: string; enabled: boolean }

async function descriptor(page: Page): Promise<Descriptor | null> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('sync-engine:pdf_annotation:registry')
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    try {
      return await new Promise<Descriptor | null>((resolve, reject) => {
        const request = database.transaction('replicas').objectStore('replicas').get('main')
        request.onsuccess = () => resolve(request.result ?? null)
        request.onerror = () => reject(request.error)
      })
    } finally { database.close() }
  })
}

async function addColor(page: Page, color: string, semantics: string) {
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  await page.getByPlaceholder('#87ceeb').fill(color)
  await page.getByPlaceholder('Reference', { exact: true }).fill(semantics)
  await page.getByRole('button', { name: 'Add color', exact: true }).click()
  await expect(page.getByText(semantics, { exact: true })).toBeVisible()
}

async function replicaMeta(page: Page, databaseName: string): Promise<{ pendingCount: number; acceptedAwaitingCount: number; confirmedSequence: number } | undefined> {
  return page.evaluate(async name => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(name)
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    try {
      return await new Promise<{ pendingCount: number; acceptedAwaitingCount: number; confirmedSequence: number } | undefined>((resolve, reject) => {
        const request = database.transaction('internal:meta').objectStore('internal:meta').getAll()
        request.onsuccess = () => resolve(request.result.find(entry => entry.value?.kind === 'record-replica-v1')?.value)
        request.onerror = () => reject(request.error)
      })
    } finally { database.close() }
  }, databaseName)
}

async function pendingCount(page: Page, databaseName: string): Promise<number> {
  return (await replicaMeta(page, databaseName))?.pendingCount ?? -1
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Logout', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeVisible()
}

test('real app: D1 snapshot rollover, retained failures, queued edits and account isolation', async ({ page, context }) => {
  const suffix = crypto.randomUUID().slice(0, 8)
  const signup = await context.request.post('/api/auth/signup', { data: { username: `sync-a-${suffix}`, password: 'local-integration-only' } })
  expect(signup.status()).toBe(201)
  const accountA = await signup.json()
  expect(signup.headers()['set-cookie']).toContain('pdf_annotation_session=')
  const snapshots: { watermark: number; rowCount: number; rows: { collection: string; row: unknown }[] }[] = []
  page.on('response', response => {
    if (response.request().method() === 'GET' && response.url().includes('/api/sync?') && response.ok()) {
      // A later navigation can discard an unneeded response body. Assertions
      // below still require both complete snapshots used to verify rollover.
      void response.json().then(snapshot => snapshots.push(snapshot), () => undefined)
    }
  })
  let deploymentVersion = `integration-${suffix}-a`
  await page.route('**/api/auth/session', async route => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), deploymentVersion } })
  })
  await page.goto('/')
  await expect(page.getByTitle('Sync status: synced', { exact: true })).toBeVisible()
  const initial = await descriptor(page)
  expect(initial?.deploymentVersion).toBe(deploymentVersion)
  await addColor(page, '#123456', `D1-${suffix}`)
  await expect(page.getByTitle('Sync status: synced', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByTitle('Sync status: synced', { exact: true })).toBeVisible()
  expect((await descriptor(page))?.clientId).toBe(initial?.clientId)
  expect(snapshots.length).toBe(1)

  deploymentVersion = `integration-${suffix}-b`
  await page.reload()
  await expect(page.getByTitle('Sync status: synced', { exact: true })).toBeVisible()
  const rebuilt = await descriptor(page)
  expect(rebuilt?.clientId).not.toBe(initial?.clientId)
  expect(rebuilt?.databaseName).not.toBe(initial?.databaseName)
  expect(rebuilt?.deploymentVersion).toBe(deploymentVersion)
  await expect.poll(() => snapshots.length).toBe(2)
  expect(snapshots[1].watermark).toBeGreaterThan(0)
  expect(snapshots[1].rows).toContainEqual({ collection: 'highlight_colors', row: { color: '#123456', semantics: `D1-${suffix}` } })

  deploymentVersion = `integration-${suffix}-c`
  await page.route('**/api/sync?**', route => route.abort('internetdisconnected'))
  await page.reload()
  await expect(page.getByTitle('Sync status: error', { exact: true })).toBeVisible()
  expect((await descriptor(page))?.databaseName).toBe(rebuilt?.databaseName)
  expect((await descriptor(page))?.deploymentVersion).toBe(rebuilt?.deploymentVersion)
  await page.unroute('**/api/sync?**')
  deploymentVersion = rebuilt!.deploymentVersion
  await page.reload()
  await expect(page.getByTitle('Sync status: synced', { exact: true })).toBeVisible()

  await page.route('**/api/sync', route => route.abort('internetdisconnected'))
  await addColor(page, '#654321', `Queued-${suffix}`)
  await expect.poll(() => pendingCount(page, rebuilt!.databaseName)).toBeGreaterThan(0)
  deploymentVersion = `integration-${suffix}-c`
  await page.reload()
  await expect(page.getByText(/previous local replica has unsynced edits/)).toBeVisible()
  expect((await descriptor(page))?.databaseName).toBe(rebuilt?.databaseName)
  expect((await descriptor(page))?.deploymentVersion).toBe(rebuilt?.deploymentVersion)
  await page.unroute('**/api/sync')
  deploymentVersion = rebuilt!.deploymentVersion
  await page.reload()
  await expect(page.getByTitle('Sync status: synced', { exact: true })).toBeVisible()
  deploymentVersion = `integration-${suffix}-c`
  await page.reload()
  await expect(page.getByTitle('Sync status: synced', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  await expect(page.getByText(`Queued-${suffix}`, { exact: true })).toBeVisible()

  const crossAccount = await context.request.get(`/api/sync?bootstrap=1&protocolVersion=1&contractVersion=pdf-annotation%2F1&streamId=user%3Aother`)
  expect(crossAccount.status()).toBe(403)
  for (const endpoint of ['/api/documents', '/api/annotations', '/api/operations']) {
    expect((await context.request.post(endpoint, { data: {} })).status()).toBe(410)
  }
  const originalCookie = (await context.cookies()).find(cookie => cookie.name === 'pdf_annotation_session')!
  await logout(page)
  expect((await descriptor(page))?.enabled).toBe(false)
  const revoked = await context.request.get('/api/auth/session', { headers: { cookie: `${originalCookie.name}=${originalCookie.value}` } })
  expect((await revoked.json()).authenticated).toBe(false)
  const signupB = await context.request.post('/api/auth/signup', { data: { username: `sync-b-${suffix}`, password: 'local-integration-only' } })
  expect(signupB.status()).toBe(201)
  await page.reload()
  await expect(page.getByTitle('Sync status: synced', { exact: true })).toBeVisible()
  expect((await descriptor(page))?.accountId).not.toBe(accountA.userId)
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  await expect(page.getByText(`Queued-${suffix}`, { exact: true })).toHaveCount(0)
  await expect(page.getByText(`D1-${suffix}`, { exact: true })).toHaveCount(0)
  const firstB = await descriptor(page)
  // Defaults enqueue asynchronously after the first ready render. Confirm all
  // four seeded colors before exercising a settled-account switch.
  await expect.poll(async () => {
    const meta = await replicaMeta(page, firstB!.databaseName)
    return !!meta && meta.confirmedSequence >= 4 && meta.pendingCount === 0 && meta.acceptedAwaitingCount === 0
  }).toBe(true)

  // An account change must also retain access to the previous account's queue.
  await logout(page)
  const loginA = await context.request.post('/api/auth/login', { data: { username: `sync-a-${suffix}`, password: 'local-integration-only' } })
  expect(loginA.status()).toBe(200)
  await page.reload()
  await expect(page.getByTitle('Sync status: synced', { exact: true })).toBeVisible()
  const retainedA = await descriptor(page)
  await page.route('**/api/sync', route => route.abort('internetdisconnected'))
  await addColor(page, '#abcdef', `Account-queue-${suffix}`)
  await expect.poll(() => pendingCount(page, retainedA!.databaseName)).toBeGreaterThan(0)
  await logout(page)
  expect((await context.request.post('/api/auth/login', { data: { username: `sync-b-${suffix}`, password: 'local-integration-only' } })).status()).toBe(200)
  await page.reload()
  await expect(page.getByText(/previous local replica has unsynced edits/)).toBeVisible()
  expect((await descriptor(page))?.databaseName).toBe(retainedA?.databaseName)
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  await logout(page)
  await page.unroute('**/api/sync')
  expect((await context.request.post('/api/auth/login', { data: { username: `sync-a-${suffix}`, password: 'local-integration-only' } })).status()).toBe(200)
  await page.reload()
  await expect(page.getByTitle('Sync status: synced', { exact: true })).toBeVisible()
  expect((await descriptor(page))?.clientId).toBe(retainedA?.clientId)
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  await expect(page.getByText(`Account-queue-${suffix}`, { exact: true })).toBeVisible()
  await logout(page)
  expect((await context.request.post('/api/auth/login', { data: { username: `sync-b-${suffix}`, password: 'local-integration-only' } })).status()).toBe(200)
  await page.reload()
  await expect(page.getByTitle('Sync status: synced', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  await expect(page.getByText(`Account-queue-${suffix}`, { exact: true })).toHaveCount(0)
})
