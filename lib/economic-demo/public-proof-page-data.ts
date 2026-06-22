import { railNeutralProofChainFixtures } from "../../packages/agent-protocol/dist/rail-neutral-proof-chain-fixture.js";
import { economicDemoScenarios, type EconomicDemoScenarioId } from "@/lib/economic-demo/fixture";
import { buildEconomicDemoDryRunPlan } from "@/lib/economic-demo/dry-run";
import { getStaticWebpageLiveWorkflowEvidence } from "@/lib/economic-demo/webpage-live-workflow-evidence";

export const PUBLIC_PROOF_PAGE_DATA_SCHEMA_VERSION = "reddi.economic-demo.public-proof-page-data.v1" as const;

export type PublicProofPageStateLabel =
  | "fixture_zero_spend"
  | "planned_dry_run"
  | "simulated"
  | "devnet_proof_metadata"
  | "live_gated"
  | "production_live_disabled";

export type PublicProofPageBoundaryFlags = {
  walletSigning: false;
  rpcCall: false;
  providerCall: false;
  paidRequest: false;
  sandboxExecution: false;
  hostedRegistryWrite: false;
  marketplacePublication: false;
  trustUpgrade: false;
  reputationMutation: false;
  custodyClaim: false;
  settlementFinalityProof: false;
  livePayment: false;
};

export type PublicProofPageRailNeutralCase = {
  case: string;
  status: "binding_ready" | "blocked";
  sourceRef: {
    rail: string;
    sourceId: string;
    artifactPath: string;
  };
  payment?: {
    network: string;
    asset: string;
    amount: string;
    paymentProofRef?: string;
  };
  bindingRefs: {
    sourceRef: string;
    quoteRef?: string;
    paymentProofRef?: string;
    requestHash?: string;
    responseHash?: string;
    evidenceRef?: string;
    nonceRef?: string;
    recipientRef?: string;
    operatorApprovalRef?: string;
  };
  evidenceArchive?: {
    id: string;
    receiptId: string;
    sourceId: string;
    evidenceRef?: string;
    requestHash?: string;
    responseHash?: string;
  };
  receipt?: {
    id: string;
    sourceId: string;
    attestationStatus: string;
    supportState: string;
  };
  blockedBy: Array<{
    code: string;
    path: string;
    message: string;
  }>;
  claimBoundaryLabels: string[];
  boundaryFlags: PublicProofPageBoundaryFlags;
};

export type PublicProofPageData = {
  schemaVersion: typeof PUBLIC_PROOF_PAGE_DATA_SCHEMA_VERSION;
  generatedAt: string;
  scenarioId: EconomicDemoScenarioId;
  stateLabels: PublicProofPageStateLabel[];
  quote: {
    currency: "USDC";
    downstreamFeesUsdc: number;
    attestorFeesUsdc: number;
    orchestratorMarkupUsdc: number;
    protocolRailFeeBps: number;
    protocolRailFeesUsdc: number;
    jupiterSwapAllowanceUsdc: number;
    totalUsdc: number;
    solEstimate: number;
    slippageBps: number;
  };
  policyDecision: {
    status: "allowed_fixture_only";
    reasonCodes: string[];
    auditNotes: string[];
  };
  auddPaymentPlanPreflight: {
    status: "allowed_fixture_only";
    paymentMode: "dry-run";
    evidenceRequired: true;
    failurePolicy: string;
    refundPolicy: string;
  };
  publicWorkflowEvidence: {
    schemaVersion: string;
    sourceArtifactPath: string;
    disclosureLedgerEvidenceComplete: boolean;
    downstreamCallsExecuted: number;
    limitations: string[];
  };
  railNeutralProofChain: {
    schemaVersion: "reddi.rail-neutral-proof-chain-fixture.v1";
    cases: PublicProofPageRailNeutralCase[];
    bindingReadyCase: "pay_sh_sandbox_single_charge_binding";
    blockedCases: string[];
  };
  attestationDraft: {
    status: "draft_only";
    attestorProfileId: string;
    result: "not_submitted";
    evidenceRef?: string;
  };
  reputationDraft: {
    status: "draft_only";
    profileId: string;
    mutationAllowed: false;
    commitTx: null;
    revealTx: null;
  };
  sourceListingRefs: {
    dryRunPlan: {
      orchestratorProfileId: string;
      downstreamProfileIds: string[];
      downstreamCallsExecuted: 0;
    };
    fixtureSourceRefs: string[];
    listingRefs: string[];
  };
  copyBoundaries: string[];
  boundaryFlags: PublicProofPageBoundaryFlags;
};

const GENERATED_AT = "2026-06-22T12:45:00.000Z";

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

export function getPublicProofPageData(scenarioId: EconomicDemoScenarioId = "webpage"): PublicProofPageData {
  const scenario = economicDemoScenarios.find((candidate) => candidate.id === scenarioId);
  if (!scenario) throw new Error(`unknown_public_proof_scenario:${scenarioId}`);

  const dryRunPlan = buildEconomicDemoDryRunPlan(scenarioId);
  const workflowEvidence = getStaticWebpageLiveWorkflowEvidence();
  const cases = Object.values(railNeutralProofChainFixtures).map(toPublicRailNeutralCase);
  const bindingReady = cases.find((item) => item.status === "binding_ready");
  if (!bindingReady) throw new Error("missing_binding_ready_rail_neutral_fixture");

  return {
    schemaVersion: PUBLIC_PROOF_PAGE_DATA_SCHEMA_VERSION,
    generatedAt: GENERATED_AT,
    scenarioId,
    stateLabels: [
      "fixture_zero_spend",
      "planned_dry_run",
      "simulated",
      "devnet_proof_metadata",
      "live_gated",
      "production_live_disabled",
    ],
    quote: scenario.quote,
    policyDecision: {
      status: "allowed_fixture_only",
      reasonCodes: ["allowed", "fixture_only", "no_live_payment"],
      auditNotes: ["Public proof page data is deterministic and read-only."],
    },
    auddPaymentPlanPreflight: {
      status: "allowed_fixture_only",
      paymentMode: "dry-run",
      evidenceRequired: true,
      failurePolicy: "no_charge_on_failure",
      refundPolicy: "manual_review_fixture_only",
    },
    publicWorkflowEvidence: {
      schemaVersion: workflowEvidence.schemaVersion,
      sourceArtifactPath: workflowEvidence.sourceArtifactPath,
      disclosureLedgerEvidenceComplete: workflowEvidence.disclosureLedgerSummary.evidenceComplete,
      downstreamCallsExecuted: workflowEvidence.downstreamCallsExecuted,
      limitations: workflowEvidence.limitations,
    },
    railNeutralProofChain: {
      schemaVersion: "reddi.rail-neutral-proof-chain-fixture.v1",
      cases,
      bindingReadyCase: "pay_sh_sandbox_single_charge_binding",
      blockedCases: cases.filter((item) => item.status === "blocked").map((item) => item.case),
    },
    attestationDraft: {
      status: "draft_only",
      attestorProfileId: "verification-validation-agent",
      result: "not_submitted",
      evidenceRef: bindingReady.evidenceArchive?.evidenceRef,
    },
    reputationDraft: {
      status: "draft_only",
      profileId: dryRunPlan.orchestrator.id,
      mutationAllowed: false,
      commitTx: null,
      revealTx: null,
    },
    sourceListingRefs: {
      dryRunPlan: {
        orchestratorProfileId: dryRunPlan.orchestrator.id,
        downstreamProfileIds: dryRunPlan.edges.map((edge) => edge.toProfileId),
        downstreamCallsExecuted: dryRunPlan.downstreamCallsExecuted,
      },
      fixtureSourceRefs: cases.map((item) => item.sourceRef.sourceId),
      listingRefs: ["source-adapter:pay-sh:reddi-x402", "source-adapter:mpp-tempo:probe-only"],
    },
    copyBoundaries: [
      "AUDD payment metadata is fixture/dry-run proof data only.",
      "No AUDD is settled, escrowed, or held in Quasar custody by this public proof contract.",
      "Rail-neutral receipt data is limited to refs, hashes, support states, and claim-boundary labels.",
      "Blocked proof-chain cases fail closed and do not imply settlement, custody, trust, reputation, provider execution, marketplace publication, or live payment.",
    ],
    boundaryFlags: BOUNDARY_FLAGS,
  };
}

function toPublicRailNeutralCase(
  fixture: (typeof railNeutralProofChainFixtures)[keyof typeof railNeutralProofChainFixtures],
): PublicProofPageRailNeutralCase {
  return {
    case: fixture.case,
    status: fixture.status,
    sourceRef: {
      rail: fixture.sourceRef.rail,
      sourceId: fixture.sourceRef.sourceId,
      artifactPath: fixture.sourceRef.artifactPath,
    },
    payment: fixture.railNeutralReceipt
      ? {
          network: fixture.railNeutralReceipt.payment.network,
          asset: fixture.railNeutralReceipt.payment.asset,
          amount: fixture.railNeutralReceipt.payment.amount,
          paymentProofRef: fixture.railNeutralReceipt.payment.paymentProofRef,
        }
      : undefined,
    bindingRefs: fixture.bindingRefs,
    evidenceArchive: fixture.evidence
      ? {
          id: fixture.evidence.id,
          receiptId: fixture.evidence.receiptId,
          sourceId: fixture.evidence.sourceId,
          evidenceRef: fixture.evidence.evidenceRef,
          requestHash: fixture.evidence.requestHash,
          responseHash: fixture.evidence.responseHash,
        }
      : undefined,
    receipt: fixture.redactedReceipt
      ? {
          id: fixture.redactedReceipt.job.id,
          sourceId: fixture.redactedReceipt.source.id,
          attestationStatus: fixture.redactedReceipt.attestationStatus,
          supportState: String(fixture.redactedReceipt.metadata?.supportState ?? "unknown"),
        }
      : undefined,
    blockedBy: fixture.blockedBy ?? [],
    claimBoundaryLabels: fixture.claimBoundaryLabels,
    boundaryFlags: BOUNDARY_FLAGS,
  };
}
