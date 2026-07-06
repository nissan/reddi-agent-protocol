import { expect, test } from "@playwright/test";

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 960 },
] as const;

const blockedSourceCases = [
  "mpp_tempo_unsupported_network",
  "unsupported_asset_network",
  "malformed_receipt",
  "policy_denied",
  "airwallex_webhook_probe_only_cap",
  "live_path_overclaim",
] as const;

const copyModes = [
  "fixture_zero_spend",
  "planned_dry_run",
  "simulated",
  "devnet_proof_metadata",
  "live_gated",
  "production_live_disabled",
] as const;

test.describe("/economic-demo/paid-workflow (#498)", () => {
  for (const viewport of viewports) {
    test(`renders the buyer no-spend workflow shell at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/economic-demo/paid-workflow");

      await expect(
        page.getByRole("heading", { name: /buyer paid workflow — no-spend shell/i }),
      ).toBeVisible();

      // Journey shell: quote -> budget -> timeline placeholder -> result -> receipt -> evidence.
      await expect(page.getByTestId("paid-workflow-quote")).toBeVisible();
      await expect(page.getByTestId("paid-workflow-quote")).toContainText("Quoted total");
      await expect(page.getByTestId("paid-workflow-budget")).toContainText(
        "downstream calls executed: 0",
      );
      const placeholder = page.getByTestId("paid-workflow-timeline-placeholder");
      await expect(placeholder).toContainText(/placeholder/i);
      await expect(placeholder).toContainText("#499");
      await expect(page.getByTestId("paid-workflow-result")).toBeVisible();
      await expect(page.getByTestId("paid-workflow-receipt")).toContainText("refs_hashes_only");
      await expect(page.getByTestId("paid-workflow-evidence")).toBeVisible();
      await expect(page.getByTestId("paid-workflow-attestation-preview")).toContainText("Draft only");
      await expect(page.getByTestId("paid-workflow-reputation-preview")).toContainText("No mutation");

      // Capture to test-results (not docs/evidence/498 directly): writing into
      // docs/ mid-run triggers the webpack dev watcher and the next navigation
      // races the invalidation. Evidence is copied to docs/evidence/498 after
      // the run (see docs/evidence/498/README.md).
      await page.screenshot({
        path: `test-results/evidence-498/${viewport.name}-${viewport.width}.png`,
        fullPage: true,
      });
    });
  }

  test("distinguishes all six copy modes without live-implying claims", async ({ page }) => {
    await page.goto("/economic-demo/paid-workflow");

    const modes = page.getByTestId("paid-workflow-copy-modes");
    await expect(modes).toBeVisible();
    for (const mode of copyModes) {
      await expect(modes.getByTestId(`paid-workflow-copy-mode-${mode}`)).toBeVisible();
    }
    await expect(modes).toContainText("No-spend fixture");
    await expect(modes).toContainText("Dry run (planned only)");
    await expect(modes).toContainText("Recorded devnet metadata");
    await expect(modes).toContainText("Live-gated (approval required)");
    await expect(modes).toContainText("Production disabled");

    // The page must only ever mention custody/settlement/mainnet negated.
    const copyBoundaries = page.getByTestId("paid-workflow-copy-boundaries");
    await expect(copyBoundaries).toContainText(/no custody/i);
    await expect(copyBoundaries).toContainText(/no settlement finality/i);
    await expect(copyBoundaries).toContainText(/no mainnet settlement/i);
    await expect(copyBoundaries).toContainText(/no hosted publication/i);
    await expect(copyBoundaries).toContainText(/no trust or reputation mutation/i);
  });

  test("renders every fail-closed boundary state including the #588 probe-only cap", async ({
    page,
  }) => {
    await page.goto("/economic-demo/paid-workflow");

    // Empty contract preview fails closed.
    const emptyState = page.getByTestId("paid-workflow-empty-state");
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText("empty_fixture_pack");
    await expect(emptyState).toContainText(/fails closed/i);

    // All blocked rail-neutral cases render with fail-closed reasons.
    for (const sourceCase of blockedSourceCases) {
      const card = page.getByTestId(`paid-workflow-blocked-${sourceCase}`);
      await card.scrollIntoViewIfNeeded();
      await expect(card).toBeVisible();
    }
    await expect(page.getByTestId("paid-workflow-blocked-policy_denied")).toContainText("Policy denied");
    await expect(page.getByTestId("paid-workflow-blocked-malformed_receipt")).toContainText(
      "Malformed receipt",
    );
    await expect(page.getByTestId("paid-workflow-blocked-live_path_overclaim")).toContainText(
      "Live-path overclaim",
    );
    await expect(
      page.getByTestId("paid-workflow-blocked-airwallex_webhook_probe_only_cap"),
    ).toContainText("Probe-only receipt cap");

    // Real second-rail unsupported/probe-only support states (#587).
    const rail = page.getByTestId("paid-workflow-unsupported-rail");
    await expect(rail.getByTestId("paid-workflow-rail-state-airwallex_webhook_receipt_probe_only")).toBeVisible();
    await expect(
      rail.getByTestId("paid-workflow-rail-state-unsupported_live_airwallex_settlement"),
    ).toBeVisible();
    await expect(rail).toContainText(/probe_only/);

    // Recorded devnet stays dry-run with authoritative zeros; live path stays gated.
    const devnet = page.getByTestId("paid-workflow-recorded-devnet");
    await expect(devnet).toContainText("0 devnet transactions");
    await expect(devnet).toContainText("0 paid requests");
    const liveGate = page.getByTestId("paid-workflow-live-gate");
    await expect(liveGate).toContainText(/approval required/i);
    await expect(liveGate).toContainText("none recorded");
    await expect(page.getByTestId("paid-workflow-production-disabled")).toContainText(
      /disabled by default/i,
    );

    // Boundary flags grid: every hard boundary is false.
    const flags = page.getByTestId("paid-workflow-boundary-flags");
    await expect(flags).toContainText("All live flags false");
    await expect(flags).toContainText("Wallet Signing");
    await expect(flags).toContainText("Live Payment");

    // Zero live paths: the route exposes no buttons (no run/pay/approve affordance).
    await expect(page.getByTestId("paid-workflow-route").getByRole("button")).toHaveCount(0);
  });

  test("captures the quote to ledger to result to receipt/evidence to blocked-state flow", async ({
    page,
  }) => {
    await page.goto("/economic-demo/paid-workflow");
    await expect(
      page.getByRole("heading", { name: /buyer paid workflow — no-spend shell/i }),
    ).toBeVisible();

    for (const testId of [
      "paid-workflow-copy-modes",
      "paid-workflow-quote",
      "paid-workflow-budget",
      "paid-workflow-timeline-placeholder",
      "paid-workflow-result",
      "paid-workflow-receipt",
      "paid-workflow-evidence",
      "paid-workflow-boundary-states",
      "paid-workflow-blocked-airwallex_webhook_probe_only_cap",
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
