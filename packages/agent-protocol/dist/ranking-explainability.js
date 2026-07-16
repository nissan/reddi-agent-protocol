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
import { evaluateDiscoveryCandidatePolicyPreflight, } from './discovery-source.js';
import { createSourceAwareCandidateDiagnostics, } from './source-diagnostics.js';
export const RANKING_EXPLAINABILITY_SCHEMA_VERSION = 'reddi.ranking-explainability.v1';
/** Where the relevance-is-never-trust boundary is defined. */
export const RANKING_EXPLAINABILITY_BOUNDARIES_DOC_REF = 'docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md';
export const REQUIRED_RANKING_GATES = [
    'trust',
    'policy',
    'quote',
    'evidence',
    'payment',
    'budget',
    'settlement',
    'attestation',
];
const GUARDRAILS = {
    trustGranted: false,
    invocationAuthorized: false,
    paymentAuthorized: false,
    publicationAuthorized: false,
    settlementBypassPossible: false,
    attestationBypassPossible: false,
};
const BOUNDARY = {
    scoreMeaning: 'relevance_only_not_trust',
    relevanceInfluencedGates: false,
    boundariesDocRef: RANKING_EXPLAINABILITY_BOUNDARIES_DOC_REF,
};
const POLICY_GATE_CODES = ['source_not_allowed'];
const TRUST_GATE_CODES = ['trust_verification_required', 'provider_trust_mismatch'];
const QUOTE_GATE_CODES = ['missing_quote', 'malformed_candidate'];
const PAYMENT_GATE_CODES = ['unsupported_asset', 'unsupported_network'];
const BUDGET_GATE_CODES = ['over_budget'];
function decisionCodes(decision) {
    if (!decision || decision.allowed)
        return [];
    return decision.reasonCodes;
}
function gateCell(gate, state, reasonCodes, summary) {
    return { gate, state, reasonCodes, summary };
}
function trustGate(candidate, codes) {
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
    return gateCell('trust', 'not_evaluated', [status === 'claimed' ? 'trust_claimed_unverified' : 'trust_unverified'], 'No RAP-side trust verification has passed for this provider; unverified is never treated as trusted.');
}
function policyGate(decision, codes) {
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
function quoteGate(candidate, decision, codes) {
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
function paymentGate(candidate, decision, codes) {
    const failedCodes = codes.filter((code) => PAYMENT_GATE_CODES.includes(code));
    if (failedCodes.length > 0) {
        return gateCell('payment', 'failed', failedCodes, `Payment gate denied this candidate: ${failedCodes.join(', ')}.`);
    }
    if (decision && candidate.quote) {
        return gateCell('payment', 'passed', ['payment_policy_fit'], 'Quote asset and network fit the evaluated payment policy.');
    }
    return gateCell('payment', 'not_evaluated', ['policy_preflight_required'], 'Payment policy fit has not been evaluated for this candidate.');
}
function budgetGate(candidate, decision, codes) {
    const failedCodes = codes.filter((code) => BUDGET_GATE_CODES.includes(code));
    if (failedCodes.length > 0) {
        return gateCell('budget', 'failed', failedCodes, 'Quote exceeds the policy budget or does not match the expected asset/network.');
    }
    if (decision && candidate.quote) {
        return gateCell('budget', 'passed', ['budget_within_policy'], 'Quote is within the evaluated policy budget.');
    }
    return gateCell('budget', 'not_evaluated', ['policy_preflight_required'], 'Budget fit has not been evaluated for this candidate.');
}
function evidenceGate(evidence) {
    const receiptCount = evidence?.receiptCount ?? 0;
    const attestationCount = evidence?.attestationCount ?? 0;
    if (receiptCount > 0 || attestationCount > 0) {
        return gateCell('evidence', 'passed', ['reputation_history_present'], `Prior evidence exists: ${receiptCount} receipt(s), ${attestationCount} attestation(s).`);
    }
    return gateCell('evidence', 'not_evaluated', ['reputation_history_absent'], 'No prior receipt or attestation history is attached; the candidate is unproven.');
}
function settlementGate(evidence) {
    const refs = evidence?.settlementReceiptRefs ?? [];
    if (refs.length > 0) {
        return gateCell('settlement', 'passed', ['settlement_receipts_recorded'], `Settlement receipts recorded: ${refs.join(', ')}.`);
    }
    return gateCell('settlement', 'not_evaluated', ['settlement_evidence_missing'], 'No settlement receipt evidence is attached; settlement constraints are never bypassed for any source.');
}
function attestationGate(evidence) {
    const refs = evidence?.attestationRefs ?? [];
    if (refs.length > 0) {
        return gateCell('attestation', 'passed', ['attestation_evidence_recorded'], `Attestation evidence recorded: ${refs.join(', ')}.`);
    }
    return gateCell('attestation', 'not_evaluated', ['attestation_evidence_missing'], 'No attestation evidence is attached; attestation constraints are never bypassed for any source.');
}
function selectionFor(gates) {
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
export function deriveRankingCandidateExplainability(candidate, options = {}) {
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
    const gates = [
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
    const rejectionReasons = orderedGates
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
function relevanceOf(candidate) {
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
export function explainSourceRanking(candidates, options = {}) {
    const ordered = [...candidates].sort((a, b) => {
        const delta = relevanceOf(b) - relevanceOf(a);
        if (delta !== 0)
            return delta;
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
