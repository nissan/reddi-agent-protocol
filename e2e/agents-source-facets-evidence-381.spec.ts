import { test, expect, type Page } from "@playwright/test";

/**
 * #381 evidence capture for the /agents discovery source facets.
 *
 * Captures the issue-required screenshots: /agents at 375/768/1280 widths,
 * plus RAP-native, ARD-imported, blocked, and empty states, and
 * keyboard/focus proof for filters and card actions.
 *
 * Screenshots are written to `test-results/evidence-381/` and copied to
 * `docs/evidence/381/` AFTER the run — writing into docs/ mid-run races the
 * webpack dev watcher (docs/evidence/498/README.md), and any later
 * `npx playwright test` invocation wipes `test-results/`, so this spec must
 * be the LAST Playwright run before copying (docs/evidence/499/README.md).
 */

const OUT = "test-results/evidence-381";

const viewports = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

async function gotoAgents(page: Page, query = "") {
  await page.goto(`/agents${query}`);
  await expect(page.getByRole("heading", { name: /specialist directory/i })).toBeVisible();
  // Wait out the transient Suspense hydration duplicate (see agents-source-facets.spec.ts).
  await expect
    .poll(async () => page.getByTestId("source-facet-filter").count(), { timeout: 30_000 })
    .toBe(1);
  await expect
    .poll(
      async () =>
        (await page
          .locator('[data-testid="agent-card"], [data-testid="marketplace-candidate-card"], [data-testid="discovery-empty-state"]')
          .count()),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
}

test.describe("/agents #381 evidence pack", () => {
  for (const viewport of viewports) {
    test(`captures /agents and source states at ${viewport.name} (${viewport.width})`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      // Default /agents (all sources).
      await gotoAgents(page);
      await page.screenshot({ path: `${OUT}/${viewport.name}-${viewport.width}-agents.png`, fullPage: true });

      // RAP-native specialist cards (registry-classified sources).
      await gotoAgents(page, "?source=rap-registry,openrouter,local-demo");
      await page.screenshot({
        path: `${OUT}/${viewport.name}-${viewport.width}-rap-native.png`,
        fullPage: true,
      });

      // ARD-imported candidates (includes malformed/blocked fixtures).
      await gotoAgents(page, "?source=ard-catalog");
      await expect(
        page.locator('[data-testid="marketplace-candidate-card"][data-render-state="ard-imported"]').first(),
      ).toBeVisible();
      await page.screenshot({
        path: `${OUT}/${viewport.name}-${viewport.width}-ard-imported.png`,
        fullPage: true,
      });

      // Blocked candidates (ARD malformed + hosted export blocks).
      await gotoAgents(page, "?source=ard-catalog,hosted-rap");
      const blocked = page.locator('[data-testid="marketplace-candidate-card"][data-render-state="blocked"]').first();
      await blocked.scrollIntoViewIfNeeded();
      await expect(blocked).toBeVisible();
      await page.screenshot({
        path: `${OUT}/${viewport.name}-${viewport.width}-blocked.png`,
        fullPage: true,
      });
      await blocked.screenshot({
        path: `${OUT}/${viewport.name}-${viewport.width}-blocked-card.png`,
      });

      // Empty state — no candidates exist from this source (not ingested).
      await gotoAgents(page, "?source=circle-x402");
      await expect(page.getByTestId("discovery-empty-state")).toBeVisible();
      await page.screenshot({
        path: `${OUT}/${viewport.name}-${viewport.width}-empty-no-candidates.png`,
        fullPage: true,
      });

      // Empty state — filters too narrow (candidates exist, composition excludes them).
      await gotoAgents(page, "?source=hosted-rap&task=transcribe");
      await expect(page.getByTestId("filters-too-narrow")).toBeVisible();
      await page.screenshot({
        path: `${OUT}/${viewport.name}-${viewport.width}-empty-filters-too-narrow.png`,
        fullPage: true,
      });
    });
  }

  test("captures keyboard/focus proof for filters and card actions", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });

    await gotoAgents(page, "?source=ard-catalog");

    const pill = page.getByTestId("source-facet-hosted-rap");
    await pill.focus();
    await expect(pill).toBeFocused();
    await page.screenshot({ path: `${OUT}/desktop-1280-focus-source-pill.png`, fullPage: false });

    const toggle = page.getByTestId("candidate-reasons-toggle").first();
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await toggle.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/desktop-1280-focus-card-action.png`, fullPage: false });

    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("candidate-reasons").first()).toBeVisible();
    await page.screenshot({ path: `${OUT}/desktop-1280-card-action-expanded.png`, fullPage: false });
  });
});
