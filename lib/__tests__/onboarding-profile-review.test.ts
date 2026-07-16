/**
 * #385 — Generated RAP profile review editor adapter tests.
 *
 * The adapter must stay a thin surface over the #575 analyser handoff and the
 * #576 onboarding state machine: no new validation rules, no network, no
 * secret storage. These tests cover the fixture scenarios, the five-way
 * provenance projection, the discovered-vs-generated diff, operator edits
 * (valid, invalid, credential-shaped), required-field/inline-issue mapping,
 * the save/continue gate (resolved / deferred-with-reason / blocked), and the
 * no-live-path boundary.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  PROFILE_EDITABLE_FIELD_KEYS,
  PROFILE_REVIEW_SCENARIOS,
  PROFILE_UNAVAILABLE_SECTIONS,
  buildProfileDiff,
  buildProfileReviewDescriptorCandidate,
  buildProfileReviewViewModel,
  evaluateProfileGate,
  getProfileReviewScenario,
  listOverriddenKeys,
  recordProfileContinueDecision,
  runProfileReview,
} from "@/lib/onboarding/profile-review";
import { validateOnboardingIntakeDescriptor } from "@reddi/agent-protocol/onboarding-analyser-handoff";

function review(scenarioId: Parameters<typeof runProfileReview>[0], edits = {}) {
  const outcome = runProfileReview(scenarioId, edits);
  if (outcome.status !== "review") {
    throw new Error(`expected review outcome, got ${outcome.status}`);
  }
  return outcome;
}

const COMPLETE_PAYMENT_EDITS = {
  settlementAddress: "OperatorSettlementAddress111111111111111111",
  network: "solana-devnet",
  price: "3.00",
  currency: "AUDD",
};

describe("fixture scenarios (#385)", () => {
  it("exposes the three evidence scenarios and validates every descriptor via #575", () => {
    expect(PROFILE_REVIEW_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      "complete",
      "missing-required",
      "inferred-warnings",
    ]);
    for (const scenario of PROFILE_REVIEW_SCENARIOS) {
      const candidate = buildProfileReviewDescriptorCandidate(scenario.id);
      const result = validateOnboardingIntakeDescriptor(candidate);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.descriptor.ingestionMode).toBe("static-fixture");
        expect(result.descriptor.staticOnly).toBe(true);
        expect(result.descriptor.sourceKind).toBe(getProfileReviewScenario(scenario.id).sourceKind);
      }
    }
  });

  it("complete scenario: readiness needs operator review, nothing blocked, draft state machine open", () => {
    const outcome = review("complete");
    expect(outcome.handoff.readiness.overall).toBe("needs_operator_review");
    expect(outcome.handoff.readiness.lanes.some((lane) => lane.status === "blocked")).toBe(false);
    expect(outcome.readModel.state).toBe("draft");
    expect(outcome.readModel.blockingGates.some((gate) => gate.gate === "operator_approval")).toBe(true);
    expect(outcome.nextStates.length).toBeGreaterThan(0);
  });

  it("missing-required scenario: payment readiness fails closed with missing fields and blocked identity", () => {
    const outcome = review("missing-required");
    expect(outcome.handoff.readiness.overall).toBe("blocked");
    expect(outcome.handoff.readiness.failClosedReasons).toContain("missing_payment_metadata");
    expect(outcome.handoff.rapProfileDraft.payment.missingFields).toEqual([
      "settlementAddress",
      "network",
      "price",
      "currency",
    ]);
    expect(outcome.handoff.rapProfileDraft.identity.displayName.provenance).toBe("blocked");
    expect(outcome.handoff.rapProfileDraft.invocation.missingEndpoint).toBe(true);
  });

  it("inferred-warnings scenario: all capability risks are inferred, including an execute-class risk", () => {
    const outcome = review("inferred-warnings");
    const risks = outcome.handoff.capabilityInventory.entries.map((entry) => entry.sideEffectRisk);
    expect(risks.every((risk) => risk.provenance === "inferred")).toBe(true);
    expect(risks.map((risk) => risk.value)).toContain("execute");
    expect(outcome.handoff.readiness.overall).toBe("needs_operator_review");
  });

  it("is deterministic for the same input", () => {
    expect(runProfileReview("complete")).toEqual(runProfileReview("complete"));
  });
});

describe("provenance view model (five-way #575 partition)", () => {
  it("projects discovered / inferred / user_provided / blocked and honest verified=0", () => {
    const outcome = review("complete");
    const viewModel = buildProfileReviewViewModel(outcome.handoff, outcome.overriddenKeys);
    expect(viewModel.provenanceCounts.discovered).toBeGreaterThan(0);
    expect(viewModel.provenanceCounts.inferred).toBeGreaterThan(0); // draft-release-notes has no hint
    expect(viewModel.provenanceCounts.user_provided).toBeGreaterThan(0); // operator contactRef
    expect(viewModel.provenanceCounts.verified).toBe(0); // never verified at generation time
    expect(viewModel.capabilityTags.map((tag) => tag.tag)).toEqual([
      "summarize-document",
      "list-issues",
      "draft-release-notes",
    ]);
  });

  it("renders blocked fields honestly with reasons on the missing-required scenario", () => {
    const outcome = review("missing-required");
    const viewModel = buildProfileReviewViewModel(outcome.handoff, outcome.overriddenKeys);
    const displayName = viewModel.identity.find((row) => row.editable === "displayName");
    expect(displayName?.provenance).toBe("blocked");
    expect(displayName?.value).toBeNull();
    expect(viewModel.payment.rows.every((row) => row.provenance === "blocked")).toBe(true);
    expect(viewModel.payment.rows.every((row) => row.blockedReason === "missing_payment_metadata")).toBe(true);
    const endpoint = viewModel.invocation.find((row) => row.editable === "endpointUrl");
    expect(endpoint?.provenance).toBe("blocked");
  });

  it("flags inferred execute/write risks with warnings", () => {
    const outcome = review("inferred-warnings");
    const viewModel = buildProfileReviewViewModel(outcome.handoff, outcome.overriddenKeys);
    const executeCapability = viewModel.capabilities.find((capability) => capability.sideEffectRisk === "execute");
    expect(executeCapability?.riskProvenance).toBe("inferred");
    expect(executeCapability?.riskWarning).toMatch(/EXECUTE/);
    const writeCapability = viewModel.capabilities.find((capability) => capability.sideEffectRisk === "write");
    expect(writeCapability?.riskWarning).toMatch(/WRITE/);
  });

  it("marks operator-edited fields as user_provided in the view", () => {
    const edits = { displayName: "Renamed by operator", ...COMPLETE_PAYMENT_EDITS };
    const outcome = review("missing-required", edits);
    expect(outcome.overriddenKeys).toEqual(listOverriddenKeys(edits));
    const viewModel = buildProfileReviewViewModel(outcome.handoff, outcome.overriddenKeys);
    const displayName = viewModel.identity.find((row) => row.editable === "displayName");
    expect(displayName?.provenance).toBe("user_provided");
    expect(displayName?.value).toBe("Renamed by operator");
    expect(viewModel.payment.rows.every((row) => row.provenance === "user_provided")).toBe(true);
  });

  it("declares the sections the contract does not carry as unavailable", () => {
    expect(PROFILE_UNAVAILABLE_SECTIONS.map((section) => section.id)).toEqual([
      "tools",
      "skills",
      "downstream-calls",
      "context-requirements",
    ]);
    for (const section of PROFILE_UNAVAILABLE_SECTIONS) {
      expect(section.note.length).toBeGreaterThan(0);
    }
  });
});

describe("diff view (discovered metadata vs generated profile)", () => {
  it("marks generator-added fields, inferred fields, and blocked fields", () => {
    const outcome = review("complete");
    const rows = buildProfileDiff("complete", outcome.handoff, outcome.overriddenKeys);
    const byField = new Map(rows.map((row) => [row.field, row]));
    expect(byField.get("Display name")?.status).toBe("unchanged");
    expect(byField.get("Policy requirements")?.status).toBe("generated_added");
    expect(byField.get("Payment status")?.generated).toBe("declared_unverified");
    expect(byField.get('Capability "draft-release-notes" side-effect risk')?.status).toBe("inferred");
    expect(byField.get('Capability "summarize-document" side-effect risk')?.status).toBe("unchanged");
  });

  it("marks operator edits and missing fields", () => {
    const edits = { displayName: "Renamed by operator" };
    const outcome = review("missing-required", edits);
    const rows = buildProfileDiff("missing-required", outcome.handoff, outcome.overriddenKeys);
    const byField = new Map(rows.map((row) => [row.field, row]));
    expect(byField.get("Display name")?.status).toBe("operator_edited");
    expect(byField.get("Display name")?.generated).toBe("Renamed by operator");
    expect(byField.get("Settlement address")?.status).toBe("blocked");
    expect(byField.get("Settlement address")?.generated).toBeNull();
  });
});

describe("operator edits re-validated by #575 (no new rules)", () => {
  it("rejects a private endpoint URL with an inline issue mapped to the field", () => {
    const outcome = runProfileReview("complete", { endpointUrl: "https://localhost:8443/invoke" });
    expect(outcome.status).toBe("invalid_edits");
    if (outcome.status !== "invalid_edits") return;
    expect(outcome.issues.some((issue) => issue.field === "endpointUrl" && issue.code === "private_url_blocked")).toBe(true);
    expect(outcome.issues.every((issue) => issue.recovery.length > 0)).toBe(true);
  });

  it("rejects credential-shaped edits fail-closed and never echoes the secret", () => {
    const secret = "sk-editorleak1234567890";
    const outcome = runProfileReview("complete", {
      endpointUrl: `https://api.example.com/invoke?api_key=${secret}`,
    });
    expect(outcome.status).toBe("blocked_secret");
    if (outcome.status !== "blocked_secret") return;
    expect(JSON.stringify(outcome.issues)).not.toContain(secret);
    expect(outcome.issues.some((issue) => issue.code === "credential_leakage_rejected")).toBe(true);
  });

  it("supplying the missing payment fields resolves the blocked readiness", () => {
    const outcome = review("missing-required", COMPLETE_PAYMENT_EDITS);
    expect(outcome.handoff.readiness.overall).toBe("needs_operator_review");
    expect(outcome.handoff.rapProfileDraft.payment.status).toBe("declared_unverified");
    expect(outcome.handoff.rapProfileDraft.payment.missingFields).toEqual([]);
  });

  it("partial payment edits keep the remaining fields blocked", () => {
    const outcome = review("missing-required", { price: "1.00", currency: "AUDD" });
    expect(outcome.handoff.readiness.overall).toBe("blocked");
    expect(outcome.handoff.rapProfileDraft.payment.missingFields).toEqual(["settlementAddress", "network"]);
  });

  it("whitespace-only edits are ignored (keep as generated)", () => {
    expect(listOverriddenKeys({ displayName: "   ", price: "" })).toEqual([]);
  });
});

describe("save/continue gate (#576 blocking-gate semantics)", () => {
  it("enables continue without deferral when nothing is blocked", () => {
    const outcome = review("complete");
    const gate = evaluateProfileGate(outcome.handoff, "");
    expect(gate.blocked).toBe(false);
    expect(gate.canContinue).toBe(true);
    expect(gate.continueTarget).toBe("pending_operator_approval");
  });

  it("disables continue while blocked until a deferral reason is supplied", () => {
    const outcome = review("missing-required");
    const withoutReason = evaluateProfileGate(outcome.handoff, "   ");
    expect(withoutReason.blocked).toBe(true);
    expect(withoutReason.canContinue).toBe(false);
    const withReason = evaluateProfileGate(outcome.handoff, "Provider sends payment metadata next week.");
    expect(withReason.canContinue).toBe(true);
    expect(withReason.continueTarget).toBe("payment_setup_required");
  });

  it("records the resolved decision as draft -> pending_operator_approval (local read-model only)", () => {
    const outcome = review("complete");
    const decision = recordProfileContinueDecision(outcome.handoff, outcome.readModel, "");
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.deferred).toBe(false);
    expect(decision.record.from).toBe("draft");
    expect(decision.record.to).toBe("pending_operator_approval");
    expect(decision.record.scope).toBe("local_read_model_only");
    expect(decision.record.actorType).toBe("operator");
    // No publication side effects, ever.
    expect(Object.values(decision.readModel.publication).every((flag) => flag === false)).toBe(true);
    expect(decision.readModel.internalCandidateOnly).toBe(true);
  });

  it("records an explicit deferral with the reason verbatim in the audit record", () => {
    const reason = "Payment metadata arrives from the provider next week; deferring payment setup.";
    const outcome = review("missing-required");
    const decision = recordProfileContinueDecision(outcome.handoff, outcome.readModel, reason);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.deferred).toBe(true);
    expect(decision.record.to).toBe("payment_setup_required");
    expect(decision.record.reason).toContain(reason);
    const paymentGate = decision.record.blockingGates.find((gate) => gate.gate === "payment_setup");
    expect(paymentGate?.reasonCodes).toContain("missing_payment_metadata");
    expect(paymentGate?.note).toContain(reason);
    expect(decision.readModel.state).toBe("payment_setup_required");
    expect(Object.values(decision.readModel.publication).every((flag) => flag === false)).toBe(true);
  });

  it("fails closed when continuing while blocked without a deferral reason", () => {
    const outcome = review("missing-required");
    const decision = recordProfileContinueDecision(outcome.handoff, outcome.readModel, "");
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.errors[0]?.code).toBe("unresolved_blocking_gates");
  });
});

describe("no-live-path boundary", () => {
  it("keeps every guardrail false on review outcomes", () => {
    const outcome = review("complete");
    expect(Object.values(outcome.handoff.guardrails).every((flag) => flag === false)).toBe(true);
    expect(Object.values(outcome.readModel.guardrails).every((flag) => flag === false)).toBe(true);
    expect(outcome.handoff.listingExportDraft.publicationDisabled).toBe(true);
    expect(outcome.handoff.sellerWrapperDraft.paymentPlan.activation).toBe("disabled");
  });

  it("adapter source contains no network, wallet, or storage surface", () => {
    const source = readFileSync(join(process.cwd(), "lib/onboarding/profile-review.ts"), "utf8");
    for (const forbidden of [
      "fetch(",
      "XMLHttpRequest",
      "WebSocket",
      "axios",
      "node:http",
      "node:https",
      "node:net",
      "child_process",
      "node:fs",
      "localStorage",
      "sessionStorage",
      "@solana/web3.js",
      "wallet-adapter",
    ]) {
      expect(source.includes(forbidden)).toBe(false);
    }
    expect(source).not.toMatch(/\basync\b|\bawait\b/);
  });

  it("covers every editable field key with a label", () => {
    expect(PROFILE_EDITABLE_FIELD_KEYS).toEqual([
      "displayName",
      "contactRef",
      "endpointUrl",
      "settlementAddress",
      "network",
      "price",
      "currency",
    ]);
  });
});
