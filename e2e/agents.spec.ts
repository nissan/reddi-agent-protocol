import { test, expect } from '@playwright/test'

test.describe('/agents page', () => {
  test('loads without crashing', async ({ page }) => {
    await page.goto('/agents')
    // Should not show error page
    await expect(page.locator('body')).not.toContainText(/500|Internal Server Error/i)
  })

  test('shows page heading and demo mode toggle', async ({ page }) => {
    await page.goto('/agents')
    // Page heading should be present
    await expect(page.getByRole('heading', { name: /Browse Specialists/i })).toBeVisible()
    // Demo mode toggle button
    await expect(page.getByRole('button', { name: /demo mode/i })).toBeVisible()
  })

  test('shows agent cards from seed data', async ({ page }) => {
    await page.goto('/agents')
    // SeedAgentCards are rendered from the seed data — should have at least one
    const cards = page.locator('[data-testid="agent-card"]')
    await expect(cards.first()).toBeVisible()
    const count = await cards.count()
    expect(count).toBeGreaterThan(0)
  })
})
