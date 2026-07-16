import { expect, test, type Page } from "@playwright/test";

/**
 * #386 — AUDD/Solana payment and readiness gate UI.
 *
 * Functional coverage: scenario switching (buttons + deep link), fail-closed
 * gate rendering with concrete next actions, dry-run receipt readback,
 * always-disabled live controls, boundary flag grid, profile-editor entry
 * links, keyboard operability, and the zero-external-request boundary.
 */

const SCENARIOS = ["ready", "blocked-payment", "blocked-evidence", "blocked-trust", "dry-run-receipt"] as const;

async function goToGate(page: Page, query = "") {
  await page.goto(`/onboarding/readiness-gate${query}`);
  await expect(page.getByTestId("readiness-gate-page")).toBeVisible({ timeout: 15_000 });
  // Suspense hydration can briefly render duplicate trees in dev — poll until
  // the scenario pill count settles to exactly one tree's worth.
  await expect
    .poll(async () => page.getByTestId("readiness-gate-scenario-ready").count(), { timeout: 10_000 })
    .toBe(1);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

async function selectScenario(page: Page, id: (typeof SCENARIOS)[number]) {
  await page.getByTestId(`readiness-gate-scenario-${id}`).click();
  await expect(page.getByTestId(`readiness-gate-scenario-${id}`)).toHaveAttribute("aria-pressed", "true");
}

test.describe("readiness gate UI (#386)", () => {
  test("renders the five fixture scenarios with ready as the default", async ({ page }) => {
    await goToGate(page);
    for (const id of SCENARIOS) {
      await expect(page.getByTestId(`readiness-gate-scenario-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId("readiness-gate-scenario-ready")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("readiness-gate-overall")).toHaveAttribute(
      "data-overall-status",
      "ready_for_operator_review",
    );
    await expect(page.getByTestId("readiness-gate-overall")).toContainText(/operator review is still required/i);
  });

  test("deep links select the scenario from the querystring", async ({ page }) => {
    await goToGate(page, "?scenario=blocked-payment");
    await expect(page.getByTestId("readiness-gate-scenario-blocked-payment")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("readiness-gate-overall")).toHaveAttribute("data-overall-status", "blocked");
  });

  test("scenario switching updates the URL and the overall status", async ({ page }) => {
    await goToGate(page);
    await selectScenario(page, "blocked-evidence");
    await expect(page.getByTestId("readiness-gate-overall")).toHaveAttribute("data-overall-status", "blocked");
    expect(page.url()).toContain("scenario=blocked-evidence");
    await selectScenario(page, "ready");
    await expect(page.getByTestId("readiness-gate-overall")).toHaveAttribute(
      "data-overall-status",
      "ready_for_operator_review",
    );
    expect(page.url()).toContain("scenario=ready");
  });

  test("blocked-payment fails closed with concrete next actions and the exact missing field", async ({ page }) => {
    await goToGate(page, "?scenario=blocked-payment");
    const x402 = page.getByTestId("readiness-gate-x402_payment_config");
    await expect(x402).toHaveAttribute("data-status", "blocked");
    await expect(x402).toContainText("network");
    await expect(page.getByTestId("readiness-gate-next-action-x402_payment_config")).toContainText(/network/);
    await expect(page.getByTestId("readiness-gate-endpoint_availability")).toHaveAttribute("data-status", "blocked");
    await expect(page.getByTestId("readiness-gate-next-action-endpoint_availability")).toContainText(
      /public HTTPS/i,
    );
    await expect(page.getByTestId("readiness-gate-auth_safety")).toHaveAttribute("data-status", "blocked");
    await expect(page.getByTestId("readiness-gate-buyer_budget_policy")).toContainText("unsupported_rail_currency");
    await expect(page.getByTestId("readiness-gate-receipt")).toHaveAttribute("data-receipt-status", "not_run");
  });

  test("blocked-evidence keeps payment gates green and fails the evidence chain closed", async ({ page }) => {
    await goToGate(page, "?scenario=blocked-evidence");
    await expect(page.getByTestId("readiness-gate-payment_rail")).toHaveAttribute("data-status", "ready");
    await expect(page.getByTestId("readiness-gate-evidence_requirement")).toHaveAttribute("data-status", "blocked");
    await expect(page.getByTestId("readiness-gate-evidence_requirement")).toContainText("evidence_required");
    await expect(page.getByTestId("readiness-gate-receipt_requirement")).toHaveAttribute("data-status", "blocked");
    await expect(page.getByTestId("readiness-gate-receipt_evidence_binding")).toHaveAttribute(
      "data-status",
      "blocked",
    );
    await expect(page.getByTestId("readiness-gate-receipt")).toHaveAttribute("data-receipt-status", "denied");
  });

  test("blocked-trust withholds attestation/reputation backing via the bridge", async ({ page }) => {
    await goToGate(page, "?scenario=blocked-trust");
    await expect(page.getByTestId("readiness-gate-attestation_state")).toHaveAttribute("data-status", "blocked");
    await expect(page.getByTestId("readiness-gate-reputation_state")).toHaveAttribute("data-status", "blocked");
    await expect(page.getByTestId("readiness-gate-reputation_state")).toContainText(
      "listingProjection.offchainPreview",
    );
    await expect(page.getByTestId("readiness-gate-auth_safety")).toHaveAttribute(
      "data-status",
      "needs_operator_review",
    );
    await expect(page.getByTestId("readiness-gate-payment_rail")).toHaveAttribute("data-status", "ready");
  });

  test("dry-run receipt readback exposes the durable refs", async ({ page }) => {
    await goToGate(page, "?scenario=dry-run-receipt");
    const receipt = page.getByTestId("readiness-gate-receipt");
    await expect(receipt).toHaveAttribute("data-receipt-status", "bound");
    await expect(receipt).toContainText("job:audd-readiness-gate-386-dry-run-receipt");
    await expect(receipt).toContainText("binding:audd-readiness-gate-386-dry-run-receipt");
    await expect(receipt).toContainText("evidence:audd-readiness-gate-386-dry-run-receipt");
    await expect(receipt).toContainText("sha256:");
    await expect(receipt).toContainText("draft only");
  });

  test("live payment controls are disabled in every scenario with honest copy", async ({ page }) => {
    await goToGate(page);
    for (const id of SCENARIOS) {
      await selectScenario(page, id);
      const button = page.getByTestId("readiness-gate-live-control-button");
      await expect(button).toBeDisabled();
      await expect(button).toContainText(/unavailable/i);
      await expect(page.getByTestId("readiness-gate-live-requirement-backend_readiness")).toContainText(/absent/i);
      await expect(page.getByTestId("readiness-gate-live-requirement-operator_live_approval")).toContainText(
        /absent/i,
      );
    }
  });

  test("renders the #392 AUDD boundary copy and the hard-false flag grid", async ({ page }) => {
    await goToGate(page);
    await expect(page.getByTestId("readiness-gate-audd-boundary")).toContainText(
      /proof-metadata \/ payment-plan readiness/,
    );
    await expect(page.getByTestId("readiness-gate-audd-boundary")).toContainText(/not Quasar AUDD custody/);
    const flags = page.getByTestId("readiness-gate-boundary-flags");
    await expect(flags).toContainText("walletSigning");
    await expect(flags).toContainText("livePayment");
    // Count flag VALUE cells only — the section heading and the boundary note also
    // contain the word "false", so a container-wide text regex overcounts (16 flags + 2 copy).
    const flagValues = flags.locator("div.grid span.text-\\[\\#14F195\\]");
    await expect(flagValues).toHaveCount(16);
    for (const text of await flagValues.allInnerTexts()) {
      expect(text).toBe("false");
    }
    await expect(page.getByTestId("readiness-gate-seller-wrapper-validation")).toContainText(
      "seller_wrapper_config_valid",
    );
  });

  test("profile editor continue path links into the readiness gate", async ({ page }) => {
    await page.goto("/onboarding/profile-editor");
    await expect(page.getByTestId("profile-editor-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("profile-editor-readiness-gate-footer-link")).toBeVisible();
    await page.getByTestId("profile-editor-continue").click();
    await expect(page.getByTestId("profile-editor-decision")).toBeVisible();
    await page.getByTestId("profile-editor-readiness-gate-entry").click();
    await expect(page.getByTestId("readiness-gate-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("readiness-gate-scenario-ready")).toHaveAttribute("aria-pressed", "true");
  });

  test("scenario pills are keyboard operable", async ({ page }) => {
    await goToGate(page);
    await page.getByTestId("readiness-gate-scenario-ready").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("readiness-gate-scenario-blocked-payment")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("readiness-gate-scenario-blocked-payment")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("readiness-gate-overall")).toHaveAttribute("data-overall-status", "blocked");
  });

  test("performs zero external network requests", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (
        url.hostname !== "127.0.0.1" &&
        url.hostname !== "localhost" &&
        !url.hostname.endsWith("gstatic.com") &&
        !url.hostname.endsWith("googleapis.com")
      ) {
        externalRequests.push(request.url());
      }
    });
    await goToGate(page);
    for (const id of SCENARIOS) {
      await selectScenario(page, id);
    }
    expect(externalRequests).toEqual([]);
  });
});
