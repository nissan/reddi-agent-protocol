import {
  AIRWALLEX_HOSTED_CHECKOUT_RAIL_SCHEMA_VERSION,
  AIRWALLEX_RAIL_SUPPORT_STATE_MATRIX,
  type AirwallexRailSupportStateRow,
} from "../../packages/agent-protocol/dist/airwallex-hosted-checkout-rail.js";
import {
  economicDemoScenarios,
  type BudgetLedgerEntry,
  type EconomicDemoQuote,
} from "@/lib/economic-demo/fixture";
import { buildEconomicDemoLedgerReconciliation } from "@/lib/economic-demo/ledger-reconciliation";
import {
  getPaidWorkflowProofUiFixturePack,
  PAID_WORKFLOW_PROOF_UI_FIXTURE_PACK_SCHEMA_VERSION,
  type PaidWorkflowProofUiCaseFixture,
  type PaidWorkflowProofUiFixturePack,
} from "@/lib/economic-demo/paid-workflow-proof-ui-fixtures";
import type {
  PublicProofPageBoundaryFlags,
  PublicProofPageStateLabel,
} from "@/lib/economic-demo/public-proof-page-data";
import {
  assertX402ReferenceWorkflowRehearsalStaysDryRun,
  buildX402ReferenceWorkflowRehearsal,
  X402_REFERENCE_WORKFLOW_REHEARSAL_SCHEMA_VERSION,
  type X402ReferenceWorkflowRehearsal,
} from "@/lib/economic-demo/x402-reference-workflow-rehearsal";

/**
 * Buyer paid-workflow route model (#498, extended by #499 with the paid
 * workflow ledger and execution timeline evidence states).
 *
 * Thin adapter over the completed no-spend surfaces named by the #497 state
 * contract (docs/PAID-WORKFLOW-ROUTE-STATE-CONTRACT.md). It maps existing
 * contracts onto the #497 route states and fails closed on any input it does
 * not recognize. It invents no proof shape and performs no network, wallet,
 * RPC, provider, Pay.sh, hosted-registry, publication, or trust/reputation
 * action.
 *
 * #499 additions stay inside the same rule set: every ledger row and timeline
 * milestone is traceable to a fixture/read-model ref or explicitly marked
 * unavailable/blocked, and untraceable rows fail the whole model closed.
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

/**
 * Spend/mutation state carried by every fail-closed case (#499). Unsupported,
 * malformed, policy-denied, probe-only, and live-path-overclaim cases all keep
 * these at zero/false — a blocked case can never report spend or mutation.
 */
export type BuyerPaidWorkflowBlockedSpendState = {
  spentUsdc: "0";
  refundsIssued: 0;
  spendingAllowed: false;
  mutationAllowed: false;
  boundaryFlagsAllFalse: boolean;
};

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
  spendState: BuyerPaidWorkflowBlockedSpendState;
};

/** Ledger row categories required by the #499 acceptance criteria. */
export type BuyerPaidWorkflowLedgerRowCategory =
  | "buyer_budget"
  | "specialist_cost"
  | "attestor_proof_cost"
  | "orchestrator_fee_margin"
  | "protocol_rail_fee"
  | "swap_allowance"
  | "spent_to_date"
  | "remaining"
  | "refund_state"
  | "settlement_cost"
  | "blocked_spend";

export type BuyerPaidWorkflowLedgerRowState =
  | "planned_unspent"
  | "unspent_zero"
  | "remaining_full_budget"
  | "refund_policy_fixture_only"
  | "unavailable_not_implemented"
  | "blocked_fail_closed";

export type BuyerPaidWorkflowLedgerRow = {
  id: string;
  category: BuyerPaidWorkflowLedgerRowCategory;
  label: string;
  /** Payer -> payee for allocation rows; null for status-only rows. */
  party: string | null;
  /** Formatted USDC amount; null when the value is unavailable/blocked. */
  amountUsdc: string | null;
  state: BuyerPaidWorkflowLedgerRowState;
  detail: string;
  /**
   * Fixture/read-model refs. A row with no refs MUST be marked unavailable or
   * blocked; the builder fails closed otherwise.
   */
  refs: string[];
  availability: "available" | "unavailable" | "blocked";
};

export type BuyerPaidWorkflowLedger = {
  state: "budget_ledger_ready";
  currency: EconomicDemoQuote["currency"];
  buyerBudgetUsdc: string;
  allocatedUsdc: string;
  /** Authoritative zero from the rehearsal's real metering. */
  spentUsdc: "0";
  remainingIfUnspentUsdc: string;
  refundState: {
    failurePolicy: string;
    refundPolicy: string;
    refundsIssued: 0;
  };
  /** True when planned allocations reconcile exactly to the buyer budget. */
  reconciled: true;
  rows: BuyerPaidWorkflowLedgerRow[];
};

/** Timeline milestones required by the #499 acceptance criteria, in order. */
export const PAID_WORKFLOW_TIMELINE_MILESTONE_IDS = [
  "request",
  "quote",
  "policy_decision",
  "execution",
  "result",
  "receipt",
  "evidence",
  "attestation_preview",
  "reputation_preview",
] as const;

export type BuyerPaidWorkflowTimelineMilestoneId =
  (typeof PAID_WORKFLOW_TIMELINE_MILESTONE_IDS)[number];

export type BuyerPaidWorkflowTimelineMilestone = {
  id: BuyerPaidWorkflowTimelineMilestoneId;
  order: number;
  label: string;
  status:
    | "rehearsed_dry_run"
    | "planned_no_live_execution"
    | "fixture_result_only"
    | "binding_refs_only"
    | "preview_only";
  /** #497 copy-mode state label governing what this milestone may claim. */
  stateLabel: PublicProofPageStateLabel;
  summary: string;
  /**
   * Fixture/read-model refs. A milestone with no refs MUST be marked
   * no_public_ref_preview_only; the builder fails closed otherwise.
   */
  refs: string[];
  availability: "available" | "no_public_ref_preview_only";
  /**
   * devnet_proof_metadata label ref: recorded-devnet milestones point at the
   * #582/#564 reference-run runbook. Null for preview-only milestones.
   */
  recordedDevnetRef: string | null;
};

export type BuyerPaidWorkflowExecutionTimeline = {
  state: "execution_timeline_ready";
  sourceRunbookPath: string;
  recordedDevnetIssueRef: string;
  milestones: BuyerPaidWorkflowTimelineMilestone[];
};

/**
 * The four #497 always-false flags that exist only in the contract (the #417
 * fixture-pack flag object carries the other twelve). Together they form the
 * 16-flag hard-boundary grid.
 */
export const PAID_WORKFLOW_CONTRACT_ONLY_BOUNDARY_FLAGS = {
  productionAuddRail: false,
  defaultUsdcAutoPay: false,
  mainnetSettlement: false,
  payShProductionActivation: false,
} as const;

export type BuyerPaidWorkflowHardBoundaryFlags = PublicProofPageBoundaryFlags &
  typeof PAID_WORKFLOW_CONTRACT_ONLY_BOUNDARY_FLAGS;

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
  ledger: BuyerPaidWorkflowLedger;
  executionTimeline: BuyerPaidWorkflowExecutionTimeline;
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
  /** 16-flag #497 grid: 12 fixture-pack flags + 4 contract-only flags. */
  hardBoundaryFlags: BuyerPaidWorkflowHardBoundaryFlags;
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
    | "unsupported_rail_matrix_missing"
    | "budget_ledger_source_missing"
    | "ledger_allocation_mismatch"
    | "ledger_row_untraceable"
    | "timeline_milestone_missing"
    | "timeline_milestone_untraceable";
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
    spendState: {
      spentUsdc: "0",
      refundsIssued: 0,
      spendingAllowed: false,
      mutationAllowed: false,
      boundaryFlagsAllFalse: !hasTrueBoundaryFlag(item.boundaryFlags as Record<string, unknown>),
    },
  };
}

function usdcToMicro(amount: number): number {
  return Math.round(amount * 1_000_000);
}

function microToUsdc(micro: number): string {
  const whole = Math.floor(micro / 1_000_000);
  const fraction = String(micro % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

export type BuyerPaidWorkflowLedgerAllocationCheck = {
  reconciled: boolean;
  buyerBudgetMicroUsdc: number;
  allocatedMicroUsdc: number;
  quoteTotalMicroUsdc: number;
};

/**
 * Planned allocations (downstream + attestation + protocol fee + markup +
 * swap allowance) must reconcile exactly to the single buyer-funding entry
 * and to the quoted total. Integer micro-USDC math avoids float drift.
 */
export function reconcileBuyerPaidWorkflowLedgerAllocation(
  entries: BudgetLedgerEntry[],
  quote: EconomicDemoQuote,
): BuyerPaidWorkflowLedgerAllocationCheck {
  const funding = entries.filter((entry) => entry.category === "user-funding");
  const allocations = entries.filter(
    (entry) => entry.category !== "user-funding" && entry.category !== "refund",
  );
  const buyerBudgetMicroUsdc = funding.reduce((sum, entry) => sum + usdcToMicro(entry.amountUsdc), 0);
  const allocatedMicroUsdc = allocations.reduce((sum, entry) => sum + usdcToMicro(entry.amountUsdc), 0);
  const quoteTotalMicroUsdc = usdcToMicro(quote.totalUsdc);
  return {
    reconciled:
      funding.length === 1 &&
      buyerBudgetMicroUsdc === allocatedMicroUsdc &&
      buyerBudgetMicroUsdc === quoteTotalMicroUsdc,
    buyerBudgetMicroUsdc,
    allocatedMicroUsdc,
    quoteTotalMicroUsdc,
  };
}

function ledgerRowIsTraceable(row: BuyerPaidWorkflowLedgerRow): boolean {
  return row.refs.length > 0 || row.availability !== "available";
}

function timelineMilestoneIsTraceable(milestone: BuyerPaidWorkflowTimelineMilestone): boolean {
  return milestone.refs.length > 0 || milestone.availability === "no_public_ref_preview_only";
}

function buildLedger(
  rehearsal: X402ReferenceWorkflowRehearsal,
  blockedCases: BuyerPaidWorkflowBlockedCase[],
): BuyerPaidWorkflowLedger | BuyerPaidWorkflowRouteModelFailClosed {
  const scenario = economicDemoScenarios.find((candidate) => candidate.id === rehearsal.scenarioId);
  if (!scenario || !Array.isArray(scenario.budgetLedger) || scenario.budgetLedger.length === 0) {
    return failClosed(
      "budget_ledger_source_missing",
      "No fixture budget ledger exists for the rehearsal scenario; ledger rows are withheld instead of invented.",
    );
  }

  const entries = scenario.budgetLedger;
  const funding = entries.find((entry) => entry.category === "user-funding");
  const downstream = entries.filter((entry) => entry.category === "downstream");
  const attestation = entries.filter((entry) => entry.category === "attestation");
  const protocolFee = entries.filter((entry) => entry.category === "protocol-fee");
  const markup = entries.filter((entry) => entry.category === "markup");
  const swap = entries.filter((entry) => entry.category === "swap");
  if (!funding || downstream.length === 0 || attestation.length === 0 || protocolFee.length === 0 || markup.length === 0) {
    return failClosed(
      "budget_ledger_source_missing",
      "The fixture budget ledger is missing buyer funding, specialist, attestor, protocol-fee, or markup entries; the ledger fails closed.",
    );
  }

  const quote = rehearsal.quote;
  const check = reconcileBuyerPaidWorkflowLedgerAllocation(entries, quote);
  if (!check.reconciled) {
    return failClosed(
      "ledger_allocation_mismatch",
      "Planned fixture allocations do not reconcile to the buyer budget and quoted total; the ledger fails closed instead of rendering numbers that do not add up.",
    );
  }

  const preflight = rehearsal.policyPreflight.auddPaymentPlanPreflight;
  const reconciliation = buildEconomicDemoLedgerReconciliation();
  const verifierLayer = reconciliation.proofLayers.find(
    (layer) => layer.id === "real_devnet_receipt_verifier",
  );
  const endpointByProfileId = new Map(
    rehearsal.discovery.downstream.map((edge) => [edge.profileId, edge.endpoint]),
  );
  const scenarioRef = `fixture:economic-demo.${scenario.id}.budget_ledger`;
  const buyerBudgetUsdc = microToUsdc(check.buyerBudgetMicroUsdc);

  const rows: BuyerPaidWorkflowLedgerRow[] = [
    {
      id: "buyer_budget",
      category: "buyer_budget",
      label: funding.label,
      party: `${funding.from} -> ${funding.to}`,
      amountUsdc: buyerBudgetUsdc,
      state: "planned_unspent",
      detail: "Buyer budget equals the deterministic quote total. Planned fixture funding only; nothing is signed, paid, or settled.",
      refs: [`${scenarioRef}.user-funding`, `quote_total_usdc:${quote.totalUsdc}`],
      availability: "available",
    },
    ...downstream.map(
      (entry, index): BuyerPaidWorkflowLedgerRow => ({
        id: `specialist_cost_${entry.to.replaceAll("-", "_")}`,
        category: "specialist_cost",
        label: entry.label,
        party: `${entry.from} -> ${entry.to}`,
        amountUsdc: microToUsdc(usdcToMicro(entry.amountUsdc)),
        state: "planned_unspent",
        detail: "Reserved specialist budget from the fixture ledger; zero downstream calls executed.",
        refs: [
          `${scenarioRef}.downstream[${index}]`,
          `profile:${entry.to}`,
          ...(endpointByProfileId.has(entry.to) ? [`endpoint:${endpointByProfileId.get(entry.to)}`] : []),
        ],
        availability: "available",
      }),
    ),
    ...attestation.map(
      (entry, index): BuyerPaidWorkflowLedgerRow => ({
        id: `attestor_proof_cost_${index}`,
        category: "attestor_proof_cost",
        label: entry.label,
        party: `${entry.from} -> ${entry.to}`,
        amountUsdc: microToUsdc(usdcToMicro(entry.amountUsdc)),
        state: "planned_unspent",
        detail: "Reserved attestor/proof budget; the attestation itself stays a draft preview with no submission.",
        refs: [`${scenarioRef}.attestation[${index}]`, `attestor_fees_usdc:${quote.attestorFeesUsdc}`],
        availability: "available",
      }),
    ),
    ...markup.map(
      (entry, index): BuyerPaidWorkflowLedgerRow => ({
        id: `orchestrator_fee_margin_${index}`,
        category: "orchestrator_fee_margin",
        label: entry.label,
        party: `${entry.from} -> ${entry.to}`,
        amountUsdc: microToUsdc(usdcToMicro(entry.amountUsdc)),
        state: "planned_unspent",
        detail: "Orchestrator fee/margin retained in the plan; collected nowhere because nothing executes.",
        refs: [`${scenarioRef}.markup[${index}]`, `orchestrator_markup_usdc:${quote.orchestratorMarkupUsdc}`],
        availability: "available",
      }),
    ),
    ...protocolFee.map(
      (entry, index): BuyerPaidWorkflowLedgerRow => ({
        id: `protocol_rail_fee_${index}`,
        category: "protocol_rail_fee",
        label: entry.label,
        party: `${entry.from} -> ${entry.to}`,
        amountUsdc: microToUsdc(usdcToMicro(entry.amountUsdc)),
        state: "planned_unspent",
        detail: `Planned ${quote.protocolRailFeeBps} bps protocol rail fee; zero fees collected (real metering).`,
        refs: [
          `${scenarioRef}.protocol-fee[${index}]`,
          `rail_fee_bps:${quote.protocolRailFeeBps}`,
          `rehearsal:metering.real.protocolRailFeesCollectedUsdc:${rehearsal.metering.real.protocolRailFeesCollectedUsdc}`,
        ],
        availability: "available",
      }),
    ),
    ...swap.map(
      (entry, index): BuyerPaidWorkflowLedgerRow => ({
        id: `swap_allowance_${index}`,
        category: "swap_allowance",
        label: entry.label,
        party: `${entry.from} -> ${entry.to}`,
        amountUsdc: microToUsdc(usdcToMicro(entry.amountUsdc)),
        state: "planned_unspent",
        detail: "SOL-route swap/slippage allowance inside the quote; no swap route is executed.",
        refs: [`${scenarioRef}.swap[${index}]`, `jupiter_swap_allowance_usdc:${quote.jupiterSwapAllowanceUsdc}`],
        availability: "available",
      }),
    ),
    {
      id: "spent_to_date",
      category: "spent_to_date",
      label: "Spent to date",
      party: null,
      amountUsdc: "0",
      state: "unspent_zero",
      detail: "Authoritative zero from the recorded rehearsal's real metering: no paid requests, no settled USDC.",
      refs: [
        `rehearsal:metering.real.usdcSettled:${rehearsal.metering.real.usdcSettled}`,
        `rehearsal:metering.real.paidRequests:${rehearsal.metering.real.paidRequests}`,
        `rehearsal:metering.real.downstreamCallsExecuted:${rehearsal.metering.real.downstreamCallsExecuted}`,
      ],
      availability: "available",
    },
    {
      id: "remaining",
      category: "remaining",
      label: "Remaining (unspent)",
      party: null,
      amountUsdc: buyerBudgetUsdc,
      state: "remaining_full_budget",
      detail: "The full buyer budget remains: nothing was spent, so remaining equals the quoted total.",
      refs: [`quote_total_usdc:${quote.totalUsdc}`, `rehearsal:metering.real.usdcSettled:${rehearsal.metering.real.usdcSettled}`],
      availability: "available",
    },
    {
      id: "refund_state",
      category: "refund_state",
      label: "Refund state",
      party: null,
      amountUsdc: "0",
      state: "refund_policy_fixture_only",
      detail: `No refund exists because no charge exists. Failure policy: ${preflight.failurePolicy}; refund policy: ${preflight.refundPolicy}.`,
      refs: [
        `preflight:${preflight.status}`,
        `failure_policy:${preflight.failurePolicy}`,
        `refund_policy:${preflight.refundPolicy}`,
      ],
      availability: "available",
    },
    {
      id: "settlement_cost",
      category: "settlement_cost",
      label: "Real settlement cost",
      party: null,
      amountUsdc: null,
      state: "unavailable_not_implemented",
      detail:
        "Unavailable: no real settlement occurred and the production-style devnet receipt verifier is a later phase, so no settlement cost can be reported honestly.",
      refs: verifierLayer ? [`ledger-reconciliation:proof_layer:${verifierLayer.id}:${verifierLayer.status}`] : [],
      availability: "unavailable",
    },
    {
      id: "blocked_spend",
      category: "blocked_spend",
      label: "Blocked cases spend",
      party: null,
      amountUsdc: "0",
      state: "blocked_fail_closed",
      detail: `${blockedCases.length} fail-closed proof-chain cases hold spending and mutation at zero/false.`,
      refs: blockedCases.map((item) => `blocked_case:${item.sourceCase}`),
      availability: "blocked",
    },
  ];

  const untraceable = rows.filter((row) => !ledgerRowIsTraceable(row));
  if (untraceable.length > 0) {
    return failClosed(
      "ledger_row_untraceable",
      `Ledger rows without a fixture/read-model ref or explicit unavailable/blocked marker: ${untraceable.map((row) => row.id).join(", ")}.`,
    );
  }

  return {
    state: "budget_ledger_ready",
    currency: quote.currency,
    buyerBudgetUsdc,
    allocatedUsdc: microToUsdc(check.allocatedMicroUsdc),
    spentUsdc: "0",
    remainingIfUnspentUsdc: buyerBudgetUsdc,
    refundState: {
      failurePolicy: preflight.failurePolicy,
      refundPolicy: preflight.refundPolicy,
      refundsIssued: 0,
    },
    reconciled: true,
    rows,
  };
}

function buildExecutionTimeline(
  rehearsal: X402ReferenceWorkflowRehearsal,
  sections: {
    result: PaidWorkflowProofUiCaseFixture["sections"][number];
    receipt: PaidWorkflowProofUiCaseFixture["sections"][number];
    evidence: PaidWorkflowProofUiCaseFixture["sections"][number];
    attestation: PaidWorkflowProofUiCaseFixture["sections"][number];
    reputation: PaidWorkflowProofUiCaseFixture["sections"][number];
  },
): BuyerPaidWorkflowExecutionTimeline | BuyerPaidWorkflowRouteModelFailClosed {
  const stepById = new Map(rehearsal.steps.map((step) => [step.step, step]));
  const requiredSteps = ["discover", "quote", "policy_preflight", "x402_payment_plan", "receipt", "evidence", "proof_contract_emission"] as const;
  const missing = requiredSteps.filter((step) => !stepById.has(step));
  if (missing.length > 0) {
    return failClosed(
      "timeline_milestone_missing",
      `The recorded rehearsal is missing required workflow steps (${missing.join(", ")}); the execution timeline fails closed.`,
    );
  }

  const runbookRef = `runbook:${rehearsal.liveGate.runbookPath}`;
  const discover = stepById.get("discover")!;
  const quoteStep = stepById.get("quote")!;
  const policy = stepById.get("policy_preflight")!;
  const plan = stepById.get("x402_payment_plan")!;
  const receiptStep = stepById.get("receipt")!;
  const evidenceStep = stepById.get("evidence")!;
  const emission = stepById.get("proof_contract_emission")!;

  const milestones: BuyerPaidWorkflowTimelineMilestone[] = [
    {
      id: "request",
      order: 1,
      label: "Request",
      status: "rehearsed_dry_run",
      stateLabel: "planned_dry_run",
      summary: discover.summary,
      refs: [`scenario:${rehearsal.scenarioId}`, ...discover.refs],
      availability: "available",
      recordedDevnetRef: runbookRef,
    },
    {
      id: "quote",
      order: 2,
      label: "Quote",
      status: "rehearsed_dry_run",
      stateLabel: "planned_dry_run",
      summary: quoteStep.summary,
      refs: quoteStep.refs,
      availability: "available",
      recordedDevnetRef: runbookRef,
    },
    {
      id: "policy_decision",
      order: 3,
      label: "Policy decision",
      status: "rehearsed_dry_run",
      stateLabel: "planned_dry_run",
      summary: policy.summary,
      refs: policy.refs,
      availability: "available",
      recordedDevnetRef: runbookRef,
    },
    {
      id: "execution",
      order: 4,
      label: "Execution",
      status: "planned_no_live_execution",
      stateLabel: "planned_dry_run",
      summary: `${plan.summary} Real execution stays at zero: ${rehearsal.metering.real.downstreamCallsExecuted} downstream calls executed.`,
      refs: [...plan.refs, `rehearsal:metering.real.downstreamCallsExecuted:${rehearsal.metering.real.downstreamCallsExecuted}`],
      availability: "available",
      recordedDevnetRef: runbookRef,
    },
    {
      id: "result",
      order: 5,
      label: "Result",
      status: "fixture_result_only",
      stateLabel: "fixture_zero_spend",
      summary: sections.result.detail,
      refs: sections.result.refs,
      availability: "available",
      recordedDevnetRef: runbookRef,
    },
    {
      id: "receipt",
      order: 6,
      label: "Receipt",
      status: "binding_refs_only",
      stateLabel: "fixture_zero_spend",
      summary: receiptStep.summary,
      refs: [...receiptStep.refs, ...sections.receipt.refs],
      availability: "available",
      recordedDevnetRef: runbookRef,
    },
    {
      id: "evidence",
      order: 7,
      label: "Evidence",
      status: "binding_refs_only",
      stateLabel: "fixture_zero_spend",
      summary: evidenceStep.summary,
      refs: [...evidenceStep.refs, ...emission.refs, ...sections.evidence.refs],
      availability: "available",
      recordedDevnetRef: runbookRef,
    },
    {
      id: "attestation_preview",
      order: 8,
      label: "Attestation preview",
      status: "preview_only",
      stateLabel: "simulated",
      summary: sections.attestation.detail,
      refs: sections.attestation.refs,
      availability: sections.attestation.refs.length > 0 ? "available" : "no_public_ref_preview_only",
      recordedDevnetRef: null,
    },
    {
      id: "reputation_preview",
      order: 9,
      label: "Reputation preview",
      status: "preview_only",
      stateLabel: "simulated",
      summary: sections.reputation.detail,
      refs: sections.reputation.refs,
      availability: sections.reputation.refs.length > 0 ? "available" : "no_public_ref_preview_only",
      recordedDevnetRef: null,
    },
  ];

  const untraceable = milestones.filter((milestone) => !timelineMilestoneIsTraceable(milestone));
  if (untraceable.length > 0) {
    return failClosed(
      "timeline_milestone_untraceable",
      `Timeline milestones without a fixture/read-model ref or explicit no-public-ref marker: ${untraceable.map((item) => item.id).join(", ")}.`,
    );
  }

  return {
    state: "execution_timeline_ready",
    sourceRunbookPath: rehearsal.liveGate.runbookPath,
    recordedDevnetIssueRef: rehearsal.issueRef,
    milestones,
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

  const ledger = buildLedger(rehearsal, blockedCases);
  if ("status" in ledger) return ledger;

  const executionTimeline = buildExecutionTimeline(rehearsal, {
    result: resultSection,
    receipt: receiptSection,
    evidence: evidenceSection,
    attestation: attestationSection,
    reputation: reputationSection,
  });
  if ("status" in executionTimeline) return executionTimeline;

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
    ledger,
    executionTimeline,
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
    hardBoundaryFlags: {
      ...fixturePack.boundaryFlags,
      ...PAID_WORKFLOW_CONTRACT_ONLY_BOUNDARY_FLAGS,
    },
    copyBoundaries: fixturePack.copyBoundaries,
    neverClaims: [...NEVER_CLAIMS],
  };
}
