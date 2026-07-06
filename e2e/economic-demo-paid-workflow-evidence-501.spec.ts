import { expect, test } from "@playwright/test";

/**
 * #501 evidence capture for the buyer paid-workflow route.
 *
 * Captures per-state screenshots (quote, ledger, timeline, result,
 * receipt/evidence, blocked states) at mobile/tablet/desktop viewports, plus
 * a desktop scroll-through whose recorded video covers the
 * quote -> ledger -> timeline -> result -> receipt/evidence -> blocked flow.
 *
 * Screenshots are written to `test-results/evidence-501/` and copied to
 * `docs/evidence/501/` AFTER the run — writing into docs/ mid-run races the
 * webpack dev watcher (see docs/evidence/498/README.md). Any later
 * `npx playwright test` invocation wipes `test-results/`, so this spec must
 * be the LAST Playwright run before copying (docs/evidence/499/README.md).
 */

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 960 },
] as const;

const states = [
  { state: "quote", testId: "paid-workflow-quote" },
  { state: "ledger", testId: "paid-workflow-ledger" },
  { state: "timeline", testId: "paid-workflow-timeline" },
  { state: "result", testId: "paid-workflow-result" },
  { state: "receipt", testId: "paid-workflow-receipt" },
  { state: "evidence", testId: "paid-workflow-evidence" },
  { state: "blocked", testId: "paid-workflow-boundary-states" },
] as const;

test.describe("/economic-demo/paid-workflow #501 evidence pack", () => {
  for (const viewport of viewports) {
    test(`captures per-state evidence at ${viewport.name} (${viewport.width})`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/economic-demo/paid-workflow");
      await expect(
        page.getByRole("heading", { name: /buyer paid workflow — no-spend shell/i }),
      ).toBeVisible();

      for (const { state, testId } of states) {
        const section = page.getByTestId(testId);
        await section.scrollIntoViewIfNeeded();
        await expect(section).toBeVisible();
        await section.screenshot({
          path: `test-results/evidence-501/${viewport.name}-${viewport.width}-${state}.png`,
        });
      }

      await page.screenshot({
        path: `test-results/evidence-501/${viewport.name}-${viewport.width}-full.png`,
        fullPage: true,
      });
    });
  }

  test("records the quote to ledger to timeline to result to receipt/evidence to blocked flow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto("/economic-demo/paid-workflow");
    await expect(
      page.getByRole("heading", { name: /buyer paid workflow — no-spend shell/i }),
    ).toBeVisible();

    for (const testId of [
      "paid-workflow-copy-modes",
      "paid-workflow-quote",
      "paid-workflow-budget",
      "paid-workflow-ledger",
      "paid-workflow-timeline",
      "paid-workflow-result",
      "paid-workflow-receipt",
      "paid-workflow-evidence",
      "paid-workflow-boundary-states",
      "paid-workflow-blocked-live_path_overclaim",
      "paid-workflow-unsupported-rail",
      "paid-workflow-recorded-devnet",
      "paid-workflow-live-gate",
      "paid-workflow-production-disabled",
      "paid-workflow-boundary-flags",
      "paid-workflow-copy-boundaries",
    ]) {
      const section = page.getByTestId(testId);
      await section.scrollIntoViewIfNeeded();
      await expect(section).toBeVisible();
      await page.waitForTimeout(400);
    }
  });
});
