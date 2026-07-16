/**
 * #386 — AUDD/Solana payment and readiness gate view adapter.
 *
 * Every gate verdict must come verbatim from a shipped contract validator;
 * the adapter itself is pure, deterministic, JSON-serializable, fail-closed,
 * and copy-boundary clean (mirrors the #501 negated-copy discipline).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EXPECTED_HARD_BOUNDARY_FLAG_KEYS,
  FORBIDDEN_COPY_CLAIMS,
} from "@/lib/economic-demo/paid-workflow-copy-boundary-terms";
import {
  READINESS_GATE_EVALUATED_AT,
  READINESS_GATE_ISSUE,
  READINESS_GATE_SCENARIOS,
  READINESS_GATE_VIEW_SCHEMA_VERSION,
  deriveAllReadinessGateViews,
  deriveReadinessGateView,
  isReadinessGateScenarioId,
  type ReadinessGateViewModel,
} from "@/lib/onboarding/readiness-gate";

function gateById(view: ReadinessGateViewModel, id: string) {
  const row = view.gates.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`gate not found: ${id}`);
  return row;
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectStrings(item, out);
  return out;
}

describe("readiness gate scenarios (#386)", () => {
  it("registers exactly the five evidence scenarios", () => {
    expect(READINESS_GATE_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      "ready",
      "blocked-payment",
      "blocked-evidence",
      "blocked-trust",
      "dry-run-receipt",
    ]);
    expect(isReadinessGateScenarioId("ready")).toBe(true);
    expect(isReadinessGateScenarioId("live")).toBe(false);
  });

  it("derives all five scenario views with the versioned schema", () => {
    const views = deriveAllReadinessGateViews();
    for (const scenario of READINESS_GATE_SCENARIOS) {
      const view = views[scenario.id];
      expect(view.schemaVersion).toBe(READINESS_GATE_VIEW_SCHEMA_VERSION);
      expect(view.issue).toBe(READINESS_GATE_ISSUE);
      expect(view.evaluatedAt).toBe(READINESS_GATE_EVALUATED_AT);
      expect(view.scenario.id).toBe(scenario.id);
    }
  });
});

describe("ready scenario", () => {
  const view = deriveReadinessGateView("ready");

  it("passes every gate and stays gated behind operator review", () => {
    expect(view.overall.status).toBe("ready_for_operator_review");
    expect(view.overall.blockedCount).toBe(0);
    expect(view.overall.blockedGateIds).toEqual([]);
    expect(view.overall.headline).toMatch(/operator review is still required/i);
  });

  it("shows AC1 payment readbacks from the committed fixtures", () => {
    expect(gateById(view, "payment_rail").status).toBe("ready");
    expect(gateById(view, "payment_rail").readback).toContainEqual({
      label: "Rail state",
      value: "proof-metadata-only",
    });
    const audd = gateById(view, "audd_asset_network");
    expect(audd.status).toBe("ready");
    expect(audd.readback).toContainEqual({ label: "Asset", value: "AUDD" });
    expect(gateById(view, "quote").readback).toContainEqual({ label: "Payment mode", value: "dry-run" });
    expect(gateById(view, "quote").readback).toContainEqual({
      label: "Quote expires",
      value: "2026-07-01T00:00:00.000Z",
    });
    const refund = gateById(view, "refund_failure_policy");
    expect(refund.status).toBe("ready");
    expect(refund.readback).toContainEqual({ label: "Failure policy", value: "no_charge_on_failure" });
  });

  it("reports buyer budget-policy compatibility verbatim from the contract", () => {
    const buyer = gateById(view, "buyer_budget_policy");
    expect(buyer.status).toBe("ready");
    expect(buyer.reasonCodes).toEqual(["buyer_authority_policy_valid"]);
  });

  it("binds the dry-run receipt chain end to end", () => {
    expect(view.dryRunReceipt.status).toBe("bound");
    expect(view.dryRunReceipt.receiptId).toBe("job:audd-readiness-gate-386-ready");
    expect(view.dryRunReceipt.bindingId).toBe("binding:audd-readiness-gate-386-ready");
    expect(view.dryRunReceipt.evidenceId).toBe("evidence:audd-readiness-gate-386-ready");
    expect(view.dryRunReceipt.attestationId).toBe("attestation:audd-readiness-gate-386-ready");
    expect(view.dryRunReceipt.requestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(view.dryRunReceipt.responseHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(view.dryRunReceipt.reputationDraft).not.toBeNull();
    expect(gateById(view, "receipt_evidence_binding").status).toBe("ready");
    expect(gateById(view, "attestation_state").status).toBe("ready");
    expect(gateById(view, "reputation_state").status).toBe("ready");
  });

  it("keeps the trust posture with the operator, never auto-trusted", () => {
    const trust = gateById(view, "trust_posture");
    expect(trust.status).toBe("needs_operator_review");
    expect(trust.readback).toContainEqual({ label: "Imported content trust", value: "untrusted" });
    expect(trust.readback).toContainEqual({ label: "Verified provider trust", value: "false" });
  });
});

describe("blocked-payment scenario", () => {
  const view = deriveReadinessGateView("blocked-payment");

  it("fails closed overall", () => {
    expect(view.overall.status).toBe("blocked");
    expect(view.overall.blockedCount).toBeGreaterThanOrEqual(6);
  });

  it("names the exact missing x402 payment field", () => {
    const gate = gateById(view, "x402_payment_config");
    expect(gate.status).toBe("blocked");
    expect(gate.reasonCodes).toEqual(["missing_payment_metadata"]);
    expect(gate.summary).toContain("network");
    expect(gate.nextAction).toContain("network");
  });

  it("fails closed on the unsupported currency via the buyer policy contract", () => {
    const buyer = gateById(view, "buyer_budget_policy");
    expect(buyer.status).toBe("blocked");
    expect(buyer.reasonCodes).toContain("unsupported_rail_currency");
    expect(gateById(view, "payment_rail").status).toBe("blocked");
    expect(gateById(view, "payment_rail").readback).toContainEqual({
      label: "Declared currency",
      value: "AUD",
    });
  });

  it("fails closed on the unavailable endpoint and unsafe auth", () => {
    expect(gateById(view, "endpoint_availability").status).toBe("blocked");
    expect(gateById(view, "endpoint_availability").nextAction).toMatch(/public HTTPS/i);
    expect(gateById(view, "auth_safety").status).toBe("blocked");
    expect(gateById(view, "auth_safety").summary).toMatch(/no auth scheme/i);
  });

  it("has no dry-run receipt and no #393 binding — both fail closed", () => {
    expect(view.dryRunReceipt.status).toBe("not_run");
    expect(gateById(view, "dry_run_receipt").status).toBe("blocked");
    expect(gateById(view, "dry_run_receipt").reasonCodes).toContain("challenge_malformed");
    expect(gateById(view, "receipt_evidence_binding").status).toBe("blocked");
  });
});

describe("blocked-evidence scenario", () => {
  const view = deriveReadinessGateView("blocked-evidence");

  it("fails closed on missing evidence settings from the preflight contract", () => {
    expect(view.overall.status).toBe("blocked");
    const evidence = gateById(view, "evidence_requirement");
    expect(evidence.status).toBe("blocked");
    expect(evidence.reasonCodes).toContain("evidence_required");
    expect(evidence.reasonCodes).toContain("evidence_requirement_missing");
    const receipt = gateById(view, "receipt_requirement");
    expect(receipt.status).toBe("blocked");
    expect(receipt.reasonCodes).toEqual(["receipt_requirement_missing"]);
  });

  it("marks the dry-run receipt as denied, not fabricated", () => {
    expect(view.dryRunReceipt.status).toBe("denied");
    expect(view.dryRunReceipt.receiptId).toBeNull();
    expect(view.dryRunReceipt.bindingId).toBeNull();
    expect(gateById(view, "dry_run_receipt").status).toBe("blocked");
    expect(gateById(view, "dry_run_receipt").reasonCodes).toEqual(["evidence_required"]);
    expect(gateById(view, "receipt_evidence_binding").status).toBe("blocked");
  });

  it("keeps the payment rail gates green — the failure is evidence-shaped", () => {
    expect(gateById(view, "payment_rail").status).toBe("ready");
    expect(gateById(view, "audd_asset_network").status).toBe("ready");
    expect(gateById(view, "quote").status).toBe("ready");
  });
});

describe("blocked-trust scenario", () => {
  const view = deriveReadinessGateView("blocked-trust");

  it("passes payment gates but withholds attestation/reputation backing", () => {
    expect(view.overall.status).toBe("blocked");
    expect(gateById(view, "payment_rail").status).toBe("ready");
    expect(gateById(view, "buyer_budget_policy").status).toBe("ready");
    expect(gateById(view, "dry_run_receipt").status).toBe("ready");
    expect(gateById(view, "receipt_evidence_binding").status).toBe("ready");
    expect(gateById(view, "attestation_state").status).toBe("blocked");
    expect(gateById(view, "reputation_state").status).toBe("blocked");
  });

  it("carries the #606 bridge projection verbatim", () => {
    const reputation = gateById(view, "reputation_state");
    expect(reputation.readback).toContainEqual({
      label: "listingProjection.offchainPreview",
      value: "pending",
    });
    expect(reputation.readback).toContainEqual({
      label: "Buyer-facing claims allowed",
      value: "false",
    });
  });

  it("flags inferred execute-risk auth for operator review", () => {
    expect(gateById(view, "auth_safety").status).toBe("needs_operator_review");
  });
});

describe("cross-scenario invariants", () => {
  const views = deriveAllReadinessGateViews();
  const allViews = Object.values(views);

  it("every non-ready gate carries a concrete next action", () => {
    for (const view of allViews) {
      for (const row of view.gates) {
        if (row.status !== "ready") {
          expect(typeof row.nextAction).toBe("string");
          expect((row.nextAction ?? "").length).toBeGreaterThan(20);
        } else {
          expect(row.nextAction).toBeNull();
        }
      }
    }
  });

  it("live payment controls are disabled everywhere with absent requirements", () => {
    for (const view of allViews) {
      expect(view.liveControls.enabled).toBe(false);
      const states = view.liveControls.requirements.map((requirement) => requirement.state);
      expect(states).toEqual(["absent", "absent", "out_of_scope"]);
    }
  });

  it("renders the full #497 boundary-flag grid hard-false", () => {
    for (const view of allViews) {
      expect(Object.keys(view.boundaries.flags).sort()).toEqual([...EXPECTED_HARD_BOUNDARY_FLAG_KEYS].sort());
      expect(Object.values(view.boundaries.flags).every((flag) => flag === false)).toBe(true);
    }
  });

  it("validates the seller-wrapper config through the #535 validator", () => {
    for (const view of allViews) {
      expect(view.sellerWrapperValidation.valid).toBe(true);
      expect(view.sellerWrapperValidation.reasonCodes).toEqual(["seller_wrapper_config_valid"]);
    }
  });

  it("is deterministic and JSON-serializable", () => {
    const again = deriveAllReadinessGateViews();
    expect(again).toEqual(views);
    for (const view of allViews) {
      expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    }
  });

  it("mirrors the #501 negated-copy discipline: no forbidden live-claim upgrade in any string", () => {
    const strings = allViews.flatMap((view) => collectStrings(view));
    expect(strings.length).toBeGreaterThan(100);
    for (const claim of FORBIDDEN_COPY_CLAIMS) {
      // Self-test parity with the static gate: the patterns must still catch
      // their own injection example, otherwise this scan proves nothing.
      expect(claim.patterns.some((pattern) => pattern.test(claim.injectionExample))).toBe(true);
      for (const text of strings) {
        for (const pattern of claim.patterns) {
          if (pattern.test(text)) {
            throw new Error(`forbidden copy claim "${claim.id}" matched: ${text}`);
          }
        }
      }
    }
  });

  it("keeps the #392 AUDD boundary copy on every scenario", () => {
    for (const view of allViews) {
      expect(view.auddBoundary.decisionIssue).toBe(392);
      expect(view.auddBoundary.copy).toMatch(/proof-metadata \/ payment-plan readiness/);
      expect(view.auddBoundary.copy).toMatch(/not Quasar AUDD custody/);
      expect(view.auddBoundary.copy).toMatch(/no settled AUDD escrow/);
    }
  });

  it("never leaks credential-shaped material into the view", () => {
    const strings = allViews.flatMap((view) => collectStrings(view));
    for (const text of strings) {
      expect(text).not.toMatch(/(?:api[_-]?key|private[_-]?key|password|bearer|secret)\s*[:=]\s*\S/i);
      expect(text).not.toMatch(/\bsk-[A-Za-z0-9]{8,}/);
    }
  });
});

describe("adapter source guard", () => {
  const source = readFileSync(join(process.cwd(), "lib/onboarding/readiness-gate.ts"), "utf8");

  it("has no live-call, storage, wallet, or nondeterministic surface", () => {
    for (const forbidden of [
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "@solana/web3.js",
      "Keypair",
      "sendTransaction",
      "Math.random",
      "Date.now",
      "new Date()",
    ]) {
      expect(source.includes(forbidden)).toBe(false);
    }
  });

  it("stays server-only and consumes the shipped contract validators", () => {
    expect(source).toContain('import "server-only";');
    for (const contract of [
      "evaluateAuddPaymentPlanPreflight",
      "evaluateBuyerAuthorityPolicy",
      "deriveReceiptEvidenceBinding",
      "deriveAttestationReputationBridge",
      "runProfileReview",
      "generateSellerWrapperConfigExamples",
      "validateSellerWrapperConfigExamples",
    ]) {
      expect(source).toContain(contract);
    }
  });
});
