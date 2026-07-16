import { expect, test, type Page } from "@playwright/test";

/**
 * #384 evidence capture for the guided intake flow.
 *
 * Captures the issue-required UI evidence: intake, loading, error,
 * blocked-secret, and empty/no-results states at 375 / 768 / 1280 widths,
 * plus consent and analysed-results captures, into
 * `test-results/evidence-384/` — copied to `docs/evidence/384/` AFTER the
 * run (writing into docs/ mid-run races the webpack dev watcher, see
 * docs/evidence/498/README.md). Any later `npx playwright test` invocation
 * wipes `test-results/`, so this spec must be the LAST Playwright run before
 * copying (docs/evidence/499/README.md).
 */

const SECRET_VALUE = "sk-evidenceleak1234567890";

const viewports = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

function shot(viewport: (typeof viewports)[number], state: string): string {
  return `test-results/evidence-384/${viewport.name}-${viewport.width}-${state}.png`;
}

async function goToIntake(page: Page) {
  await page.goto("/onboarding/intake");
  await expect(page.getByTestId("intake-page")).toBeVisible();
}

async function acceptConsentAndRun(page: Page) {
  await page.getByTestId("intake-continue").click();
  await expect(page.getByTestId("intake-consent-step")).toBeVisible();
  await page.getByTestId("intake-consent-checkbox").check();
  await page.getByTestId("intake-run-analysis").click();
}

async function startOver(page: Page) {
  await page.getByTestId("intake-start-over").click();
  await expect(page.getByTestId("intake-source-step")).toBeVisible();
}

test.describe("/onboarding/intake #384 evidence pack", () => {
  for (const viewport of viewports) {
    test(`captures intake states at ${viewport.name} (${viewport.width})`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      // 1. Intake (source selection).
      await goToIntake(page);
      await page.getByTestId("intake-source-option-mcp-card-url").click();
      await page.getByTestId("intake-sample-url").click();
      await page.screenshot({ path: shot(viewport, "intake"), fullPage: true });

      // 2. Consent + data-sharing boundary.
      await page.getByTestId("intake-continue").click();
      await expect(page.getByTestId("intake-consent-step")).toBeVisible();
      await page.screenshot({ path: shot(viewport, "consent"), fullPage: true });

      // 3. Loading (fixture-backed static analysis in progress).
      await page.getByTestId("intake-consent-checkbox").check();
      await page.getByTestId("intake-run-analysis").click();
      await expect(page.getByTestId("intake-loading")).toBeVisible();
      await page.screenshot({ path: shot(viewport, "loading") });

      // 4. Analysed results (success).
      await expect(page.getByTestId("intake-results")).toBeVisible({ timeout: 10_000 });
      await page.screenshot({ path: shot(viewport, "results"), fullPage: true });
      await startOver(page);

      // 5. Error + retry (simulated fixture interruption).
      await page.getByTestId("intake-sample-unreachable").click();
      await acceptConsentAndRun(page);
      await expect(page.getByTestId("intake-error")).toBeVisible({ timeout: 10_000 });
      await page.screenshot({ path: shot(viewport, "error"), fullPage: true });
      await startOver(page);

      // 6. Invalid URL.
      await page.getByTestId("intake-source-url-input").fill("http://localhost:8443/card.json");
      await acceptConsentAndRun(page);
      await expect(page.getByTestId("intake-invalid-url")).toBeVisible({ timeout: 10_000 });
      await page.screenshot({ path: shot(viewport, "invalid-url"), fullPage: true });
      await startOver(page);

      // 7. Blocked secret (credential-shaped input rejected fail-closed).
      await page
        .getByTestId("intake-source-url-input")
        .fill(`https://example.com/card.json?api_key=${SECRET_VALUE}`);
      await acceptConsentAndRun(page);
      await expect(page.getByTestId("intake-blocked-secret")).toBeVisible({ timeout: 10_000 });
      const content = await page.content();
      expect(content).not.toContain(SECRET_VALUE);
      await page.screenshot({ path: shot(viewport, "blocked-secret"), fullPage: true });
      await startOver(page);

      // 8. Empty / no-results.
      await page.getByTestId("intake-source-option-manual-seed").click();
      await page.getByTestId("intake-manual-displayname").fill("Empty Agent");
      await page.getByTestId("intake-manual-description").fill("No capabilities yet");
      await acceptConsentAndRun(page);
      await expect(page.getByTestId("intake-empty")).toBeVisible({ timeout: 10_000 });
      await page.screenshot({ path: shot(viewport, "empty"), fullPage: true });
    });
  }

  test("records the full intake flow (video evidence)", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await goToIntake(page);
    await page.getByTestId("intake-source-option-mcp-card-url").click();
    await page.getByTestId("intake-sample-url").click();
    await acceptConsentAndRun(page);
    await expect(page.getByTestId("intake-results")).toBeVisible({ timeout: 10_000 });
    for (const section of [
      "intake-capabilities",
      "intake-readiness",
      "intake-state-machine",
      "intake-listing-states",
      "intake-guardrails",
    ]) {
      await page.getByTestId(section).scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
    }
    await startOver(page);
    await page
      .getByTestId("intake-source-url-input")
      .fill(`https://example.com/card.json?api_key=${SECRET_VALUE}`);
    await acceptConsentAndRun(page);
    await expect(page.getByTestId("intake-blocked-secret")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600);
  });
});
