import { expect, test, type Page } from "@playwright/test";

/**
 * #386 evidence capture — AUDD/Solana payment and readiness gate UI.
 *
 * Screenshots land in test-results/evidence-386/ and are copied into
 * docs/evidence/386/ after the LAST Playwright run (per the #498/#499
 * pitfalls: docs/ copies during a run race the webpack watcher). The final
 * test records the profile-review -> readiness-gate -> blocked/ready
 * transition; the committed video comes from Playwright's video artifact
 * (video, not trace, per the #506 chrome-channel precedent).
 */

const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

const STATES = ["ready", "blocked-payment", "blocked-evidence", "blocked-trust", "dry-run-receipt"] as const;

function shotPath(viewport: (typeof VIEWPORTS)[number], state: string): string {
  return `test-results/evidence-386/${viewport.name}-${viewport.width}-${state}.png`;
}

async function goToGate(page: Page, state: (typeof STATES)[number]) {
  await page.goto(`/onboarding/readiness-gate?scenario=${state}`);
  await expect(page.getByTestId("readiness-gate-page")).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => page.getByTestId("readiness-gate-scenario-ready").count(), { timeout: 10_000 })
    .toBe(1);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

test.describe("readiness gate evidence (#386)", () => {
  for (const viewport of VIEWPORTS) {
    test(`captures the five gate states at ${viewport.name} (${viewport.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const state of STATES) {
        await goToGate(page, state);
        await expect(page.getByTestId(`readiness-gate-scenario-${state}`)).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByTestId("readiness-gate-live-control-button")).toBeDisabled();
        await page.screenshot({ path: shotPath(viewport, state), fullPage: true });
      }
    });
  }

  test("records the profile review -> readiness gate -> blocked/ready transition (video evidence)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    // Start on the profile review editor (the #385 continue path).
    await page.goto("/onboarding/profile-editor");
    await expect(page.getByTestId("profile-editor-page")).toBeVisible({ timeout: 15_000 });
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.getByTestId("profile-editor-gate").scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);

    // Record the continue decision, then follow the readiness-gate entry link.
    await page.getByTestId("profile-editor-continue").click();
    await expect(page.getByTestId("profile-editor-decision")).toBeVisible();
    await page.waitForTimeout(400);
    await page.getByTestId("profile-editor-readiness-gate-entry").click();
    await expect(page.getByTestId("readiness-gate-page")).toBeVisible({ timeout: 15_000 });
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await expect(page.getByTestId("readiness-gate-overall")).toHaveAttribute(
      "data-overall-status",
      "ready_for_operator_review",
    );
    await page.waitForTimeout(600);

    // Blocked state: every failed gate carries a concrete next action.
    await page.getByTestId("readiness-gate-scenario-blocked-payment").click();
    await expect(page.getByTestId("readiness-gate-overall")).toHaveAttribute("data-overall-status", "blocked");
    await page.getByTestId("readiness-gate-next-action-x402_payment_config").scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await page.getByTestId("readiness-gate-live-controls").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("readiness-gate-live-control-button")).toBeDisabled();
    await page.waitForTimeout(600);

    // Back to ready: gates green, live controls still disabled.
    await page.getByTestId("readiness-gate-scenario-ready").scrollIntoViewIfNeeded();
    await page.getByTestId("readiness-gate-scenario-ready").click();
    await expect(page.getByTestId("readiness-gate-overall")).toHaveAttribute(
      "data-overall-status",
      "ready_for_operator_review",
    );
    await page.getByTestId("readiness-gate-receipt").scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await page.getByTestId("readiness-gate-live-controls").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("readiness-gate-live-control-button")).toBeDisabled();
    await page.waitForTimeout(600);
  });
});
