import { existsSync } from "node:fs";
import { join } from "node:path";

import { PUBLIC_PROOF_PAGE_DATA_SCHEMA_VERSION } from "@/lib/economic-demo/public-proof-page-data";
import {
  assertX402ReferenceWorkflowRehearsalStaysDryRun,
  buildX402ReferenceWorkflowRehearsal,
  X402_REFERENCE_WORKFLOW_REHEARSAL_SCHEMA_VERSION,
  X402_REFERENCE_WORKFLOW_RUNBOOK_PATH,
  X402_REFERENCE_WORKFLOW_STEP_IDS,
} from "@/lib/economic-demo/x402-reference-workflow-rehearsal";

describe("economic demo x402 reference workflow rehearsal (#564 no-live prep)", () => {
  it("rehearses the full A2A loop in order with every step dry-run only", () => {
    const rehearsal = buildX402ReferenceWorkflowRehearsal();

    expect(rehearsal.schemaVersion).toBe(X402_REFERENCE_WORKFLOW_REHEARSAL_SCHEMA_VERSION);
    expect(rehearsal.issueRef).toBe("nissan/reddi-agent-protocol#564");
    expect(rehearsal.mode).toBe("no_live_dry_run_rehearsal");
    expect(rehearsal.scenarioId).toBe("webpage");
    expect(rehearsal.steps.map((step) => step.step)).toEqual([...X402_REFERENCE_WORKFLOW_STEP_IDS]);
    expect(rehearsal.steps.map((step) => step.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const step of rehearsal.steps) {
      expect(step.status).toBe("rehearsed_dry_run");
      expect(step.liveExecution).toBe(false);
      expect(step.refs.length).toBeGreaterThan(0);
    }
  });

  it("emits a proof artifact that validates against the #417 public proof page data contract", () => {
    const rehearsal = buildX402ReferenceWorkflowRehearsal();
    const proof = rehearsal.proofContract;

    expect(proof.schemaVersion).toBe(PUBLIC_PROOF_PAGE_DATA_SCHEMA_VERSION);
    expect(proof.scenarioId).toBe("webpage");
    expect(proof.stateLabels).toEqual(
      expect.arrayContaining([
        "fixture_zero_spend",
        "planned_dry_run",
        "simulated",
        "devnet_proof_metadata",
        "live_gated",
        "production_live_disabled",
      ]),
    );
    expect(proof.policyDecision.status).toBe("allowed_fixture_only");
    expect(proof.auddPaymentPlanPreflight).toMatchObject({
      status: "allowed_fixture_only",
      paymentMode: "dry-run",
      evidenceRequired: true,
    });
    expect(proof.railNeutralProofChain.schemaVersion).toBe("reddi.rail-neutral-proof-chain-fixture.v1");
    const bindingReady = proof.railNeutralProofChain.cases.find((item) => item.status === "binding_ready");
    expect(bindingReady).toBeDefined();
    expect(rehearsal.receipt.bindingCase).toBe(bindingReady?.case);
    expect(rehearsal.evidence.bindingCase).toBe(bindingReady?.case);
    expect(rehearsal.x402PaymentPlan.dryRunPaymentProofRef).toBe(bindingReady?.payment?.paymentProofRef);
    expect(proof.reputationDraft).toMatchObject({ status: "draft_only", mutationAllowed: false, commitTx: null, revealTx: null });
    expect(proof.attestationDraft).toMatchObject({ status: "draft_only", result: "not_submitted" });
  });

  it("keeps every live-gated boundary flag false and real metering at zero, marked test", () => {
    const rehearsal = buildX402ReferenceWorkflowRehearsal();

    expect(Object.values(rehearsal.boundaryFlags).every((flag) => flag === false)).toBe(true);
    expect(Object.values(rehearsal.proofContract.boundaryFlags).every((flag) => flag === false)).toBe(true);
    expect(rehearsal.metering.meteringMode).toBe("test");
    expect(rehearsal.metering.real).toMatchObject({
      executed: false,
      downstreamCallsExecuted: 0,
      paidRequests: 0,
      walletSigningEvents: 0,
      rpcCalls: 0,
      devnetTransactions: 0,
      usdcSettled: "0",
      protocolRailFeesCollectedUsdc: "0",
      realSettlementsVerified: 0,
    });
    expect(rehearsal.metering.test.plannedDownstreamCalls).toBeGreaterThan(0);
    expect(rehearsal.metering.test.plannedTotalUsdc).toBeGreaterThan(0);
    expect(rehearsal.network).toEqual({ target: "solana-devnet", executed: false, state: "live_gated" });
    expect(rehearsal.x402PaymentPlan).toMatchObject({ paymentMode: "dry-run", executed: false, settlementClaim: "none" });
    expect(() => assertX402ReferenceWorkflowRehearsalStaysDryRun(rehearsal)).not.toThrow();
  });

  it("fails closed when any dry-run boundary is violated", () => {
    const rehearsal = buildX402ReferenceWorkflowRehearsal();
    const tampered = JSON.parse(JSON.stringify(rehearsal)) as ReturnType<typeof buildX402ReferenceWorkflowRehearsal>;
    (tampered.metering.real as { paidRequests: number }).paidRequests = 1;
    (tampered.boundaryFlags as { livePayment: boolean }).livePayment = true;

    expect(() => assertX402ReferenceWorkflowRehearsalStaysDryRun(tampered)).toThrow(
      /x402_reference_workflow_rehearsal_dry_run_violation/,
    );
    expect(() => assertX402ReferenceWorkflowRehearsalStaysDryRun(tampered)).toThrow(/real_paid_requests_not_zero/);
    expect(() => assertX402ReferenceWorkflowRehearsalStaysDryRun(tampered)).toThrow(/boundary_flag_not_false:livePayment/);
  });

  it("stays live-gated behind operator approval with a committed runbook", () => {
    const rehearsal = buildX402ReferenceWorkflowRehearsal();

    expect(rehearsal.liveGate).toMatchObject({
      state: "live_gated",
      liveStepsExecuted: false,
      requiresOperatorApproval: true,
      operator: "Nissan",
      autonomousAgentExecutionAllowed: false,
      operatorApprovalRef: null,
      runbookPath: X402_REFERENCE_WORKFLOW_RUNBOOK_PATH,
    });
    expect(rehearsal.liveGate.armEnvVarNames).toEqual([
      "ECONOMIC_DEMO_LIVE_PAID_DEVNET",
      "ECONOMIC_DEMO_LIVE_PAID_DEVNET_CONFIRM",
      "ECONOMIC_DEMO_ORCHESTRATOR_DEVNET_KEYPAIR_JSON",
    ]);
    expect(rehearsal.liveGate.confirmTokenValue).toBe("RUN_ECONOMIC_DEMO_LIVE_PAID_DEVNET");
    expect(existsSync(join(process.cwd(), X402_REFERENCE_WORKFLOW_RUNBOOK_PATH))).toBe(true);
    expect(existsSync(join(process.cwd(), rehearsal.liveGate.promotionChecklistPath))).toBe(true);
  });

  it("is deterministic across repeated builds", () => {
    expect(buildX402ReferenceWorkflowRehearsal()).toEqual(buildX402ReferenceWorkflowRehearsal());
  });
});
