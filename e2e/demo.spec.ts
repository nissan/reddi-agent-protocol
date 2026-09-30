import { test, expect } from '@playwright/test'

// The demo pipeline streams with additive delays (0+1.2+2.8+4.5+7.0+9.0+10.5 = ~35s total)
// Set a generous timeout for the full trace tests
const TRACE_TIMEOUT = 50_000

test.describe('/demo page', () => {
  test('loads with textarea and generate button', async ({ page }) => {
    await page.goto('/demo')
    await expect(page.locator('textarea')).toBeVisible()
    await expect(page.getByRole('button', { name: /generate/i })).toBeVisible()
  })

  test.skip('debug trace fires on Generate click', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/demo')
    await page.locator('textarea').fill('A landing page for a privacy-first AI assistant for developers')
    await page.getByRole('button', { name: /generate/i }).click()

    // Planning section appears first (delay 0ms)
    await expect(page.getByText(/Planning/i)).toBeVisible({ timeout: 5000 })
    
    // Agent Discovery appears (~1.2s)
    await expect(page.getByText(/Agent Discovery/i)).toBeVisible({ timeout: 8000 })
    
    // Escrow Deposit (~4s cumulative)
    await expect(page.getByText(/Escrow Deposit/i)).toBeVisible({ timeout: 12000 })
    
    // Primary Agent Responding (~8.5s cumulative)
    await expect(page.getByText(/Primary Agent Responding/i)).toBeVisible({ timeout: 18000 })

    // Attestation Scoring (~15.5s cumulative)
    await expect(page.getByText(/Attestation Scoring/i)).toBeVisible({ timeout: 25000 })
    
    // Commit-Reveal (~24.5s cumulative)
    await expect(page.getByText(/Commit-Reveal/i)).toBeVisible({ timeout: 35000 })
    
    // Complete (~35s cumulative)
    await expect(page.getByText(/Complete/i)).toBeVisible({ timeout: TRACE_TIMEOUT })
  })

  test.skip('iframe renders after pipeline completes', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/demo')
    await page.locator('textarea').fill('A landing page for a SaaS analytics tool')
    await page.getByRole('button', { name: /generate/i }).click()

    // Wait for completion (35s stream) then iframe should appear
    await expect(page.locator('iframe')).toBeVisible({ timeout: TRACE_TIMEOUT })
  })
})
