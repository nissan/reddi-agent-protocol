import { test, expect } from '@playwright/test'

/** /jobs: the signed-in user's recorded paid calls (#740). Without a database configured it must say so, not show data. */
test.describe('/jobs page', () => {
  test('loads with a heading and no server error', async ({ page }) => {
    await page.goto('/jobs')
    await expect(page.getByRole('heading', { level: 1, name: 'My jobs' })).toBeVisible()
    await expect(page.locator('body')).not.toContainText(/Internal Server Error/i)
  })

  test('shows no job rows when nobody is signed in', async ({ page }) => {
    await page.goto('/jobs')
    await expect(page.locator('[data-testid="jobs-not-configured"], [data-testid="jobs-signed-out"]')).toBeVisible()
    await expect(page.getByTestId('jobs-list')).toHaveCount(0)
  })
})
