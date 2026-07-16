import { expect, test, type Page } from "@playwright/test";

/**
 * #385 evidence capture for the generated RAP profile review editor.
 *
 * Captures the issue-required UI evidence: complete profile, missing required
 * fields, inferred-field warnings, and validation errors at 375 / 768 / 1280
 * widths, plus keyboard/focus proof for editor controls and form errors and
 * the save/continue decision states, into `test-results/evidence-385/` —
 * copied to `docs/evidence/385/` AFTER the run (writing into docs/ mid-run
 * races the webpack dev watcher, see docs/evidence/498/README.md). Any later
 * `npx playwright test` invocation wipes `test-results/`, so this spec must be
 * the LAST Playwright run before copying (docs/evidence/499/README.md).
 */

const viewports = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

function shot(viewport: (typeof viewports)[number], state: string): string {
  return `test-results/evidence-385/${viewport.name}-${viewport.width}-${state}.png`;
}

async function goToEditor(page: Page) {
  await page.goto("/onboarding/profile-editor");
  await expect(page.getByTestId("profile-editor-page")).toBeVisible();
  // Hide the Next.js dev-tools indicator overlay: the dev server flags the
  // pre-existing global font-preload warning (fires on every route a few
  // seconds after load) as an "issue", which would stamp a dev-only badge
  // onto the captures. Application UI is unaffected.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

test.describe("/onboarding/profile-editor #385 evidence pack", () => {
  for (const viewport of viewports) {
    test(`captures editor states at ${viewport.name} (${viewport.width})`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      // 1. Complete profile (all sections, provenance, diff, continue enabled).
      await goToEditor(page);
      await expect(page.getByTestId("profile-editor-continue")).toBeEnabled();
      await page.screenshot({ path: shot(viewport, "complete"), fullPage: true });

      // 2. Missing required fields (blocked readiness, deferral required).
      await page.getByTestId("profile-editor-scenario-missing-required").click();
      await expect(page.getByTestId("profile-editor-readiness-overall")).toHaveText("blocked");
      await expect(page.getByTestId("profile-editor-continue")).toBeDisabled();
      await page.screenshot({ path: shot(viewport, "missing-required"), fullPage: true });

      // 3. Inferred-field warnings (heuristic risk inference flagged for review).
      await page.getByTestId("profile-editor-scenario-inferred-warnings").click();
      await expect(page.getByTestId("profile-editor-inferred-warning-execute-workflow")).toBeVisible();
      await page.screenshot({ path: shot(viewport, "inferred-warnings"), fullPage: true });

      // 4. Validation errors (fail-closed inline error + recovery action).
      await page.getByTestId("profile-editor-scenario-complete").click();
      await page.getByTestId("profile-editor-field-endpointUrl").fill("https://localhost:8443/invoke");
      await page.getByTestId("profile-editor-apply").click();
      await expect(page.getByTestId("profile-editor-inline-error-endpointUrl")).toBeVisible();
      await expect(page.getByTestId("profile-editor-field-endpointUrl")).toBeFocused();
      await page.screenshot({ path: shot(viewport, "validation-errors"), fullPage: true });
    });
  }

  test("captures keyboard/focus proof for editor controls and form errors", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await goToEditor(page);

    // Focus-visible ring on a scenario control reached via keyboard.
    await page.getByTestId("profile-editor-scenario-complete").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("profile-editor-scenario-missing-required")).toBeFocused();
    await page.screenshot({
      path: "test-results/evidence-385/desktop-1280-keyboard-scenario-focus.png",
    });

    // Focus-visible state on a labelled editor input.
    await page.getByTestId("profile-editor-field-displayName").focus();
    await expect(page.getByTestId("profile-editor-field-displayName")).toBeFocused();
    await page.screenshot({
      path: "test-results/evidence-385/desktop-1280-keyboard-input-focus.png",
    });

    // After a failed apply, focus lands on the first invalid field whose
    // aria-describedby points at the inline error (form-error keyboard proof).
    await page.getByTestId("profile-editor-field-endpointUrl").fill("https://localhost:8443/invoke");
    await page.getByTestId("profile-editor-apply").click();
    const endpointInput = page.getByTestId("profile-editor-field-endpointUrl");
    await expect(endpointInput).toBeFocused();
    await expect(endpointInput).toHaveAttribute("aria-invalid", "true");
    await expect(endpointInput).toHaveAttribute("aria-describedby", "profile-editor-error-endpointUrl");
    // Capture the focused invalid field with its focus ring and the inline
    // error it is aria-described by.
    await endpointInput.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "test-results/evidence-385/desktop-1280-keyboard-error-focus.png",
    });
  });

  test("captures save/continue decision states (resolved and deferred)", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });

    // Resolved: complete profile continues to pending_operator_approval.
    await goToEditor(page);
    await page.getByTestId("profile-editor-continue").click();
    await expect(page.getByTestId("profile-editor-decision")).toContainText("pending_operator_approval");
    await page.getByTestId("profile-editor-gate").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "test-results/evidence-385/desktop-1280-continue-resolved.png",
      fullPage: true,
    });

    // Deferred: blocked draft continues only with an explicit reason.
    await page.getByTestId("profile-editor-scenario-missing-required").click();
    await page
      .getByTestId("profile-editor-deferral-reason")
      .fill("Payment metadata arrives from the provider next week; deferring payment setup.");
    await page.getByTestId("profile-editor-continue").click();
    await expect(page.getByTestId("profile-editor-decision")).toContainText("payment_setup_required");
    await page.screenshot({
      path: "test-results/evidence-385/desktop-1280-continue-deferred.png",
      fullPage: true,
    });
  });

  test("records the full review flow (video evidence)", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await goToEditor(page);
    for (const section of [
      "profile-editor-provenance-legend",
      "profile-editor-capabilities",
      "profile-editor-payment",
      "profile-editor-unavailable",
      "profile-editor-diff",
      "profile-editor-readiness",
      "profile-editor-gate",
    ]) {
      await page.getByTestId(section).scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
    }
    // Missing-required: inline recovery by supplying the payment fields.
    await page.getByTestId("profile-editor-scenario-missing-required").click();
    await page.getByTestId("profile-editor-payment").scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.getByTestId("profile-editor-field-settlementAddress").fill("OperatorSettlementAddress111111111111111111");
    await page.getByTestId("profile-editor-field-network").fill("solana-devnet");
    await page.getByTestId("profile-editor-field-price").fill("3.00");
    await page.getByTestId("profile-editor-field-currency").fill("AUDD");
    await page.getByTestId("profile-editor-apply").click();
    await expect(page.getByTestId("profile-editor-payment-status")).toHaveText("declared_unverified");
    await page.getByTestId("profile-editor-gate").scrollIntoViewIfNeeded();
    await page.getByTestId("profile-editor-continue").click();
    await expect(page.getByTestId("profile-editor-decision")).toBeVisible();
    await page.waitForTimeout(600);
  });
});
