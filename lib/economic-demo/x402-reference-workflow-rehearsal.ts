import { buildEconomicDemoDryRunPlan, type DryRunEconomicPlan } from "@/lib/economic-demo/dry-run";
import { buildEconomicDemoLedgerReconciliation } from "@/lib/economic-demo/ledger-reconciliation";
import {
  ECONOMIC_DEMO_LIVE_PAID_DEVNET_CONFIRM,
  ECONOMIC_DEMO_LIVE_PAID_DEVNET_PROFILE_IDS,
} from "@/lib/economic-demo/live-paid-devnet-run";
import { getEconomicDemoPaymentReadiness } from "@/lib/economic-demo/payment-readiness";
import {
  getPublicProofPageData,
  PUBLIC_PROOF_PAGE_DATA_SCHEMA_VERSION,
  type PublicProofPageBoundaryFlags,
  type PublicProofPageData,
  type PublicProofPageRailNeutralCase,
} from "@/lib/economic-demo/public-proof-page-data";

export const X402_REFERENCE_WORKFLOW_REHEARSAL_SCHEMA_VERSION =
  "reddi.economic-demo.x402-reference-workflow-rehearsal.v1" as const;

export const X402_REFERENCE_WORKFLOW_REHEARSAL_ISSUE_REF = "nissan/reddi-agent-protocol#564" as const;

export const X402_REFERENCE_WORKFLOW_RUNBOOK_PATH = "docs/DEVNET-REFERENCE-RUN-564.md" as const;

export const X402_REFERENCE_WORKFLOW_STEP_IDS = [
  "discover",
  "quote",
  "policy_preflight",
  "x402_payment_plan",
  "receipt",
  "evidence",
  "proof_contract_emission",
] as const;

export type X402ReferenceWorkflowStepId = (typeof X402_REFERENCE_WORKFLOW_STEP_IDS)[number];

export type X402ReferenceWorkflowStep = {
  step: X402ReferenceWorkflowStepId;
  order: number;
  status: "rehearsed_dry_run";
  liveExecution: false;
  summary: string;
  refs: string[];
};

export type X402ReferenceWorkflowMetering = {
  meteringMode: "test";
  real: {
    label: "real_live_execution";
    executed: false;
    downstreamCallsExecuted: 0;
    paidRequests: 0;
    walletSigningEvents: 0;
    rpcCalls: 0;
    devnetTransactions: 0;
    usdcSettled: "0";
    protocolRailFeesCollectedUsdc: "0";
    realSettlementsVerified: 0;
  };
  test: {
    label: "test_fixture_dry_run";
    plannedDownstreamCalls: number;
    plannedTotalUsdc: number;
    plannedProtocolRailFeeBps: number;
    plannedProtocolRailFeeUsdc: number;
    controlledDemoReceipts: number;
    surfpoolLocalTransferLamports: number;
    surfpoolLocalTransferSol: string;
  };
};

export type X402ReferenceWorkflowLiveGate = {
  state: "live_gated";
  liveStepsExecuted: false;
  requiresOperatorApproval: true;
  operator: "Nissan";
  autonomousAgentExecutionAllowed: false;
  operatorApprovalRef: null;
  runbookPath: typeof X402_REFERENCE_WORKFLOW_RUNBOOK_PATH;
  promotionChecklistPath: "docs/QUASAR-SURFPOOL-DEVNET-PROMOTION-CHECKLIST.md";
  armEnvVarNames: string[];
  confirmTokenName: "ECONOMIC_DEMO_LIVE_PAID_DEVNET_CONFIRM";
  confirmTokenValue: typeof ECONOMIC_DEMO_LIVE_PAID_DEVNET_CONFIRM;
  allowlistedProfileIds: readonly string[];
};

export type X402ReferenceWorkflowRehearsal = {
  schemaVersion: typeof X402_REFERENCE_WORKFLOW_REHEARSAL_SCHEMA_VERSION;
  issueRef: typeof X402_REFERENCE_WORKFLOW_REHEARSAL_ISSUE_REF;
  generatedAt: string;
  scenarioId: "webpage";
  mode: "no_live_dry_run_rehearsal";
  network: {
    target: "solana-devnet";
    executed: false;
    state: "live_gated";
  };
  steps: X402ReferenceWorkflowStep[];
  discovery: {
    source: "openrouter-specialist-catalog";
    orchestratorProfileId: string;
    orchestratorEndpoint: string;
    downstream: Array<{
      profileId: string;
      capability: string;
      endpoint: string;
      walletAddress: string;
      priceAmount: string;
      priceCurrency: string;
    }>;
  };
  quote: PublicProofPageData["quote"];
  policyPreflight: {
    policyDecision: PublicProofPageData["policyDecision"];
    auddPaymentPlanPreflight: PublicProofPageData["auddPaymentPlanPreflight"];
  };
  x402PaymentPlan: {
    paymentMode: "dry-run";
    executed: false;
    network: string;
    asset: string;
    amount: string;
    dryRunPaymentProofRef: string;
    liveChallengeSnapshot: {
      source: "static_readiness_fixture";
      endpoint: string;
      network: "solana-devnet";
      payTo: string;
      amount: string;
      currency: string;
    };
    settlementClaim: "none";
  };
  receipt: NonNullable<PublicProofPageRailNeutralCase["receipt"]> & { bindingCase: string };
  evidence: NonNullable<PublicProofPageRailNeutralCase["evidenceArchive"]> & { bindingCase: string };
  proofContract: PublicProofPageData;
  metering: X402ReferenceWorkflowMetering;
  liveGate: X402ReferenceWorkflowLiveGate;
  boundaryFlags: PublicProofPageBoundaryFlags;
  copyBoundaries: string[];
  notes: string[];
};

const GENERATED_AT = "2026-07-06T12:00:00.000Z";

const BOUNDARY_FLAGS: PublicProofPageBoundaryFlags = {
  walletSigning: false,
  rpcCall: false,
  providerCall: false,
  paidRequest: false,
  sandboxExecution: false,
  hostedRegistryWrite: false,
  marketplacePublication: false,
  trustUpgrade: false,
  reputationMutation: false,
  custodyClaim: false,
  settlementFinalityProof: false,
  livePayment: false,
};

function toStep(
  step: X402ReferenceWorkflowStepId,
  order: number,
  summary: string,
  refs: string[],
): X402ReferenceWorkflowStep {
  return { step, order, status: "rehearsed_dry_run", liveExecution: false, summary, refs };
}

function bindingReadyCase(proofContract: PublicProofPageData): PublicProofPageRailNeutralCase {
  const found = proofContract.railNeutralProofChain.cases.find((item) => item.status === "binding_ready");
  if (!found) throw new Error("missing_binding_ready_rail_neutral_fixture");
  return found;
}

export function buildX402ReferenceWorkflowRehearsal(): X402ReferenceWorkflowRehearsal {
  const scenarioId = "webpage" as const;
  const dryRunPlan: DryRunEconomicPlan = buildEconomicDemoDryRunPlan(scenarioId);
  const proofContract = getPublicProofPageData(scenarioId);
  const readiness = getEconomicDemoPaymentReadiness();
  const ledger = buildEconomicDemoLedgerReconciliation();
  const bindingReady = bindingReadyCase(proofContract);

  if (proofContract.schemaVersion !== PUBLIC_PROOF_PAGE_DATA_SCHEMA_VERSION) {
    throw new Error("public_proof_page_data_schema_mismatch");
  }
  if (!bindingReady.receipt || !bindingReady.evidenceArchive) {
    throw new Error("binding_ready_case_missing_receipt_or_evidence");
  }
  if (!bindingReady.payment?.paymentProofRef) {
    throw new Error("binding_ready_case_missing_dry_run_payment_proof_ref");
  }

  const plannedProtocolRailFeeUsdc = proofContract.quote.protocolRailFeesUsdc;

  return {
    schemaVersion: X402_REFERENCE_WORKFLOW_REHEARSAL_SCHEMA_VERSION,
    issueRef: X402_REFERENCE_WORKFLOW_REHEARSAL_ISSUE_REF,
    generatedAt: GENERATED_AT,
    scenarioId,
    mode: "no_live_dry_run_rehearsal",
    network: {
      target: "solana-devnet",
      executed: false,
      state: "live_gated",
    },
    steps: [
      toStep("discover", 1, "Resolve orchestrator and downstream specialists from the deployed 30-profile catalog without network calls.", [
        `profile:${dryRunPlan.orchestrator.id}`,
        ...dryRunPlan.edges.map((edge) => `profile:${edge.toProfileId}`),
      ]),
      toStep("quote", 2, "Assemble the deterministic USDC quote including downstream fees, attestor fees, markup, and protocol rail fee.", [
        `scenario:${scenarioId}`,
        `quote_total_usdc:${proofContract.quote.totalUsdc}`,
      ]),
      toStep("policy_preflight", 3, "Evaluate the fixture-only policy decision and AUDD payment-plan preflight; both stay allowed_fixture_only.", [
        `policy:${proofContract.policyDecision.status}`,
        `preflight:${proofContract.auddPaymentPlanPreflight.status}`,
      ]),
      toStep("x402_payment_plan", 4, "Bind the dry-run x402 payment plan to the sandbox single-charge payment proof ref; no payment is generated or submitted.", [
        `payment_proof_ref:${bindingReady.payment.paymentProofRef}`,
        `rail:${bindingReady.sourceRef.rail}`,
      ]),
      toStep("receipt", 5, "Reference the redacted rail-neutral receipt (refs, hashes, and support states only).", [
        `receipt:${bindingReady.receipt.id}`,
      ]),
      toStep("evidence", 6, "Reference the EvidenceArchive record binding source, request hash, response hash, and evidence ref.", [
        `evidence:${bindingReady.evidenceArchive.id}`,
      ]),
      toStep("proof_contract_emission", 7, "Emit the #417 public proof page data contract as the rehearsal proof artifact.", [
        `schema:${PUBLIC_PROOF_PAGE_DATA_SCHEMA_VERSION}`,
      ]),
    ],
    discovery: {
      source: "openrouter-specialist-catalog",
      orchestratorProfileId: dryRunPlan.orchestrator.id,
      orchestratorEndpoint: dryRunPlan.orchestrator.endpoint,
      downstream: dryRunPlan.edges.map((edge) => ({
        profileId: edge.toProfileId,
        capability: edge.capability,
        endpoint: edge.endpoint,
        walletAddress: edge.walletAddress,
        priceAmount: edge.price.amount,
        priceCurrency: edge.price.currency,
      })),
    },
    quote: proofContract.quote,
    policyPreflight: {
      policyDecision: proofContract.policyDecision,
      auddPaymentPlanPreflight: proofContract.auddPaymentPlanPreflight,
    },
    x402PaymentPlan: {
      paymentMode: "dry-run",
      executed: false,
      network: bindingReady.payment.network,
      asset: bindingReady.payment.asset,
      amount: bindingReady.payment.amount,
      dryRunPaymentProofRef: bindingReady.payment.paymentProofRef,
      liveChallengeSnapshot: {
        source: "static_readiness_fixture",
        endpoint: readiness.endpoint,
        network: readiness.liveChallenge.network,
        payTo: readiness.liveChallenge.payTo,
        amount: readiness.liveChallenge.amount,
        currency: readiness.liveChallenge.currency,
      },
      settlementClaim: "none",
    },
    receipt: { ...bindingReady.receipt, bindingCase: bindingReady.case },
    evidence: { ...bindingReady.evidenceArchive, bindingCase: bindingReady.case },
    proofContract,
    metering: {
      meteringMode: "test",
      real: {
        label: "real_live_execution",
        executed: false,
        downstreamCallsExecuted: 0,
        paidRequests: 0,
        walletSigningEvents: 0,
        rpcCalls: 0,
        devnetTransactions: 0,
        usdcSettled: "0",
        protocolRailFeesCollectedUsdc: "0",
        realSettlementsVerified: 0,
      },
      test: {
        label: "test_fixture_dry_run",
        plannedDownstreamCalls: dryRunPlan.edges.length,
        plannedTotalUsdc: proofContract.quote.totalUsdc,
        plannedProtocolRailFeeBps: proofContract.quote.protocolRailFeeBps,
        plannedProtocolRailFeeUsdc: plannedProtocolRailFeeUsdc,
        controlledDemoReceipts: ledger.totals.controlledPaidCompletions,
        surfpoolLocalTransferLamports: ledger.totals.surfpoolLocalTransferLamports,
        surfpoolLocalTransferSol: ledger.totals.surfpoolLocalTransferSol,
      },
    },
    liveGate: {
      state: "live_gated",
      liveStepsExecuted: false,
      requiresOperatorApproval: true,
      operator: "Nissan",
      autonomousAgentExecutionAllowed: false,
      operatorApprovalRef: null,
      runbookPath: X402_REFERENCE_WORKFLOW_RUNBOOK_PATH,
      promotionChecklistPath: "docs/QUASAR-SURFPOOL-DEVNET-PROMOTION-CHECKLIST.md",
      armEnvVarNames: [
        "ECONOMIC_DEMO_LIVE_PAID_DEVNET",
        "ECONOMIC_DEMO_LIVE_PAID_DEVNET_CONFIRM",
        "ECONOMIC_DEMO_ORCHESTRATOR_DEVNET_KEYPAIR_JSON",
      ],
      confirmTokenName: "ECONOMIC_DEMO_LIVE_PAID_DEVNET_CONFIRM",
      confirmTokenValue: ECONOMIC_DEMO_LIVE_PAID_DEVNET_CONFIRM,
      allowlistedProfileIds: ECONOMIC_DEMO_LIVE_PAID_DEVNET_PROFILE_IDS,
    },
    boundaryFlags: BOUNDARY_FLAGS,
    copyBoundaries: [
      "This rehearsal is a deterministic no-live dry run: no wallet signing, RPC call, provider call, paid request, or devnet transaction occurs.",
      "Payment metadata is fixture/dry-run proof data only; nothing is settled, escrowed, or held in custody.",
      "Real metering fields are authoritative zeros until the operator-approved live devnet run; test metering values are fixture-planned only.",
      "The live devnet reference run REQUIRES OPERATOR (Nissan) approval and is not executable by autonomous agents.",
      ...proofContract.copyBoundaries,
    ],
    notes: [
      "Rehearses the full A2A loop end-to-end: discover -> quote -> policy preflight -> x402 payment plan (dry-run proof ref only) -> receipt -> evidence -> #417 proof data contract emission.",
      `Live-run preconditions, commands, abort criteria, and post-run publication steps live in ${X402_REFERENCE_WORKFLOW_RUNBOOK_PATH}.`,
      "Run via: npm run rehearse:x402-reference-workflow",
    ],
  };
}

export function assertX402ReferenceWorkflowRehearsalStaysDryRun(rehearsal: X402ReferenceWorkflowRehearsal): void {
  const violations: string[] = [];
  for (const [flag, value] of Object.entries(rehearsal.boundaryFlags)) {
    if (value !== false) violations.push(`boundary_flag_not_false:${flag}`);
  }
  for (const [flag, value] of Object.entries(rehearsal.proofContract.boundaryFlags)) {
    if (value !== false) violations.push(`proof_contract_boundary_flag_not_false:${flag}`);
  }
  const real = rehearsal.metering.real;
  if (real.executed !== false) violations.push("real_metering_executed_not_false");
  if (real.downstreamCallsExecuted !== 0) violations.push("real_downstream_calls_not_zero");
  if (real.paidRequests !== 0) violations.push("real_paid_requests_not_zero");
  if (real.walletSigningEvents !== 0) violations.push("real_wallet_signing_events_not_zero");
  if (real.rpcCalls !== 0) violations.push("real_rpc_calls_not_zero");
  if (real.devnetTransactions !== 0) violations.push("real_devnet_transactions_not_zero");
  if (real.usdcSettled !== "0") violations.push("real_usdc_settled_not_zero");
  if (real.realSettlementsVerified !== 0) violations.push("real_settlements_verified_not_zero");
  if (rehearsal.metering.meteringMode !== "test") violations.push("metering_mode_not_test");
  if (rehearsal.network.executed !== false) violations.push("network_executed_not_false");
  if (rehearsal.liveGate.liveStepsExecuted !== false) violations.push("live_steps_executed_not_false");
  if (rehearsal.liveGate.operatorApprovalRef !== null) violations.push("operator_approval_ref_not_null");
  if (rehearsal.steps.some((step) => step.liveExecution !== false)) violations.push("step_live_execution_not_false");
  if (violations.length > 0) {
    throw new Error(`x402_reference_workflow_rehearsal_dry_run_violation:${violations.join(",")}`);
  }
}
