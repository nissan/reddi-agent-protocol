import { expect, test } from '@playwright/test'

const requiredFixtureKeys = [
  'approveReadyDraft',
  'requestChangesMissingPayment',
  'rejectedMalformedConnector',
  'suspendedUnsafeMetadata',
  'solanaAiKitBlocked',
]

const requiredTabs = [
  'All',
  'Needs review',
  'Blocked',
  'Approve-ready',
  'Request changes',
  'Rejected',
  'Suspended',
]

test.describe('/manager/discovery', () => {
  test('renders static operator discovery review workspace and fixture states', async ({ page }) => {
    await page.goto('/manager/discovery')

    await expect(page.getByRole('heading', { name: /static imported catalog workspace/i })).toBeVisible()
    await expect(page.getByText(/External imported content is untrusted, not RAP-attested, and static-only/i)).toBeVisible()

    const filters = page.getByTestId('operator-discovery-filters')
    for (const tab of requiredTabs) {
      await expect(filters.getByRole('button', { name: new RegExp(`^${tab}`, 'i') })).toBeVisible()
    }

    for (const key of requiredFixtureKeys) {
      await expect(page.getByTestId(`operator-discovery-queue-${key}`)).toBeVisible()
    }

    await expect(page.getByText(/repo-marketplace-metadata/i).first()).toBeVisible()
    await expect(page.getByText(/claude-plugin/i).first()).toBeVisible()
    await expect(page.getByText(/raw refs/i)).toBeVisible()
    await expect(page.getByText(/storybook:agent-stack\/operator-review/i).first()).toBeVisible()
    const detail = page.getByTestId('operator-discovery-detail')
    await expect(detail.getByText(/^not RAP-attested$/i)).toBeVisible()
    await expect(detail.getByText(/^static-only$/i)).toBeVisible()
  })

  test('filters review lanes and shows empty state without mutating anything', async ({ page }) => {
    await page.goto('/manager/discovery')

    const filters = page.getByTestId('operator-discovery-filters')

    await filters.getByRole('button', { name: /^Rejected/i }).click()
    await expect(page.getByTestId('operator-discovery-queue-rejectedMalformedConnector')).toBeVisible()
    await expect(page.getByText(/rejected_malformed_connector/i).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: /^Diagnostics$/i })).toBeVisible()

    await filters.getByRole('button', { name: /^Suspended/i }).click()
    await expect(page.getByTestId('operator-discovery-queue-suspendedUnsafeMetadata')).toBeVisible()
    await expect(page.getByTestId('operator-discovery-queue-solanaAiKitBlocked')).toBeVisible()
    await expect(page.getByText(/suspended_imported_listing/i).first()).toBeVisible()

    await filters.getByRole('button', { name: /^Approve-ready/i }).click()
    await expect(page.getByTestId('operator-discovery-queue-approveReadyDraft')).toBeVisible()
    await expect(page.getByText(/no malformed connector diagnostics selected/i)).toBeVisible()
    await expect(page.getByTestId('operator-discovery-supply-empty-state')).toBeVisible()
  })

  test('keeps all marketplace, payment, publication, readiness, and attestation actions disabled', async ({ page }) => {
    await page.goto('/manager/discovery')

    const actions = page.getByTestId('operator-discovery-placeholder-actions')
    for (const label of ['Approve', 'Ignore', 'Request changes', 'Suspend', 'Publish', 'Payment', 'Readiness', 'RAP attestation']) {
      await expect(actions.getByRole('button', { name: new RegExp(`^${label}$`, 'i') })).toBeDisabled()
    }

    await expect(page.getByText(/no API mutation, live payment, publication, wallet, RPC, MCP contact, repo fetch, or imported command execution/i)).toBeVisible()
    await expect(page.getByText(/Do not store secrets/i)).toBeVisible()
  })

  for (const viewport of [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'tablet', width: 834, height: 1112 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    test(`supports ${viewport.name} ${viewport.width}x${viewport.height} review`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto('/manager/discovery')

      await expect(page.getByTestId('operator-discovery-workspace')).toBeVisible()
      await expect(page.getByTestId('operator-discovery-detail')).toBeVisible()
      await expect(page.getByText(/Marketplace Draft Preview/i)).toBeVisible()
      await expect(page.getByText(/Static Guardrails/i)).toBeVisible()
      await page.screenshot({ path: `artifacts/manager-discovery/${viewport.name}-${viewport.width}x${viewport.height}.png`, fullPage: true })
    })
  }
})
