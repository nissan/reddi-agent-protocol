import {
  economicDemoScenarios,
  type EconomicDemoScenario,
} from "@/lib/economic-demo/fixture";
import {
  deriveAllSupervisorRunDiagnostics,
  deriveSupervisorRunDiagnostics,
  SUPERVISOR_RUN_DIAGNOSTICS_SCHEMA_VERSION,
} from "@/lib/manager/supervisor-run-diagnostics";

function scenario(id: EconomicDemoScenario["id"]): EconomicDemoScenario {
  const found = economicDemoScenarios.find((item) => item.id === id);
  if (!found) throw new Error(`missing economic demo scenario: ${id}`);
  return found;
}

describe("supervisor run diagnostics read model (#344)", () => {
  it("links every fixture run to its supervisor, mode, and receipt refs", () => {
    const all = deriveAllSupervisorRunDiagnostics();
    expect(all).toHaveLength(economicDemoScenarios.length);
    for (const diagnostics of all) {
      expect(diagnostics.schemaVersion).toBe(SUPERVISOR_RUN_DIAGNOSTICS_SCHEMA_VERSION);
      expect(diagnostics.runLinkage.runId).toBe(`fixture-run:${diagnostics.runLinkage.scenarioId}`);
      expect(diagnostics.runLinkage.supervisorProfileId).toBeTruthy();
      expect(diagnostics.runLinkage.evidenceKind).toBe("fixture");
      expect(diagnostics.runLinkage.receiptRefs.length).toBeGreaterThan(0);
      expect(diagnostics.guardrails).toEqual({
        liveRunExecuted: false,
        walletSigning: false,
        rpcCall: false,
        paymentExecuted: false,
        attestationIssued: false,
        reputationMutated: false,
      });
    }
  });

  it("reports child invocation state with settlement and attestation coverage per child", () => {
    const diagnostics = deriveSupervisorRunDiagnostics(scenario("webpage"));
    const childIds = diagnostics.childInvocations.map((child) => child.childProfileId);
    expect(childIds).toEqual([
      "content-creation-agent",
      "code-generation-agent",
      "verification-validation-agent",
    ]);

    const copy = diagnostics.childInvocations[0];
    expect(copy.invocationState).toBe("planned");
    expect(copy.settlementState).toBe("settlement_receipt_recorded");
    expect(copy.attestationState).toBe("attested");
    expect(copy.settlementReceiptRefs.length).toBeGreaterThan(0);
    expect(copy.attestationRefs.length).toBeGreaterThan(0);

    const attestor = diagnostics.childInvocations[2];
    expect(attestor.invocationState).toBe("attested");
    expect(attestor.attestationRefs).toContain("fixture:attestation:release-recommended");
  });

  it("surfaces the failure reason and withholds settlement/attestation for a blocked child", () => {
    const diagnostics = deriveSupervisorRunDiagnostics(scenario("picture"));
    const blocked = diagnostics.childInvocations.find(
      (child) => child.childProfileId === "image-generation-adapter",
    );
    expect(blocked).toBeDefined();
    expect(blocked?.invocationState).toBe("blocked");
    expect(blocked?.failureReason).toBe("image-generation-disabled");
    expect(blocked?.settlementState).toBe("blocked_no_settlement");
    expect(blocked?.attestationState).toBe("blocked_not_attested");
    expect(blocked?.settlementReceiptRefs).toEqual([]);
    expect(diagnostics.failureReasons).toEqual([
      { childProfileId: "image-generation-adapter", reason: "image-generation-disabled" },
    ]);
  });

  it("summarises settlement/audit state from the run report", () => {
    const diagnostics = deriveSupervisorRunDiagnostics(scenario("research"));
    expect(diagnostics.settlementAuditState.paymentReceiptCount).toBeGreaterThan(0);
    expect(diagnostics.settlementAuditState.attestationCount).toBeGreaterThan(0);
    expect(diagnostics.settlementAuditState.reputationEventCount).toBeGreaterThan(0);
    expect(diagnostics.settlementAuditState.paymentProofStatuses.length).toBeGreaterThan(0);
  });

  it("finds no settlement/attestation bypass in any existing fixture scenario (structural)", () => {
    for (const diagnostics of deriveAllSupervisorRunDiagnostics()) {
      expect(diagnostics.settlementAuditState.constraintViolations).toEqual([]);
    }
  });

  it("detects — rather than silently passes — a settled child with no attestation coverage", () => {
    const rogue: EconomicDemoScenario = {
      ...scenario("webpage"),
      id: "webpage",
      orchestrator: "agentic-workflow-system",
      edges: [
        {
          from: "agentic-workflow-system",
          to: "rogue-specialist",
          capability: "security-review",
          payloadSummary: "Paid work with no attestation edge and no attestor call coverage.",
          amountLamports: 1_000_000,
          status: "paid",
          receipt: "fixture:x402:challenge:rogue",
        },
      ],
      budgetLedger: [
        {
          label: "Rogue specialist budget",
          from: "agentic-workflow-system",
          to: "rogue-specialist",
          amountUsdc: 1,
          category: "downstream",
        },
      ],
    };

    const diagnostics = deriveSupervisorRunDiagnostics(rogue);
    expect(diagnostics.settlementAuditState.constraintViolations).toEqual([
      expect.objectContaining({
        code: "settled_child_without_attestation",
        childProfileId: "rogue-specialist",
      }),
    ]);
  });

  it("detects a blocked child that still carries settlement receipts", () => {
    const tampered: EconomicDemoScenario = {
      ...scenario("picture"),
      budgetLedger: [
        ...scenario("picture").budgetLedger,
        {
          label: "Illegitimate blocked-adapter payment",
          from: "tool-using-agent",
          to: "image-generation-adapter",
          amountUsdc: 0.25,
          category: "downstream",
        },
      ],
    };

    const diagnostics = deriveSupervisorRunDiagnostics(tampered);
    expect(diagnostics.settlementAuditState.constraintViolations).toEqual([
      expect.objectContaining({
        code: "blocked_child_with_settlement",
        childProfileId: "image-generation-adapter",
      }),
    ]);
  });
});
