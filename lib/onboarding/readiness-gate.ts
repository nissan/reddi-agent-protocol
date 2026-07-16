/**
 * #386 — AUDD/Solana payment and readiness gate UI (view adapter).
 *
 * Thin, deterministic adapter between the readiness-gate surface
 * (`/onboarding/readiness-gate`) and the merged #375-lane contracts. It adds
 * NO validation rules of its own — every gate verdict below is produced by a
 * shipped contract validator and surfaced verbatim:
 *
 * - profile draft + readiness lanes: `runProfileReview` (#385 adapter over the
 *   #575 `reddi.onboarding-*.v1` analyser handoff),
 * - seller-wrapper rails + AUDD payment plan: `reddi.seller-wrapper-rail-fixture.v1`
 *   (#529) and `reddi.seller-wrapper-config.v1` (#535),
 * - AUDD dry-run preflight: `evaluateAuddPaymentPlanPreflight`
 *   (`reddi.audd-payment-plan.v1`, #391),
 * - buyer budget-policy compatibility: `evaluateBuyerAuthorityPolicy`
 *   (`reddi.buyer-authority-policy.v1`, #549),
 * - receipt/evidence binding: `deriveReceiptEvidenceBinding`
 *   (`reddi.receipt-evidence-binding.v1`, #393),
 * - attestation/reputation backing: `deriveAttestationReputationBridge`
 *   (`reddi.attestation-reputation-bridge.v1`, #394/#606 `listingProjection`).
 *
 * Boundary (per docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md and the #392
 * decision): everything here is static fixture composition. Nothing fetches,
 * probes, invokes, publishes, pays, signs, or mutates trust/reputation. AUDD
 * is proof-metadata / payment-plan readiness for v0.1 — no Quasar AUDD
 * custody and no settled AUDD escrow exists anywhere behind this view. Live
 * payment controls stay disabled: these fixtures never carry backend
 * readiness or operator live-payment approval.
 */

import "server-only";

import { createHash } from "node:crypto";

import {
  applyAttestationToReputation,
  createAttestationRecord,
  type AttestationRecord,
} from "../../packages/agent-protocol/dist/attestation-reputation.js";
import {
  deriveAttestationReputationBridge,
  type AttestationReputationBridge,
} from "../../packages/agent-protocol/dist/attestation-reputation-bridge.js";
import {
  createAuddPaymentChallenge,
  createAuddSolanaPaymentPlan,
  evaluateAuddPaymentPlanPreflight,
  type AuddPaymentPlanPreflightDecision,
  type AuddSolanaPaymentPlan,
} from "../../packages/agent-protocol/dist/audd-payment-plan.js";
import {
  buyerAuthorityPolicyExamples,
  evaluateBuyerAuthorityPolicy,
  type BuyerAuthorityPolicy,
  type BuyerAuthorityPolicyEvaluation,
} from "../../packages/agent-protocol/dist/buyer-authority-policy.js";
import {
  createEvidenceArchiveRecord,
  type EvidenceArchiveRecord,
} from "../../packages/agent-protocol/dist/evidence-archive.js";
import {
  deriveReceiptEvidenceBinding,
  type ReceiptEvidenceBinding,
} from "../../packages/agent-protocol/dist/receipt-evidence-binding.js";
import {
  createReddiReceipt,
  type ReddiReceipt,
} from "../../packages/agent-protocol/dist/receipts.js";
import {
  generateSellerWrapperConfigExamples,
  validateSellerWrapperConfigExamples,
} from "../../packages/agent-protocol/dist/seller-wrapper-config.js";
import {
  getSellerWrapperRail,
  sellerWrapperRailFixture,
  type SellerWrapperRailConfig,
} from "../../packages/agent-protocol/dist/seller-wrapper-rail-fixtures.js";
import { EXPECTED_HARD_BOUNDARY_FLAG_KEYS } from "../economic-demo/paid-workflow-copy-boundary-terms";
import { getEconomicDemoPaymentReadiness } from "../economic-demo/payment-readiness";
import {
  runProfileReview,
  type ProfileReviewEdits,
  type ProfileReviewScenarioId,
} from "./profile-review";

export const READINESS_GATE_VIEW_SCHEMA_VERSION = "reddi.onboarding-readiness-gate-view.v1" as const;
export const READINESS_GATE_ISSUE = 386 as const;

/**
 * Deterministic evaluation timestamp. Chosen to sit inside both the committed
 * seller-wrapper AUDD quote window and the buyer-authority policy expiry
 * (both end 2026-07-01T00:00:00Z), so the fixtures prove an unexpired path.
 */
export const READINESS_GATE_EVALUATED_AT = "2026-06-30T00:00:00.000Z" as const;

/** AUDD mint uses 6 decimal places in the committed fixtures. */
const AUDD_DECIMALS = 6;

const SELLER_ID = "seller:listing-writer";
const SPECIALIST_ID = "specialist:listing-writer";

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export type ReadinessGateScenarioId =
  | "ready"
  | "blocked-payment"
  | "blocked-evidence"
  | "blocked-trust"
  | "dry-run-receipt";

export type ReadinessGateScenario = {
  id: ReadinessGateScenarioId;
  label: string;
  description: string;
  profileScenario: ProfileReviewScenarioId;
};

export const READINESS_GATE_SCENARIOS: readonly ReadinessGateScenario[] = Object.freeze([
  {
    id: "ready",
    label: "Ready for operator review",
    description:
      "Complete AUDD profile, seller-wrapper rail resolved, unexpired dry-run quote, buyer policy compatible, dry-run receipt bound to evidence, attestation attested. Nothing is live; operator review is still required.",
    profileScenario: "complete",
  },
  {
    id: "blocked-payment",
    label: "Blocked: payment configuration",
    description:
      "Payment network missing from the generated profile, currency outside the supported rail set, no invocation endpoint, and no declared auth scheme. Every payment gate fails closed with the exact missing field.",
    profileScenario: "missing-required",
  },
  {
    id: "blocked-evidence",
    label: "Blocked: evidence settings",
    description:
      "Seller payment plan omits the evidence requirement, so the dry-run preflight fails closed, no receipt/evidence binding exists, and the buyer policy reports missing receipt and evidence requirements.",
    profileScenario: "complete",
  },
  {
    id: "blocked-trust",
    label: "Blocked: trust and attestation",
    description:
      "Payment gates pass, but the dry-run receipt carries no attestation, so the attestation/reputation bridge withholds any reputation backing (insufficient evidence) and inferred execute-risk capabilities need operator review.",
    profileScenario: "inferred-warnings",
  },
  {
    id: "dry-run-receipt",
    label: "Dry-run receipt readback",
    description:
      "Same inputs as the ready state, focused on the SATP-style readback: quote, payment plan, preflight decision, mocked-invocation receipt, evidence archive record, and the #393 binding that ties them together.",
    profileScenario: "complete",
  },
] as const);

export function getReadinessGateScenario(id: ReadinessGateScenarioId): ReadinessGateScenario {
  const scenario = READINESS_GATE_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`unknown readiness gate scenario: ${id}`);
  return scenario;
}

export function isReadinessGateScenarioId(value: unknown): value is ReadinessGateScenarioId {
  return READINESS_GATE_SCENARIOS.some((scenario) => scenario.id === value);
}

// ---------------------------------------------------------------------------
// View model types (JSON-serializable — the page passes these to the client)
// ---------------------------------------------------------------------------

export type ReadinessGateStatus = "ready" | "needs_operator_review" | "blocked";

export type ReadinessGateSection = "payment" | "trust";

export type ReadinessGateReadback = { label: string; value: string };

export type ReadinessGateRow = {
  id: string;
  section: ReadinessGateSection;
  label: string;
  status: ReadinessGateStatus;
  /** One-line honest statement of the gate state. */
  summary: string;
  /** Verbatim reason codes from the contract that decided this gate. */
  reasonCodes: string[];
  /** Durable readback fields (refs, ids, bindings) behind the verdict. */
  readback: ReadinessGateReadback[];
  /** Concrete next action. Always present when the gate is not ready. */
  nextAction: string | null;
  /** Schema version(s) of the contract(s) consulted. */
  contractRefs: string[];
};

export type ReadinessGateDryRunReceipt = {
  status: "bound" | "denied" | "not_run";
  reasonCodes: string[];
  quote: {
    source: string;
    specialist: string;
    amountUnits: string;
    amountDisplay: string;
    asset: string;
    network: string;
    mint: string | null;
    paymentMode: string;
    quoteExpiresAt: string | null;
  } | null;
  payTo: string | null;
  settlementAccount: string | null;
  policyApproval: string | null;
  paymentProofRef: string | null;
  receiptId: string | null;
  requestHash: string | null;
  responseHash: string | null;
  evidenceId: string | null;
  evidenceRef: string | null;
  evidenceHash: string | null;
  bindingId: string | null;
  attestationId: string | null;
  reputationDraft: {
    previousScore: number;
    nextScore: number;
    routingImpact: string;
  } | null;
};

export type ReadinessGateLiveControlRequirement = {
  id: "backend_readiness" | "operator_live_approval" | "audd_custody_boundary";
  label: string;
  state: "absent" | "out_of_scope";
  detail: string;
};

export type ReadinessGateViewModel = {
  schemaVersion: typeof READINESS_GATE_VIEW_SCHEMA_VERSION;
  issue: typeof READINESS_GATE_ISSUE;
  scenario: ReadinessGateScenario;
  evaluatedAt: string;
  source: {
    listingRef: string;
    sourceKind: string;
    snapshotRef: string;
    displayName: string | null;
    endpointUrl: string | null;
  };
  profileReadiness: {
    overall: string;
    failClosedReasons: string[];
    lanes: { lane: string; status: string; reasonCodes: string[] }[];
  };
  overall: {
    status: "ready_for_operator_review" | "blocked";
    headline: string;
    blockedGateIds: string[];
    readyCount: number;
    reviewCount: number;
    blockedCount: number;
  };
  gates: ReadinessGateRow[];
  dryRunReceipt: ReadinessGateDryRunReceipt;
  liveControls: {
    enabled: false;
    requirements: ReadinessGateLiveControlRequirement[];
    copy: string;
  };
  boundaries: {
    flags: Record<string, false>;
    note: string;
  };
  auddBoundary: {
    copy: string;
    decisionIssue: 392;
    authorityDoc: string;
  };
  sellerWrapperValidation: {
    valid: boolean;
    reasonCodes: string[];
  };
};

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

function hashJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

/** Convert a decimal price string to AUDD base units (6dp). Fixture-only math. */
function toAuddBaseUnits(price: string): string | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(price.trim());
  if (!match) return null;
  const whole = match[1];
  const fraction = (match[2] ?? "").slice(0, AUDD_DECIMALS).padEnd(AUDD_DECIMALS, "0");
  const units = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
  return /^\d+$/.test(units) ? units : null;
}

function formatAuddAmount(units: string): string {
  const padded = units.padStart(AUDD_DECIMALS + 1, "0");
  const whole = padded.slice(0, -AUDD_DECIMALS);
  const fraction = padded.slice(-AUDD_DECIMALS).replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction} AUDD` : `${whole} AUDD`;
}

// ---------------------------------------------------------------------------
// Scenario input composition (all inputs are committed fixtures)
// ---------------------------------------------------------------------------

type ProfileReviewHandoff = Extract<ReturnType<typeof runProfileReview>, { status: "review" }>["handoff"];

type ScenarioInputs = {
  scenario: ReadinessGateScenario;
  nonce: string;
  profileEdits: ProfileReviewEdits;
  handoff: ProfileReviewHandoff;
  listingRef: string;
  sourceId: string;
  endpointUrl: string;
  /** null = the profile carries no usable AUDD plan (blocked-payment). */
  plan: AuddSolanaPaymentPlan | null;
  rail: SellerWrapperRailConfig | null;
  preflight: AuddPaymentPlanPreflightDecision;
  buyerPolicy: BuyerAuthorityPolicy;
  buyerRequestSummary: {
    asset: string;
    network: string;
    amountUnits: string;
    supportState: string;
    receiptPresented: boolean;
    evidencePresented: boolean;
  };
  buyerEvaluation: BuyerAuthorityPolicyEvaluation;
  receipt: ReddiReceipt | null;
  evidence: EvidenceArchiveRecord | null;
  attestation: AttestationRecord | null;
  reputationDraft: ReturnType<typeof applyAttestationToReputation> | null;
  binding: ReceiptEvidenceBinding | null;
  bindingErrors: string[];
  bridge: AttestationReputationBridge;
};

function buildDryRunChain(input: {
  nonce: string;
  plan: AuddSolanaPaymentPlan;
  endpointUrl: string;
  sourceId: string;
  listingRef: string;
  withAttestation: boolean;
}): {
  preflight: AuddPaymentPlanPreflightDecision;
  receipt: ReddiReceipt | null;
  evidence: EvidenceArchiveRecord | null;
  attestation: AttestationRecord | null;
  reputationDraft: ReturnType<typeof applyAttestationToReputation> | null;
  binding: ReceiptEvidenceBinding | null;
  bindingErrors: string[];
} {
  const { nonce, plan, endpointUrl, sourceId, listingRef, withAttestation } = input;
  const auddSpendCap = buyerAuthorityPolicyExamples.allow.policy.spendCaps.find(
    (cap) => cap.asset === "AUDD" && cap.network === plan.network,
  );

  const challenge = createAuddPaymentChallenge({
    mode: plan.paymentMode,
    paymentPlan: plan,
    quote: { source: sourceId, specialist: SPECIALIST_ID },
    nonce,
    endpoint: endpointUrl,
  });
  const preflight = evaluateAuddPaymentPlanPreflight(challenge, {
    allowedNetworks: [plan.network],
    allowedMints: [plan.mint],
    allowedPayees: [plan.payee],
    allowedSettlementAccounts: [plan.settlementAccount],
    maxAmount: auddSpendCap?.maxAmountUnits ?? plan.amount,
    requireEvidence: true,
    approvalState: "approved",
    paymentProofRef: `dry-run:${nonce}`,
    now: READINESS_GATE_EVALUATED_AT,
  });

  if (!preflight.allowed || !preflight.paymentProofRef || !preflight.policyDecision) {
    return {
      preflight,
      receipt: null,
      evidence: null,
      attestation: null,
      reputationDraft: null,
      binding: null,
      bindingErrors: [],
    };
  }

  // Mocked invocation payloads (mirrors runAuddSellerWrapperNoSpendFlow — the
  // specialist is a local mock; no endpoint is contacted).
  const requestBody = { task: "draft-listing", rail: "AUDD" };
  const resultBody = { ok: true, body: requestBody, mode: "mocked-invocation" };
  const requestHash = hashJson(requestBody);
  const responseHash = hashJson(resultBody);
  const evidencePayload = { requestHash, responseHash, resultSummary: resultBody };

  const evidence = createEvidenceArchiveRecord({
    id: `evidence:${nonce}`,
    receiptId: `job:${nonce}`,
    sourceId,
    requestHash,
    responseHash,
    evidenceRef: `file://fixtures/evidence/${nonce}.json`,
    createdAt: READINESS_GATE_EVALUATED_AT,
    evidencePayload,
  });

  const receipt = createReddiReceipt({
    schemaVersion: "reddi.receipt.v1",
    job: { id: `job:${nonce}`, type: "specialist-call" },
    source: { id: sourceId, type: "seller-middleware", uri: endpointUrl },
    payer: { id: "buyer:local-dry-run" },
    specialist: { id: SPECIALIST_ID, endpoint: endpointUrl },
    protocol: { name: "Reddi Agent Protocol", version: "0.1.0" },
    payment: {
      network: plan.network,
      asset: plan.asset,
      amount: plan.amount,
      paymentProofRef: preflight.paymentProofRef,
    },
    requestHash,
    responseHash,
    evidenceRef: evidence.evidenceRef,
    policyDecision: preflight.policyDecision,
    attestationStatus: withAttestation ? "attested" : "not_requested",
    createdAt: READINESS_GATE_EVALUATED_AT,
  });

  let attestation: AttestationRecord | null = null;
  let reputationDraft: ReturnType<typeof applyAttestationToReputation> | null = null;
  if (withAttestation) {
    attestation = createAttestationRecord({
      schemaVersion: "reddi.attestation.v1",
      id: `attestation:${nonce}`,
      receiptId: receipt.job.id,
      evidenceId: evidence.id,
      evidenceRef: evidence.evidenceRef,
      evidenceHash: evidence.evidenceHash,
      attestor: { id: "attestor:local-fixture", type: "local-fixture" },
      trustBoundary: "reddi_attested",
      verdict: "passed",
      workStatus: "completed",
      confidence: 92,
      rubric: {
        dimensions: [
          {
            id: "evidence_integrity",
            score: 95,
            weight: 2,
            summary: "Request/response hashes recomputed and matched the archived evidence.",
            reasonCodes: ["evidence_attached"],
          },
          {
            id: "policy_compliance",
            score: 92,
            weight: 2,
            summary: "Preflight and buyer budget-policy decisions were recorded before invocation.",
            reasonCodes: ["attestation_passed"],
          },
          {
            id: "delivery_quality",
            score: 90,
            weight: 1,
            summary: "The mocked invocation returned the requested draft output.",
            reasonCodes: ["attestation_passed"],
          },
        ],
      },
      createdAt: READINESS_GATE_EVALUATED_AT,
    });
    reputationDraft = applyAttestationToReputation(attestation, undefined, {
      subject: { id: listingRef, type: "listing" },
      now: READINESS_GATE_EVALUATED_AT,
    });
  }

  const bindingResult = deriveReceiptEvidenceBinding({
    id: `binding:${nonce}`,
    source: {
      kind: "static-fixture",
      sourceId,
      fixtureRef: `fixtures/onboarding/readiness-gate/${nonce}.json`,
      listingId: listingRef,
    },
    receipt,
    evidence,
    evidencePayload,
    paymentPreflight: preflight,
    ...(attestation ? { attestation } : {}),
    ...(reputationDraft?.ok ? { reputationEventDraft: reputationDraft.event } : {}),
    createdAt: READINESS_GATE_EVALUATED_AT,
  });

  return {
    preflight,
    receipt,
    evidence,
    attestation,
    reputationDraft,
    binding: bindingResult.ok ? bindingResult.binding : null,
    bindingErrors: bindingResult.ok
      ? []
      : bindingResult.errors.map((error) => `${error.code}:${error.path}`),
  };
}

function buildScenarioInputs(scenarioId: ReadinessGateScenarioId): ScenarioInputs {
  const scenario = getReadinessGateScenario(scenarioId);
  const nonce = `audd-readiness-gate-386-${scenarioId}`;
  const endpointFixture = sellerWrapperRailFixture.endpoints[0];
  const buyerPolicy = buyerAuthorityPolicyExamples.allow.policy;
  const fixtureRail = getSellerWrapperRail(sellerWrapperRailFixture, "AUDD", "solana-devnet") ?? null;
  const fixturePlan = fixtureRail?.auddPaymentPlan ?? null;

  const profileEdits: ProfileReviewEdits =
    scenarioId === "blocked-payment"
      ? {
          // Operator supplied everything except the network, and picked a
          // fiat currency code outside the supported SOL/USDC/AUDD rail set —
          // exercising both "missing config" and "unsupported asset" honestly.
          settlementAddress: "FixtureSettlementAddress1111111111111111111",
          price: "2.50",
          currency: "AUD",
        }
      : {};

  const review = runProfileReview(scenario.profileScenario, profileEdits);
  if (review.status !== "review") {
    throw new Error(`readiness_gate_fixture_profile_invalid:${scenarioId}`);
  }
  const handoff = review.handoff;
  const paymentMetadata = handoff.rapProfileDraft.payment.metadata;
  const listingRef = `listing:${handoff.intake.intakeId}`;
  const sourceId = `source:${handoff.intake.intakeId}`;

  // Resolve the seller-wrapper rail for the profile's declared currency/network.
  const declaredCurrency = paymentMetadata?.currency ?? null;
  const declaredNetwork = paymentMetadata?.network ?? null;
  const rail =
    declaredCurrency && declaredNetwork && (declaredCurrency === "SOL" || declaredCurrency === "USDC" || declaredCurrency === "AUDD")
      ? getSellerWrapperRail(sellerWrapperRailFixture, declaredCurrency, declaredNetwork) ?? null
      : null;

  // Scenario-specific AUDD payment plan.
  let plan: AuddSolanaPaymentPlan | null = null;
  if (scenarioId === "blocked-payment") {
    plan = null; // No usable payment configuration exists.
  } else if (!fixturePlan) {
    plan = null;
  } else if (scenarioId === "blocked-evidence") {
    plan = createAuddSolanaPaymentPlan({ ...fixturePlan, evidenceRequired: false });
  } else if (scenarioId === "blocked-trust") {
    const declaredUnits = paymentMetadata?.price ? toAuddBaseUnits(paymentMetadata.price) : null;
    plan = createAuddSolanaPaymentPlan({ ...fixturePlan, amount: declaredUnits ?? fixturePlan.amount });
  } else {
    plan = fixturePlan;
  }

  // Dry-run chain (quote -> preflight -> mocked invocation -> receipt/evidence -> #393 binding).
  const chain = plan
    ? buildDryRunChain({
        nonce,
        plan,
        endpointUrl: endpointFixture.transport.url,
        sourceId,
        listingRef,
        withAttestation: scenarioId === "ready" || scenarioId === "dry-run-receipt",
      })
    : {
        // No plan can be constructed: run the preflight validator on an empty
        // challenge so the fail-closed verdict still comes from the contract.
        preflight: evaluateAuddPaymentPlanPreflight({}, {}),
        receipt: null,
        evidence: null,
        attestation: null,
        reputationDraft: null,
        binding: null,
        bindingErrors: [],
      };

  // Buyer budget-policy compatibility (evaluated against the declared listing terms).
  const declaredUnits = paymentMetadata?.price ? toAuddBaseUnits(paymentMetadata.price) : null;
  const receiptPresented = scenarioId !== "blocked-evidence";
  const evidencePresented = scenarioId !== "blocked-evidence";
  const buyerRequestSummary = {
    asset: declaredCurrency ?? "(not declared)",
    network: declaredNetwork ?? "(not declared)",
    amountUnits: plan?.amount ?? declaredUnits ?? "0",
    supportState: rail?.state ?? "proof-metadata-only",
    receiptPresented,
    evidencePresented,
  };
  const buyerEvaluation = evaluateBuyerAuthorityPolicy(buyerPolicy, {
    sellerId: SELLER_ID,
    endpointId: endpointFixture.endpointId,
    asset: declaredCurrency ?? "",
    network: declaredNetwork ?? "",
    amountUnits: buyerRequestSummary.amountUnits,
    supportState: buyerRequestSummary.supportState,
    receiptPresented,
    evidencePresented,
    now: READINESS_GATE_EVALUATED_AT,
    ...(plan
      ? {
          failureMode:
            plan.failurePolicy.mode === "no_charge_on_failure"
              ? ("no_charge_on_failure" as const)
              : ("manual_review_required" as const),
          refundMode: plan.refundPolicy.mode === "manual_review" ? ("manual_review" as const) : ("not_applicable" as const),
        }
      : {}),
    operatorApprovalState: "approved",
  });

  // Attestation/reputation backing via the #606 bridge.
  const bridgeResult = deriveAttestationReputationBridge({
    id: `bridge:${nonce}`,
    ...(chain.binding
      ? { binding: chain.binding }
      : {
          source: {
            kind: "static-fixture",
            sourceId,
            fixtureRef: `fixtures/onboarding/readiness-gate/${nonce}.json`,
            listingId: listingRef,
          },
        }),
    subject: { id: listingRef, type: "listing" },
    createdAt: READINESS_GATE_EVALUATED_AT,
  });

  return {
    scenario,
    nonce,
    profileEdits,
    plan,
    rail,
    preflight: chain.preflight,
    buyerPolicy,
    buyerRequestSummary,
    buyerEvaluation,
    receipt: chain.receipt,
    evidence: chain.evidence,
    attestation: chain.attestation,
    reputationDraft: chain.reputationDraft,
    binding: chain.binding,
    bindingErrors: chain.bindingErrors,
    bridge: bridgeResult.bridge,
    handoff,
    listingRef,
    sourceId,
    endpointUrl: endpointFixture.transport.url,
  };
}

// ---------------------------------------------------------------------------
// Gate assembly
// ---------------------------------------------------------------------------

function gate(row: ReadinessGateRow): ReadinessGateRow {
  if (row.status !== "ready" && (!row.nextAction || row.nextAction.trim().length === 0)) {
    throw new Error(`readiness_gate_missing_next_action:${row.id}`);
  }
  return row;
}

export function deriveReadinessGateView(scenarioId: ReadinessGateScenarioId): ReadinessGateViewModel {
  const inputs = buildScenarioInputs(scenarioId);
  const {
    scenario,
    plan,
    rail,
    preflight,
    buyerPolicy,
    buyerRequestSummary,
    buyerEvaluation,
    receipt,
    evidence,
    attestation,
    reputationDraft,
    binding,
    bindingErrors,
    bridge,
    handoff,
    listingRef,
    endpointUrl,
  } = inputs;

  const profile = handoff.rapProfileDraft;
  const paymentMetadata = profile.payment.metadata;
  const lanes = handoff.readiness.lanes;
  const laneByKey = new Map(lanes.map((lane) => [lane.lane, lane]));

  const declaredEndpoint = profile.invocation.endpointUrls[0] ?? null;
  const auddCap = buyerPolicy.spendCaps.find((cap) => cap.asset === "AUDD");

  const gates: ReadinessGateRow[] = [];

  // --- Payment section -----------------------------------------------------

  gates.push(
    gate({
      id: "x402_payment_config",
      section: "payment",
      label: "x402 payment configuration",
      status: profile.payment.status === "declared_unverified" ? "ready" : "blocked",
      summary:
        profile.payment.status === "declared_unverified"
          ? "Payment metadata is declared (verification stays with operator review; activation is disabled)."
          : `Payment configuration is incomplete — missing: ${profile.payment.missingFields.join(", ") || "(all fields)"}.`,
      reasonCodes: profile.payment.status === "declared_unverified" ? [] : ["missing_payment_metadata"],
      readback: [
        { label: "Payment status", value: profile.payment.status },
        { label: "Missing fields", value: profile.payment.missingFields.join(", ") || "none" },
        { label: "Activation", value: profile.payment.activation },
      ],
      nextAction:
        profile.payment.status === "declared_unverified"
          ? null
          : `Supply ${profile.payment.missingFields.join(", ") || "the payment metadata"} in the profile editor — x402 challenges cannot be described without it.`,
      contractRefs: ["reddi.onboarding-rap-profile-draft.v1"],
    }),
  );

  gates.push(
    gate({
      id: "payment_rail",
      section: "payment",
      label: "Payment rail",
      status: rail ? "ready" : "blocked",
      summary: rail
        ? `Seller-wrapper rail resolved: ${rail.id} (${rail.asset} on ${rail.network}, state ${rail.state}).`
        : "No seller-wrapper rail matches the declared currency/network — the listing cannot describe a payment path.",
      reasonCodes: rail ? [] : ["unsupported_rail_currency"],
      readback: [
        { label: "Declared currency", value: paymentMetadata?.currency ?? "(not declared)" },
        { label: "Declared network", value: paymentMetadata?.network ?? "(not declared)" },
        { label: "Rail", value: rail ? rail.id : "none resolved" },
        { label: "Rail state", value: rail?.state ?? "n/a" },
        { label: "Supported rails", value: "SOL, USDC, AUDD (reddi.seller-wrapper-rail-fixture.v1)" },
      ],
      nextAction: rail
        ? null
        : "Declare a supported rail currency (SOL, USDC, or AUDD) and network (solana-devnet in these fixtures) in the profile editor.",
      contractRefs: ["reddi.seller-wrapper-rail-fixture.v1"],
    }),
  );

  gates.push(
    gate({
      id: "audd_asset_network",
      section: "payment",
      label: "AUDD asset and network",
      status: plan ? "ready" : "blocked",
      summary: plan
        ? `AUDD payment plan present: mint ${plan.mint} on ${plan.network} (proof metadata only).`
        : "No AUDD payment plan can be constructed from the declared metadata.",
      reasonCodes: plan ? [] : preflight.reasonCodes,
      readback: [
        { label: "Asset", value: plan ? plan.asset : "(none)" },
        { label: "Mint", value: plan?.mint ?? "(none)" },
        { label: "Network", value: plan?.network ?? paymentMetadata?.network ?? "(not declared)" },
        { label: "Plan schema", value: plan ? "reddi.audd-payment-plan.v1" : "absent" },
      ],
      nextAction: plan
        ? null
        : "Complete the payment configuration first; the AUDD plan is generated from the declared mint/network/amount and fails closed while any field is missing or unsupported.",
      contractRefs: ["reddi.audd-payment-plan.v1"],
    }),
  );

  gates.push(
    gate({
      id: "settlement_payee",
      section: "payment",
      label: "Settlement and payee",
      status: plan ? "ready" : "blocked",
      summary: plan
        ? "Payee and settlement account are pinned in the payment plan (no custody: metadata only)."
        : "No payee/settlement binding exists without a payment plan.",
      reasonCodes: [],
      readback: [
        { label: "pay_to", value: plan?.payee ?? "(none)" },
        { label: "Settlement account", value: plan?.settlementAccount ?? "(none)" },
        { label: "Declared settlement address", value: paymentMetadata?.settlementAddress ?? "(not declared)" },
      ],
      nextAction: plan ? null : "Supply the settlement address in the profile editor so the payee binding can be generated and preflighted.",
      contractRefs: ["reddi.audd-payment-plan.v1"],
    }),
  );

  const quoteExpired = preflight.reasonCodes.includes("quote_expired");
  gates.push(
    gate({
      id: "quote",
      section: "payment",
      label: "Quote mode and expiry",
      status: plan && !quoteExpired ? "ready" : "blocked",
      summary: !plan
        ? "No quote exists without a payment plan."
        : quoteExpired
          ? "The quote is expired; the preflight fails closed."
          : `Quote is ${plan.paymentMode} mode and unexpired at evaluation time.`,
      reasonCodes: quoteExpired ? ["quote_expired"] : plan ? [] : ["missing_audd_payment_plan"],
      readback: [
        { label: "Payment mode", value: plan?.paymentMode ?? "(none)" },
        { label: "Quote amount", value: plan ? `${plan.amount} base units (${formatAuddAmount(plan.amount)})` : "(none)" },
        { label: "Quote expires", value: plan?.quoteExpiresAt ?? "(none)" },
        { label: "Evaluated at", value: READINESS_GATE_EVALUATED_AT },
      ],
      nextAction:
        plan && !quoteExpired
          ? null
          : plan
            ? "Regenerate the seller quote — expired quotes are never honoured."
            : "Complete the payment configuration to generate a dry-run quote.",
      contractRefs: ["reddi.audd-payment-plan.v1"],
    }),
  );

  gates.push(
    gate({
      id: "refund_failure_policy",
      section: "payment",
      label: "Refund and failure policy",
      status: plan
        ? buyerEvaluation.reasonCodes.includes("refund_failure_policy_mismatch")
          ? "blocked"
          : "ready"
        : "blocked",
      summary: plan
        ? buyerEvaluation.reasonCodes.includes("refund_failure_policy_mismatch")
          ? "The seller's refund/failure policy does not match the buyer policy requirements."
          : `Failure: ${plan.failurePolicy.mode}; refund: ${plan.refundPolicy.mode} — compatible with the buyer policy.`
        : "No refund/failure policy exists without a payment plan.",
      reasonCodes: buyerEvaluation.reasonCodes.filter((code) => code === "refund_failure_policy_mismatch"),
      readback: [
        { label: "Failure policy", value: plan?.failurePolicy.mode ?? "(none)" },
        { label: "Refund policy", value: plan?.refundPolicy.mode ?? "(none)" },
        {
          label: "Buyer policy requires",
          value: `${buyerPolicy.refundFailurePolicy.failureMode} / ${buyerPolicy.refundFailurePolicy.refundMode}`,
        },
      ],
      nextAction:
        plan && !buyerEvaluation.reasonCodes.includes("refund_failure_policy_mismatch")
          ? null
          : plan
            ? "Align the seller failure/refund policy with the buyer policy (no_charge_on_failure / manual_review) before requesting approval."
            : "Complete the payment configuration; refund/failure placeholders are generated with the plan.",
      contractRefs: ["reddi.audd-payment-plan.v1", "reddi.buyer-authority-policy.v1"],
    }),
  );

  gates.push(
    gate({
      id: "buyer_budget_policy",
      section: "payment",
      label: "Buyer budget-policy compatibility",
      status: buyerEvaluation.allowed ? "ready" : "blocked",
      summary: buyerEvaluation.allowed
        ? `Compatible with buyer policy ${buyerPolicy.policyId} (${buyerEvaluation.reasonCodes.join(", ")}).`
        : `Buyer policy evaluation failed closed: ${buyerEvaluation.reasonCodes.join(", ")}.`,
      reasonCodes: [...buyerEvaluation.reasonCodes],
      readback: [
        { label: "Policy", value: buyerPolicy.policyId },
        { label: "Policy expires", value: buyerPolicy.expiresAt },
        {
          label: "Spend cap (AUDD)",
          value: auddCap ? `${auddCap.maxAmountUnits} base units / ${auddCap.window}` : "(none)",
        },
        {
          label: "Evaluated request",
          value: `${buyerRequestSummary.asset} on ${buyerRequestSummary.network}, ${buyerRequestSummary.amountUnits} units, state ${buyerRequestSummary.supportState}`,
        },
        {
          label: "Receipt / evidence presented",
          value: `${buyerRequestSummary.receiptPresented} / ${buyerRequestSummary.evidencePresented}`,
        },
      ],
      nextAction: buyerEvaluation.allowed
        ? null
        : "Resolve each reason code above (rail/currency support, spend caps, receipt and evidence requirements) — the buyer preflight re-runs deterministically.",
      contractRefs: ["reddi.buyer-authority-policy.v1"],
    }),
  );

  gates.push(
    gate({
      id: "endpoint_availability",
      section: "payment",
      label: "Invocation endpoint",
      status: declaredEndpoint ? "ready" : "blocked",
      summary: declaredEndpoint
        ? `Endpoint declared (${declaredEndpoint}). Live probes are disabled in this build; runtime availability is not claimed.`
        : "No invocation endpoint is declared — the listing is unreachable and fails closed.",
      reasonCodes: declaredEndpoint ? [] : ["missing_evidence"],
      readback: [
        { label: "Declared endpoint", value: declaredEndpoint ?? "(none)" },
        { label: "Health checks", value: `${profile.healthChecks.status} (probes disabled)` },
        { label: "Invocation allowed", value: String(profile.invocation.invocationAllowed) },
        { label: "Seller wrapper transport", value: endpointUrl },
      ],
      nextAction: declaredEndpoint
        ? null
        : "Add a public HTTPS invocation endpoint in the profile editor. Private/localhost hosts are rejected fail-closed.",
      contractRefs: ["reddi.onboarding-rap-profile-draft.v1"],
    }),
  );

  const authDeclared = profile.authRequirements.length > 0;
  const authLane = laneByKey.get("auth_scope_risk");
  const authNeedsReview = authLane?.status === "needs_operator_review";
  gates.push(
    gate({
      id: "auth_safety",
      section: "payment",
      label: "Auth safety",
      status: !authDeclared ? "blocked" : authNeedsReview && scenario.profileScenario === "inferred-warnings" ? "needs_operator_review" : "ready",
      summary: !authDeclared
        ? "No auth scheme is declared for a paid endpoint — unsafe, fails closed."
        : authNeedsReview && scenario.profileScenario === "inferred-warnings"
          ? "Auth is declared, but inferred execute-risk capabilities require operator scope review before approval."
          : "Auth requirements are declared as names/hints only (never secrets).",
      reasonCodes: !authDeclared ? ["missing_evidence"] : authLane?.reasonCodes ?? [],
      readback: [
        { label: "Auth requirements", value: authDeclared ? profile.authRequirements.join("; ") : "(none declared)" },
        { label: "auth_scope_risk lane", value: authLane?.status ?? "unknown" },
      ],
      nextAction: !authDeclared
        ? "Declare an auth scheme (scheme names/hints only — credential values are rejected and discarded) before this endpoint can be considered for paid invocation."
        : authNeedsReview && scenario.profileScenario === "inferred-warnings"
          ? "Review the inferred execute-risk capabilities and confirm the auth scope in the profile editor before approving."
          : null,
      contractRefs: ["reddi.onboarding-readiness-result.v1"],
    }),
  );

  // --- Receipts, evidence and trust section --------------------------------

  const receiptRequirementBlocked = buyerEvaluation.reasonCodes.includes("receipt_requirement_missing");
  gates.push(
    gate({
      id: "receipt_requirement",
      section: "trust",
      label: "Receipt requirement",
      status: receiptRequirementBlocked ? "blocked" : "ready",
      summary: receiptRequirementBlocked
        ? "The buyer policy requires a receipt but none is presented for this listing."
        : "Receipt requirement satisfied: every paid call must emit a rail-neutral receipt.",
      reasonCodes: receiptRequirementBlocked ? ["receipt_requirement_missing"] : [],
      readback: [
        { label: "Buyer policy receiptRequired", value: String(buyerPolicy.receiptEvidence.receiptRequired) },
        { label: "Receipt presented", value: String(buyerRequestSummary.receiptPresented) },
        { label: "Receipt schema", value: "reddi.receipt.v1" },
      ],
      nextAction: receiptRequirementBlocked
        ? "Run the no-spend dry-run flow to produce a receipt (quote -> preflight -> mocked invocation) — live calls stay disabled either way."
        : null,
      contractRefs: ["reddi.buyer-authority-policy.v1", "reddi.receipt.v1"],
    }),
  );

  const evidenceRequirementBlocked =
    buyerEvaluation.reasonCodes.includes("evidence_requirement_missing") ||
    preflight.reasonCodes.includes("evidence_required") ||
    (plan !== null && !plan.evidenceRequired);
  gates.push(
    gate({
      id: "evidence_requirement",
      section: "trust",
      label: "Evidence requirement",
      status: evidenceRequirementBlocked ? "blocked" : plan ? "ready" : "blocked",
      summary: evidenceRequirementBlocked
        ? "Evidence settings are missing: the seller plan does not require evidence, so the buyer preflight fails closed."
        : plan
          ? "Evidence is required by both the seller plan and the buyer policy."
          : "No evidence settings exist without a payment plan.",
      reasonCodes: [
        ...preflight.reasonCodes.filter((code) => code === "evidence_required"),
        ...buyerEvaluation.reasonCodes.filter((code) => code === "evidence_requirement_missing"),
      ],
      readback: [
        { label: "Plan evidenceRequired", value: plan ? String(plan.evidenceRequired) : "(no plan)" },
        { label: "Buyer policy evidenceRequired", value: String(buyerPolicy.receiptEvidence.evidenceRequired) },
        { label: "Evidence archive required", value: String(buyerPolicy.receiptEvidence.evidenceArchiveRequired) },
        { label: "Profile evidence expectations", value: profile.evidenceExpectations.join(", ") },
      ],
      nextAction: evidenceRequirementBlocked
        ? "Set evidenceRequired: true on the seller payment plan (seller-wrapper config) — buyers in this lane reject evidence-less plans."
        : plan
          ? null
          : "Complete the payment configuration; evidence settings are generated with the plan.",
      contractRefs: ["reddi.audd-payment-plan.v1", "reddi.buyer-authority-policy.v1"],
    }),
  );

  gates.push(
    gate({
      id: "dry_run_receipt",
      section: "trust",
      label: "Dry-run receipt",
      status: preflight.allowed && receipt ? "ready" : "blocked",
      summary:
        preflight.allowed && receipt
          ? `Dry-run preflight allowed and a mocked-invocation receipt exists (${receipt.job.id}).`
          : `The dry-run preflight failed closed: ${preflight.reasonCodes.join(", ")}. No receipt exists.`,
      reasonCodes: [...preflight.reasonCodes],
      readback: [
        { label: "Preflight allowed", value: String(preflight.allowed) },
        { label: "Payment proof ref", value: preflight.paymentProofRef ?? "(none)" },
        { label: "Receipt id", value: receipt?.job.id ?? "(none)" },
        { label: "Attestation status", value: receipt?.attestationStatus ?? "(no receipt)" },
      ],
      nextAction:
        preflight.allowed && receipt
          ? null
          : "Fix the preflight reason codes above and re-run the no-spend dry-run; a listing without a passing dry-run receipt is never surfaced as payable.",
      contractRefs: ["reddi.audd-payment-plan.v1", "reddi.receipt.v1"],
    }),
  );

  gates.push(
    gate({
      id: "receipt_evidence_binding",
      section: "trust",
      label: "Receipt/evidence binding (#393)",
      status: binding ? "ready" : "blocked",
      summary: binding
        ? `Binding ${binding.id} ties the receipt, evidence archive record, and payment preflight together.`
        : bindingErrors.length > 0
          ? `The binding derivation failed closed: ${bindingErrors.join(", ")}.`
          : "No receipt/evidence binding exists for this listing.",
      reasonCodes: bindingErrors.map((error) => error.split(":")[0]),
      readback: [
        { label: "Binding id", value: binding?.id ?? "(none)" },
        { label: "Evidence ref", value: binding?.evidence.evidenceRef ?? evidence?.evidenceRef ?? "(none)" },
        { label: "Evidence hash", value: binding?.evidence.evidenceHash ?? "(none)" },
        { label: "Payment proof ref", value: binding?.payment.paymentProofRef ?? "(none)" },
      ],
      nextAction: binding
        ? null
        : "Produce a passing dry-run receipt first, then derive the #393 binding — listings without a receipt/evidence binding fail closed everywhere downstream.",
      contractRefs: ["reddi.receipt-evidence-binding.v1"],
    }),
  );

  const attestationReady = Boolean(binding?.attestation && binding.attestation.status === "attested");
  gates.push(
    gate({
      id: "attestation_state",
      section: "trust",
      label: "Attestation state",
      status: attestationReady ? "ready" : "blocked",
      summary: attestationReady
        ? `Attested (${binding?.attestation?.verdict}, trust boundary ${binding?.attestation?.trustBoundary}).`
        : "No attestation backs this listing; the bridge withholds any reputation preview.",
      reasonCodes: attestationReady ? [] : [...bridge.listingProjection.blockedReasons],
      readback: [
        { label: "Attestation id", value: binding?.attestation?.id ?? attestation?.id ?? "(none)" },
        { label: "Verdict", value: binding?.attestation?.verdict ?? "(none)" },
        { label: "Bridge status", value: bridge.status },
        { label: "Bridge marking", value: bridge.marking.attestation },
      ],
      nextAction: attestationReady
        ? null
        : "Request a local-fixture attestation over the dry-run evidence (rubric: evidence_integrity, policy_compliance, delivery_quality) — reputation previews stay withheld without one.",
      contractRefs: ["reddi.attestation.v1", "reddi.attestation-reputation-bridge.v1"],
    }),
  );

  const reputationAvailable = bridge.listingProjection.offchainPreview === "available";
  const repDraftEvent = reputationDraft?.ok ? reputationDraft.event : null;
  gates.push(
    gate({
      id: "reputation_state",
      section: "trust",
      label: "Reputation starting state",
      status: reputationAvailable ? "ready" : "blocked",
      summary: reputationAvailable
        ? `Starting state is unproven; an off-chain preview is available (draft ${repDraftEvent?.previousScore} -> ${repDraftEvent?.nextScore}, not mutated).`
        : `No reputation backing: ${bridge.listingProjection.blockedReasons.join(" ") || `bridge status ${bridge.status}.`}`,
      reasonCodes: [...bridge.reasonCodes],
      readback: [
        { label: "Profile reputation", value: `${profile.reputation.status} (receipts: ${profile.reputation.receiptRefs.length})` },
        { label: "listingProjection.offchainPreview", value: bridge.listingProjection.offchainPreview },
        { label: "listingProjection.quasar", value: bridge.listingProjection.quasar },
        { label: "listingProjection.hostedAttestation", value: bridge.listingProjection.hostedAttestation },
        { label: "Buyer-facing claims allowed", value: String(bridge.listingProjection.buyerFacingClaimsAllowed) },
        { label: "Evidence refs", value: bridge.listingProjection.evidenceRefs.join(", ") || "(none)" },
      ],
      nextAction: reputationAvailable
        ? null
        : "Complete the receipt -> evidence -> attestation chain; the #606 bridge only exposes a reputation preview when the full binding is attested.",
      contractRefs: ["reddi.attestation-reputation-bridge.v1"],
    }),
  );

  const trustLane = laneByKey.get("imported_content_trust");
  gates.push(
    gate({
      id: "trust_posture",
      section: "trust",
      label: "Source trust posture",
      status: profile.trust.sourceAuthenticity === "snapshot_recorded" ? "needs_operator_review" : "blocked",
      summary:
        profile.trust.sourceAuthenticity === "snapshot_recorded"
          ? "Snapshot recorded; imported content stays untrusted and the provider unverified until operator review assigns trust with evidence."
          : "No source snapshot is recorded — authenticity cannot be established.",
      reasonCodes: trustLane?.reasonCodes ?? [],
      readback: [
        { label: "Source authenticity", value: profile.trust.sourceAuthenticity },
        { label: "Imported content trust", value: profile.trust.importedContentTrust },
        { label: "Verified provider trust", value: String(profile.trust.verifiedProviderTrust) },
      ],
      nextAction:
        profile.trust.sourceAuthenticity === "snapshot_recorded"
          ? "Operator review: verify the snapshot against the live source and assign trust with evidence refs — imported content never self-asserts trust."
          : "Re-ingest the source with a recorded snapshot reference.",
      contractRefs: ["reddi.onboarding-rap-profile-draft.v1"],
    }),
  );

  // --- Overall --------------------------------------------------------------

  const blockedGateIds = gates.filter((row) => row.status === "blocked").map((row) => row.id);
  const readyCount = gates.filter((row) => row.status === "ready").length;
  const reviewCount = gates.filter((row) => row.status === "needs_operator_review").length;
  const overallStatus = blockedGateIds.length > 0 ? "blocked" : "ready_for_operator_review";

  // --- Dry-run receipt readback ---------------------------------------------

  const dryRunReceipt: ReadinessGateDryRunReceipt = {
    status: binding ? "bound" : plan ? "denied" : "not_run",
    reasonCodes: [...preflight.reasonCodes],
    quote: plan
      ? {
          source: inputs.sourceId,
          specialist: SPECIALIST_ID,
          amountUnits: plan.amount,
          amountDisplay: formatAuddAmount(plan.amount),
          asset: plan.asset,
          network: plan.network,
          mint: plan.mint,
          paymentMode: plan.paymentMode,
          quoteExpiresAt: plan.quoteExpiresAt,
        }
      : null,
    payTo: plan?.payee ?? null,
    settlementAccount: plan?.settlementAccount ?? null,
    policyApproval: preflight.policyDecision ? preflight.policyDecision.approvalState : null,
    paymentProofRef: preflight.paymentProofRef ?? null,
    receiptId: receipt?.job.id ?? null,
    requestHash: receipt?.requestHash ?? null,
    responseHash: receipt?.responseHash ?? null,
    evidenceId: evidence?.id ?? null,
    evidenceRef: evidence?.evidenceRef ?? null,
    evidenceHash: evidence?.evidenceHash ?? null,
    bindingId: binding?.id ?? null,
    attestationId: binding?.attestation?.id ?? null,
    reputationDraft: repDraftEvent
      ? {
          previousScore: repDraftEvent.previousScore,
          nextScore: repDraftEvent.nextScore,
          routingImpact: repDraftEvent.routingImpact,
        }
      : null,
  };

  // --- Live controls (always disabled in fixtures) ---------------------------

  const economicDemoReadiness = getEconomicDemoPaymentReadiness();
  const liveControls: ReadinessGateViewModel["liveControls"] = {
    enabled: false,
    requirements: [
      {
        id: "backend_readiness",
        label: "Backend payment readiness for this listing",
        state: "absent",
        detail: `No backend readiness record exists for this listing in these fixtures. The economic-demo x402 readiness artifact (${economicDemoReadiness.mode}, profile ${economicDemoReadiness.profileId}) proves protocol-level challenge/receipt capability for the hosted demo specialist only — it is not readiness for this listing.`,
      },
      {
        id: "operator_live_approval",
        label: "Explicit operator live-payment approval",
        state: "absent",
        detail:
          "No operator live-payment approval exists in these fixtures — the seller-wrapper config validator rejects livePaymentApproved: true (live_payment_not_approved) and the buyer policy pins allowLivePayment: false.",
      },
      {
        id: "audd_custody_boundary",
        label: "AUDD custody / settled escrow",
        state: "out_of_scope",
        detail:
          "Out of scope for v0.1 by the #392 decision: AUDD support is payment-plan/proof metadata. No Quasar AUDD custody and no settled AUDD escrow exists behind this surface.",
      },
    ],
    copy:
      "Live payment controls are intentionally not rendered as actionable anywhere on this surface. In these fixtures, backend readiness and operator live-payment approval never exist, so there is nothing a control could truthfully do. Everything above is dry-run / no-spend readiness.",
  };

  // --- Boundary flags (#497 grid vocabulary, all hard-false) -----------------

  const flags: Record<string, false> = {};
  for (const key of EXPECTED_HARD_BOUNDARY_FLAG_KEYS) flags[key] = false;

  const sellerWrapperConfig = generateSellerWrapperConfigExamples();
  const sellerWrapperValidation = validateSellerWrapperConfigExamples(sellerWrapperConfig);

  return {
    schemaVersion: READINESS_GATE_VIEW_SCHEMA_VERSION,
    issue: READINESS_GATE_ISSUE,
    scenario,
    evaluatedAt: READINESS_GATE_EVALUATED_AT,
    source: {
      listingRef,
      sourceKind: profile.identity.sourceKind,
      snapshotRef: handoff.intake.source.snapshotRef,
      displayName: profile.identity.displayName.value ?? null,
      endpointUrl: declaredEndpoint,
    },
    profileReadiness: {
      overall: handoff.readiness.overall,
      failClosedReasons: [...handoff.readiness.failClosedReasons],
      lanes: lanes.map((lane) => ({
        lane: lane.lane,
        status: lane.status,
        reasonCodes: [...lane.reasonCodes],
      })),
    },
    overall: {
      status: overallStatus,
      headline:
        overallStatus === "blocked"
          ? `${blockedGateIds.length} gate${blockedGateIds.length === 1 ? "" : "s"} failed closed. Each failed gate names its concrete next action below.`
          : "All gates pass on fixtures. Operator review is still required before anything becomes public, payable, or trusted — nothing on this page is live.",
      blockedGateIds,
      readyCount,
      reviewCount,
      blockedCount: blockedGateIds.length,
    },
    gates,
    dryRunReceipt,
    liveControls,
    boundaries: {
      flags,
      note: "All live flags are false. No wallet signing, RPC call, provider call, paid request, hosted registry write, marketplace publication, trust upgrade, or reputation mutation is reachable from this surface.",
    },
    auddBoundary: {
      copy:
        "AUDD on this page is proof-metadata / payment-plan readiness for v0.1 — dry-run quotes, preflight decisions, and receipt metadata only. It is not Quasar AUDD custody, and no settled AUDD escrow exists. Any custody or settlement-finality expansion requires a separately approved and audited workstream.",
      decisionIssue: 392,
      authorityDoc: "docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md",
    },
    sellerWrapperValidation: {
      valid: sellerWrapperValidation.valid,
      reasonCodes: [...sellerWrapperValidation.reasonCodes],
    },
  };
}

export function deriveAllReadinessGateViews(): Record<ReadinessGateScenarioId, ReadinessGateViewModel> {
  return {
    ready: deriveReadinessGateView("ready"),
    "blocked-payment": deriveReadinessGateView("blocked-payment"),
    "blocked-evidence": deriveReadinessGateView("blocked-evidence"),
    "blocked-trust": deriveReadinessGateView("blocked-trust"),
    "dry-run-receipt": deriveReadinessGateView("dry-run-receipt"),
  };
}
