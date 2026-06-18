import { aiCatalogFixtures, createAiCatalogSnapshot, type AiCatalogResourceSnapshot, type AiCatalogSnapshot } from './ai-catalog.js';

export const PROVIDER_TRUST_RECORD_SCHEMA_VERSION = 'reddi.provider-trust.v1' as const;

export type ProviderTrustVerificationStatus =
  | 'claimed'
  | 'verified'
  | 'unverified'
  | 'failed_verification';

export type ProviderTrustReasonCode =
  | 'rap_verified'
  | 'rap_verification_failed'
  | 'external_claim_not_verified_by_rap'
  | 'no_trust_metadata'
  | 'provider_not_found'
  | 'malformed_trust_metadata'
  | 'credential_leakage_rejected';

export type ProviderTrustValidationError = {
  code: ProviderTrustReasonCode;
  path: string;
  message: string;
};

export type ProviderTrustRecord = {
  schemaVersion: typeof PROVIDER_TRUST_RECORD_SCHEMA_VERSION;
  provider: {
    id: string;
    name: string;
    mediaType: string;
    url?: string;
  };
  publisher: {
    id: string;
    name?: string;
    domain?: string;
  };
  source: {
    kind: 'ai-catalog';
    rawSnapshotRef?: string;
    catalogPublisherId: string;
  };
  verification: {
    status: ProviderTrustVerificationStatus;
    reasonCodes: ProviderTrustReasonCode[];
    verifier?: string;
    checkedAt?: string;
    failureReasons: string[];
  };
  trustMetadata: {
    trustManifest?: unknown;
    provenanceLinks: unknown[];
    attestations: unknown[];
    detachedSignature?: unknown;
    verificationReferences: unknown[];
    publisherIdentity?: unknown;
  };
};

export type ProviderTrustVerificationInput = {
  status?: Extract<ProviderTrustVerificationStatus, 'verified' | 'failed_verification'>;
  verifier?: string;
  checkedAt?: string;
  failureReasons?: string[];
};

export type NormalizeAiCatalogTrustOptions = {
  verification?: ProviderTrustVerificationInput;
};

export type ProviderTrustNormalizationResult =
  | { ok: true; record: ProviderTrustRecord }
  | { ok: false; errors: ProviderTrustValidationError[] };

export type ProviderTrustFixtureCase = {
  description: string;
  catalog: AiCatalogSnapshot;
  resourceId: string;
  options?: NormalizeAiCatalogTrustOptions;
  expectedValid: boolean;
  expectedStatus?: ProviderTrustVerificationStatus;
  expectedReasonCodes: ProviderTrustReasonCode[];
};

const SENSITIVE_KEY_PATTERN = /(^|[_-])(api[_-]?key|authorization|bearer|cookie|credential|mnemonic|password|private[_-]?key|refresh[_-]?token|secret|seed|session[_-]?token|token)($|[_-])|apiKey|accessToken|refreshToken|sessionToken|privateKey/i;
const SENSITIVE_VALUE_PATTERN = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|authorization:\s*bearer\s+|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,})/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function collectTrustList(value: unknown, path: string, errors: ProviderTrustValidationError[]): unknown[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (typeof item !== 'string' && !isPlainObject(item)) {
      errors.push(error('malformed_trust_metadata', `${path}${Array.isArray(value) ? `[${index}]` : ''}`, 'trust metadata references must be strings or objects.'));
    }
  }
  return values;
}

function validateOptionalStringOrObject(value: unknown, path: string, errors: ProviderTrustValidationError[]): unknown {
  if (value === undefined) return undefined;
  if (typeof value === 'string' || isPlainObject(value)) return value;
  errors.push(error('malformed_trust_metadata', path, 'trust metadata field must be a string or object.'));
  return undefined;
}

function error(code: ProviderTrustReasonCode, path: string, message: string): ProviderTrustValidationError {
  return { code, path, message };
}

function findCredentialMaterial(value: unknown, path = '$'): string | undefined {
  if (typeof value === 'string') return SENSITIVE_VALUE_PATTERN.test(value) ? path : undefined;
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findCredentialMaterial(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (SENSITIVE_KEY_PATTERN.test(key)) return childPath;
    const found = findCredentialMaterial(child, childPath);
    if (found) return found;
  }
  return undefined;
}

function metadataObject(resource: AiCatalogResourceSnapshot): Record<string, unknown> | undefined {
  return isPlainObject(resource.raw) && isPlainObject(resource.raw.metadata) ? resource.raw.metadata : undefined;
}

function trustObject(resource: AiCatalogResourceSnapshot): Record<string, unknown> | undefined {
  const metadata = metadataObject(resource);
  if (metadata && isPlainObject(metadata.trust)) return metadata.trust;
  return undefined;
}

function hasTrustMetadata(record: ProviderTrustRecord['trustMetadata']): boolean {
  return Boolean(
    record.trustManifest
      || record.detachedSignature
      || record.publisherIdentity
      || record.provenanceLinks.length > 0
      || record.attestations.length > 0
      || record.verificationReferences.length > 0,
  );
}

function collectTrustMetadata(resource: AiCatalogResourceSnapshot, errors: ProviderTrustValidationError[]): ProviderTrustRecord['trustMetadata'] {
  const raw = isPlainObject(resource.raw) ? resource.raw : {};
  const metadata = metadataObject(resource);
  const trust = trustObject(resource);
  const trustManifest = resource.trustManifest ?? trust?.trustManifest ?? metadata?.trustManifest;

  if (trustManifest !== undefined && typeof trustManifest !== 'string' && !isPlainObject(trustManifest)) {
    errors.push(error('malformed_trust_metadata', '$.trustManifest', 'trustManifest must be a URL string or object.'));
  }

  const manifestObject = isPlainObject(trustManifest) ? trustManifest : undefined;
  const detachedSignature = raw.detachedSignature ?? raw.signature ?? trust?.detachedSignature ?? trust?.signature ?? manifestObject?.signature;
  if (detachedSignature !== undefined && typeof detachedSignature !== 'string' && !isPlainObject(detachedSignature)) {
    errors.push(error('malformed_trust_metadata', '$.detachedSignature', 'detached-signature metadata must be a string or object.'));
  }

  return {
    trustManifest,
    provenanceLinks: [
      ...collectTrustList(manifestObject?.provenance, '$.trustManifest.provenance', errors),
      ...collectTrustList(manifestObject?.provenanceLinks, '$.trustManifest.provenanceLinks', errors),
      ...collectTrustList(raw.provenance, '$.provenance', errors),
      ...collectTrustList(raw.provenanceLinks, '$.provenanceLinks', errors),
      ...collectTrustList(trust?.provenance, '$.metadata.trust.provenance', errors),
      ...collectTrustList(trust?.provenanceLinks, '$.metadata.trust.provenanceLinks', errors),
    ],
    attestations: [
      ...collectTrustList(manifestObject?.attestations, '$.trustManifest.attestations', errors),
      ...collectTrustList(raw.attestations, '$.attestations', errors),
      ...collectTrustList(trust?.attestations, '$.metadata.trust.attestations', errors),
    ],
    detachedSignature,
    verificationReferences: [
      ...collectTrustList(manifestObject?.verification, '$.trustManifest.verification', errors),
      ...collectTrustList(manifestObject?.verificationReferences, '$.trustManifest.verificationReferences', errors),
      ...collectTrustList(raw.verification, '$.verification', errors),
      ...collectTrustList(raw.verificationReferences, '$.verificationReferences', errors),
      ...collectTrustList(trust?.verification, '$.metadata.trust.verification', errors),
      ...collectTrustList(trust?.verificationReferences, '$.metadata.trust.verificationReferences', errors),
    ],
    publisherIdentity: validateOptionalStringOrObject(
      raw.publisherIdentity ?? trust?.publisherIdentity ?? metadata?.publisherIdentity ?? manifestObject?.publisherIdentity,
      '$.publisherIdentity',
      errors,
    ),
  };
}

function buildVerification(
  metadata: ProviderTrustRecord['trustMetadata'],
  verification?: ProviderTrustVerificationInput,
): ProviderTrustRecord['verification'] {
  const failureReasons = verification?.failureReasons ?? [];

  if (verification?.status === 'verified') {
    return {
      status: 'verified',
      reasonCodes: ['rap_verified'],
      verifier: verification.verifier,
      checkedAt: verification.checkedAt,
      failureReasons: [],
    };
  }

  if (verification?.status === 'failed_verification') {
    return {
      status: 'failed_verification',
      reasonCodes: ['rap_verification_failed'],
      verifier: verification.verifier,
      checkedAt: verification.checkedAt,
      failureReasons,
    };
  }

  if (hasTrustMetadata(metadata)) {
    return {
      status: 'claimed',
      reasonCodes: ['external_claim_not_verified_by_rap'],
      failureReasons: [],
    };
  }

  return {
    status: 'unverified',
    reasonCodes: ['no_trust_metadata'],
    failureReasons: [],
  };
}

export function normalizeAiCatalogProviderTrustRecord(
  catalog: AiCatalogSnapshot,
  resourceId: string,
  options: NormalizeAiCatalogTrustOptions = {},
): ProviderTrustNormalizationResult {
  const resource = catalog.resources.find((item) => item.id === resourceId);
  if (!resource) {
    return {
      ok: false,
      errors: [error('provider_not_found', '$.resourceId', `No AI Catalog resource found for ${resourceId}.`)],
    };
  }

  const errors: ProviderTrustValidationError[] = [];
  const credentialPath = findCredentialMaterial({
    trustManifest: resource.trustManifest,
    payment: resource.payment,
    auth: resource.auth,
    raw: resource.raw,
  });
  if (credentialPath) {
    errors.push(error('credential_leakage_rejected', credentialPath, 'provider trust metadata contains credential-shaped material.'));
  }

  const trustMetadata = collectTrustMetadata(resource, errors);
  if (errors.length > 0) return { ok: false, errors };

  const record: ProviderTrustRecord = {
    schemaVersion: PROVIDER_TRUST_RECORD_SCHEMA_VERSION,
    provider: {
      id: resource.id,
      name: resource.name,
      mediaType: resource.mediaType,
      url: resource.url ?? resource.endpoint ?? resource.catalogUrl,
    },
    publisher: {
      id: catalog.publisher.id,
      name: catalog.publisher.name,
      domain: catalog.publisher.domain,
    },
    source: {
      kind: 'ai-catalog',
      rawSnapshotRef: catalog.rawSnapshotRef,
      catalogPublisherId: catalog.publisher.id,
    },
    verification: buildVerification(trustMetadata, options.verification),
    trustMetadata,
  };

  return { ok: true, record };
}

export function createAiCatalogProviderTrustRecord(
  catalog: AiCatalogSnapshot,
  resourceId: string,
  options: NormalizeAiCatalogTrustOptions = {},
): ProviderTrustRecord {
  const result = normalizeAiCatalogProviderTrustRecord(catalog, resourceId, options);
  if (!result.ok) {
    throw new Error(`invalid_provider_trust_record:${result.errors.map((item) => item.code).join(',')}`);
  }
  return result.record;
}

export const providerTrustFixtures = {
  verifiedCatalog: createAiCatalogSnapshot({
    ...aiCatalogFixtures.happyPath,
    entries: [
      {
        ...aiCatalogFixtures.happyPath.entries[0],
        trustManifest: {
          identity: 'urn:ai:reddi.tech:specialists:code-review',
          provenance: ['https://agents.reddi.tech/provenance/code-review.json'],
          attestations: [{ type: 'build-provenance', ref: 'sha256:attestation-fixture' }],
          signature: {
            format: 'dsse',
            ref: 'https://agents.reddi.tech/signatures/code-review.dsse',
            status: 'claimed',
          },
        },
        metadata: {
          ...aiCatalogFixtures.happyPath.entries[0].metadata,
          trust: {
            verificationReferences: ['https://agents.reddi.tech/verification/code-review.json'],
            publisherIdentity: { domain: 'reddi.tech', status: 'claimed' },
          },
        },
      },
    ],
  }, { rawSnapshotRef: 'sha256:verified-catalog-fixture' }),
  unverifiedCatalog: createAiCatalogSnapshot({
    specVersion: '1.0',
    host: { identifier: 'example.com', displayName: 'Example Agents' },
    entries: [
      {
        identifier: 'urn:example:agents:summary',
        displayName: 'Summary Agent',
        mediaType: 'application/mcp-server-card+json',
        url: 'https://agents.example.com/summary/mcp.json',
      },
    ],
  }, { rawSnapshotRef: 'sha256:unverified-catalog-fixture' }),
  malformedTrustCatalog: createAiCatalogSnapshot({
    specVersion: '1.0',
    host: 'example.com',
    entries: [
      {
        identifier: 'urn:example:agents:malformed-trust',
        displayName: 'Malformed Trust Agent',
        mediaType: 'application/mcp-server-card+json',
        url: 'https://agents.example.com/malformed/mcp.json',
        trustManifest: 42,
      },
    ],
  }, { rawSnapshotRef: 'sha256:malformed-trust-fixture' }),
  credentialBearingCatalog: {
    schemaVersion: 'ai-catalog.v1',
    publisher: { id: 'example.com' },
    rawSnapshotRef: 'sha256:credential-bearing-trust-fixture',
    resources: [
      {
        id: 'urn:example:agents:credential-bearing',
        type: 'application/mcp-server-card+json',
        mediaType: 'application/mcp-server-card+json',
        name: 'Credential Bearing Agent',
        url: 'https://agents.example.com/credential-safe-url/mcp.json',
        trustManifest: { identity: 'urn:example:agents:credential-bearing' },
        auth: {
          token: 'redacted-but-still-secret-shaped',
        },
        raw: {
          identifier: 'urn:example:agents:credential-bearing',
          displayName: 'Credential Bearing Agent',
          mediaType: 'application/mcp-server-card+json',
          url: 'https://agents.example.com/credential-safe-url/mcp.json',
          trustManifest: { identity: 'urn:example:agents:credential-bearing' },
          metadata: {
            trust: { provenance: ['https://agents.example.com/provenance.json'] },
          },
          auth: {
            token: 'redacted-but-still-secret-shaped',
          },
        },
      },
    ],
  } satisfies AiCatalogSnapshot,
} as const;

export const providerTrustFixtureCases: Record<string, ProviderTrustFixtureCase> = {
  verified: {
    description: 'RAP-side verification upgrades externally claimed metadata to verified.',
    catalog: providerTrustFixtures.verifiedCatalog,
    resourceId: 'urn:ai:reddi.tech:specialists:code-review',
    options: {
      verification: {
        status: 'verified',
        verifier: 'rap:local-fixture',
        checkedAt: '2026-06-18T10:55:00.000Z',
      },
    },
    expectedValid: true,
    expectedStatus: 'verified',
    expectedReasonCodes: ['rap_verified'],
  },
  claimed: {
    description: 'External trust metadata remains claimed until RAP verifies it.',
    catalog: providerTrustFixtures.verifiedCatalog,
    resourceId: 'urn:ai:reddi.tech:specialists:code-review',
    expectedValid: true,
    expectedStatus: 'claimed',
    expectedReasonCodes: ['external_claim_not_verified_by_rap'],
  },
  unverified: {
    description: 'Provider without trust metadata stays unverified.',
    catalog: providerTrustFixtures.unverifiedCatalog,
    resourceId: 'urn:example:agents:summary',
    expectedValid: true,
    expectedStatus: 'unverified',
    expectedReasonCodes: ['no_trust_metadata'],
  },
  failedVerification: {
    description: 'RAP-side verification failure is explicit and carries failure reasons.',
    catalog: providerTrustFixtures.verifiedCatalog,
    resourceId: 'urn:ai:reddi.tech:specialists:code-review',
    options: {
      verification: {
        status: 'failed_verification',
        verifier: 'rap:local-fixture',
        checkedAt: '2026-06-18T10:55:00.000Z',
        failureReasons: ['signature_ref_not_available'],
      },
    },
    expectedValid: true,
    expectedStatus: 'failed_verification',
    expectedReasonCodes: ['rap_verification_failed'],
  },
  malformedTrustManifest: {
    description: 'Malformed trust manifest fails closed.',
    catalog: providerTrustFixtures.malformedTrustCatalog,
    resourceId: 'urn:example:agents:malformed-trust',
    expectedValid: false,
    expectedReasonCodes: ['malformed_trust_metadata'],
  },
  credentialBearingMetadata: {
    description: 'Credential-bearing auth/payment/trust metadata fails closed.',
    catalog: providerTrustFixtures.credentialBearingCatalog,
    resourceId: 'urn:example:agents:credential-bearing',
    expectedValid: false,
    expectedReasonCodes: ['credential_leakage_rejected'],
  },
};
