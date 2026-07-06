import {
  AIRWALLEX_HOSTED_CHECKOUT_RAIL_SCHEMA_VERSION,
  AIRWALLEX_RAIL_SUPPORT_STATE_MATRIX,
  type AirwallexRailSupportStateRow,
} from "../../packages/agent-protocol/dist/airwallex-hosted-checkout-rail.js";
import {
  getPaidWorkflowProofUiFixturePack,
  PAID_WORKFLOW_PROOF_UI_FIXTURE_PACK_SCHEMA_VERSION,
  type PaidWorkflowProofUiCaseFixture,
  type PaidWorkflowProofUiFixturePack,
} from "@/lib/economic-demo/paid-workflow-proof-ui-fixtures";
import type { PublicProofPageBoundaryFlags } from "@/lib/economic-demo/public-proof-page-data";
import {
  assertX402ReferenceWorkflowRehearsalStaysDryRun,
  buildX402ReferenceWorkflowRehearsal,
  X402_REFERENCE_WORKFLOW_REHEARSAL_SCHEMA_VERSION,
  type X402ReferenceWorkflowRehearsal,
} from "@/lib/economic-demo/x402-reference-workflow-rehearsal";

/**
 * Buyer paid-workflow route model (#498).
 *
 * Thin adapter over the completed no-spend surfaces named by the #497 state
 * contract (docs/PAID-WORKFLOW-ROUTE-STATE-CONTRACT.md). It maps existing
 * contracts onto the #497 route states and fails closed on any input it does
 * not recognize. It invents no proof shape and performs no network, wallet,
 * RPC, provider, Pay.sh, hosted-registry, publication, or trust/reputation
 * action.
 */

export const BUYER_PAID_WORKFLOW_ROUTE_MODEL_SCHEMA_VERSION =
  "reddi.economic-demo.buyer-paid-workflow-route-model.v1" as const;

/** Route states defined by the #497 contract. */
export const PAID_WORKFLOW_ROUTE_STATES = [
  "quote_ready",
  "budget_ledger_ready",
  "execution_timeline_ready",
  "result_ready",
  "receipt_binding_ready",
  "evidence_refs_ready",
  "attestation_preview_only",
  "reputation_preview_only",
  "blocked_fail_closed",
  "live_gated_only",
  "production_disabled",
] as const;

export type PaidWorkflowRouteState = (typeof PAID_WORKFLOW_ROUTE_STATES)[number];

export type BuyerPaidWorkflowCopyModeId =
  | "fixture_zero_spend"
  | "planned_dry_run"
  | "simulated"
  | "devnet_proof_metadata"
  | "live_gated"
  | "production_live_disabled";

export type BuyerPaidWorkflowCopyMode = {
  mode: BuyerPaidWorkflowCopyModeId;
  label: string;
  detail: string;
};

/**
 * UI copy per mode, derived from the #497 copy boundary matrix and
 * docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md (the repo-wide copy authority:
 * the fail-closed reading wins).
 */
export const BUYER_PAID_WORKFLOW_COPY_MODES: BuyerPaidWorkflowCopyMode[] = [
  {
    mode: "fixture_zero_spend",
    label: "No-spend fixture",
    detail: "Deterministic fixture data. No network, no spend, nothing paid, settled, executed live, custody-backed, published, or trusted.",
  },
  {
    mode: "planned_dry_run",
    label: "Dry run (planned only)",
    detail: "Planned quote, policy, ledger, and proof refs. No wallet signed, no provider called, no RPC verified, no funds moved.",
  },
  {
    mode: "simulated",
    label: "Simulated preview",
    detail: "Simulated result or preview state only. Not a production result and not a verified live service response.",
  },
  {
    mode: "devnet_proof_metadata",
    label: "Recorded devnet metadata",
    detail: "Recorded devnet proof metadata; an optional fresh-devnet gate exists. No mainnet settlement, production activation, or default USDC auto-pay.",
  },
  {
    mode: "live_gated",
    label: "Live-gated (approval required)",
    detail: "A fresh paid run needs an explicit operator approval record, cap, endpoint, payer, payee, command, evidence path, rollback owner, and expiry. No approval is granted here and no route can spend.",
  },
  {
    mode: "production_live_disabled",
    label: "Production disabled",
    detail: "Production live payment is disabled by default. No Pay.sh production activation, no production AUDD rail, no hosted registry write.",
  },
];

export type BuyerPaidWorkflowBlockedKind =
  | "unsupported_rail_network"
  | "malformed_receipt"
  | "policy_denied"
  | "probe_only_receipt_cap"
  | "live_path_overclaim"
  | "fail_closed_other";

export type BuyerPaidWorkflowBlockedCase = {
  state: "blocked_fail_closed";
  id: string;
  sourceCase: string;
  kind: BuyerPaidWorkflowBlockedKind;
  kindLabel: string;
  rail: string;
  supportState: string;
  blockedBy: PaidWorkflowProofUiCaseFixture["blockedBy"];
  boundaryLabels: string[];
};

export type BuyerPaidWorkflowSection = {
  state: PaidWorkflowRouteState;
  title: string;
  primaryLabel: string;
  detail: string;
  refs: string[];
};

export type BuyerPaidWorkflowRouteModelReady = {
  schemaVersion: typeof BUYER_PAID_WORKFLOW_ROUTE_MODEL_SCHEMA_VERSION;
  status: "ready";
  consumes: {
    fixturePackSchemaVersion: typeof PAID_WORKFLOW_PROOF_UI_FIXTURE_PACK_SCHEMA_VERSION;
    publicProofPageDataSchemaVersion: string;
    rehearsalSchemaVersion: typeof X402_REFERENCE_WORKFLOW_REHEARSAL_SCHEMA_VERSION;
    railSupportMatrixSchemaVersion: typeof AIRWALLEX_HOSTED_CHECKOUT_RAIL_SCHEMA_VERSION;
  };
  copyModes: BuyerPaidWorkflowCopyMode[];
  quote: BuyerPaidWorkflowSection & {
    totalUsdc: number;
    currency: string;
    lines: Array<{ label: string; value: string }>;
  };
  budget: BuyerPaidWorkflowSection & {
    downstreamProfileIds: string[];
    downstreamCallsExecuted: number;
  };
  executionTimeline: {
    state: "execution_timeline_ready";
    placeholder: true;
    placeholderNote: string;
    pendingIssueRef: "#499";
    milestones: Array<{
      id: string;
      label: string;
      status: "rehearsed_dry_run" | "preview_only";
      refs: string[];
    }>;
  };
  result: BuyerPaidWorkflowSection;
  receipt: BuyerPaidWorkflowSection & { paymentProofLabel: "refs_hashes_only" };
  evidence: BuyerPaidWorkflowSection;
  attestationPreview: BuyerPaidWorkflowSection;
  reputationPreview: BuyerPaidWorkflowSection;
  blockedCases: BuyerPaidWorkflowBlockedCase[];
  unsupportedRail: {
    schemaVersion: typeof AIRWALLEX_HOSTED_CHECKOUT_RAIL_SCHEMA_VERSION;
    draft: boolean;
    rows: Array<{
      supportState: string;
      standard: string;
      description: string;
      claimBoundary: string[];
    }>;
  };
  recordedDevnet: {
    state: "devnet_proof_metadata";
    issueRef: string;
    runbookPath: string;
    mode: X402ReferenceWorkflowRehearsal["mode"];
    steps: Array<{ step: string; summary: string; refs: string[] }>;
    realMetering: X402ReferenceWorkflowRehearsal["metering"]["real"];
  };
  liveGate: {
    state: "live_gated_only";
    requiresOperatorApproval: true;
    operatorApprovalRef: null;
    runbookPath: string;
    armEnvVarNames: string[];
    detail: string;
  };
  productionDisabled: {
    state: "production_disabled";
    detail: string;
  };
  boundaryFlags: PublicProofPageBoundaryFlags;
  copyBoundaries: string[];
  neverClaims: string[];
};

export type BuyerPaidWorkflowRouteModelFailClosed = {
  schemaVersion: typeof BUYER_PAID_WORKFLOW_ROUTE_MODEL_SCHEMA_VERSION;
  status: "fail_closed";
  state: "blocked_fail_closed";
  reasonCode:
    | "empty_fixture_pack"
    | "fixture_pack_schema_mismatch"
    | "missing_happy_path_case"
    | "boundary_flag_drift"
    | "rehearsal_schema_mismatch"
    | "rehearsal_not_dry_run"
    | "unsupported_rail_matrix_missing";
  message: string;
  neverClaims: string[];
};

export type BuyerPaidWorkflowRouteModel =
  | BuyerPaidWorkflowRouteModelReady
  | BuyerPaidWorkflowRouteModelFailClosed;

export type BuyerPaidWorkflowRouteModelInputs = {
  fixturePack?: PaidWorkflowProofUiFixturePack;
  rehearsal?: X402ReferenceWorkflowRehearsal;
  railSupportMatrix?: AirwallexRailSupportStateRow[];
};

const NEVER_CLAIMS = [
  "custody",
  "settlement finality",
  "mainnet settlement",
  "hosted publication",
  "trust or reputation mutation",
  "wallet signing",
  "RPC or provider calls",
  "paid requests or Pay.sh activation",
] as const;

const BLOCKED_KIND_BY_SOURCE_CASE: Record<string, { kind: BuyerPaidWorkflowBlockedKind; label: string }> = {
  mpp_tempo_unsupported_network: {
    kind: "unsupported_rail_network",
    label: "Unsupported rail/network",
  },
  unsupported_asset_network: {
    kind: "unsupported_rail_network",
    label: "Unsupported asset/network",
  },
  malformed_receipt: {
    kind: "malformed_receipt",
    label: "Malformed receipt",
  },
  policy_denied: {
    kind: "policy_denied",
    label: "Policy denied",
  },
  airwallex_webhook_probe_only_cap: {
    kind: "probe_only_receipt_cap",
    label: "Probe-only receipt cap",
  },
  live_path_overclaim: {
    kind: "live_path_overclaim",
    label: "Live-path overclaim",
  },
};

function failClosed(
  reasonCode: BuyerPaidWorkflowRouteModelFailClosed["reasonCode"],
  message: string,
): BuyerPaidWorkflowRouteModelFailClosed {
  return {
    schemaVersion: BUYER_PAID_WORKFLOW_ROUTE_MODEL_SCHEMA_VERSION,
    status: "fail_closed",
    state: "blocked_fail_closed",
    reasonCode,
    message,
    neverClaims: [...NEVER_CLAIMS],
  };
}

function hasTrueBoundaryFlag(flags: Record<string, unknown> | undefined): boolean {
  if (!flags) return true;
  return Object.values(flags).some((value) => value !== false);
}

function toBlockedCase(item: PaidWorkflowProofUiCaseFixture): BuyerPaidWorkflowBlockedCase {
  const mapped = BLOCKED_KIND_BY_SOURCE_CASE[item.sourceCase] ?? {
    kind: "fail_closed_other" as const,
    label: "Fail-closed proof-chain case",
  };
  return {
    state: "blocked_fail_closed",
    id: item.id,
    sourceCase: item.sourceCase,
    kind: mapped.kind,
    kindLabel: mapped.label,
    rail: item.rail,
    supportState: item.supportState,
    blockedBy: item.blockedBy,
    boundaryLabels: item.boundaryLabels,
  };
}

export function buildBuyerPaidWorkflowRouteModel(
  inputs: BuyerPaidWorkflowRouteModelInputs = {},
): BuyerPaidWorkflowRouteModel {
  const fixturePack = inputs.fixturePack ?? getPaidWorkflowProofUiFixturePack();

  if (fixturePack?.schemaVersion !== PAID_WORKFLOW_PROOF_UI_FIXTURE_PACK_SCHEMA_VERSION) {
    return failClosed(
      "fixture_pack_schema_mismatch",
      "The paid-workflow fixture pack schema is not the pinned #457 contract version; nothing is rendered.",
    );
  }
  if (!Array.isArray(fixturePack.cases) || fixturePack.cases.length === 0) {
    return failClosed(
      "empty_fixture_pack",
      "The paid-workflow fixture pack contains no proof-chain cases; the buyer route renders no quote, ledger, result, receipt, or evidence.",
    );
  }

  const happyPath = fixturePack.cases.find(
    (item) => item.id === fixturePack.happyPathCaseId && item.status === "no_network_no_spend_happy_path",
  );
  if (!happyPath) {
    return failClosed(
      "missing_happy_path_case",
      "No no-network/no-spend happy-path proof-chain case is present; the buyer route fails closed.",
    );
  }

  if (
    hasTrueBoundaryFlag(fixturePack.boundaryFlags as Record<string, unknown>) ||
    fixturePack.cases.some((item) => hasTrueBoundaryFlag(item.boundaryFlags as Record<string, unknown>))
  ) {
    return failClosed(
      "boundary_flag_drift",
      "A boundary flag is not false. The #497 contract keeps every live/spend/mutation flag false; the buyer route fails closed instead of rendering drifted data.",
    );
  }

  let rehearsal: X402ReferenceWorkflowRehearsal;
  try {
    rehearsal = inputs.rehearsal ?? buildX402ReferenceWorkflowRehearsal();
    if (rehearsal.schemaVersion !== X402_REFERENCE_WORKFLOW_REHEARSAL_SCHEMA_VERSION) {
      return failClosed(
        "rehearsal_schema_mismatch",
        "The recorded-devnet rehearsal schema is not the pinned #564 contract version; recorded-devnet metadata is withheld.",
      );
    }
    assertX402ReferenceWorkflowRehearsalStaysDryRun(rehearsal);
  } catch {
    return failClosed(
      "rehearsal_not_dry_run",
      "The recorded-devnet rehearsal failed its dry-run assertions; the buyer route fails closed rather than rendering live-looking data.",
    );
  }

  const railSupportMatrix = inputs.railSupportMatrix ?? AIRWALLEX_RAIL_SUPPORT_STATE_MATRIX;
  const unsupportedRailRows = (railSupportMatrix ?? []).filter(
    (row) =>
      row.supportState === "unsupported_live_airwallex_settlement" ||
      row.supportState === "airwallex_webhook_receipt_probe_only",
  );
  if (unsupportedRailRows.length === 0) {
    return failClosed(
      "unsupported_rail_matrix_missing",
      "The second-rail support-state matrix has no unsupported/probe-only rows; the unsupported-rail boundary state cannot be rendered honestly.",
    );
  }

  const sectionByKey = (key: PaidWorkflowProofUiCaseFixture["sections"][number]["key"]) =>
    happyPath.sections.find((section) => section.key === key);

  const quoteSection = sectionByKey("quote");
  const budgetSection = sectionByKey("budget_ledger");
  const resultSection = sectionByKey("result");
  const receiptSection = sectionByKey("receipt");
  const evidenceSection = sectionByKey("evidence");
  const attestationSection = sectionByKey("attestation_preview");
  const reputationSection = sectionByKey("reputation_preview");
  if (
    !quoteSection ||
    !budgetSection ||
    !resultSection ||
    !receiptSection ||
    !evidenceSection ||
    !attestationSection ||
    !reputationSection
  ) {
    return failClosed(
      "missing_happy_path_case",
      "The happy-path case is missing one or more required sections; the buyer route fails closed.",
    );
  }

  const quote = rehearsal.quote;
  const blockedCases = fixturePack.cases.filter((item) => item.status === "blocked").map(toBlockedCase);

  return {
    schemaVersion: BUYER_PAID_WORKFLOW_ROUTE_MODEL_SCHEMA_VERSION,
    status: "ready",
    consumes: {
      fixturePackSchemaVersion: fixturePack.schemaVersion,
      publicProofPageDataSchemaVersion: fixturePack.consumes.publicProofPageDataSchemaVersion,
      rehearsalSchemaVersion: rehearsal.schemaVersion,
      railSupportMatrixSchemaVersion: AIRWALLEX_HOSTED_CHECKOUT_RAIL_SCHEMA_VERSION,
    },
    copyModes: BUYER_PAID_WORKFLOW_COPY_MODES,
    quote: {
      state: "quote_ready",
      title: "Quote",
      primaryLabel: quoteSection.primaryLabel,
      detail: quoteSection.detail,
      refs: quoteSection.refs,
      totalUsdc: quote.totalUsdc,
      currency: quote.currency,
      lines: [
        { label: "Downstream fees", value: `${quote.downstreamFeesUsdc.toFixed(2)} ${quote.currency}` },
        { label: "Attestor fees", value: `${quote.attestorFeesUsdc.toFixed(2)} ${quote.currency}` },
        { label: "Orchestrator markup", value: `${quote.orchestratorMarkupUsdc.toFixed(2)} ${quote.currency}` },
        { label: "Protocol rail fee", value: `${quote.protocolRailFeeBps} bps (${quote.protocolRailFeesUsdc.toFixed(6)} ${quote.currency})` },
        { label: "Swap allowance", value: `${quote.jupiterSwapAllowanceUsdc.toFixed(2)} ${quote.currency}` },
      ],
    },
    budget: {
      state: "budget_ledger_ready",
      title: "Budget summary",
      primaryLabel: budgetSection.primaryLabel,
      detail: budgetSection.detail,
      refs: budgetSection.refs,
      downstreamProfileIds: [...rehearsal.discovery.downstream.map((edge) => edge.profileId)],
      downstreamCallsExecuted: rehearsal.metering.real.downstreamCallsExecuted,
    },
    executionTimeline: {
      state: "execution_timeline_ready",
      placeholder: true,
      placeholderNote:
        "Placeholder shell. Detailed ledger rows and per-milestone timeline polish land with #499; this section only mirrors the #497 milestone list from already-rehearsed dry-run steps.",
      pendingIssueRef: "#499",
      milestones: [
        ...rehearsal.steps.map((step) => ({
          id: step.step,
          label: step.step.replaceAll("_", " "),
          status: "rehearsed_dry_run" as const,
          refs: step.refs,
        })),
        { id: "attestation_preview", label: "attestation preview", status: "preview_only" as const, refs: [] },
        { id: "reputation_preview", label: "reputation preview", status: "preview_only" as const, refs: [] },
      ],
    },
    result: {
      state: "result_ready",
      title: "Result summary",
      primaryLabel: resultSection.primaryLabel,
      detail: resultSection.detail,
      refs: resultSection.refs,
    },
    receipt: {
      state: "receipt_binding_ready",
      title: "Receipt / proof summary",
      primaryLabel: receiptSection.primaryLabel,
      detail: receiptSection.detail,
      refs: receiptSection.refs,
      paymentProofLabel: "refs_hashes_only",
    },
    evidence: {
      state: "evidence_refs_ready",
      title: "Evidence",
      primaryLabel: evidenceSection.primaryLabel,
      detail: evidenceSection.detail,
      refs: evidenceSection.refs,
    },
    attestationPreview: {
      state: "attestation_preview_only",
      title: "Attestation preview",
      primaryLabel: attestationSection.primaryLabel,
      detail: attestationSection.detail,
      refs: attestationSection.refs,
    },
    reputationPreview: {
      state: "reputation_preview_only",
      title: "Reputation preview",
      primaryLabel: reputationSection.primaryLabel,
      detail: reputationSection.detail,
      refs: reputationSection.refs,
    },
    blockedCases,
    unsupportedRail: {
      schemaVersion: AIRWALLEX_HOSTED_CHECKOUT_RAIL_SCHEMA_VERSION,
      draft: true,
      rows: unsupportedRailRows.map((row) => ({
        supportState: row.supportState,
        standard: row.standard,
        description: row.description,
        claimBoundary: [...row.claimBoundary],
      })),
    },
    recordedDevnet: {
      state: "devnet_proof_metadata",
      issueRef: rehearsal.issueRef,
      runbookPath: rehearsal.liveGate.runbookPath,
      mode: rehearsal.mode,
      steps: rehearsal.steps.map((step) => ({ step: step.step, summary: step.summary, refs: step.refs })),
      realMetering: rehearsal.metering.real,
    },
    liveGate: {
      state: "live_gated_only",
      requiresOperatorApproval: true,
      operatorApprovalRef: null,
      runbookPath: rehearsal.liveGate.runbookPath,
      armEnvVarNames: [...rehearsal.liveGate.armEnvVarNames],
      detail:
        "Optional fresh-devnet run exists only as policy. It requires an explicit operator approval record and the documented arm/confirm gates; this page exposes no run button and no auto-pay path.",
    },
    productionDisabled: {
      state: "production_disabled",
      detail:
        "Production live payment and settlement stay disabled. No Pay.sh production activation, no production AUDD rail, no hosted registry write, no default USDC auto-pay.",
    },
    boundaryFlags: fixturePack.boundaryFlags,
    copyBoundaries: fixturePack.copyBoundaries,
    neverClaims: [...NEVER_CLAIMS],
  };
}
