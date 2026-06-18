import { normalizeAiCatalogProviderTrustRecord, } from './provider-trust.js';
export const DISCOVERY_CANDIDATE_SCHEMA_VERSION = 'reddi.discovery-candidate.v1';
const SOURCE_KINDS = new Set([
    'local-specialist',
    'direct-ai-catalog',
    'ard-registry',
    'source-adapter',
    'hosted-rap-registry',
]);
function diagnostic(code, path, message) {
    return { code, path, message };
}
function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function asString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function asDiscoverySourceKind(value) {
    return typeof value === 'string' && SOURCE_KINDS.has(value)
        ? value
        : undefined;
}
function amountToBigInt(value) {
    if (typeof value !== 'string')
        return undefined;
    if (!/^[0-9]+$/.test(value))
        return undefined;
    return BigInt(value);
}
function resourceReference(resource) {
    return {
        url: resource.url ?? resource.catalogUrl,
        endpoint: resource.endpoint,
    };
}
export function validateDiscoveryCandidate(input) {
    const errors = [];
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
    const providerTrust = input.providerTrust;
    if (providerTrust !== undefined) {
        if (!isPlainObject(providerTrust) || providerTrust.schemaVersion !== 'reddi.provider-trust.v1') {
            errors.push(diagnostic('malformed_candidate', '$.providerTrust', 'Provider trust must be a reddi.provider-trust.v1 record.'));
        }
        else if (!isPlainObject(providerTrust.provider) || !asString(providerTrust.provider.id)) {
            errors.push(diagnostic('malformed_candidate', '$.providerTrust.provider.id', 'Provider trust record must include a provider id.'));
        }
        else if (identifier && providerTrust.provider.id !== identifier) {
            errors.push(diagnostic('provider_trust_mismatch', '$.providerTrust.provider.id', 'Provider trust record must match the discovery candidate identifier.'));
        }
    }
    const quote = input.quote;
    if (quote !== undefined) {
        if (!isPlainObject(quote)) {
            errors.push(diagnostic('malformed_candidate', '$.quote', 'Discovery candidate quote must be an object.'));
        }
        else if (!asString(quote.amount) || amountToBigInt(asString(quote.amount)) === undefined || !asString(quote.asset) || !asString(quote.network)) {
            errors.push(diagnostic('malformed_candidate', '$.quote', 'Discovery candidate quote must include decimal amount, asset, and network.'));
        }
    }
    if (errors.length > 0)
        return { ok: false, errors };
    return {
        ok: true,
        candidate: {
            schemaVersion: DISCOVERY_CANDIDATE_SCHEMA_VERSION,
            sourceKind: sourceKind,
            identifier: identifier,
            publisher: isPlainObject(input.publisher)
                ? {
                    id: asString(input.publisher.id) ?? 'unknown',
                    name: asString(input.publisher.name),
                    domain: asString(input.publisher.domain),
                }
                : undefined,
            name: name,
            description: asString(input.description),
            resourceType: resourceType,
            mediaType: mediaType,
            url: asString(input.url),
            endpoint: asString(input.endpoint),
            trustMetadata: providerTrust?.trustMetadata ?? input.trustMetadata,
            providerTrust,
            relevance: relevance
                ? {
                    score: relevanceScore,
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
export function createAiCatalogDiscoveryCandidates(catalog, options = {}) {
    const sourceKind = options.sourceKind ?? 'direct-ai-catalog';
    const candidates = [];
    const errors = [];
    for (const resource of catalog.resources) {
        const trust = normalizeAiCatalogProviderTrustRecord(catalog, resource.id, options.trustOptionsByResourceId?.[resource.id]);
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
        if (validation.ok)
            candidates.push(validation.candidate);
        else
            errors.push(...validation.errors);
    }
    if (errors.length > 0)
        return { ok: false, errors };
    return {
        ok: true,
        candidates,
        diagnostics: [diagnostic('candidate_ready_for_policy_preflight', '$', 'Discovery candidates require explicit policy preflight before quote/payment/invocation.')],
    };
}
export function evaluateDiscoveryCandidatePolicyPreflight(candidate, policy) {
    const reasonCodes = [];
    const auditNotes = [
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
    }
    else {
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
            if (quoted === undefined
                || maximum === undefined
                || candidate.quote.asset !== policy.maxQuote.asset
                || candidate.quote.network !== policy.maxQuote.network
                || quoted > maximum) {
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
};
