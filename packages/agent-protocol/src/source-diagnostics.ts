import {
  type DiscoveryCandidate,
  type DiscoveryCandidatePolicyPreflightDecision,
  type DiscoveryCandidateReasonCode,
  type DiscoverySourceKind,
} from './discovery-source.js';
import { type ProviderTrustVerificationStatus } from './provider-trust.js';

export const SOURCE_DIAGNOSTICS_SCHEMA_VERSION = 'reddi.source-diagnostics.v1' as const;

export type SourceDiagnosticLane =
  | 'capability_match'
  | 'discovery_source'
  | 'publisher_identity'
  | 'trust_evidence'
  | 'policy_decision'
  | 'payment_fit'
  | 'reputation_evidence';

export type SourceDiagnosticSeverity = 'info' | 'warning' | 'blocked';

export type SourceDiagnosticReasonCode =
  | 'capability_declared'
  | 'capability_match_unscored'
  | 'discovery_source_recorded'
  | 'raw_snapshot_recorded'
  | 'publisher_identity_recorded'
  | 'publisher_identity_missing'
  | 'trust_verified'
  | 'trust_claimed_unverified'
  | 'trust_unverified'
  | 'trust_failed_verification'
  | 'policy_allowed'
  | 'policy_denied'
  | 'payment_quote_present'
  | 'payment_quote_missing'
  | 'payment_quote_denied'
  | 'reputation_history_present'
  | 'reputation_history_absent';

export type SourceDiagnosticMessage = {
  lane: SourceDiagnosticLane;
  severity: SourceDiagnosticSeverity;
  code: SourceDiagnosticReasonCode | DiscoveryCandidateReasonCode;
  summary: string;
  action?: string;
};

export type SourceAwareCandidateDiagnostics = {
  schemaVersion: typeof SOURCE_DIAGNOSTICS_SCHEMA_VERSION;
  candidate: {
    identifier: string;
    name: string;
    sourceKind: DiscoverySourceKind;
    rawSnapshotRef?: string;
  };
  capabilityMatch: {
    resourceType: string;
    mediaType: string;
    relevanceScore?: number;
    scoreMeaning: 'relevance_only_not_trust';
    summary: string;
  };
  discoverySource: {
    sourceKind: DiscoverySourceKind;
    url?: string;
    endpoint?: string;
    rawSnapshotRef?: string;
    summary: string;
  };
  publisherIdentity: {
    id?: string;
    name?: string;
    domain?: string;
    trustStatus?: ProviderTrustVerificationStatus;
    summary: string;
  };
  trustEvidence: {
    status: ProviderTrustVerificationStatus | 'missing';
    reasonCodes: string[];
    verifier?: string;
    checkedAt?: string;
    failureReasons: string[];
    provenanceCount: number;
    attestationCount: number;
    verificationReferenceCount: number;
    summary: string;
  };
  policyDecision: {
    allowed?: boolean;
    reasonCodes: DiscoveryCandidateReasonCode[];
    summaries: string[];
  };
  paymentFit: {
    quote?: {
      amount: string;
      asset: string;
      network: string;
    };
    allowed?: boolean;
    reasonCodes: DiscoveryCandidateReasonCode[];
    summary: string;
  };
  reputationEvidence: {
    status: 'history_present' | 'no_history';
    receiptCount?: number;
    attestationCount?: number;
    summary: string;
  };
  messages: SourceDiagnosticMessage[];
};

export type SourceAwareDiagnosticsOptions = {
  policyDecision?: DiscoveryCandidatePolicyPreflightDecision;
  reputation?: {
    receiptCount?: number;
    attestationCount?: number;
  };
};

function trustSummary(status: ProviderTrustVerificationStatus | 'missing'): string {
  switch (status) {
    case 'verified':
      return 'RAP-side verification marked this provider as verified.';
    case 'claimed':
      return 'External trust metadata is present, but RAP has not verified it.';
    case 'failed_verification':
      return 'RAP-side verification failed for this provider.';
    case 'unverified':
      return 'No verified trust metadata is available for this provider.';
    case 'missing':
      return 'No provider trust record is attached to this discovery candidate.';
  }
}

function trustMessageCode(status: ProviderTrustVerificationStatus | 'missing'): SourceDiagnosticReasonCode {
  switch (status) {
    case 'verified':
      return 'trust_verified';
    case 'claimed':
      return 'trust_claimed_unverified';
    case 'failed_verification':
      return 'trust_failed_verification';
    case 'unverified':
    case 'missing':
      return 'trust_unverified';
  }
}

function trustSeverity(status: ProviderTrustVerificationStatus | 'missing'): SourceDiagnosticSeverity {
  if (status === 'verified') return 'info';
  if (status === 'failed_verification') return 'blocked';
  return 'warning';
}

function paymentReasonCodes(decision?: DiscoveryCandidatePolicyPreflightDecision): DiscoveryCandidateReasonCode[] {
  if (!decision) return [];
  return decision.reasonCodes.filter((code) => (
    code === 'missing_quote'
    || code === 'malformed_candidate'
    || code === 'unsupported_asset'
    || code === 'unsupported_network'
    || code === 'over_budget'
  ));
}

function paymentAllowed(candidate: DiscoveryCandidate, decision?: DiscoveryCandidatePolicyPreflightDecision): boolean | undefined {
  if (!candidate.quote && !decision) return undefined;
  const paymentCodes = paymentReasonCodes(decision);
  return Boolean(candidate.quote) && paymentCodes.length === 0;
}

export function createSourceAwareCandidateDiagnostics(
  candidate: DiscoveryCandidate,
  options: SourceAwareDiagnosticsOptions = {},
): SourceAwareCandidateDiagnostics {
  const policyDecision = options.policyDecision;
  const trustStatus = candidate.providerTrust?.verification?.status ?? 'missing';
  const trustMetadata = candidate.providerTrust?.trustMetadata ?? candidate.trustMetadata;
  const provenanceCount = trustMetadata?.provenanceLinks.length ?? 0;
  const attestationCount = trustMetadata?.attestations.length ?? 0;
  const verificationReferenceCount = trustMetadata?.verificationReferences.length ?? 0;
  const publisher = candidate.publisher;
  const paymentCodes = paymentReasonCodes(policyDecision);
  const paymentLaneAllowed = paymentAllowed(candidate, policyDecision);
  const hasReputation = Boolean((options.reputation?.receiptCount ?? 0) > 0 || (options.reputation?.attestationCount ?? 0) > 0);
  const messages: SourceDiagnosticMessage[] = [];

  messages.push({
    lane: 'capability_match',
    severity: 'info',
    code: candidate.relevance?.score === undefined ? 'capability_match_unscored' : 'capability_declared',
    summary: candidate.relevance?.score === undefined
      ? `Candidate ${candidate.identifier} declares ${candidate.mediaType}; no relevance score was supplied.`
      : `Candidate ${candidate.identifier} has relevance score ${candidate.relevance.score}; this is not a trust score.`,
  });

  messages.push({
    lane: 'discovery_source',
    severity: 'info',
    code: candidate.rawSnapshotRef ? 'raw_snapshot_recorded' : 'discovery_source_recorded',
    summary: `Discovered from ${candidate.sourceKind}${candidate.rawSnapshotRef ? ` with snapshot ${candidate.rawSnapshotRef}` : ''}.`,
  });

  messages.push({
    lane: 'publisher_identity',
    severity: publisher?.id ? 'info' : 'warning',
    code: publisher?.id ? 'publisher_identity_recorded' : 'publisher_identity_missing',
    summary: publisher?.id ? `Publisher identity recorded as ${publisher.id}.` : 'No publisher identity is attached to this candidate.',
    action: publisher?.id ? undefined : 'Require provider identity before publishing or paid invocation.',
  });

  messages.push({
    lane: 'trust_evidence',
    severity: trustSeverity(trustStatus),
    code: trustMessageCode(trustStatus),
    summary: trustSummary(trustStatus),
    action: trustStatus === 'verified' ? undefined : 'Run RAP-side trust verification before treating this candidate as trusted.',
  });

  if (policyDecision) {
    messages.push({
      lane: 'policy_decision',
      severity: policyDecision.allowed ? 'info' : 'blocked',
      code: policyDecision.allowed ? 'policy_allowed' : 'policy_denied',
      summary: policyDecision.allowed
        ? 'Policy preflight allowed this candidate.'
        : `Policy preflight denied this candidate: ${policyDecision.reasonCodes.join(', ')}.`,
      action: policyDecision.allowed ? undefined : 'Resolve the listed policy reason codes before quote/payment/invocation.',
    });
  }

  messages.push({
    lane: 'payment_fit',
    severity: paymentCodes.length > 0 ? 'blocked' : candidate.quote ? 'info' : 'warning',
    code: paymentCodes.length > 0 ? 'payment_quote_denied' : candidate.quote ? 'payment_quote_present' : 'payment_quote_missing',
    summary: paymentCodes.length > 0
      ? `Payment or budget fit failed: ${paymentCodes.join(', ')}.`
      : candidate.quote
        ? `Quote is ${candidate.quote.amount} ${candidate.quote.asset} on ${candidate.quote.network}.`
        : 'No quote is attached; quote/payment preflight is still required.',
    action: paymentCodes.length > 0 || !candidate.quote ? 'Complete quote/payment preflight before invocation.' : undefined,
  });

  messages.push({
    lane: 'reputation_evidence',
    severity: hasReputation ? 'info' : 'warning',
    code: hasReputation ? 'reputation_history_present' : 'reputation_history_absent',
    summary: hasReputation
      ? `Reputation evidence includes ${options.reputation?.receiptCount ?? 0} receipt(s) and ${options.reputation?.attestationCount ?? 0} attestation(s).`
      : 'No prior receipt or attestation history is attached.',
    action: hasReputation ? undefined : 'Treat this candidate as unproven until receipts or attestations exist.',
  });

  return {
    schemaVersion: SOURCE_DIAGNOSTICS_SCHEMA_VERSION,
    candidate: {
      identifier: candidate.identifier,
      name: candidate.name,
      sourceKind: candidate.sourceKind,
      rawSnapshotRef: candidate.rawSnapshotRef,
    },
    capabilityMatch: {
      resourceType: candidate.resourceType,
      mediaType: candidate.mediaType,
      relevanceScore: candidate.relevance?.score,
      scoreMeaning: 'relevance_only_not_trust',
      summary: candidate.relevance?.score === undefined
        ? 'Capability match has no supplied relevance score.'
        : 'Relevance score is only a capability/search signal and never a trust, safety, payment, or reputation decision.',
    },
    discoverySource: {
      sourceKind: candidate.sourceKind,
      url: candidate.url,
      endpoint: candidate.endpoint,
      rawSnapshotRef: candidate.rawSnapshotRef,
      summary: 'Discovery source is recorded separately from policy, trust, payment, and reputation.',
    },
    publisherIdentity: {
      id: publisher?.id,
      name: publisher?.name,
      domain: publisher?.domain,
      trustStatus: candidate.providerTrust?.verification.status,
      summary: publisher?.id ? 'Publisher identity is present for audit and display.' : 'Publisher identity is missing.',
    },
    trustEvidence: {
      status: trustStatus,
      reasonCodes: candidate.providerTrust?.verification.reasonCodes ?? ['no_trust_record'],
      verifier: candidate.providerTrust?.verification.verifier,
      checkedAt: candidate.providerTrust?.verification.checkedAt,
      failureReasons: candidate.providerTrust?.verification.failureReasons ?? [],
      provenanceCount,
      attestationCount,
      verificationReferenceCount,
      summary: trustSummary(trustStatus),
    },
    policyDecision: {
      allowed: policyDecision?.allowed,
      reasonCodes: policyDecision?.reasonCodes ?? [],
      summaries: policyDecision?.auditNotes ?? [],
    },
    paymentFit: {
      quote: candidate.quote
        ? {
            amount: candidate.quote.amount,
            asset: candidate.quote.asset,
            network: candidate.quote.network,
          }
        : undefined,
      allowed: paymentLaneAllowed,
      reasonCodes: paymentCodes,
      summary: paymentCodes.length > 0
        ? 'Payment or budget policy denied this candidate.'
        : candidate.quote
          ? 'Quote metadata is present; payment still requires explicit approval/settlement outside discovery.'
          : 'Quote metadata is missing.',
    },
    reputationEvidence: {
      status: hasReputation ? 'history_present' : 'no_history',
      receiptCount: options.reputation?.receiptCount,
      attestationCount: options.reputation?.attestationCount,
      summary: hasReputation ? 'Prior reputation evidence is present.' : 'No prior reputation evidence is present.',
    },
    messages,
  };
}
