import { expect, test, type Page } from "@playwright/test";

/**
 * #385 — Generated RAP profile review editor.
 *
 * Functional coverage for `/onboarding/profile-editor`: profile sections with
 * five-way provenance, honest unavailable sections, diff view, inline
 * validation with recovery actions, save/continue gating (resolved vs
 * explicitly deferred with a reason), keyboard/focus accessibility, and the
 * zero-external-request boundary.
 */

const SECRET_VALUE = "sk-editorleak1234567890";

async function goToEditor(page: Page) {
  await page.goto("/onboarding/profile-editor");
  await expect(page.getByTestId("profile-editor-page")).toBeVisible();
}

async function selectScenario(page: Page, id: string) {
  await page.getByTestId(`profile-editor-scenario-${id}`).click();
  await expect(page.getByTestId(`profile-editor-scenario-${id}`)).toHaveAttribute("aria-pressed", "true");
}

test.describe("/onboarding/profile-editor #385", () => {
  test("renders the complete profile with all sections and five-way provenance", async ({ page }) => {
    await goToEditor(page);

    for (const section of [
      "profile-editor-provenance-legend",
      "profile-editor-identity",
      "profile-editor-capabilities",
      "profile-editor-invocation",
      "profile-editor-payment",
      "profile-editor-trust",
      "profile-editor-policy",
      "profile-editor-unavailable",
      "profile-editor-diff",
      "profile-editor-readiness",
      "profile-editor-gate",
    ]) {
      await expect(page.getByTestId(section)).toBeVisible();
    }

    // Five-way provenance legend renders every category, verified honestly 0.
    for (const provenance of ["discovered", "inferred", "user_provided", "verified", "blocked"]) {
      await expect(page.getByTestId(`profile-editor-provenance-count-${provenance}`)).toBeVisible();
    }
    await expect(page.getByTestId("profile-editor-provenance-count-verified")).toContainText("× 0");

    // Capability tags with provenance chips.
    const tags = page.getByTestId("profile-editor-capability-tags");
    await expect(tags).toContainText("summarize-document");
    await expect(tags).toContainText("list-issues");
    await expect(tags).toContainText("draft-release-notes");

    // Payment declared but unverified; activation disabled.
    await expect(page.getByTestId("profile-editor-payment-status")).toHaveText("declared_unverified");
    await expect(page.getByTestId("profile-editor-payment")).toContainText("activation: disabled");

    // Sections the contract does not carry render honestly as unavailable.
    for (const id of ["tools", "skills", "downstream-calls", "context-requirements"]) {
      await expect(page.getByTestId(`profile-editor-unavailable-${id}`)).toContainText("unavailable");
    }

    // Readiness is reviewable, so save/continue is enabled without deferral.
    await expect(page.getByTestId("profile-editor-readiness-overall")).toHaveText("needs_operator_review");
    await expect(page.getByTestId("profile-editor-continue")).toBeEnabled();
    await expect(page.getByTestId("profile-editor-blocking")).toHaveCount(0);
  });

  test("shows the diff between discovered metadata and generated profile fields", async ({ page }) => {
    await goToEditor(page);
    const diff = page.getByTestId("profile-editor-diff");
    await expect(diff).toContainText("Discovered metadata");
    await expect(diff).toContainText("Generated profile");
    // Generator-added posture rows.
    await expect(diff.locator('tr[data-diff-status="generated_added"]').first()).toBeVisible();
    // The hint-less capability risk is marked inferred.
    await expect(diff.locator('tr[data-diff-status="inferred"]')).toContainText("draft-release-notes");
  });

  test("missing-required scenario blocks save/continue until resolved or deferred with a reason", async ({ page }) => {
    await goToEditor(page);
    await selectScenario(page, "missing-required");

    await expect(page.getByTestId("profile-editor-readiness-overall")).toHaveText("blocked");
    await expect(page.getByTestId("profile-editor-payment-status")).toHaveText("missing_payment_metadata");
    await expect(page.getByTestId("profile-editor-payment-missing")).toContainText("settlementAddress");
    await expect(page.getByTestId("profile-editor-blocking")).toBeVisible();

    // Disabled without a deferral reason, with a clear hint.
    const continueButton = page.getByTestId("profile-editor-continue");
    await expect(continueButton).toBeDisabled();
    await expect(page.getByTestId("profile-editor-continue-blocked-hint")).toContainText(
      "resolved or explicitly deferred",
    );

    // Supplying a deferral reason enables continue and records the deferral.
    await page
      .getByTestId("profile-editor-deferral-reason")
      .fill("Payment metadata arrives from the provider next week; deferring payment setup.");
    await expect(continueButton).toBeEnabled();
    await continueButton.click();

    const decision = page.getByTestId("profile-editor-decision");
    await expect(decision).toBeVisible();
    await expect(decision).toContainText("deferred");
    await expect(decision).toContainText("draft → payment_setup_required");
    await expect(decision).toContainText("local_read_model_only");
    await expect(decision).toContainText("Payment metadata arrives from the provider next week");
    // Publication ledger stays hard-false.
    const ledger = page.getByTestId("profile-editor-publication-ledger");
    await expect(ledger).toContainText("hostedRegistryWritePerformed");
    await expect(ledger).not.toContainText("true");
  });

  test("resolving missing payment fields unblocks continue without deferral", async ({ page }) => {
    await goToEditor(page);
    await selectScenario(page, "missing-required");

    await page.getByTestId("profile-editor-field-settlementAddress").fill("OperatorSettlementAddress111111111111111111");
    await page.getByTestId("profile-editor-field-network").fill("solana-devnet");
    await page.getByTestId("profile-editor-field-price").fill("3.00");
    await page.getByTestId("profile-editor-field-currency").fill("AUDD");
    await page.getByTestId("profile-editor-apply").click();

    await expect(page.getByTestId("profile-editor-readiness-overall")).toHaveText("needs_operator_review");
    await expect(page.getByTestId("profile-editor-payment-status")).toHaveText("declared_unverified");
    // Operator-supplied values are marked user_provided.
    await expect(
      page.getByTestId("profile-editor-payment").locator('[data-provenance="user_provided"]').first(),
    ).toBeVisible();

    const continueButton = page.getByTestId("profile-editor-continue");
    await expect(continueButton).toBeEnabled();
    await continueButton.click();
    const decision = page.getByTestId("profile-editor-decision");
    await expect(decision).toContainText("draft → pending_operator_approval");
  });

  test("inferred-warnings scenario highlights inferred risks including execute", async ({ page }) => {
    await goToEditor(page);
    await selectScenario(page, "inferred-warnings");
    await expect(page.getByTestId("profile-editor-inferred-warning-execute-workflow")).toContainText("EXECUTE");
    await expect(page.getByTestId("profile-editor-inferred-warning-update-records")).toContainText("WRITE");
    // Inferred provenance chips visible in the capabilities section.
    await expect(
      page.getByTestId("profile-editor-capabilities").locator('[data-provenance="inferred"]').first(),
    ).toBeVisible();
  });

  test("invalid endpoint edit fails closed with an inline error, recovery action, and focus", async ({ page }) => {
    await goToEditor(page);
    const endpointInput = page.getByTestId("profile-editor-field-endpointUrl");
    await endpointInput.fill("https://localhost:8443/invoke");
    await page.getByTestId("profile-editor-apply").click();

    // Error summary (role=alert) + inline field error with recovery action.
    await expect(page.getByTestId("profile-editor-issues")).toBeVisible();
    const inlineError = page.getByTestId("profile-editor-inline-error-endpointUrl");
    await expect(inlineError).toContainText("private_url_blocked");
    await expect(inlineError).toContainText("Use a public HTTPS URL");

    // Accessible wiring: aria-invalid + aria-describedby -> the inline error id.
    await expect(endpointInput).toHaveAttribute("aria-invalid", "true");
    await expect(endpointInput).toHaveAttribute("aria-describedby", "profile-editor-error-endpointUrl");
    // Focus moves to the first invalid field for keyboard recovery.
    await expect(endpointInput).toBeFocused();

    // The draft itself was not changed: readiness still reviewable.
    await expect(page.getByTestId("profile-editor-readiness-overall")).toHaveText("needs_operator_review");
  });

  test("credential-shaped edits are discarded and never echoed", async ({ page }) => {
    await goToEditor(page);
    await page
      .getByTestId("profile-editor-field-endpointUrl")
      .fill(`https://api.example.com/invoke?api_key=${SECRET_VALUE}`);
    await page.getByTestId("profile-editor-apply").click();

    await expect(page.getByTestId("profile-editor-issues")).toContainText("Credential-shaped input blocked");
    await expect(page.getByTestId("profile-editor-issues")).toContainText("discarded");
    const content = await page.content();
    expect(content).not.toContain(SECRET_VALUE);
    // The input was cleared back to the last valid state.
    await expect(page.getByTestId("profile-editor-field-endpointUrl")).toHaveValue("");
  });

  test("editor controls are keyboard reachable with visible labels", async ({ page }) => {
    await goToEditor(page);

    // Every editable input has an associated label (accessible name).
    for (const field of ["displayName", "contactRef", "endpointUrl", "settlementAddress", "network", "price", "currency"]) {
      const input = page.getByTestId(`profile-editor-field-${field}`);
      await expect(input).toBeVisible();
      const id = await input.getAttribute("id");
      await expect(page.locator(`label[for="${id}"]`)).toBeVisible();
    }

    // Scenario buttons expose pressed state and are focusable via keyboard.
    await page.getByTestId("profile-editor-scenario-complete").focus();
    await expect(page.getByTestId("profile-editor-scenario-complete")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("profile-editor-scenario-missing-required")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("profile-editor-scenario-missing-required")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Deferral textarea is labelled and described.
    const deferral = page.getByTestId("profile-editor-deferral-reason");
    await expect(page.locator('label[for="profile-editor-deferral-reason"]')).toBeVisible();
    await expect(deferral).toHaveAttribute("aria-describedby", "profile-editor-deferral-hint");
  });

  test("performs zero external network requests", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && !url.hostname.endsWith("gstatic.com") && !url.hostname.endsWith("googleapis.com")) {
        externalRequests.push(request.url());
      }
    });
    await goToEditor(page);
    await selectScenario(page, "missing-required");
    await page.getByTestId("profile-editor-field-price").fill("1.00");
    await page.getByTestId("profile-editor-apply").click();
    await page.getByTestId("profile-editor-deferral-reason").fill("Deferring for provider input.");
    await page.getByTestId("profile-editor-continue").click();
    await expect(page.getByTestId("profile-editor-decision")).toBeVisible();
    expect(externalRequests).toEqual([]);
  });

  test("intake results link into the profile editor", async ({ page }) => {
    await page.goto("/onboarding/intake");
    await page.getByTestId("intake-source-option-mcp-card-url").click();
    await page.getByTestId("intake-sample-url").click();
    await page.getByTestId("intake-continue").click();
    await page.getByTestId("intake-consent-checkbox").check();
    await page.getByTestId("intake-run-analysis").click();
    await expect(page.getByTestId("intake-results")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("intake-profile-editor-entry").click();
    await expect(page.getByTestId("profile-editor-page")).toBeVisible();
  });
});
