import { expect, test } from '@playwright/test'

const laneIds = [
  'source_provenance',
  'identity_evidence',
  'payment_readiness',
  'reputation_evidence',
  'policy_fit',
  'actionability',
]

test.describe('/manager/discovery actionability matrix (#506)', () => {
  test('renders all six lanes with per-lane states and the discovery-vs-trust boundary', async ({ page }) => {
    await page.goto('/manager/discovery')

    const matrix = page.getByTestId('discovery-actionability-matrix')
    await expect(matrix).toBeVisible()

    for (const lane of laneIds) {
      await expect(matrix.getByTestId(`discovery-actionability-lane-${lane}`)).toBeVisible()
    }

    await expect(matrix.getByTestId('discovery-actionability-boundary')).toContainText(
      /Discovery relevance \(ARD\) is not RAP trust, attestation, or authorization/i,
    )
    await expect(matrix.getByText('discovery ≠ trust')).toBeVisible()

    // Default selection is the approve-ready draft fixture: payment missing, review pending.
    await expect(matrix.getByTestId('discovery-actionability-state-source_provenance')).toHaveText('self-asserted')
    await expect(matrix.getByTestId('discovery-actionability-state-payment_readiness')).toHaveText('unavailable')
    await expect(matrix.getByTestId('discovery-actionability-state-reputation_evidence')).toHaveText('unavailable')
    await expect(matrix.getByTestId('discovery-actionability-state-actionability')).toHaveText('needs human review')
  })

  test('preserves source provenance: origin, snapshot, crawl time, self-asserted metadata', async ({ page }) => {
    await page.goto('/manager/discovery')

    const provenance = page.getByTestId('discovery-actionability-provenance')
    await expect(provenance).toBeVisible()
    await expect(provenance.getByText('Origin', { exact: true })).toBeVisible()
    await expect(provenance.getByText('static-import')).toBeVisible()
    await expect(provenance.getByText('Snapshot', { exact: true })).toBeVisible()
    await expect(provenance.getByText('Crawl / snapshot time')).toBeVisible()
    await expect(provenance.getByText(/self-asserted until separately verified/i)).toBeVisible()
    await expect(provenance.getByText(/no publish,\s*payment, endpoint call, wallet\/RPC action, or registry\/trust\/reputation mutation/i)).toBeVisible()
  })

  test('lane states change per candidate without any enabled mutation path', async ({ page }) => {
    await page.goto('/manager/discovery')

    const filters = page.getByTestId('operator-discovery-filters')

    await filters.getByRole('button', { name: /^Rejected/i }).click()
    await page.getByTestId('operator-discovery-queue-rejectedMalformedConnector').click()
    await expect(page.getByTestId('discovery-actionability-state-identity_evidence')).toHaveText('failed verification')
    await expect(page.getByTestId('discovery-actionability-state-actionability')).toHaveText('blocked')

    await filters.getByRole('button', { name: /^Suspended/i }).click()
    await page.getByTestId('operator-discovery-queue-solanaAiKitBlocked').click()
    await expect(page.getByTestId('discovery-actionability-state-policy_fit')).toHaveText('blocked')
    await expect(page.getByTestId('discovery-actionability-state-actionability')).toHaveText('production-disabled')

    // The placeholder action grid must stay disabled while the matrix is rendered.
    const actions = page.getByTestId('operator-discovery-placeholder-actions')
    for (const label of ['Approve', 'Publish', 'Payment', 'RAP attestation']) {
      await expect(actions.getByRole('button', { name: new RegExp(`^${label}$`, 'i') })).toBeDisabled()
    }
  })

  for (const viewport of [
    { name: 'mobile', width: 375, height: 812 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    test(`captures ${viewport.name} ${viewport.width}px evidence of the matrix`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/manager/discovery')

      const matrix = page.getByTestId('discovery-actionability-matrix')
      await matrix.scrollIntoViewIfNeeded()
      await expect(matrix).toBeVisible()
      await expect(matrix.getByTestId('discovery-actionability-lane-actionability')).toBeVisible()

      await page.screenshot({
        path: `docs/evidence/506/${viewport.name}-${viewport.width}.png`,
        fullPage: true,
      })
    })
  }
})
