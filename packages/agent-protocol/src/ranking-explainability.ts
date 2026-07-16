/**
 * Source-aware ranking explainability (#344, epic #336).
 *
 * Enriches resolve/ranking output with a typed, per-candidate explainability
 * block so users and operators can see WHY a source/specialist was selected,
 * rejected, or deferred — without ever blending discovery relevance into
 * trust, safety, budget, payment, invocation, or publication decisions
 * (`docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md`, #452).
 *
 * This module is PURE and read-model only: no network, no filesystem, no
 * LLM/provider call, no MCP/tool call, no wallet/RPC action, no registry
 * write, no publication, no payment, no trust or reputation mutation. It only
 * explains in-memory candidates the caller already holds.
 *
 * Vocabulary reuse (no new words where existing ones fit):
 * - Per-candidate lane diagnostics come from `source-diagnostics.ts`
 *   (`reddi.source-diagnostics.v1`, the #344 lane vocabulary incl.
 *   `relevance_only_not_trust`).
 * - Gate/rejection reason codes reuse `discovery-source.ts`
 *   (`DiscoveryCandidateReasonCode`) wherever a code exists there.
 * - The relevance boundary mirrors the #593 conformance matrix
 *   (`discoveryBoundary.scoreMeaning: 'relevance_only_not_trust'`).
 *
 * Fail-closed contract:
 * - Every candidate always carries ALL required gates — including
 *   `settlement` and `attestation` — so no source kind can silently bypass
 *   settlement or attestation constraints (#344 AC).
 * - A gate that has not produced positive evidence is `not_evaluated`, which
 *   is never treated as passed.
 * - Relevance influences ranking ORDER only; it never changes a gate state
 *   and a high-relevance candidate with any failed gate is still `rejected`.
 */

import {
  evaluateDiscoveryCandidatePolicyPreflight,
  type DiscoveryCandidate,
  type DiscoveryCandidatePolicy,
  type DiscoveryCandidatePolicyPreflightDecision,
  type DiscoveryCandidateReasonCode,
  type DiscoverySourceKind,
} from './discovery-source.js';
import {
  createSourceAwareCandidateDiagnostics,
  type SourceAwareCandidateDiagnostics,
} from './source-diagnostics.js';
import { type ProviderTrustVerificationStatus } from './provider-trust.js';

export const RANKING_EXPLAINABILITY_SCHEMA_VERSION = 'reddi.ranking-explainability.v1' as const;

/** Where the relevance-is-never-trust boundary is defined. */
export const RANKING_EXPLAINABILITY_BOUNDARIES_DOC_REF = 'docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md' as const;

/**
 * The gates every ranked candidate must carry. `settlement` and `attestation`
 * are structural members of this list: they exist for every source kind and
 * cannot be removed or defaulted to passed by any caller option.
 */
export type RankingGateId =
  | 'trust'
  | 'policy'
  | 'quote'
  | 'evidence'
  | 'payment'
  | 'budget'
  | 'settlement'
  | 'attestation';

export const REQUIRED_RANKING_GATES: readonly RankingGateId[] = [
  'trust',
  'policy',
  'quote',
  'evidence',
  'payment',
  'budget',
  'settlement',
  'attestation',
] as const;

/** `not_evaluated` is never treated as passed — fail closed. */
export type RankingGateState = 'passed' | 'failed' | 'not_evaluated';

export type RankingGateCell = {
  gate: RankingGateId;
  state: RankingGateState;
  reasonCodes: string[];
  summary: string;
};

/** Why a candidate ended up selected, rejected, or deferred. */
export type RankingSelectionState = 'selected' | 'rejected' | 'deferred';

export type RankingRejectionReason = {
  gate: RankingGateId;
  code: string;
  summary: string;
};

export type RankingCandidateHealthInput = {
  /** Endpoint health as recorded by the discovery surface; never probed here. */
  endpointHealth?: 'pass' | 'fail' | 'degraded' | 'not_probed';
  /** When the discovery snapshot backing this candidate was generated. */
  snapshotGeneratedAt?: string;
};

/**
 * Prior receipt/attestation/settlement EVIDENCE the caller already holds
 * (e.g. from `receipt-evidence-binding` records). References only — this
 * module never creates, verifies, or settles anything.
 */
export type RankingCandidateEvidenceInput = {
  receiptCount?: number;
  attestationCount?: number;
  settlementReceiptRefs?: string[];
  attestationRefs?: string[];
};

export type RankingCandidateExplainabilityOptions = {
  /** RAP policy; when present the policy preflight is evaluated here. */
  policy?: DiscoveryCandidatePolicy;
  /** A preflight decision the caller already evaluated (wins over `policy`). */
  policyDecision?: DiscoveryCandidatePolicyPreflightDecision;
  /** Fields the ranking query matched on, when the search surface knows them. */
  matchedFields?: string[];
  health?: RankingCandidateHealthInput;
  evidence?: RankingCandidateEvidenceInput;
};

export type RankingCandidateExplainability = {
  schemaVersion: typeof RANKING_EXPLAINABILITY_SCHEMA_VERSION;
  /** Source identity: who/where this candidate came from. */
  sourceIdentity: {
    identifier: string;
    name: string;
    sourceKind: DiscoverySourceKind;
    publisher?: {
      id: string;
      name?: string;
      domain?: string;
    };
    url?: string;
    endpoint?: string;
    rawSnapshotRef?: string;
  };
  /** Capability match: search/ranking relevance only — never trust. */
  capabilityMatch: {
    resourceType: string;
    mediaType: string;
    relevanceScore?: number;
    scoreMeaning: 'relevance_only_not_trust';
    matchedFields: string[];
    summary: string;
  };
  /** Trust state as RAP recorded it; external claims are never verified here. */
  trustState: {
    status: ProviderTrustVerificationStatus | 'missing';
    reasonCodes: string[];
    failureReasons: string[];
    summary: string;
  };
  /** Payment policy fit (quote/asset/network/budget) from the Decide lane. */
  paymentPolicyFit: {
    quote?: {
      amount: string;
      asset: string;
      network: string;
    };
    allowed?: boolean;
    reasonCodes: DiscoveryCandidateReasonCode[];
    summary: string;
  };
  /** Health/freshness as recorded by the discovery snapshot; never probed. */
  healthFreshness: {
    endpointHealth: 'pass' | 'fail' | 'degraded' | 'not_probed';
    freshness: 'snapshot_backed' | 'unknown';
    snapshotGeneratedAt?: string;
    snapshotRef?: string;
    summary: string;
  };
  /** All required gates, always present, fail closed. */
  gates: RankingGateCell[];
  /** Failed gates flattened into displayable rejection reasons. */
  rejectionReasons: RankingRejectionReason[];
  selection: {
    state: RankingSelectionState;
    /** Ranking order comes from relevance only; gates never reorder. */
    rankInfluencedByGates: false;
    summary: string;
  };
  /** The composed #344 lane diagnostics (`reddi.source-diagnostics.v1`). */
  diagnostics: SourceAwareCandidateDiagnostics;
  boundary: {
    scoreMeaning: 'relevance_only_not_trust';
    relevanceInfluencedGates: false;
    boundariesDocRef: typeof RANKING_EXPLAINABILITY_BOUNDARIES_DOC_REF;
  };
  /** Explainability is read-only; it authorizes nothing. */
  guardrails: {
    trustGranted: false;
    invocationAuthorized: false;
    paymentAuthorized: false;
    publicationAuthorized: false;
    settlementBypassPossible: false;
    attestationBypassPossible: false;
  };
};

export type RankedCandidateExplanation = {
  /** 1-based position, assigned by relevance ordering only. */
  rank: number;
  explainability: RankingCandidateExplainability;
};

export type SourceRankingExplainabilityReport = {
  schemaVersion: typeof RANKING_EXPLAINABILITY_SCHEMA_VERSION;
  generatedAt?: string;
  ordering: 'relevance_desc_then_identifier_asc';
  total: number;
  candidates: RankedCandidateExplanation[];
  boundary: RankingCandidateExplainability['boundary'];
  guardrails: RankingCandidateExplainability['guardrails'];
};

export type ExplainSourceRankingOptions = {
  policy?: DiscoveryCandidatePolicy;
  generatedAt?: string;
  /** Per-candidate inputs keyed by candidate identifier. */
  perCandidate?: Record<string, Omit<RankingCandidateExplainabilityOptions, 'policy'>>;
};

const GUARDRAILS: RankingCandidateExplainability['guardrails'] = {
  trustGranted: false,
  invocationAuthorized: false,
  paymentAuthorized: false,
  publicationAuthorized: false,
  settlementBypassPossible: false,
  attestationBypassPossible: false,
};

const BOUNDARY: RankingCandidateExplainability['boundary'] = {
  scoreMeaning: 'relevance_only_not_trust',
  relevanceInfluencedGates: false,
  boundariesDocRef: RANKING_EXPLAINABILITY_BOUNDARIES_DOC_REF,
};

const POLICY_GATE_CODES: readonly DiscoveryCandidateReasonCode[] = ['source_not_allowed'];
const TRUST_GATE_CODES: readonly DiscoveryCandidateReasonCode[] = ['trust_verification_required', 'provider_trust_mismatch'];
const QUOTE_GATE_CODES: readonly DiscoveryCandidateReasonCode[] = ['missing_quote', 'malformed_candidate'];
const PAYMENT_GATE_CODES: readonly DiscoveryCandidateReasonCode[] = ['unsupported_asset', 'unsupported_network'];
const BUDGET_GATE_CODES: readonly DiscoveryCandidateReasonCode[] = ['over_budget'];

function decisionCodes(decision: DiscoveryCandidatePolicyPreflightDecision | undefined): DiscoveryCandidateReasonCode[] {
  if (!decision || decision.allowed) return [];
  return decision.reasonCodes;
}

function gateCell(gate: RankingGateId, state: RankingGateState, reasonCodes: string[], summary: string): RankingGateCell {
  return { gate, state, reasonCodes, summary };
}

function trustGate(candidate: DiscoveryCandidate, codes: DiscoveryCandidateReasonCode[]): RankingGateCell {
  const status = candidate.providerTrust?.verification?.status ?? 'missing';
  const failedCodes = codes.filter((code) => TRUST_GATE_CODES.includes(code));
  if (status === 'failed_verification') {
    return gateCell('trust', 'failed', ['trust_failed_verification', ...failedCodes], 'RAP-side trust verification failed for this provider.');
  }
  if (failedCodes.length > 0) {
    return gateCell('trust', 'failed', failedCodes, `Trust gate denied this candidate: ${failedCodes.join(', ')}.`);
  }
  if (status === 'verified') {
    return gateCell('trust', 'passed', ['trust_verified'], 'RAP-side verification marked this provider as verified.');
  }
  return gateCell(
    'trust',
    'not_evaluated',
    [status === 'claimed' ? 'trust_claimed_unverified' : 'trust_unverified'],
    'No RAP-side trust verification has passed for this provider; unverified is never treated as trusted.',
  );
}

function policyGate(decision: DiscoveryCandidatePolicyPreflightDecision | undefined, codes: DiscoveryCandidateReasonCode[]): RankingGateCell {
  const failedCodes = codes.filter((code) => POLICY_GATE_CODES.includes(code));
  if (failedCodes.length > 0) {
    return gateCell('policy', 'failed', failedCodes, `Policy gate denied this candidate: ${failedCodes.join(', ')}.`);
  }
  if (decision) {
    return decision.allowed
      ? gateCell('policy', 'passed', ['policy_allowed'], 'Policy preflight allowed this candidate.')
      : gateCell('policy', 'failed', decision.reasonCodes, `Policy preflight denied this candidate: ${decision.reasonCodes.join(', ')}.`);
  }
  return gateCell('policy', 'not_evaluated', ['policy_preflight_required'], 'RAP policy preflight has not run for this candidate.');
}

function quoteGate(candidate: DiscoveryCandidate, decision: DiscoveryCandidatePolicyPreflightDecision | undefined, codes: DiscoveryCandidateReasonCode[]): RankingGateCell {
  const failedCodes = codes.filter((code) => QUOTE_GATE_CODES.includes(code));
  if (!candidate.quote) {
    return gateCell('quote', 'failed', ['missing_quote'], 'No quote is attached; quote preflight fails closed without one.');
  }
  if (failedCodes.length > 0) {
    return gateCell('quote', 'failed', failedCodes, `Quote gate denied this candidate: ${failedCodes.join(', ')}.`);
  }
  if (decision) {
    return gateCell('quote', 'passed', ['payment_quote_present'], `Quote is ${candidate.quote.amount} ${candidate.quote.asset} on ${candidate.quote.network}.`);
  }
  return gateCell('quote', 'not_evaluated', ['policy_preflight_required'], 'A quote is attached but quote preflight has not run.');
}

function paymentGate(candidate: DiscoveryCandidate, decision: DiscoveryCandidatePolicyPreflightDecision | undefined, codes: DiscoveryCandidateReasonCode[]): RankingGateCell {
  const failedCodes = codes.filter((code) => PAYMENT_GATE_CODES.includes(code));
  if (failedCodes.length > 0) {
    return gateCell('payment', 'failed', failedCodes, `Payment gate denied this candidate: ${failedCodes.join(', ')}.`);
  }
  if (decision && candidate.quote) {
    return gateCell('payment', 'passed', ['payment_policy_fit'], 'Quote asset and network fit the evaluated payment policy.');
  }
  return gateCell('payment', 'not_evaluated', ['policy_preflight_required'], 'Payment policy fit has not been evaluated for this candidate.');
}

function budgetGate(candidate: DiscoveryCandidate, decision: DiscoveryCandidatePolicyPreflightDecision | undefined, codes: DiscoveryCandidateReasonCode[]): RankingGateCell {
  const failedCodes = codes.filter((code) => BUDGET_GATE_CODES.includes(code));
  if (failedCodes.length > 0) {
    return gateCell('budget', 'failed', failedCodes, 'Quote exceeds the policy budget or does not match the expected asset/network.');
  }
  if (decision && candidate.quote) {
    return gateCell('budget', 'passed', ['budget_within_policy'], 'Quote is within the evaluated policy budget.');
  }
  return gateCell('budget', 'not_evaluated', ['policy_preflight_required'], 'Budget fit has not been evaluated for this candidate.');
}

function evidenceGate(evidence: RankingCandidateEvidenceInput | undefined): RankingGateCell {
  const receiptCount = evidence?.receiptCount ?? 0;
  const attestationCount = evidence?.attestationCount ?? 0;
  if (receiptCount > 0 || attestationCount > 0) {
    return gateCell(
      'evidence',
      'passed',
      ['reputation_history_present'],
      `Prior evidence exists: ${receiptCount} receipt(s), ${attestationCount} attestation(s).`,
    );
  }
  return gateCell('evidence', 'not_evaluated', ['reputation_history_absent'], 'No prior receipt or attestation history is attached; the candidate is unproven.');
}

function settlementGate(evidence: RankingCandidateEvidenceInput | undefined): RankingGateCell {
  const refs = evidence?.settlementReceiptRefs ?? [];
  if (refs.length > 0) {
    return gateCell('settlement', 'passed', ['settlement_receipts_recorded'], `Settlement receipts recorded: ${refs.join(', ')}.`);
  }
  return gateCell(
    'settlement',
    'not_evaluated',
    ['settlement_evidence_missing'],
    'No settlement receipt evidence is attached; settlement constraints are never bypassed for any source.',
  );
}

function attestationGate(evidence: RankingCandidateEvidenceInput | undefined): RankingGateCell {
  const refs = evidence?.attestationRefs ?? [];
  if (refs.length > 0) {
    return gateCell('attestation', 'passed', ['attestation_evidence_recorded'], `Attestation evidence recorded: ${refs.join(', ')}.`);
  }
  return gateCell(
    'attestation',
    'not_evaluated',
    ['attestation_evidence_missing'],
    'No attestation evidence is attached; attestation constraints are never bypassed for any source.',
  );
}

function selectionFor(gates: RankingGateCell[]): RankingCandidateExplainability['selection'] {
  const failed = gates.filter((cell) => cell.state === 'failed');
  if (failed.length > 0) {
    return {
      state: 'rejected',
      rankInfluencedByGates: false,
      summary: `Rejected: gate(s) failed — ${failed.map((cell) => cell.gate).join(', ')}. Relevance never overrides a failed gate.`,
    };
  }
  const outstanding = gates.filter((cell) => cell.state === 'not_evaluated');
  if (outstanding.length > 0) {
    return {
      state: 'deferred',
      rankInfluencedByGates: false,
      summary: `Deferred: gate(s) outstanding — ${outstanding.map((cell) => cell.gate).join(', ')}. Not-evaluated gates never count as passed.`,
    };
  }
  return {
    state: 'selected',
    rankInfluencedByGates: false,
    summary: 'Selected: every required gate passed. Invocation, payment, and publication still require their own explicit flows.',
  };
}

/**
 * Derive the `reddi.ranking-explainability.v1` block for one candidate.
 *
 * All eight required gates are always emitted; there is no option to omit,
 * override, or pre-pass a gate. Settlement and attestation gates only pass on
 * explicit caller-held evidence references.
 */
export function deriveRankingCandidateExplainability(
  candidate: DiscoveryCandidate,
  options: RankingCandidateExplainabilityOptions = {},
): RankingCandidateExplainability {
  const policyDecision = options.policyDecision
    ?? (options.policy ? evaluateDiscoveryCandidatePolicyPreflight(candidate, options.policy) : undefined);
  const codes = decisionCodes(policyDecision);
  const diagnostics = createSourceAwareCandidateDiagnostics(candidate, {
    policyDecision,
    reputation: {
      receiptCount: options.evidence?.receiptCount,
      attestationCount: options.evidence?.attestationCount,
    },
  });

  const gates: RankingGateCell[] = [
    trustGate(candidate, codes),
    policyGate(policyDecision, codes),
    quoteGate(candidate, policyDecision, codes),
    evidenceGate(options.evidence),
    paymentGate(candidate, policyDecision, codes),
    budgetGate(candidate, policyDecision, codes),
    settlementGate(options.evidence),
    attestationGate(options.evidence),
  ];
  const orderedGates = REQUIRED_RANKING_GATES.map((gateId) => {
    const found = gates.find((cell) => cell.gate === gateId);
    if (!found) {
      throw new Error(`ranking explainability is missing required gate: ${gateId}`);
    }
    return found;
  });

  const rejectionReasons: RankingRejectionReason[] = orderedGates
    .filter((cell) => cell.state === 'failed')
    .flatMap((cell) => cell.reasonCodes.map((code) => ({ gate: cell.gate, code, summary: cell.summary })));

  const endpointHealth = options.health?.endpointHealth ?? 'not_probed';
  const snapshotGeneratedAt = options.health?.snapshotGeneratedAt;

  return {
    schemaVersion: RANKING_EXPLAINABILITY_SCHEMA_VERSION,
    sourceIdentity: {
      identifier: candidate.identifier,
      name: candidate.name,
      sourceKind: candidate.sourceKind,
      publisher: candidate.publisher,
      url: candidate.url,
      endpoint: candidate.endpoint,
      rawSnapshotRef: candidate.rawSnapshotRef,
    },
    capabilityMatch: {
      resourceType: candidate.resourceType,
      mediaType: candidate.mediaType,
      relevanceScore: candidate.relevance?.score,
      scoreMeaning: 'relevance_only_not_trust',
      matchedFields: options.matchedFields ?? [],
      summary: candidate.relevance?.score === undefined
        ? 'No relevance score was supplied; relevance would not affect any gate either way.'
        : `Relevance score ${candidate.relevance.score} is a capability/search signal only — never trust, safety, budget, payment, invocation, or publication approval.`,
    },
    trustState: {
      status: candidate.providerTrust?.verification?.status ?? 'missing',
      reasonCodes: candidate.providerTrust?.verification?.reasonCodes ?? ['no_trust_record'],
      failureReasons: candidate.providerTrust?.verification?.failureReasons ?? [],
      summary: diagnostics.trustEvidence.summary,
    },
    paymentPolicyFit: {
      quote: diagnostics.paymentFit.quote,
      allowed: diagnostics.paymentFit.allowed,
      reasonCodes: diagnostics.paymentFit.reasonCodes,
      summary: diagnostics.paymentFit.summary,
    },
    healthFreshness: {
      endpointHealth,
      freshness: snapshotGeneratedAt || candidate.rawSnapshotRef ? 'snapshot_backed' : 'unknown',
      snapshotGeneratedAt,
      snapshotRef: candidate.rawSnapshotRef,
      summary: endpointHealth === 'not_probed'
        ? 'Endpoint health has not been probed; freshness comes from the recorded discovery snapshot only.'
        : `Endpoint health is recorded as ${endpointHealth} by the discovery surface; nothing was probed here.`,
    },
    gates: orderedGates,
    rejectionReasons,
    selection: selectionFor(orderedGates),
    diagnostics,
    boundary: BOUNDARY,
    guardrails: GUARDRAILS,
  };
}

function relevanceOf(candidate: DiscoveryCandidate): number {
  return candidate.relevance?.score ?? -1;
}

/**
 * Enrich a resolve/ranking candidate list with per-candidate explainability.
 *
 * Ordering is relevance-descending (ties broken by identifier) and is the ONLY
 * thing relevance controls: rejected candidates keep their relevance rank and
 * are marked `rejected` with reasons instead of being silently re-ordered or
 * hidden.
 */
export function explainSourceRanking(
  candidates: DiscoveryCandidate[],
  options: ExplainSourceRankingOptions = {},
): SourceRankingExplainabilityReport {
  const ordered = [...candidates].sort((a, b) => {
    const delta = relevanceOf(b) - relevanceOf(a);
    if (delta !== 0) return delta;
    return a.identifier.localeCompare(b.identifier);
  });

  const ranked = ordered.map((candidate, index) => ({
    rank: index + 1,
    explainability: deriveRankingCandidateExplainability(candidate, {
      policy: options.policy,
      ...options.perCandidate?.[candidate.identifier],
    }),
  }));

  return {
    schemaVersion: RANKING_EXPLAINABILITY_SCHEMA_VERSION,
    generatedAt: options.generatedAt,
    ordering: 'relevance_desc_then_identifier_asc',
    total: ranked.length,
    candidates: ranked,
    boundary: BOUNDARY,
    guardrails: GUARDRAILS,
  };
}
