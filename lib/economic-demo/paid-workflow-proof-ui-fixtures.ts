import {
  getPublicProofPageData,
  PUBLIC_PROOF_PAGE_DATA_SCHEMA_VERSION,
  type PublicProofPageData,
  type PublicProofPageRailNeutralCase,
} from "@/lib/economic-demo/public-proof-page-data";

export const PAID_WORKFLOW_PROOF_UI_FIXTURE_PACK_SCHEMA_VERSION =
  "reddi.economic-demo.paid-workflow-proof-ui-fixture-pack.v1" as const;

export type PaidWorkflowProofUiViewport = "mobile" | "tablet" | "desktop";

export type PaidWorkflowProofUiSectionKey =
  | "quote"
  | "budget_ledger"
  | "result"
  | "receipt"
  | "evidence"
  | "attestation_preview"
  | "reputation_preview";

export type PaidWorkflowProofUiCaseStatus = "no_network_no_spend_happy_path" | "blocked";

export type PaidWorkflowProofUiViewportFixture = {
  viewport: PaidWorkflowProofUiViewport;
  width: number;
  height: number;
  density: "single_column" | "split_panels" | "dashboard_grid";
  requiredSections: PaidWorkflowProofUiSectionKey[];
  layoutNotes: string[];
};

export type PaidWorkflowProofUiSectionFixture = {
  key: PaidWorkflowProofUiSectionKey;
  title: string;
  state:
    | "ready"
    | "planned"
    | "draft"
    | "binding_ready"
    | "blocked"
    | "live_gated"
    | "production_live_disabled";
  primaryLabel: string;
  detail: string;
  refs: string[];
};

export type PaidWorkflowProofUiCaseFixture = {
  id: string;
  sourceCase: string;
  status: PaidWorkflowProofUiCaseStatus;
  rail: string;
  supportState: string;
  stateLabels: PublicProofPageData["stateLabels"];
  paymentProofLabel: "refs_hashes_only" | "fail_closed";
  viewports: PaidWorkflowProofUiViewportFixture[];
  sections: PaidWorkflowProofUiSectionFixture[];
  blockedBy: PublicProofPageRailNeutralCase["blockedBy"];
  boundaryLabels: string[];
  boundaryFlags: PublicProofPageData["boundaryFlags"];
};

export type PaidWorkflowProofUiFixturePack = {
  schemaVersion: typeof PAID_WORKFLOW_PROOF_UI_FIXTURE_PACK_SCHEMA_VERSION;
  generatedAt: string;
  consumes: {
    publicProofPageDataSchemaVersion: typeof PUBLIC_PROOF_PAGE_DATA_SCHEMA_VERSION;
    publicProofPageGeneratedAt: string;
  };
  viewports: PaidWorkflowProofUiViewportFixture[];
  cases: PaidWorkflowProofUiCaseFixture[];
  happyPathCaseId: "pay_sh_sandbox_single_charge_binding_ready";
  blockedCaseIds: string[];
  copyBoundaries: string[];
  boundaryFlags: PublicProofPageData["boundaryFlags"];
};

const GENERATED_AT = "2026-06-22T13:20:00.000Z";

const REQUIRED_SECTIONS: PaidWorkflowProofUiSectionKey[] = [
  "quote",
  "budget_ledger",
  "result",
  "receipt",
  "evidence",
  "attestation_preview",
  "reputation_preview",
];

const VIEWPORTS: PaidWorkflowProofUiViewportFixture[] = [
  {
    viewport: "mobile",
    width: 390,
    height: 844,
    density: "single_column",
    requiredSections: REQUIRED_SECTIONS,
    layoutNotes: [
      "Render sections as a stable single-column stack.",
      "Keep quote total, receipt/evidence state, and blocked reason labels visible without horizontal scrolling.",
    ],
  },
  {
    viewport: "tablet",
    width: 820,
    height: 1180,
    density: "split_panels",
    requiredSections: REQUIRED_SECTIONS,
    layoutNotes: [
      "Render quote/budget and receipt/evidence as two readable groups.",
      "Keep attestation and reputation previews visually subordinate to proof state labels.",
    ],
  },
  {
    viewport: "desktop",
    width: 1440,
    height: 960,
    density: "dashboard_grid",
    requiredSections: REQUIRED_SECTIONS,
    layoutNotes: [
      "Render quote, ledger, receipt, evidence, result, attestation, and reputation panels in scan-friendly dashboard groups.",
      "Blocked variants must keep fail-closed reason and no-live-payment boundary labels visible.",
    ],
  },
];

export function getPaidWorkflowProofUiFixturePack(
  publicProofPageData: PublicProofPageData = getPublicProofPageData(),
): PaidWorkflowProofUiFixturePack {
  const cases = publicProofPageData.railNeutralProofChain.cases.map((item) =>
    item.status === "binding_ready"
      ? buildHappyPathCase(publicProofPageData, item)
      : buildBlockedCase(publicProofPageData, item),
  );

  return {
    schemaVersion: PAID_WORKFLOW_PROOF_UI_FIXTURE_PACK_SCHEMA_VERSION,
    generatedAt: GENERATED_AT,
    consumes: {
      publicProofPageDataSchemaVersion: publicProofPageData.schemaVersion,
      publicProofPageGeneratedAt: publicProofPageData.generatedAt,
    },
    viewports: VIEWPORTS,
    cases,
    happyPathCaseId: "pay_sh_sandbox_single_charge_binding_ready",
    blockedCaseIds: cases.filter((item) => item.status === "blocked").map((item) => item.id),
    copyBoundaries: [
      ...publicProofPageData.copyBoundaries,
      "UI fixtures are deterministic no-network/no-spend data for rendering only.",
      "Viewport coverage proves downstream render states exist; it is not visual evidence of a UI implementation.",
    ],
    boundaryFlags: publicProofPageData.boundaryFlags,
  };
}

function buildHappyPathCase(
  publicProofPageData: PublicProofPageData,
  proofCase: PublicProofPageRailNeutralCase,
): PaidWorkflowProofUiCaseFixture {
  return {
    id: "pay_sh_sandbox_single_charge_binding_ready",
    sourceCase: proofCase.case,
    status: "no_network_no_spend_happy_path",
    rail: proofCase.sourceRef.rail,
    supportState: proofCase.receipt?.supportState ?? "receipt_binding_candidate",
    stateLabels: publicProofPageData.stateLabels,
    paymentProofLabel: "refs_hashes_only",
    viewports: VIEWPORTS,
    sections: [
      quoteSection(publicProofPageData),
      budgetLedgerSection(publicProofPageData),
      resultSection(publicProofPageData, "ready", "Ready fixture result"),
      receiptSection(proofCase, "binding_ready", "Receipt binding ready"),
      evidenceSection(proofCase, "ready", "Evidence refs ready"),
      attestationPreviewSection(publicProofPageData),
      reputationPreviewSection(publicProofPageData),
    ],
    blockedBy: [],
    boundaryLabels: proofCase.claimBoundaryLabels,
    boundaryFlags: publicProofPageData.boundaryFlags,
  };
}

function buildBlockedCase(
  publicProofPageData: PublicProofPageData,
  proofCase: PublicProofPageRailNeutralCase,
): PaidWorkflowProofUiCaseFixture {
  const reason = proofCase.blockedBy[0]?.message ?? "Proof-chain fixture failed closed.";

  return {
    id: `${proofCase.case}_blocked`,
    sourceCase: proofCase.case,
    status: "blocked",
    rail: proofCase.sourceRef.rail,
    supportState: "fail_closed",
    stateLabels: publicProofPageData.stateLabels,
    paymentProofLabel: "fail_closed",
    viewports: VIEWPORTS,
    sections: [
      quoteSection(publicProofPageData),
      budgetLedgerSection(publicProofPageData),
      resultSection(publicProofPageData, "blocked", "Blocked before result release"),
      receiptSection(proofCase, "blocked", "Receipt unavailable"),
      evidenceSection(proofCase, "blocked", reason),
      attestationPreviewSection(publicProofPageData),
      reputationPreviewSection(publicProofPageData),
    ],
    blockedBy: proofCase.blockedBy,
    boundaryLabels: proofCase.claimBoundaryLabels,
    boundaryFlags: publicProofPageData.boundaryFlags,
  };
}

function quoteSection(publicProofPageData: PublicProofPageData): PaidWorkflowProofUiSectionFixture {
  return {
    key: "quote",
    title: "Quote",
    state: "ready",
    primaryLabel: `${publicProofPageData.quote.totalUsdc.toFixed(6)} ${publicProofPageData.quote.currency}`,
    detail: `${publicProofPageData.quote.downstreamFeesUsdc.toFixed(2)} downstream + ${publicProofPageData.quote.attestorFeesUsdc.toFixed(2)} attestor + ${publicProofPageData.quote.orchestratorMarkupUsdc.toFixed(2)} markup + ${publicProofPageData.quote.protocolRailFeeBps} bps rail fee.`,
    refs: [publicProofPageData.railNeutralProofChain.bindingReadyCase],
  };
}

function budgetLedgerSection(publicProofPageData: PublicProofPageData): PaidWorkflowProofUiSectionFixture {
  return {
    key: "budget_ledger",
    title: "Budget ledger",
    state: "planned",
    primaryLabel: "Planned dry-run ledger",
    detail: `${publicProofPageData.sourceListingRefs.dryRunPlan.downstreamProfileIds.length} downstream profiles; downstream calls executed: ${publicProofPageData.sourceListingRefs.dryRunPlan.downstreamCallsExecuted}.`,
    refs: publicProofPageData.sourceListingRefs.dryRunPlan.downstreamProfileIds,
  };
}

function resultSection(
  publicProofPageData: PublicProofPageData,
  state: PaidWorkflowProofUiSectionFixture["state"],
  primaryLabel: string,
): PaidWorkflowProofUiSectionFixture {
  return {
    key: "result",
    title: "Result",
    state,
    primaryLabel,
    detail: publicProofPageData.publicWorkflowEvidence.limitations[0] ?? "Fixture result is bounded by public proof data.",
    refs: [publicProofPageData.publicWorkflowEvidence.sourceArtifactPath],
  };
}

function receiptSection(
  proofCase: PublicProofPageRailNeutralCase,
  state: PaidWorkflowProofUiSectionFixture["state"],
  primaryLabel: string,
): PaidWorkflowProofUiSectionFixture {
  return {
    key: "receipt",
    title: "Receipt",
    state,
    primaryLabel,
    detail: proofCase.receipt
      ? `${proofCase.receipt.supportState}; ${proofCase.payment?.asset ?? "unknown asset"} on ${proofCase.payment?.network ?? "unknown network"}.`
      : proofCase.blockedBy[0]?.message ?? "No receipt is available for this fail-closed state.",
    refs: [
      proofCase.receipt?.id,
      proofCase.bindingRefs.paymentProofRef,
      proofCase.bindingRefs.nonceRef,
      proofCase.bindingRefs.recipientRef,
    ].filter((item): item is string => Boolean(item)),
  };
}

function evidenceSection(
  proofCase: PublicProofPageRailNeutralCase,
  state: PaidWorkflowProofUiSectionFixture["state"],
  primaryLabel: string,
): PaidWorkflowProofUiSectionFixture {
  return {
    key: "evidence",
    title: "Evidence",
    state,
    primaryLabel,
    detail: proofCase.evidenceArchive
      ? "EvidenceArchive refs are available without raw prompt, output, credential, provider, wallet, or RPC material."
      : "EvidenceArchive binding is withheld because the proof-chain case failed closed.",
    refs: [
      proofCase.evidenceArchive?.id,
      proofCase.evidenceArchive?.evidenceRef,
      proofCase.evidenceArchive?.requestHash,
      proofCase.evidenceArchive?.responseHash,
    ].filter((item): item is string => Boolean(item)),
  };
}

function attestationPreviewSection(publicProofPageData: PublicProofPageData): PaidWorkflowProofUiSectionFixture {
  return {
    key: "attestation_preview",
    title: "Attestation preview",
    state: "draft",
    primaryLabel: "Draft only",
    detail: `${publicProofPageData.attestationDraft.attestorProfileId} has not submitted an attestation.`,
    refs: [publicProofPageData.attestationDraft.evidenceRef].filter((item): item is string => Boolean(item)),
  };
}

function reputationPreviewSection(publicProofPageData: PublicProofPageData): PaidWorkflowProofUiSectionFixture {
  return {
    key: "reputation_preview",
    title: "Reputation preview",
    state: "draft",
    primaryLabel: "No mutation",
    detail: `${publicProofPageData.reputationDraft.profileId} reputation mutation is disabled for this fixture pack.`,
    refs: [],
  };
}
