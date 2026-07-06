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

test.describe("/economic-demo/paid-workflow (#498/#499)", () => {
  for (const viewport of viewports) {
    test(`renders the buyer no-spend workflow with ledger and timeline at ${viewport.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/economic-demo/paid-workflow");

      await expect(
        page.getByRole("heading", { name: /buyer paid workflow — no-spend shell/i }),
      ).toBeVisible();

      // Journey: quote -> budget -> ledger -> timeline -> result -> receipt -> evidence.
      await expect(page.getByTestId("paid-workflow-quote")).toBeVisible();
      await expect(page.getByTestId("paid-workflow-quote")).toContainText("Quoted total");
      await expect(page.getByTestId("paid-workflow-budget")).toContainText(
        "downstream calls executed: 0",
      );

      // #499 ledger: buyer budget, specialist, attestor, fee/margin, remaining/refund,
      // unavailable settlement, blocked-spend rows.
      const ledger = page.getByTestId("paid-workflow-ledger");
      await expect(ledger).toBeVisible();
      await expect(ledger.getByTestId("paid-workflow-ledger-totals")).toContainText("Buyer budget");
      await expect(ledger.getByTestId("paid-workflow-ledger-totals")).toContainText("Remaining (unspent)");
      await expect(ledger.getByTestId("paid-workflow-ledger-row-buyer_budget")).toBeVisible();
      await expect(ledger.getByTestId("paid-workflow-ledger-row-spent_to_date")).toContainText("0 USDC");
      await expect(ledger.getByTestId("paid-workflow-ledger-row-refund_state")).toContainText(
        "no_charge_on_failure",
      );

      // #499 timeline: request -> ... -> reputation preview.
      const timeline = page.getByTestId("paid-workflow-timeline");
      await expect(timeline).toBeVisible();
      await expect(timeline.getByTestId("paid-workflow-timeline-request")).toBeVisible();
      await expect(timeline.getByTestId("paid-workflow-timeline-reputation_preview")).toBeVisible();

      await expect(page.getByTestId("paid-workflow-result")).toBeVisible();
      await expect(page.getByTestId("paid-workflow-receipt")).toContainText("refs_hashes_only");
      await expect(page.getByTestId("paid-workflow-evidence")).toBeVisible();
      await expect(page.getByTestId("paid-workflow-attestation-preview")).toContainText("Draft only");
      await expect(page.getByTestId("paid-workflow-reputation-preview")).toContainText("No mutation");

      // Capture to test-results (not docs/evidence/499 directly): writing into
      // docs/ mid-run triggers the webpack dev watcher and the next navigation
      // races the invalidation. Evidence is copied to docs/evidence/499 after
      // the run (see docs/evidence/499/README.md).
      await page.screenshot({
        path: `test-results/evidence-499/${viewport.name}-${viewport.width}.png`,
        fullPage: true,
      });
    });
  }

  test("renders every #499 ledger row and timeline milestone traceable or explicitly marked", async ({
    page,
  }) => {
    await page.goto("/economic-demo/paid-workflow");

    const ledger = page.getByTestId("paid-workflow-ledger");
    await ledger.scrollIntoViewIfNeeded();
    await expect(ledger).toContainText("allocations reconciled");

    // Specialist + attestor + fee/margin rows carry fixture/profile refs.
    await expect(
      ledger.getByTestId("paid-workflow-ledger-row-specialist_cost_content_creation_agent"),
    ).toContainText("profile:content-creation-agent");
    await expect(
      ledger.getByTestId("paid-workflow-ledger-row-specialist_cost_code_generation_agent"),
    ).toContainText("profile:code-generation-agent");
    await expect(ledger.getByTestId("paid-workflow-ledger-row-attestor_proof_cost_0")).toBeVisible();
    await expect(ledger.getByTestId("paid-workflow-ledger-row-orchestrator_fee_margin_0")).toBeVisible();
    await expect(ledger.getByTestId("paid-workflow-ledger-row-protocol_rail_fee_0")).toContainText("bps");

    // Unavailable and blocked rows are explicitly marked, never silently omitted.
    const settlementRow = ledger.getByTestId("paid-workflow-ledger-row-settlement_cost");
    await expect(settlementRow).toContainText("unavailable");
    await expect(settlementRow).toContainText("receipt verifier is a later phase");
    const blockedRow = ledger.getByTestId("paid-workflow-ledger-row-blocked_spend");
    await expect(blockedRow).toContainText("blocked fail closed");

    const timeline = page.getByTestId("paid-workflow-timeline");
    await timeline.scrollIntoViewIfNeeded();
    for (const milestone of [
      "request",
      "quote",
      "policy_decision",
      "execution",
      "result",
      "receipt",
      "evidence",
      "attestation_preview",
      "reputation_preview",
    ]) {
      await expect(timeline.getByTestId(`paid-workflow-timeline-${milestone}`)).toBeVisible();
    }
    await expect(timeline.getByTestId("paid-workflow-timeline-execution")).toContainText(
      "planned no live execution",
    );
    await expect(timeline.getByTestId("paid-workflow-timeline-policy_decision")).toContainText(
      "policy:allowed_fixture_only",
    );
    // Recorded-devnet metadata labels reference the #582/#564 runbook.
    await expect(timeline.getByTestId("paid-workflow-timeline-request")).toContainText(
      "devnet_proof_metadata",
    );
    await expect(timeline).toContainText("DEVNET-REFERENCE-RUN-564.md");
    // The preview-only milestone with no public ref says so explicitly.
    await expect(timeline.getByTestId("paid-workflow-timeline-reputation_preview")).toContainText(
      "No public ref",
    );
  });

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

    // All blocked rail-neutral cases render with fail-closed reasons and keep
    // spending/mutation false (#499 criterion 3: unsupported, malformed,
    // policy-denied, probe-only, live-path-overclaim).
    for (const sourceCase of blockedSourceCases) {
      const card = page.getByTestId(`paid-workflow-blocked-${sourceCase}`);
      await card.scrollIntoViewIfNeeded();
      await expect(card).toBeVisible();
      await expect(card).toContainText("spent 0 USDC");
      await expect(card).toContainText("spending and mutation stay false");
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

    // Boundary flags grid: the full 16-flag #497 grid, every flag false —
    // including the four contract-only flags (#499 criterion 4).
    const flags = page.getByTestId("paid-workflow-boundary-flags");
    await expect(flags).toContainText("All live flags false");
    await expect(flags).toContainText("Wallet Signing");
    await expect(flags).toContainText("Live Payment");
    await expect(flags).toContainText("Production Audd Rail");
    await expect(flags).toContainText("Default Usdc Auto Pay");
    await expect(flags).toContainText("Mainnet Settlement");
    await expect(flags).toContainText("Pay Sh Production Activation");

    // Zero live paths: the route exposes no buttons (no run/pay/approve affordance).
    await expect(page.getByTestId("paid-workflow-route").getByRole("button")).toHaveCount(0);
  });

  test("captures the quote to ledger to timeline to result to receipt/evidence to blocked-state flow", async ({
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
      "paid-workflow-ledger",
      "paid-workflow-timeline",
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
