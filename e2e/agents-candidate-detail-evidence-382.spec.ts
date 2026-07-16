import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * #382 evidence capture for the candidate detail UI.
 *
 * Captures the issue-required screenshots at 375/768/1280: a valid
 * ARD-imported candidate detail, an unverified hosted catalog candidate
 * detail, blocked/malformed detail states, empty/unavailable states
 * (not-found + non-ingested source), the RAP-native specialist detail
 * (existing /agents/[wallet] route the specialist cards link to), and
 * keyboard/focus proof for the card entry link and back navigation.
 *
 * Screenshots are written to `test-results/evidence-382/` and copied to
 * `docs/evidence/382/` AFTER the run — writing into docs/ mid-run races the
 * webpack dev watcher (docs/evidence/498/README.md), and any later
 * `npx playwright test` invocation wipes `test-results/`, so this spec must
 * be the LAST Playwright run before copying (docs/evidence/499/README.md).
 */

const OUT = "test-results/evidence-382";

const viewports = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

async function fetchCandidateIds(request: APIRequestContext) {
  const res = await request.get("/api/discovery/candidates");
  expect(res.ok()).toBe(true);
  const data = await res.json();
  const cards: Array<{ id: string; sourceFacet: string; renderState: string }> = data.result.cards;
  const find = (predicate: (card: (typeof cards)[number]) => boolean) => {
    const card = cards.find(predicate);
    expect(card).toBeDefined();
    return card!.id;
  };
  return {
    ard: find((card) => card.sourceFacet === "ard-catalog" && card.renderState === "ard-imported"),
    ardBlocked: find((card) => card.sourceFacet === "ard-catalog" && card.renderState === "blocked"),
    hosted: find((card) => card.sourceFacet === "hosted-rap" && card.renderState === "untrusted"),
    hostedBlocked: find((card) => card.id.startsWith("hosted-rap:blocked:")),
  };
}

async function gotoDetail(page: Page, id: string, query = "") {
  await page.goto(`/agents/candidates/${encodeURIComponent(id)}${query}`);
  await expect
    .poll(
      async () =>
        page
          .locator('[data-testid="candidate-detail"], [data-testid="candidate-detail-unavailable"]')
          .count(),
      { timeout: 30_000 },
    )
    .toBe(1);
}

test.describe("/agents/candidates #382 evidence pack", () => {
  for (const viewport of viewports) {
    test(`captures candidate detail states at ${viewport.name} (${viewport.width})`, async ({ page, request }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const ids = await fetchCandidateIds(request);

      // Valid ARD-imported candidate detail (full matrix + lifecycle + provenance).
      await gotoDetail(page, ids.ard, "?source=ard-catalog");
      await expect(page.getByTestId("candidate-detail-matrix")).toBeVisible();
      await page.screenshot({ path: `${OUT}/${viewport.name}-${viewport.width}-ard-imported-detail.png`, fullPage: true });

      // Unverified hosted catalog candidate detail (honest unavailable fields).
      await gotoDetail(page, ids.hosted);
      await expect(page.getByTestId("detail-field-endpoint-url")).toContainText(/unavailable/i);
      await page.screenshot({ path: `${OUT}/${viewport.name}-${viewport.width}-hosted-untrusted-detail.png`, fullPage: true });

      // Blocked/malformed ARD candidate detail (fail-closed, recovery actions).
      await gotoDetail(page, ids.ardBlocked);
      await expect(page.getByTestId("candidate-detail-recovery")).toBeVisible();
      await page.screenshot({ path: `${OUT}/${viewport.name}-${viewport.width}-blocked-detail.png`, fullPage: true });

      // Blocked hosted export record (matrix honestly unavailable).
      await gotoDetail(page, ids.hostedBlocked);
      await expect(page.getByTestId("candidate-detail-matrix-unavailable")).toBeVisible();
      await page.screenshot({ path: `${OUT}/${viewport.name}-${viewport.width}-blocked-hosted-export-detail.png`, fullPage: true });

      // Empty / unavailable states: unknown candidate + non-ingested source.
      await gotoDetail(page, "hosted-rap:does-not-exist");
      await expect(page.getByTestId("candidate-detail-unavailable")).toBeVisible();
      await page.screenshot({ path: `${OUT}/${viewport.name}-${viewport.width}-not-found.png`, fullPage: true });

      await gotoDetail(page, "circle-x402:anything");
      await expect(page.getByTestId("candidate-detail-unavailable")).toContainText(/not found|not ingested/i);
      await page.screenshot({ path: `${OUT}/${viewport.name}-${viewport.width}-source-unavailable.png`, fullPage: true });

      // RAP-native specialist detail — the existing /agents/[wallet] route the
      // RAP-native specialist cards link to (#382 covers wallet-less
      // candidates; registry-native specialists keep their own detail page).
      const registryRes = await request.get("/api/registry");
      const registryData = await registryRes.json();
      const wallet: string | undefined = registryData?.listings?.[0]?.walletAddress;
      if (wallet) {
        await page.goto(`/agents/${wallet}`);
        await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 45_000 });
        await page.screenshot({ path: `${OUT}/${viewport.name}-${viewport.width}-rap-native-detail.png`, fullPage: true });
      }
    });
  }

  test("captures keyboard/focus proof for detail entry and back navigation", async ({ page, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    const ids = await fetchCandidateIds(request);

    // Entry point: the card's "View details" link on /agents.
    await page.goto("/agents?source=ard-catalog");
    await expect
      .poll(async () => page.getByTestId("source-facet-filter").count(), { timeout: 30_000 })
      .toBe(1);
    const link = page.getByTestId("candidate-detail-link").first();
    await expect(link).toBeVisible({ timeout: 20_000 });
    await link.focus();
    await expect(link).toBeFocused();
    await link.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/desktop-1280-focus-card-detail-link.png`, fullPage: false });

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/agents\/candidates\//);
    await expect
      .poll(async () => page.getByTestId("candidate-detail").count(), { timeout: 30_000 })
      .toBe(1);

    // Back navigation focus on the detail page.
    await gotoDetail(page, ids.ard, "?source=ard-catalog");
    const back = page.getByTestId("candidate-detail-back");
    await back.focus();
    await expect(back).toBeFocused();
    await page.screenshot({ path: `${OUT}/desktop-1280-focus-detail-back.png`, fullPage: false });

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/agents\?source=ard-catalog/);
    await expect
      .poll(async () => page.getByTestId("source-facet-filter").count(), { timeout: 30_000 })
      .toBe(1);
    await page.screenshot({ path: `${OUT}/desktop-1280-after-back-navigation.png`, fullPage: false });
  });
});
