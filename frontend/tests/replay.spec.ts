import { expect, test } from '@playwright/test'

test('merged dashboard follows the backend replay and exposes real model data', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await request.post('/v1/replay/control', { data: { action: 'reset' } })
  await page.goto('/')
  await expect(page.getByText('TALON API CONNECTED').first()).toBeVisible()
  await expect(page.locator('.replay-summary')).toContainText('0 /')

  await page.getByLabel('Replay speed').selectOption('20')
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(async () => (await (await request.get('/v1/events')).json()).cursor).toBeGreaterThan(20)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  const paused = await (await request.get('/v1/events')).json()
  await expect(page.locator('.replay-summary')).toContainText(`${paused.cursor} / ${paused.total}`)
  await page.getByRole('button', { name: 'Live feed' }).click()
  await expect(page.getByRole('dialog', { name: /Live event feed/ })).toContainText(paused.events.at(-1).id)
  await page.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('button', { name: 'Models & evaluation' }).click()
  await expect(page.getByLabel('Model availability and evaluation')).toContainText(paused.intelligence.models.version)
  await expect(page.getByLabel('Case reconstruction evaluation')).toContainText('Case reconstruction · ready')
  await page.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(async () => (await (await request.get('/v1/events')).json()).status, { timeout: 30000 }).toBe('completed')
  const completed = await (await request.get('/v1/events')).json()
  const targetCase = completed.intelligence.cases.find((item: { entities: { id: string }[]; transactionIds: string[] }) =>
    new Set(completed.events.filter((event: { id: string }) => item.transactionIds.includes(event.id))
      .map((event: { fromBank: string; fromAccount: string }) => `${event.fromBank}/${event.fromAccount}`)).size >= 2)
  expect(targetCase).toBeTruthy()
  await page.locator('.case-card').filter({ hasText: targetCase.id }).click()
  await expect(page.locator('.selected-case-float')).toContainText(targetCase.id)
  await page.getByRole('button', { name: 'Case details' }).click()
  await expect(page.getByRole('dialog')).toContainText(targetCase.id)
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Simulate hold' }).click()
  await page.getByRole('button', { name: 'Compare holds' }).click()
  await expect(page.getByRole('dialog', { name: 'Compare a hold set' })).toContainText('Interrupted transfers')
  await page.getByRole('button', { name: 'Close' }).click()
  expect(errors).toEqual([])
  await request.post('/v1/replay/control', { data: { action: 'reset' } })
})

test('a selected local dataset starts analysis from the replay bar', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'accounts.csv', mimeType: 'text/csv',
    buffer: Buffer.from('account_id,risk_score,transaction_count\nA,81,2\nB,,3\n'),
  })
  await expect(page.getByRole('button', { name: 'Analyze', exact: true })).toBeVisible()
  await expect(page.locator('.replay-summary')).toContainText('2 accounts')
  await page.getByRole('button', { name: 'Analyze', exact: true }).click()
  await expect(page.getByRole('main', { name: 'Dataset detection progress' })).toBeVisible()
  await expect(page.getByText('Running the detection pipeline against')).toContainText('accounts.csv')
})

test('local analysis preserves source risk and does not invent missing scores', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'accounts.csv', mimeType: 'text/csv',
    buffer: Buffer.from('account_id,risk_score,transaction_count\nA,81,2\nB,,3\n'),
  })
  await page.getByRole('button', { name: 'Analyze', exact: true }).click()
  await expect(page.getByText('LOCAL ANALYSIS RESULTS', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('table').first()).toContainText('81.0')
  await expect(page.getByRole('table').first()).toContainText('B')
  await page.getByRole('row', { name: /B Unlinked/ }).click()
  await expect(page.getByText('No risk value supplied')).toBeVisible()
  await expect(page.getByText('Analysis uses fields available in the imported CSV and stays in this browser.')).toBeVisible()
})
