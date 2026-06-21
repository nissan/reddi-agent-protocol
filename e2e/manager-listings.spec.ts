import { expect, test, type Page } from '@playwright/test'

const queueStates = [
  'draft',
  'needs_changes',
  'approve_ready',
  'published_placeholder',
  'unpublished',
  'rejected',
  'blocked',
  'suspended',
]

const actionLabels = [
  'Approve',
  'Reject',
  'Request changes',
  'Publish',
  'Unpublish',
  'Suspend',
  'Payment readiness',
  'Publication readiness',
]

const payShPreviewStates = [
  'preview_ready',
  'missing_pricing',
  'invalid_endpoint',
  'live_disabled',
  'unsafe_metadata',
]

const payShControlLabels = [
  'Submit to Pay.sh',
  'Paid call',
  'Wallet/RPC',
  'Live activation',
]

async function gotoListings(page: Page) {
  await page.goto('/manager/listings', { waitUntil: 'domcontentloaded' })
}

async function stabilizeEvidenceScreenshot(page: Page) {
  await page.addStyleTag({
    content: `
      nav.sticky {
        position: static !important;
        top: auto !important;
      }
    `,
  })
}

test.describe('/manager/listings', () => {
  test.describe.configure({ timeout: 90_000 })

  test('renders every static approval queue state with visible marketplace boundaries', async ({ page }) => {
    await gotoListings(page)

    await expect(page.getByRole('heading', { name: /imported listing preview queue/i })).toBeVisible()
    await expect(page.getByText(/Imported agent stacks remain untrusted static metadata/i)).toBeVisible()

    for (const state of queueStates) {
      await expect(page.getByTestId(`marketplace-queue-state-${state}`)).toBeVisible()
    }

    const preview = page.getByTestId('marketplace-listing-preview')
    for (const label of ['imported metadata', 'external source', 'untrusted', 'not RAP-attested', 'not published', 'static-only']) {
      await expect(preview.getByText(label).first()).toBeVisible()
    }
    await expect(preview.getByText(/Placeholder only/i)).toBeVisible()
    await expect(page.getByTestId('marketplace-publication-evidence')).toBeVisible()
    await expect(page.getByTestId('pay-sh-preview-evidence')).toBeVisible()
    await expect(page.getByTestId('marketplace-static-boundary-note')).toContainText(/not a generic agent builder/i)
  })

  test('keeps approve, reject, publish, payment, and readiness actions disabled', async ({ page }) => {
    await gotoListings(page)

    const actions = page.getByTestId('marketplace-placeholder-actions')
    for (const label of actionLabels) {
      await expect(actions.getByRole('button', { name: new RegExp(`^${label}$`, 'i') })).toBeDisabled()
    }

    await expect(page.getByText(/no API mutation, live marketplace publication, payment activation, wallet signing, RPC probe, MCP call, repo fetch/i)).toBeVisible()

    const payShActions = page.getByTestId('pay-sh-disabled-controls')
    for (const label of payShControlLabels) {
      await expect(payShActions.getByRole('button', { name: new RegExp(`^${label}$`, 'i') })).toBeDisabled()
    }

    await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/Provider preview is review-only/i)
    await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/Wallet signing, top-up, and Solana RPC probes are out of scope/i)
  })

  test('distinguishes Pay.sh preview-ready, blocker, and live-disabled states', async ({ page }) => {
    await gotoListings(page)

    await page.getByTestId('pay-sh-preview-state-preview_ready').click()
    await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/Pay.sh-compatible preview/i)
    await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/Provider spec preview/)
    await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/ready/)
    await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/Live payment/)
    await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/disabled/)
    await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/Submitted to Pay.sh: no/)

    await page.getByTestId('pay-sh-preview-state-missing_pricing').click()
    await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/Missing pricing/i)
    await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/missing_price/)
    await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/PAY.md preview: blocked/i)

    await page.getByTestId('pay-sh-preview-state-invalid_endpoint').click()
    await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/Invalid endpoint/i)
    await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/zero_endpoints/)
    await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/unstable_provider_url/)

    await page.getByTestId('pay-sh-preview-state-live_disabled').click()
    await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/Live payment disabled/i)
    await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/Live payment enabled: no/)

    await page.getByTestId('pay-sh-preview-state-unsafe_metadata').click()
    await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/Blocked unsafe metadata/i)
    await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/unsafe_category_use_case/)
  })

  test('records preview to approval placeholder to request changes to publish and suspend placeholder path', async ({ page }) => {
    await gotoListings(page)

    await page.getByTestId('marketplace-queue-state-draft').click()
    await expect(page.getByTestId('marketplace-listing-preview')).toContainText(/Draft listing generated/i)

    await page.getByTestId('marketplace-queue-state-approve_ready').click()
    await expect(page.getByTestId('marketplace-listing-preview')).toContainText(/Approve-ready fixture state only/i)
    await expect(page.getByRole('button', { name: /^Approve$/i })).toBeDisabled()

    await page.getByTestId('marketplace-queue-state-needs_changes').click()
    await expect(page.getByTestId('marketplace-listing-preview')).toContainText(/Needs changes before approval/i)
    await expect(page.getByRole('button', { name: /^Request changes$/i })).toBeDisabled()

    await page.getByTestId('marketplace-queue-state-published_placeholder').click()
    await expect(page.getByTestId('marketplace-listing-preview')).toContainText(/Published state is represented as dry-run activation evidence/i)
    await expect(page.getByTestId('marketplace-publication-evidence')).toContainText(/Published \/ dry-run activation/i)
    await expect(page.getByTestId('marketplace-publication-evidence')).toContainText(/Dry-run activation only/i)
    await expect(page.getByRole('button', { name: /^Publish$/i })).toBeDisabled()

    await page.getByTestId('marketplace-queue-state-unpublished').click()
    await expect(page.getByTestId('marketplace-listing-preview')).toContainText(/Unpublished lifecycle state/i)
    await expect(page.getByTestId('marketplace-publication-evidence')).toContainText(/Latest lifecycle audit is unpublish/i)

    await page.getByTestId('marketplace-queue-state-suspended').click()
    await expect(page.getByTestId('marketplace-listing-preview')).toContainText(/Suspended imported listing fixture/i)
    await expect(page.getByRole('button', { name: /^Suspend$/i })).toBeDisabled()
  })

  test('distinguishes hosted attestation, Quasar, blocked, unpublished, and live-unavailable claim states', async ({ page }) => {
    await gotoListings(page)

    await page.getByTestId('marketplace-queue-state-approve_ready').click()
    await expect(page.getByTestId('marketplace-publication-evidence')).toContainText(/Hosted attestation pending/i)
    await expect(page.getByTestId('marketplace-publication-evidence')).toContainText(/Quasar/)

    await page.getByTestId('marketplace-queue-state-blocked').click()
    await expect(page.getByTestId('marketplace-publication-evidence')).toContainText(/Quasar compatibility pending/i)
    await expect(page.getByTestId('marketplace-publication-evidence')).toContainText(/Quasar-backed claim unavailable/i)

    await page.getByTestId('marketplace-queue-state-needs_changes').click()
    await expect(page.getByTestId('marketplace-publication-evidence')).toContainText(/Blocked evidence/i)
    await expect(page.getByTestId('marketplace-publication-evidence')).toContainText(/Payment proof missing/i)

    await page.getByTestId('marketplace-queue-state-published_placeholder').click()
    await expect(page.getByTestId('marketplace-publication-evidence')).toContainText(/Live publication: unavailable/i)
    await expect(page.getByTestId('marketplace-publication-evidence')).toContainText(/Buyer-facing trust\/reputation claims: disabled/i)
  })

  for (const viewport of [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'tablet', width: 834, height: 1112 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    for (const state of payShPreviewStates) {
      test(`captures Pay.sh ${state} at ${viewport.name} ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await gotoListings(page)
        await stabilizeEvidenceScreenshot(page)
        await page.getByTestId('marketplace-queue-state-published_placeholder').click()
        await page.getByTestId(`pay-sh-preview-state-${state}`).click()

        await expect(page.getByTestId('marketplace-listing-preview')).toBeVisible()
        await expect(page.getByTestId('pay-sh-preview-evidence')).toBeVisible()
        await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/Submitted to Pay.sh: no/)
        await expect(page.getByTestId('pay-sh-preview-evidence')).toContainText(/Live payment enabled: no/)
        await page.getByTestId('pay-sh-preview-evidence').screenshot({
          path: `artifacts/manager-listings/${viewport.name}-pay-sh-${state}-${viewport.width}x${viewport.height}.png`,
        })
      })
    }
  }
})
