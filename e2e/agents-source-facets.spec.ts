import { test, expect, type Page } from "@playwright/test";

/**
 * #381 — discovery source facets on /agents.
 *
 * Covers: URL-addressable filter state (composable with the task-type
 * filter), distinct source render states (RAP-native, ARD-imported,
 * untrusted, blocked), empty-state explanations (no candidates vs filters too
 * narrow), keyboard/focus operability for filters and card actions, and the
 * discovery-not-trust boundary (no paid call / wallet / invocation
 * affordances on discovery cards).
 */

// /api/registry can take >20s when the devnet RPC is slow; give every test
// headroom beyond the 30s repo default.
test.describe.configure({ timeout: 60_000 });

async function gotoAgents(page: Page, query = "") {
  await page.goto(`/agents${query}`);
  await expect(page.getByRole("heading", { name: /specialist directory/i })).toBeVisible();
  // The Suspense boundary briefly renders the server tree alongside the
  // hydrating client tree (~100ms in dev); wait for it to settle to exactly
  // one filter group before asserting anything else.
  await expect
    .poll(async () => page.getByTestId("source-facet-filter").count(), { timeout: 30_000 })
    .toBe(1);
  await expect(page.getByTestId("source-facet-filter")).toBeVisible({ timeout: 30_000 });
}

async function waitForResults(page: Page) {
  await expect
    .poll(
      async () =>
        (await page.locator('[data-testid="agent-card"], [data-testid="marketplace-candidate-card"], [data-testid="discovery-empty-state"]').count()),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
}

test.describe("/agents source facets (#381)", () => {
  test("renders the source filter with all seven source classes", async ({ page }) => {
    await gotoAgents(page);
    for (const facet of [
      "rap-registry",
      "ard-catalog",
      "circle-x402",
      "pay-sh",
      "openrouter",
      "local-demo",
      "hosted-rap",
    ]) {
      await expect(page.getByTestId(`source-facet-${facet}`)).toBeVisible();
    }
  });

  test("source filter is URL-addressable and composable with the task-type filter", async ({ page }) => {
    await gotoAgents(page);
    await waitForResults(page);

    await page.getByTestId("source-facet-hosted-rap").click();
    await expect(page).toHaveURL(/[?&]source=hosted-rap/);
    await expect(page.getByTestId("source-facet-hosted-rap")).toHaveAttribute("aria-pressed", "true");

    // Compose with the existing task-type filter.
    await page.getByRole("group", { name: /filter by task type/i }).getByRole("button", { name: "Code", exact: true }).click();
    await expect(page).toHaveURL(/[?&]source=hosted-rap/);
    await expect(page).toHaveURL(/[?&]task=code/);

    // Toggling the source off removes only the source param.
    await page.getByTestId("source-facet-hosted-rap").click();
    await expect(page).not.toHaveURL(/[?&]source=/);
    await expect(page).toHaveURL(/[?&]task=code/);
  });

  test("deep links restore filter state from the querystring", async ({ page }) => {
    await gotoAgents(page, "?source=ard-catalog,hosted-rap&task=code");
    await expect(page.getByTestId("source-facet-ard-catalog")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("source-facet-hosted-rap")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("source-facet-circle-x402")).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByRole("group", { name: /filter by task type/i }).getByRole("button", { name: "Code", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("hosted RAP candidates render untrusted and blocked states distinctly", async ({ page }) => {
    await gotoAgents(page, "?source=hosted-rap");
    await waitForResults(page);

    const cards = page.locator('[data-testid="marketplace-candidate-card"][data-source-facet="hosted-rap"]');
    expect(await cards.count()).toBeGreaterThan(0);

    const untrusted = page
      .locator('[data-testid="marketplace-candidate-card"][data-source-facet="hosted-rap"][data-render-state="untrusted"]')
      .first();
    await expect(untrusted).toBeVisible();
    await expect(untrusted.getByTestId("candidate-source-badge")).toHaveText(/hosted rap registry/i);
    await expect(untrusted.getByTestId("candidate-trust-badge")).toBeVisible();
    await expect(untrusted.getByTestId("candidate-readiness-badge")).toHaveText(/live-gated/i);
    await expect(untrusted.getByTestId("candidate-resource-type")).toBeVisible();

    const blocked = page
      .locator('[data-testid="marketplace-candidate-card"][data-source-facet="hosted-rap"][data-render-state="blocked"]')
      .first();
    await expect(blocked).toBeVisible();
    await expect(blocked).toContainText(/blocked/i);
  });

  test("ARD-imported candidates render imported and malformed/blocked states distinctly", async ({ page }) => {
    await gotoAgents(page, "?source=ard-catalog");
    await waitForResults(page);

    const imported = page
      .locator('[data-testid="marketplace-candidate-card"][data-source-facet="ard-catalog"][data-render-state="ard-imported"]')
      .first();
    await expect(imported).toBeVisible();
    await expect(imported).toContainText(/imported snapshot/i);
    await expect(imported.getByTestId("candidate-trust-badge")).toBeVisible();

    const blocked = page
      .locator('[data-testid="marketplace-candidate-card"][data-source-facet="ard-catalog"][data-render-state="blocked"]')
      .first();
    await expect(blocked).toBeVisible();
    await expect(blocked.getByTestId("candidate-trust-badge")).toHaveText(/failed verification|blocked/i);
  });

  test("RAP-native specialist cards render with a source badge and trust state", async ({ page }) => {
    await gotoAgents(page);
    await waitForResults(page);

    const specialist = page.locator('[data-testid="agent-card"]').first();
    await expect(specialist).toBeVisible({ timeout: 45_000 });
    await expect(specialist).toHaveAttribute("data-render-state", "rap-native");
    await expect(specialist).toHaveAttribute("data-trust-state", /trusted|unverified/);
    await expect(specialist.getByTestId("candidate-source-badge")).toBeVisible();
    await expect(specialist.getByTestId("candidate-resource-type")).toBeVisible();
  });

  test("empty state explains when no candidates exist from a source", async ({ page }) => {
    await gotoAgents(page, "?source=circle-x402");
    await waitForResults(page);

    const empty = page.getByTestId("discovery-empty-state");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(/no candidates exist from the selected sources/i);
    await expect(page.getByTestId("empty-source-circle-x402")).toContainText(/circle x402/i);
    await expect(page.getByTestId("clear-filters")).toBeVisible();
  });

  test("empty state explains when composed filters are too narrow", async ({ page }) => {
    await gotoAgents(page, "?source=hosted-rap&task=transcribe");
    await waitForResults(page);

    const empty = page.getByTestId("discovery-empty-state");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(/filters are too narrow/i);
    await expect(page.getByTestId("filters-too-narrow")).toContainText(/transcribe/i);

    // Clearing filters restores the unfiltered directory.
    await page.getByTestId("clear-filters").click();
    await expect(page).not.toHaveURL(/[?&](source|task)=/);
    await waitForResults(page);
    await expect(page.getByTestId("discovery-empty-state")).toHaveCount(0);
  });

  test("filters and card actions are keyboard operable with visible focus", async ({ page }) => {
    await gotoAgents(page, "?source=ard-catalog");
    await waitForResults(page);

    // Keyboard-toggle a source facet pill.
    const hostedPill = page.getByTestId("source-facet-hosted-rap");
    await hostedPill.focus();
    await expect(hostedPill).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/[?&]source=ard-catalog(,|%2C)hosted-rap/);
    await expect(hostedPill).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Enter");
    await expect(hostedPill).toHaveAttribute("aria-pressed", "false");

    // Keyboard-open a card's gating-reasons disclosure (the only card action).
    const toggle = page.getByTestId("candidate-reasons-toggle").first();
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("candidate-reasons").first()).toBeVisible();
  });

  test("discovery cards expose no paid call, wallet, or invocation affordance", async ({ page }) => {
    await gotoAgents(page);
    await waitForResults(page);

    await expect(page.getByTestId("discovery-boundary-note")).toContainText(
      /no paid call, wallet action, or endpoint invocation/i,
    );
    await expect(page.getByTestId("discovery-boundary-note")).toContainText(
      /DISCOVER-DECIDE-PROVE-BOUNDARIES\.md/,
    );

    const candidateCards = page.locator('[data-testid="marketplace-candidate-card"]');
    const count = await candidateCards.count();
    for (let index = 0; index < count; index += 1) {
      const card = candidateCards.nth(index);
      // Candidate cards contain no external links and no action verbs that
      // could imply a live path; the only anchor is the internal read-only
      // #382 detail-view navigation, and the only button is the read-only
      // reasons disclosure.
      const anchors = card.locator("a");
      const anchorCount = await anchors.count();
      for (let a = 0; a < anchorCount; a += 1) {
        expect(await anchors.nth(a).getAttribute("href")).toMatch(/^\/agents\/candidates\//);
      }
      const buttons = card.locator("button");
      const buttonCount = await buttons.count();
      for (let b = 0; b < buttonCount; b += 1) {
        await expect(buttons.nth(b)).toHaveAttribute("data-testid", "candidate-reasons-toggle");
      }
      await expect(card).not.toContainText(/hire now|pay now|invoke|call endpoint|connect wallet/i);
    }
  });
});
