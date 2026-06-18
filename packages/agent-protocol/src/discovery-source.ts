import {
  type AiCatalogSnapshot,
  type AiCatalogResourceSnapshot,
} from './ai-catalog.js';
import {
  normalizeAiCatalogProviderTrustRecord,
  type NormalizeAiCatalogTrustOptions,
  type ProviderTrustRecord,
  type ProviderTrustVerificationStatus,
} from './provider-trust.js';

export const DISCOVERY_CANDIDATE_SCHEMA_VERSION = 'reddi.discovery-candidate.v1' as const;

export type DiscoverySourceKind =
  | 'local-specialist'
  | 'direct-ai-catalog'
  | 'ard-registry'
  | 'source-adapter'
  | 'hosted-rap-registry';

export type DiscoveryCandidateReasonCode =
  | 'candidate_ready_for_policy_preflight'
  | 'malformed_candidate'
  | 'provider_trust_mismatch'
  | 'missing_quote'
  | 'source_not_allowed'
  | 'trust_verification_required'
  | 'unsupported_asset'
  | 'unsupported_network'
  | 'over_budget';

export type DiscoveryCandidateDiagnostic = {
  code: DiscoveryCandidateReasonCode;
  path: string;
  message: string;
};

export type DiscoveryCandidateQuote = {
  amount: string;
  asset: string;
  network: string;
  expiresAt?: string;
  payee?: string;
};

export type DiscoveryCandidate = {
  schemaVersion: typeof DISCOVERY_CANDIDATE_SCHEMA_VERSION;
  sourceKind: DiscoverySourceKind;
  identifier: string;
  publisher?: {
    id: string;
    name?: string;
    domain?: string;
  };
  name: string;
  description?: string;
  resourceType: string;
  mediaType: string;
  url?: string;
  endpoint?: string;
  trustMetadata?: ProviderTrustRecord['trustMetadata'];
  providerTrust?: ProviderTrustRecord;
  relevance?: {
    score?: number;
    reason?: string;
    source?: string;
  };
  rawSnapshotRef?: string;
  quote?: DiscoveryCandidateQuote;
  policyPreflightRequired: true;
};

export type DiscoveryCandidateNormalizationResult =
  | { ok: true; candidates: DiscoveryCandidate[]; diagnostics: DiscoveryCandidateDiagnostic[] }
  | { ok: false; errors: DiscoveryCandidateDiagnostic[] };

export type DiscoveryCandidateValidationResult =
  | { ok: true; candidate: DiscoveryCandidate; diagnostics: DiscoveryCandidateDiagnostic[] }
  | { ok: false; errors: DiscoveryCandidateDiagnostic[] };

export type CreateAiCatalogDiscoveryCandidatesOptions = {
  sourceKind?: Extract<DiscoverySourceKind, 'direct-ai-catalog' | 'ard-registry' | 'hosted-rap-registry'>;
  trustOptionsByResourceId?: Record<string, NormalizeAiCatalogTrustOptions>;
  relevanceScores?: Record<string, number>;
};

export type DiscoveryCandidatePolicy = {
  allowedSourceKinds?: DiscoverySourceKind[];
  requireVerifiedTrust?: boolean;
  allowedAssets?: string[];
  allowedNetworks?: string[];
  maxQuote?: {
    amount: string;
    asset: string;
    network: string;
  };
};

export type DiscoveryCandidatePolicyPreflightDecision = {
  allowed: boolean;
  reasonCodes: DiscoveryCandidateReasonCode[];
  auditNotes: string[];
  candidate: {
    identifier: string;
    sourceKind: DiscoverySourceKind;
    relevanceScore?: number;
    trustStatus?: ProviderTrustVerificationStatus;
  };
  quote?: DiscoveryCandidateQuote;
};

const SOURCE_KINDS = new Set<DiscoverySourceKind>([
  'local-specialist',
  'direct-ai-catalog',
  'ard-registry',
  'source-adapter',
  'hosted-rap-registry',
]);

function diagnostic(code: DiscoveryCandidateReasonCode, path: string, message: string): DiscoveryCandidateDiagnostic {
  return { code, path, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asDiscoverySourceKind(value: unknown): DiscoverySourceKind | undefined {
  return typeof value === 'string' && SOURCE_KINDS.has(value as DiscoverySourceKind)
    ? (value as DiscoverySourceKind)
    : undefined;
}

function amountToBigInt(value: unknown): bigint | undefined {
  if (typeof value !== 'string') return undefined;
  if (!/^[0-9]+$/.test(value)) return undefined;
  return BigInt(value);
}

function resourceReference(resource: AiCatalogResourceSnapshot): { url?: string; endpoint?: string } {
  return {
    url: resource.url ?? resource.catalogUrl,
    endpoint: resource.endpoint,
  };
}

export function validateDiscoveryCandidate(input: unknown): DiscoveryCandidateValidationResult {
  const errors: DiscoveryCandidateDiagnostic[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [diagnostic('malformed_candidate', '$', 'Discovery candidate must be a plain object.')] };
  }

  const sourceKind = asDiscoverySourceKind(input.sourceKind);
  if (!sourceKind) {
    errors.push(diagnostic('malformed_candidate', '$.sourceKind', 'Discovery candidate must include a supported sourceKind.'));
  }

  const identifier = asString(input.identifier);
  if (!identifier) {
    errors.push(diagnostic('malformed_candidate', '$.identifier', 'Discovery candidate must include an identifier.'));
  }

  const name = asString(input.name);
  if (!name) {
    errors.push(diagnostic('malformed_candidate', '$.name', 'Discovery candidate must include a name.'));
  }

  const resourceType = asString(input.resourceType);
  const mediaType = asString(input.mediaType);
  if (!resourceType || !mediaType) {
    errors.push(diagnostic('malformed_candidate', '$.mediaType', 'Discovery candidate must include resourceType and mediaType.'));
  }

  const relevance = isPlainObject(input.relevance) ? input.relevance : undefined;
  const relevanceScore = relevance?.score;
  if (relevanceScore !== undefined && (typeof relevanceScore !== 'number' || !Number.isFinite(relevanceScore) || relevanceScore < 0 || relevanceScore > 1)) {
    errors.push(diagnostic('malformed_candidate', '$.relevance.score', 'Relevance score must be a finite number between 0 and 1.'));
  }

  const providerTrust = input.providerTrust as ProviderTrustRecord | undefined;
  if (providerTrust !== undefined) {
    if (!isPlainObject(providerTrust) || providerTrust.schemaVersion !== 'reddi.provider-trust.v1') {
      errors.push(diagnostic('malformed_candidate', '$.providerTrust', 'Provider trust must be a reddi.provider-trust.v1 record.'));
    } else if (!isPlainObject(providerTrust.provider) || !asString(providerTrust.provider.id)) {
      errors.push(diagnostic('malformed_candidate', '$.providerTrust.provider.id', 'Provider trust record must include a provider id.'));
    } else if (identifier && providerTrust.provider.id !== identifier) {
      errors.push(diagnostic('provider_trust_mismatch', '$.providerTrust.provider.id', 'Provider trust record must match the discovery candidate identifier.'));
    }
  }

  const quote = input.quote;
  if (quote !== undefined) {
    if (!isPlainObject(quote)) {
      errors.push(diagnostic('malformed_candidate', '$.quote', 'Discovery candidate quote must be an object.'));
    } else if (!asString(quote.amount) || amountToBigInt(asString(quote.amount)!) === undefined || !asString(quote.asset) || !asString(quote.network)) {
      errors.push(diagnostic('malformed_candidate', '$.quote', 'Discovery candidate quote must include decimal amount, asset, and network.'));
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    candidate: {
      schemaVersion: DISCOVERY_CANDIDATE_SCHEMA_VERSION,
      sourceKind: sourceKind!,
      identifier: identifier!,
      publisher: isPlainObject(input.publisher)
        ? {
            id: asString(input.publisher.id) ?? 'unknown',
            name: asString(input.publisher.name),
            domain: asString(input.publisher.domain),
          }
        : undefined,
      name: name!,
      description: asString(input.description),
      resourceType: resourceType!,
      mediaType: mediaType!,
      url: asString(input.url),
      endpoint: asString(input.endpoint),
      trustMetadata: providerTrust?.trustMetadata ?? (input.trustMetadata as ProviderTrustRecord['trustMetadata'] | undefined),
      providerTrust,
      relevance: relevance
        ? {
            score: relevanceScore as number | undefined,
            reason: asString(relevance.reason),
            source: asString(relevance.source),
          }
        : undefined,
      rawSnapshotRef: asString(input.rawSnapshotRef),
      quote: isPlainObject(input.quote)
        ? {
            amount: asString(input.quote.amount) ?? '',
            asset: asString(input.quote.asset) ?? '',
            network: asString(input.quote.network) ?? '',
            expiresAt: asString(input.quote.expiresAt),
            payee: asString(input.quote.payee),
          }
        : undefined,
      policyPreflightRequired: true,
    },
    diagnostics: [diagnostic('candidate_ready_for_policy_preflight', '$', 'Discovery candidate is normalized for explicit RAP policy preflight.')],
  };
}

export function createAiCatalogDiscoveryCandidates(
  catalog: AiCatalogSnapshot,
  options: CreateAiCatalogDiscoveryCandidatesOptions = {},
): DiscoveryCandidateNormalizationResult {
  const sourceKind = options.sourceKind ?? 'direct-ai-catalog';
  const candidates: DiscoveryCandidate[] = [];
  const errors: DiscoveryCandidateDiagnostic[] = [];

  for (const resource of catalog.resources) {
    const trust = normalizeAiCatalogProviderTrustRecord(
      catalog,
      resource.id,
      options.trustOptionsByResourceId?.[resource.id],
    );
    if (!trust.ok) {
      for (const trustError of trust.errors) {
        errors.push(diagnostic('malformed_candidate', `$.resources[${resource.id}]${trustError.path}`, trustError.message));
      }
      continue;
    }

    const reference = resourceReference(resource);
    const validation = validateDiscoveryCandidate({
      schemaVersion: DISCOVERY_CANDIDATE_SCHEMA_VERSION,
      sourceKind,
      identifier: resource.id,
      publisher: catalog.publisher,
      name: resource.name,
      description: resource.description,
      resourceType: resource.type,
      mediaType: resource.mediaType,
      url: reference.url,
      endpoint: reference.endpoint,
      providerTrust: trust.record,
      trustMetadata: trust.record.trustMetadata,
      relevance: {
        score: options.relevanceScores?.[resource.id],
        source: sourceKind,
      },
      rawSnapshotRef: catalog.rawSnapshotRef,
      policyPreflightRequired: true,
    });

    if (validation.ok) candidates.push(validation.candidate);
    else errors.push(...validation.errors);
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    candidates,
    diagnostics: [diagnostic('candidate_ready_for_policy_preflight', '$', 'Discovery candidates require explicit policy preflight before quote/payment/invocation.')],
  };
}

export function evaluateDiscoveryCandidatePolicyPreflight(
  candidate: DiscoveryCandidate,
  policy: DiscoveryCandidatePolicy,
): DiscoveryCandidatePolicyPreflightDecision {
  const reasonCodes: DiscoveryCandidateReasonCode[] = [];
  const auditNotes: string[] = [
    'Discovery relevance is informational only and is not used for trust, safety, payment, or budget approval.',
  ];

  if (policy.allowedSourceKinds && !policy.allowedSourceKinds.includes(candidate.sourceKind)) {
    reasonCodes.push('source_not_allowed');
    auditNotes.push(`Denied: discovery source ${candidate.sourceKind} is not allowed by policy.`);
  }

  const trustStatus = candidate.providerTrust?.verification?.status;
  if (policy.requireVerifiedTrust && trustStatus !== 'verified') {
    reasonCodes.push('trust_verification_required');
    auditNotes.push(`Denied: provider trust status is ${trustStatus ?? 'missing'}, but policy requires verified trust.`);
  }

  if (!candidate.quote) {
    reasonCodes.push('missing_quote');
    auditNotes.push('Denied: discovery candidate has no quote; RAP quote/payment preflight must happen before invocation.');
  } else {
    const quoted = amountToBigInt(candidate.quote.amount);
    if (quoted === undefined || !candidate.quote.asset || !candidate.quote.network) {
      reasonCodes.push('malformed_candidate');
      auditNotes.push('Denied: discovery candidate quote must include decimal amount, asset, and network.');
    }

    if (policy.allowedAssets && !policy.allowedAssets.includes(candidate.quote.asset)) {
      reasonCodes.push('unsupported_asset');
      auditNotes.push(`Denied: quote asset ${candidate.quote.asset} is not allowed by policy.`);
    }

    if (policy.allowedNetworks && !policy.allowedNetworks.includes(candidate.quote.network)) {
      reasonCodes.push('unsupported_network');
      auditNotes.push(`Denied: quote network ${candidate.quote.network} is not allowed by policy.`);
    }

    if (policy.maxQuote) {
      const maximum = amountToBigInt(policy.maxQuote.amount);
      if (
        quoted === undefined
        || maximum === undefined
        || candidate.quote.asset !== policy.maxQuote.asset
        || candidate.quote.network !== policy.maxQuote.network
        || quoted > maximum
      ) {
        reasonCodes.push('over_budget');
        auditNotes.push('Denied: quote exceeds the policy maximum or does not match the expected asset/network.');
      }
    }
  }

  return {
    allowed: reasonCodes.length === 0,
    reasonCodes: reasonCodes.length === 0 ? ['candidate_ready_for_policy_preflight'] : reasonCodes,
    auditNotes,
    candidate: {
      identifier: candidate.identifier,
      sourceKind: candidate.sourceKind,
      relevanceScore: candidate.relevance?.score,
      trustStatus,
    },
    quote: candidate.quote,
  };
}

export const discoverySourceFixtures = {
  localSpecialistCandidate: {
    schemaVersion: DISCOVERY_CANDIDATE_SCHEMA_VERSION,
    sourceKind: 'local-specialist',
    identifier: 'urn:ai:local:specialists:lint',
    publisher: { id: 'local' },
    name: 'Local Lint Specialist',
    resourceType: 'application/mcp-server-card+json',
    mediaType: 'application/mcp-server-card+json',
    endpoint: 'http://localhost:4100/mcp',
    relevance: { score: 0.4, source: 'local-fixture' },
    rawSnapshotRef: 'sha256:local-specialist-fixture',
    quote: { amount: '1000', asset: 'AUDD', network: 'solana-devnet' },
    policyPreflightRequired: true,
  },
} as const;
