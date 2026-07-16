import {
  buildEconomicRunReport,
  economicDemoScenarios,
  type EconomicDemoScenario,
  type EconomicRunReport,
} from "@/lib/economic-demo/fixture";

/**
 * Supervisor run diagnostics read model (#344).
 *
 * Explains — from the existing economic-demo fixtures only, no live runs —
 * what a supervisor (orchestrator) run did: run linkage, per-child invocation
 * state, failure reasons, and settlement/audit state. It also derives the
 * structural no-silent-bypass audit: every settled child invocation must have
 * both a payment receipt and attestation coverage, and a blocked child must
 * never carry settlement receipts or reputation events. Violations are
 * surfaced as reason-coded records, never dropped.
 *
 * Pure read model: no network, no wallet/RPC action, no payment execution,
 * no attestation issuance, no reputation mutation.
 */

export const SUPERVISOR_RUN_DIAGNOSTICS_SCHEMA_VERSION =
  "reddi.supervisor-run-diagnostics.v1" as const;

export type SupervisorChildInvocationState = "planned" | "paid" | "attested" | "blocked";

export type SupervisorChildSettlementState =
  | "settlement_receipt_recorded"
  | "no_settlement_recorded"
  | "blocked_no_settlement";

export type SupervisorChildAttestationState = "attested" | "not_attested" | "blocked_not_attested";

export type SupervisorConstraintViolationCode =
  | "settled_child_without_attestation"
  | "blocked_child_with_settlement"
  | "blocked_child_with_reputation_event";

export type SupervisorConstraintViolation = {
  code: SupervisorConstraintViolationCode;
  childProfileId: string;
  summary: string;
};

export type SupervisorChildInvocationDiagnostics = {
  childProfileId: string;
  capability: string;
  invocationState: SupervisorChildInvocationState;
  receiptRef: string;
  /** Present only for blocked invocations; derived from the blocked receipt ref. */
  failureReason?: string;
  settlementState: SupervisorChildSettlementState;
  attestationState: SupervisorChildAttestationState;
  /** Refs backing the settlement/attestation states, for audit display. */
  settlementReceiptRefs: string[];
  attestationRefs: string[];
};

export type SupervisorRunDiagnostics = {
  schemaVersion: typeof SUPERVISOR_RUN_DIAGNOSTICS_SCHEMA_VERSION;
  runLinkage: {
    runId: string;
    scenarioId: EconomicDemoScenario["id"];
    supervisorProfileId: string;
    mode: EconomicDemoScenario["mode"];
    evidenceKind: "fixture";
    /** Every receipt ref recorded on the run's edges, for cross-linking. */
    receiptRefs: string[];
  };
  childInvocations: SupervisorChildInvocationDiagnostics[];
  /** Aggregated failure reasons across blocked child invocations. */
  failureReasons: Array<{ childProfileId: string; reason: string }>;
  settlementAuditState: {
    paymentReceiptCount: number;
    paymentProofStatuses: Array<EconomicRunReport["paymentReceipts"][number]["proofStatus"]>;
    attestationCount: number;
    attestationResults: Array<EconomicRunReport["attestations"][number]["result"]>;
    reputationEventCount: number;
    /** Structural no-silent-bypass audit; empty means no bypass detected. */
    constraintViolations: SupervisorConstraintViolation[];
  };
  guardrails: {
    liveRunExecuted: false;
    walletSigning: false;
    rpcCall: false;
    paymentExecuted: false;
    attestationIssued: false;
    reputationMutated: false;
  };
};

const GUARDRAILS: SupervisorRunDiagnostics["guardrails"] = {
  liveRunExecuted: false,
  walletSigning: false,
  rpcCall: false,
  paymentExecuted: false,
  attestationIssued: false,
  reputationMutated: false,
};

function blockedFailureReason(receiptRef: string): string {
  if (receiptRef.startsWith("blocked:")) {
    return receiptRef.slice("blocked:".length);
  }
  return receiptRef;
}

function settlementRefsFor(report: EconomicRunReport, childProfileId: string): string[] {
  return report.paymentReceipts
    .filter((receipt) => receipt.to === childProfileId && receipt.amountUsdc > 0)
    .map((receipt) => receipt.transactionAddress);
}

function attestationRefsFor(report: EconomicRunReport, childProfileId: string): string[] {
  const fromAttestations = report.attestations
    .filter((attestation) => attestation.validatesProfileId === childProfileId)
    .map((attestation) => attestation.attestationReceipt);
  const fromCalls = report.specialistCalls
    .filter((call) => call.specialistProfileId === childProfileId && call.validation !== null)
    .map((call) => call.validation!.attestationReceipt);
  return Array.from(new Set([...fromAttestations, ...fromCalls]));
}

/**
 * Derive supervisor diagnostics for one economic-demo scenario fixture.
 */
export function deriveSupervisorRunDiagnostics(
  scenario: EconomicDemoScenario,
): SupervisorRunDiagnostics {
  const report = buildEconomicRunReport(scenario);
  const childEdges = scenario.edges.filter((edge) => edge.from === scenario.orchestrator);

  const childInvocations: SupervisorChildInvocationDiagnostics[] = childEdges.map((edge) => {
    const blocked = edge.status === "blocked";
    const settlementReceiptRefs = settlementRefsFor(report, edge.to);
    // An edge that itself carries an attestation receipt (status `attested`,
    // e.g. the attestor's own paid edge) is attestation evidence too.
    const attestationRefs = Array.from(new Set([
      ...attestationRefsFor(report, edge.to),
      ...(edge.status === "attested" ? [edge.receipt] : []),
    ]));

    const settlementState: SupervisorChildSettlementState = blocked
      ? "blocked_no_settlement"
      : settlementReceiptRefs.length > 0
        ? "settlement_receipt_recorded"
        : "no_settlement_recorded";

    const attestationState: SupervisorChildAttestationState = blocked
      ? "blocked_not_attested"
      : attestationRefs.length > 0
        ? "attested"
        : "not_attested";

    return {
      childProfileId: edge.to,
      capability: edge.capability,
      invocationState: edge.status,
      receiptRef: edge.receipt,
      failureReason: blocked ? blockedFailureReason(edge.receipt) : undefined,
      settlementState,
      attestationState,
      settlementReceiptRefs,
      attestationRefs,
    };
  });

  const constraintViolations: SupervisorConstraintViolation[] = [];
  for (const child of childInvocations) {
    if (child.invocationState === "blocked") {
      if (child.settlementReceiptRefs.length > 0) {
        constraintViolations.push({
          code: "blocked_child_with_settlement",
          childProfileId: child.childProfileId,
          summary: `Blocked child ${child.childProfileId} carries settlement receipts; blocked invocations must never settle.`,
        });
      }
      if (report.reputationEvents.some((event) => event.profileId === child.childProfileId)) {
        constraintViolations.push({
          code: "blocked_child_with_reputation_event",
          childProfileId: child.childProfileId,
          summary: `Blocked child ${child.childProfileId} carries reputation events; blocked invocations must never mutate reputation.`,
        });
      }
      continue;
    }
    if (child.settlementReceiptRefs.length > 0 && child.attestationRefs.length === 0) {
      constraintViolations.push({
        code: "settled_child_without_attestation",
        childProfileId: child.childProfileId,
        summary: `Child ${child.childProfileId} has settlement receipts without attestation coverage; settlement must never silently bypass attestation.`,
      });
    }
  }

  return {
    schemaVersion: SUPERVISOR_RUN_DIAGNOSTICS_SCHEMA_VERSION,
    runLinkage: {
      runId: `fixture-run:${scenario.id}`,
      scenarioId: scenario.id,
      supervisorProfileId: scenario.orchestrator,
      mode: scenario.mode,
      evidenceKind: "fixture",
      receiptRefs: scenario.edges.map((edge) => edge.receipt),
    },
    childInvocations,
    failureReasons: childInvocations
      .filter((child) => child.failureReason !== undefined)
      .map((child) => ({ childProfileId: child.childProfileId, reason: child.failureReason! })),
    settlementAuditState: {
      paymentReceiptCount: report.paymentReceipts.length,
      paymentProofStatuses: Array.from(new Set(report.paymentReceipts.map((receipt) => receipt.proofStatus))),
      attestationCount: report.attestations.length,
      attestationResults: Array.from(new Set(report.attestations.map((attestation) => attestation.result))),
      reputationEventCount: report.reputationEvents.length,
      constraintViolations,
    },
    guardrails: GUARDRAILS,
  };
}

/**
 * Derive diagnostics for every economic-demo scenario fixture.
 */
export function deriveAllSupervisorRunDiagnostics(): SupervisorRunDiagnostics[] {
  return economicDemoScenarios.map((scenario) => deriveSupervisorRunDiagnostics(scenario));
}
