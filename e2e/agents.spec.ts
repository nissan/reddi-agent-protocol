import { test, expect } from '@playwright/test'

test.describe('/agents page', () => {
  test('loads without crashing', async ({ page }) => {
    await page.goto('/agents')
    await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i)
  })

  test('shows page heading and filter pills', async ({ page }) => {
    await page.goto('/agents')
    await expect(page.getByRole('heading', { name: /specialist directory/i })).toBeVisible()
    const pills = page.locator('button').filter({ hasText: /summarize|analyze|transform|classify/i })
    await expect(pills.first()).toBeVisible()
  })

  test('shows agent cards or the empty state', async ({ page }) => {
    await page.goto('/agents')
    const cards = page.locator('[data-testid="agent-card"]')
    const count = await cards.count()

    if (count > 0) {
      await expect(cards.first()).toBeVisible()
    } else {
      await expect(page.getByRole('heading', { name: /specialist directory/i })).toBeVisible()
      await expect(page.getByText(/Discover AI specialist metadata and evidence boundaries/i)).toBeVisible()
    }
  })
})
