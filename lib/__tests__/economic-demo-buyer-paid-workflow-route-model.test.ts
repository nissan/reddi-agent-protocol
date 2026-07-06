import {
  BUYER_PAID_WORKFLOW_COPY_MODES,
  BUYER_PAID_WORKFLOW_ROUTE_MODEL_SCHEMA_VERSION,
  buildBuyerPaidWorkflowRouteModel,
  PAID_WORKFLOW_ROUTE_STATES,
} from "@/lib/economic-demo/buyer-paid-workflow-route-model";
import {
  getPaidWorkflowProofUiFixturePack,
  type PaidWorkflowProofUiFixturePack,
} from "@/lib/economic-demo/paid-workflow-proof-ui-fixtures";

describe("buyer paid-workflow route model (#498)", () => {
  it("maps the #497 state contract onto existing surfaces without inventing a proof shape", () => {
    const model = buildBuyerPaidWorkflowRouteModel();

    expect(model.schemaVersion).toBe(BUYER_PAID_WORKFLOW_ROUTE_MODEL_SCHEMA_VERSION);
    if (model.status !== "ready") throw new Error(`expected ready model, got ${model.status}`);

    expect(model.consumes).toMatchObject({
      fixturePackSchemaVersion: "reddi.economic-demo.paid-workflow-proof-ui-fixture-pack.v1",
      publicProofPageDataSchemaVersion: "reddi.economic-demo.public-proof-page-data.v1",
      rehearsalSchemaVersion: "reddi.economic-demo.x402-reference-workflow-rehearsal.v1",
      railSupportMatrixSchemaVersion: "reddi.airwallex-hosted-checkout-rail.v1",
    });

    expect(model.quote.state).toBe("quote_ready");
    expect(model.quote.totalUsdc).toBeGreaterThan(0);
    expect(model.budget.state).toBe("budget_ledger_ready");
    expect(model.budget.downstreamCallsExecuted).toBe(0);
    expect(model.executionTimeline).toMatchObject({
      state: "execution_timeline_ready",
      placeholder: true,
      pendingIssueRef: "#499",
    });
    expect(model.executionTimeline.milestones.map((item) => item.id)).toEqual([
      "discover",
      "quote",
      "policy_preflight",
      "x402_payment_plan",
      "receipt",
      "evidence",
      "proof_contract_emission",
      "attestation_preview",
      "reputation_preview",
    ]);
    expect(model.result.state).toBe("result_ready");
    expect(model.receipt).toMatchObject({ state: "receipt_binding_ready", paymentProofLabel: "refs_hashes_only" });
    expect(model.evidence.state).toBe("evidence_refs_ready");
    expect(model.attestationPreview.state).toBe("attestation_preview_only");
    expect(model.reputationPreview.state).toBe("reputation_preview_only");
    expect(model.liveGate.state).toBe("live_gated_only");
    expect(model.productionDisabled.state).toBe("production_disabled");

    const usedStates = [
      model.quote.state,
      model.budget.state,
      model.executionTimeline.state,
      model.result.state,
      model.receipt.state,
      model.evidence.state,
      model.attestationPreview.state,
      model.reputationPreview.state,
      ...model.blockedCases.map((item) => item.state),
      model.liveGate.state,
      model.productionDisabled.state,
    ];
    for (const state of usedStates) {
      expect(PAID_WORKFLOW_ROUTE_STATES).toContain(state);
    }
  });

  it("classifies every blocked fixture case including the #588 probe-only cap and #587 rail rows", () => {
    const model = buildBuyerPaidWorkflowRouteModel();
    if (model.status !== "ready") throw new Error("expected ready model");

    const byCase = Object.fromEntries(model.blockedCases.map((item) => [item.sourceCase, item.kind]));
    expect(byCase).toEqual({
      mpp_tempo_unsupported_network: "unsupported_rail_network",
      unsupported_asset_network: "unsupported_rail_network",
      malformed_receipt: "malformed_receipt",
      policy_denied: "policy_denied",
      airwallex_webhook_probe_only_cap: "probe_only_receipt_cap",
      live_path_overclaim: "live_path_overclaim",
    });
    expect(model.blockedCases.every((item) => item.state === "blocked_fail_closed")).toBe(true);
    expect(model.blockedCases.every((item) => item.blockedBy.length > 0)).toBe(true);

    expect(model.unsupportedRail.rows.map((row) => row.supportState).sort()).toEqual([
      "airwallex_webhook_receipt_probe_only",
      "unsupported_live_airwallex_settlement",
    ]);
    expect(model.unsupportedRail.draft).toBe(true);
  });

  it("fails closed on an empty fixture pack", () => {
    const pack = getPaidWorkflowProofUiFixturePack();
    const model = buildBuyerPaidWorkflowRouteModel({ fixturePack: { ...pack, cases: [] } });

    expect(model).toMatchObject({
      status: "fail_closed",
      state: "blocked_fail_closed",
      reasonCode: "empty_fixture_pack",
    });
  });

  it("fails closed on a malformed fixture pack schema", () => {
    const pack = getPaidWorkflowProofUiFixturePack();
    const malformed = {
      ...pack,
      schemaVersion: "reddi.economic-demo.paid-workflow-proof-ui-fixture-pack.v999",
    } as unknown as PaidWorkflowProofUiFixturePack;

    expect(buildBuyerPaidWorkflowRouteModel({ fixturePack: malformed })).toMatchObject({
      status: "fail_closed",
      reasonCode: "fixture_pack_schema_mismatch",
    });

    expect(
      buildBuyerPaidWorkflowRouteModel({
        fixturePack: undefined as unknown as PaidWorkflowProofUiFixturePack,
      }).status,
    ).toBe("ready"); // undefined falls back to the canonical pack
  });

  it("fails closed when the happy-path case is missing", () => {
    const pack = getPaidWorkflowProofUiFixturePack();
    const model = buildBuyerPaidWorkflowRouteModel({
      fixturePack: { ...pack, cases: pack.cases.filter((item) => item.status === "blocked") },
    });

    expect(model).toMatchObject({ status: "fail_closed", reasonCode: "missing_happy_path_case" });
  });

  it("fails closed on boundary-flag drift instead of rendering live-looking data", () => {
    const pack = getPaidWorkflowProofUiFixturePack();
    const drifted = {
      ...pack,
      boundaryFlags: { ...pack.boundaryFlags, livePayment: true },
    } as unknown as PaidWorkflowProofUiFixturePack;

    expect(buildBuyerPaidWorkflowRouteModel({ fixturePack: drifted })).toMatchObject({
      status: "fail_closed",
      reasonCode: "boundary_flag_drift",
    });
  });

  it("fails closed when the second-rail support matrix has no unsupported/probe-only rows", () => {
    expect(buildBuyerPaidWorkflowRouteModel({ railSupportMatrix: [] })).toMatchObject({
      status: "fail_closed",
      reasonCode: "unsupported_rail_matrix_missing",
    });
  });

  it("keeps every boundary flag false and the live gate approval-only", () => {
    const model = buildBuyerPaidWorkflowRouteModel();
    if (model.status !== "ready") throw new Error("expected ready model");

    expect(Object.values(model.boundaryFlags).every((value) => value === false)).toBe(true);
    expect(model.liveGate).toMatchObject({
      requiresOperatorApproval: true,
      operatorApprovalRef: null,
    });
    expect(model.recordedDevnet.realMetering).toMatchObject({
      executed: false,
      downstreamCallsExecuted: 0,
      paidRequests: 0,
      walletSigningEvents: 0,
      rpcCalls: 0,
      devnetTransactions: 0,
      usdcSettled: "0",
    });

    const serialized = JSON.stringify(model);
    expect(serialized).not.toContain("rawPrompt");
    expect(serialized).not.toContain("providerResponseBody");
  });

  it("derives copy modes from the #497 copy boundary matrix without live-implying claims", () => {
    expect(BUYER_PAID_WORKFLOW_COPY_MODES.map((mode) => mode.mode)).toEqual([
      "fixture_zero_spend",
      "planned_dry_run",
      "simulated",
      "devnet_proof_metadata",
      "live_gated",
      "production_live_disabled",
    ]);

    const copy = BUYER_PAID_WORKFLOW_COPY_MODES.map((mode) => `${mode.label} ${mode.detail}`).join(" ");
    // Forbidden claims only ever appear negated; assert the raw positive
    // claims are absent from the assembled copy.
    expect(copy).not.toMatch(/\bsettlement finality proven\b/i);
    expect(copy).not.toMatch(/\bcustody-backed result\b/i);
    expect(copy).not.toMatch(/auto-pay is enabled/i);
    expect(copy).toContain("No approval is granted here");
    expect(copy).toContain("disabled by default");
  });
});
