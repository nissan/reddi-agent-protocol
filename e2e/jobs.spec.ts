import { test, expect } from '@playwright/test'

/** /jobs: the signed-in user's recorded paid calls (#740). Without a database configured it must say so, not show data. */
test.describe('/jobs page', () => {
  test('loads with a heading and no server error', async ({ page }) => {
    await page.goto('/jobs')
    await expect(page.getByRole('heading', { level: 1, name: /every call you paid for, with its receipt/i })).toBeVisible()
    await expect(page.locator('body')).not.toContainText(/Internal Server Error/i)
  })

  test('shows no job rows when nobody is signed in', async ({ page }) => {
    await page.goto('/jobs')
    await expect(page.locator('[data-testid="jobs-not-configured"], [data-testid="jobs-signed-out"]')).toBeVisible()
    await expect(page.getByTestId('jobs-list')).toHaveCount(0)
  })

  test('before sign-in, shows a labelled example of the page and no real rows', async ({ page }) => {
    await page.goto('/jobs')
    const example = page.getByTestId('jobs-example')
    await expect(example).toBeVisible()
    await expect(example.getByRole('heading', { name: /what this page shows once you have jobs/i })).toContainText('EXAMPLE')
    await expect(example.getByRole('table', { name: /recent jobs/i })).toContainText('Atlas Review')
    await expect(example).toContainText(/made-up providers and values/i)
    // The example offers no actions: nothing in it can be clicked as if it were real.
    await expect(example.getByRole('link')).toHaveCount(0)
    await expect(example.getByRole('button')).toHaveCount(0)
    await expect(page.getByTestId('jobs-list')).toHaveCount(0)
  })
})
