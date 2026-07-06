import {
  BUYER_PAID_WORKFLOW_COPY_MODES,
  BUYER_PAID_WORKFLOW_ROUTE_MODEL_SCHEMA_VERSION,
  buildBuyerPaidWorkflowRouteModel,
  PAID_WORKFLOW_CONTRACT_ONLY_BOUNDARY_FLAGS,
  PAID_WORKFLOW_ROUTE_STATES,
  PAID_WORKFLOW_TIMELINE_MILESTONE_IDS,
  reconcileBuyerPaidWorkflowLedgerAllocation,
} from "@/lib/economic-demo/buyer-paid-workflow-route-model";
import { economicDemoScenarios } from "@/lib/economic-demo/fixture";
import {
  getPaidWorkflowProofUiFixturePack,
  type PaidWorkflowProofUiFixturePack,
} from "@/lib/economic-demo/paid-workflow-proof-ui-fixtures";
import {
  buildX402ReferenceWorkflowRehearsal,
  type X402ReferenceWorkflowRehearsal,
} from "@/lib/economic-demo/x402-reference-workflow-rehearsal";

describe("buyer paid-workflow route model (#498/#499)", () => {
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
    expect(model.executionTimeline.state).toBe("execution_timeline_ready");
    expect(model.executionTimeline.milestones.map((item) => item.id)).toEqual([
      ...PAID_WORKFLOW_TIMELINE_MILESTONE_IDS,
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
      model.ledger.state,
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

  it("renders every #499 ledger row category with reconciled allocations and zero spend", () => {
    const model = buildBuyerPaidWorkflowRouteModel();
    if (model.status !== "ready") throw new Error("expected ready model");

    const categories = new Set(model.ledger.rows.map((row) => row.category));
    for (const category of [
      "buyer_budget",
      "specialist_cost",
      "attestor_proof_cost",
      "orchestrator_fee_margin",
      "protocol_rail_fee",
      "swap_allowance",
      "spent_to_date",
      "remaining",
      "refund_state",
      "settlement_cost",
      "blocked_spend",
    ]) {
      expect(categories).toContain(category);
    }

    expect(model.ledger.reconciled).toBe(true);
    expect(model.ledger.buyerBudgetUsdc).toBe(model.ledger.allocatedUsdc);
    expect(model.ledger.buyerBudgetUsdc).toBe(String(model.quote.totalUsdc));
    expect(model.ledger.spentUsdc).toBe("0");
    expect(model.ledger.remainingIfUnspentUsdc).toBe(model.ledger.buyerBudgetUsdc);
    expect(model.ledger.refundState).toMatchObject({
      failurePolicy: "no_charge_on_failure",
      refundPolicy: "manual_review_fixture_only",
      refundsIssued: 0,
    });

    // Every specialist row is traced to a catalog profile ref.
    const specialistRows = model.ledger.rows.filter((row) => row.category === "specialist_cost");
    expect(specialistRows.length).toBeGreaterThan(0);
    for (const row of specialistRows) {
      expect(row.refs.some((ref) => ref.startsWith("profile:"))).toBe(true);
    }
  });

  it("marks every ledger row traceable or explicitly unavailable/blocked", () => {
    const model = buildBuyerPaidWorkflowRouteModel();
    if (model.status !== "ready") throw new Error("expected ready model");

    for (const row of model.ledger.rows) {
      expect(row.refs.length > 0 || row.availability !== "available").toBe(true);
    }

    const settlement = model.ledger.rows.find((row) => row.category === "settlement_cost");
    expect(settlement).toMatchObject({
      availability: "unavailable",
      amountUsdc: null,
      state: "unavailable_not_implemented",
    });
    expect(settlement?.refs[0]).toContain("real_devnet_receipt_verifier");

    const blockedSpend = model.ledger.rows.find((row) => row.category === "blocked_spend");
    expect(blockedSpend).toMatchObject({ availability: "blocked", amountUsdc: "0" });
    expect(blockedSpend?.refs).toContain("blocked_case:policy_denied");
  });

  it("renders the nine #499 timeline milestones with traceable refs and recorded-devnet labels", () => {
    const model = buildBuyerPaidWorkflowRouteModel();
    if (model.status !== "ready") throw new Error("expected ready model");

    const timeline = model.executionTimeline;
    expect(timeline.sourceRunbookPath).toBe("docs/DEVNET-REFERENCE-RUN-564.md");
    expect(timeline.milestones).toHaveLength(9);
    expect(timeline.milestones.map((item) => item.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    for (const milestone of timeline.milestones) {
      expect(
        milestone.refs.length > 0 || milestone.availability === "no_public_ref_preview_only",
      ).toBe(true);
    }

    const byId = new Map(timeline.milestones.map((item) => [item.id, item]));
    expect(byId.get("execution")).toMatchObject({
      status: "planned_no_live_execution",
      stateLabel: "planned_dry_run",
    });
    expect(
      byId.get("execution")?.refs.some((ref) => ref === "rehearsal:metering.real.downstreamCallsExecuted:0"),
    ).toBe(true);
    expect(byId.get("policy_decision")?.refs).toContain("policy:allowed_fixture_only");
    expect(byId.get("result")).toMatchObject({ status: "fixture_result_only", stateLabel: "fixture_zero_spend" });
    expect(byId.get("receipt")?.status).toBe("binding_refs_only");
    expect(byId.get("evidence")?.status).toBe("binding_refs_only");
    expect(byId.get("attestation_preview")).toMatchObject({ status: "preview_only", stateLabel: "simulated", recordedDevnetRef: null });
    expect(byId.get("reputation_preview")).toMatchObject({
      status: "preview_only",
      availability: "no_public_ref_preview_only",
      recordedDevnetRef: null,
    });
    expect(byId.get("reputation_preview")?.refs).toEqual([]);

    // Recorded-devnet metadata labels reference the #582/#564 runbook.
    for (const id of ["request", "quote", "policy_decision", "execution", "result", "receipt", "evidence"] as const) {
      expect(byId.get(id)?.recordedDevnetRef).toBe("runbook:docs/DEVNET-REFERENCE-RUN-564.md");
    }
  });

  it("keeps spend and mutation false on every blocked case (#499 criterion 3)", () => {
    const model = buildBuyerPaidWorkflowRouteModel();
    if (model.status !== "ready") throw new Error("expected ready model");

    expect(model.blockedCases.length).toBeGreaterThanOrEqual(5);
    for (const item of model.blockedCases) {
      expect(item.spendState).toEqual({
        spentUsdc: "0",
        refundsIssued: 0,
        spendingAllowed: false,
        mutationAllowed: false,
        boundaryFlagsAllFalse: true,
      });
    }
  });

  it("exposes the 16-flag #497 hard-boundary grid, all false", () => {
    const model = buildBuyerPaidWorkflowRouteModel();
    if (model.status !== "ready") throw new Error("expected ready model");

    expect(Object.keys(model.hardBoundaryFlags)).toHaveLength(16);
    expect(Object.values(model.hardBoundaryFlags).every((value) => value === false)).toBe(true);
    for (const key of Object.keys(PAID_WORKFLOW_CONTRACT_ONLY_BOUNDARY_FLAGS)) {
      expect(model.hardBoundaryFlags).toHaveProperty(key, false);
    }
    // The 12 fixture-pack flags remain present alongside the 4 contract-only flags.
    expect(model.hardBoundaryFlags).toHaveProperty("walletSigning", false);
    expect(model.hardBoundaryFlags).toHaveProperty("livePayment", false);
  });

  it("reconciles the fixture budget-ledger allocation and detects doctored mismatches", () => {
    const scenario = economicDemoScenarios.find((candidate) => candidate.id === "webpage");
    if (!scenario) throw new Error("missing webpage scenario");

    const ok = reconcileBuyerPaidWorkflowLedgerAllocation(scenario.budgetLedger, scenario.quote);
    expect(ok.reconciled).toBe(true);
    expect(ok.buyerBudgetMicroUsdc).toBe(ok.allocatedMicroUsdc);

    const doctored = scenario.budgetLedger.map((entry) =>
      entry.category === "markup" ? { ...entry, amountUsdc: entry.amountUsdc + 0.5 } : entry,
    );
    expect(reconcileBuyerPaidWorkflowLedgerAllocation(doctored, scenario.quote).reconciled).toBe(false);
  });

  it("fails closed when the rehearsal scenario has no fixture budget ledger", () => {
    const rehearsal = {
      ...buildX402ReferenceWorkflowRehearsal(),
      scenarioId: "no_such_scenario",
    } as unknown as X402ReferenceWorkflowRehearsal;

    expect(buildBuyerPaidWorkflowRouteModel({ rehearsal })).toMatchObject({
      status: "fail_closed",
      state: "blocked_fail_closed",
      reasonCode: "budget_ledger_source_missing",
    });
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
