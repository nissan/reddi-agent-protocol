import { test, expect } from '@playwright/test'

test.describe('Navigation', () => {
  test('core routes load with 200', async ({ page }) => {
    const routes = [
      '/',
      '/agents',
      '/register',
      '/setup',
      '/onboarding',
      '/adl',
      '/customize',
      '/dashboard',
      '/manager',
      '/manager/discovery',
      '/specialist',
      '/planner',
      '/attestation',
      '/testers',
    ]
    for (const route of routes) {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 15000 })
      expect(response?.status(), `${route} should return 200`).toBe(200)
      await expect(page.locator('body'), `${route} should render body`).toBeVisible()
    }
  })

  test('navbar links navigate correctly', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('navigation').getByRole('link', { name: /directory/i })).toBeVisible()
    await page.getByRole('navigation').getByRole('link', { name: /directory/i }).click()
    await expect(page).toHaveURL(/\/agents/)
  })
})
