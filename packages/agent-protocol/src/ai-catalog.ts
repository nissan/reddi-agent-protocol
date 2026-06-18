export const AI_CATALOG_SCHEMA_VERSION = 'ai-catalog.v1' as const;

export type AiCatalogResourceType = string;

export type AiCatalogValidationErrorCode =
  | 'malformed_catalog'
  | 'unsupported_resource_type'
  | 'invalid_identifier'
  | 'invalid_reference'
  | 'unsafe_url'
  | 'nested_catalog_boundary'
  | 'credential_leakage_rejected'
  | 'catalog_too_large';

export type AiCatalogValidationError = {
  code: AiCatalogValidationErrorCode;
  path: string;
  message: string;
};

export type AiCatalogPublisherSnapshot = {
  id: string;
  name?: string;
  domain?: string;
};

export type AiCatalogResourceSnapshot = {
  id: string;
  type: AiCatalogResourceType;
  mediaType: string;
  name: string;
  description?: string;
  url?: string;
  endpoint?: string;
  catalogUrl?: string;
  trustManifest?: unknown;
  capabilities?: unknown;
  payment?: unknown;
  auth?: unknown;
  raw: unknown;
};

export type AiCatalogSnapshot = {
  schemaVersion: typeof AI_CATALOG_SCHEMA_VERSION;
  publisher: AiCatalogPublisherSnapshot;
  resources: AiCatalogResourceSnapshot[];
  rawSnapshotRef?: string;
};

export type AiCatalogValidationSuccess = {
  ok: true;
  catalog: AiCatalogSnapshot;
  warnings: AiCatalogValidationError[];
};

export type AiCatalogValidationFailure = {
  ok: false;
  errors: AiCatalogValidationError[];
};

export type AiCatalogValidationResult = AiCatalogValidationSuccess | AiCatalogValidationFailure;

export type AiCatalogValidationOptions = {
  rawSnapshotRef?: string;
  maxBytes?: number;
};

export type AiCatalogFixtureCase = {
  description: string;
  catalog: unknown;
  expectedValid: boolean;
  expectedErrorCodes: AiCatalogValidationErrorCode[];
};

const AI_CATALOG_MEDIA_TYPE = 'application/ai-catalog+json';
const AI_IDENTIFIER_PATTERN = /^(urn:[a-z0-9][a-z0-9-]*:.+|https?:\/\/.+)$/i;
const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:\+[a-z0-9][a-z0-9!#$&^_.+-]*)?$/i;
const LEGACY_TYPE_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const SECRET_KEY_PATTERN = /(^|[_-])(api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|client[_-]?secret|authorization|bearer|password|secret|token)($|[_-])/i;
const SECRET_VALUE_PATTERN = /(authorization:\s*bearer\s+|sk-[a-z0-9_-]{8,}|xox[baprs]-|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

function error(code: AiCatalogValidationErrorCode, path: string, message: string): AiCatalogValidationError {
  return { code, path, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function byteLength(value: unknown): number | undefined {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return undefined;
  }
}

function containsCredentialMaterial(value: unknown, path = '$'): AiCatalogValidationError | undefined {
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERN.test(value)) {
      return error('credential_leakage_rejected', path, 'Credential-shaped string values are not allowed in AI Catalog metadata.');
    }
    return undefined;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const child = containsCredentialMaterial(value[index], `${path}[${index}]`);
      if (child) return child;
    }
    return undefined;
  }

  if (isPlainObject(value)) {
    for (const [key, childValue] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (SECRET_KEY_PATTERN.test(key)) {
        return error('credential_leakage_rejected', childPath, 'Credential-shaped keys are not allowed in AI Catalog metadata.');
      }
      const child = containsCredentialMaterial(childValue, childPath);
      if (child) return child;
    }
  }

  return undefined;
}

function validateSafeUrl(value: string, path: string): AiCatalogValidationError | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return error('invalid_reference', path, 'Reference must be a valid URL.');
  }

  if (parsed.username || parsed.password) {
    return error('unsafe_url', path, 'Reference URLs must not embed credentials.');
  }

  for (const key of parsed.searchParams.keys()) {
    if (SECRET_KEY_PATTERN.test(key)) {
      return error('credential_leakage_rejected', `${path}.${key}`, 'Reference URLs must not include credential-shaped query parameters.');
    }
  }

  for (const value of parsed.searchParams.values()) {
    if (SECRET_VALUE_PATTERN.test(value)) {
      return error('credential_leakage_rejected', path, 'Reference URLs must not include credential-shaped query values.');
    }
  }

  if (parsed.protocol === 'https:') return undefined;

  const localhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  if (parsed.protocol === 'http:' && localhost) return undefined;

  return error('unsafe_url', path, 'Reference URLs must use HTTPS, except localhost HTTP fixtures.');
}

function parsePublisher(value: unknown, path: string, errors: AiCatalogValidationError[]): AiCatalogPublisherSnapshot | undefined {
  if (typeof value === 'string' && value.trim()) return { id: value.trim() };
  if (!isPlainObject(value)) {
    errors.push(error('malformed_catalog', path, 'Catalog host/publisher must be a string or object.'));
    return undefined;
  }

  const id = asString(value.identifier) ?? asString(value.id) ?? asString(value.domain) ?? asString(value.displayName) ?? asString(value.name);
  if (!id) {
    errors.push(error('malformed_catalog', `${path}.identifier`, 'Catalog host/publisher must include identifier, id, domain, displayName, or name.'));
    return undefined;
  }

  return {
    id,
    name: asString(value.displayName) ?? asString(value.name),
    domain: asString(value.domain),
  };
}

function parseResources(value: Record<string, unknown>, errors: AiCatalogValidationError[]): AiCatalogResourceSnapshot[] {
  const rawResources = value.entries ?? value.resources ?? value.items;
  const resourcesPath = Array.isArray(value.entries) ? '$.entries' : Array.isArray(value.resources) ? '$.resources' : '$.items';
  if (!Array.isArray(rawResources)) {
    errors.push(error('malformed_catalog', '$.entries', 'Catalog must include an entries array.'));
    return [];
  }

  const resources: AiCatalogResourceSnapshot[] = [];
  for (let index = 0; index < rawResources.length; index += 1) {
    const path = `${resourcesPath}[${index}]`;
    const raw = rawResources[index];
    if (!isPlainObject(raw)) {
      errors.push(error('malformed_catalog', path, 'Catalog resource must be an object.'));
      continue;
    }

    const id = asString(raw.identifier) ?? asString(raw.id);
    if (!id || !AI_IDENTIFIER_PATTERN.test(id)) {
      errors.push(error('invalid_identifier', `${path}.identifier`, 'Catalog entry identifier must be a stable URN or URL.'));
    }

    const mediaType = asString(raw.mediaType) ?? asString(raw.type);
    if (!mediaType || (!MEDIA_TYPE_PATTERN.test(mediaType) && !LEGACY_TYPE_PATTERN.test(mediaType))) {
      errors.push(error('unsupported_resource_type', `${path}.mediaType`, 'Catalog entry mediaType must be a valid media type or legacy resource type.'));
    }

    const name = asString(raw.displayName) ?? asString(raw.name);
    if (!name) {
      errors.push(error('malformed_catalog', `${path}.displayName`, 'Catalog entry must include a non-empty displayName.'));
    }

    const url = asString(raw.url);
    const endpoint = asString(raw.endpoint);
    const catalogUrlRaw = asString(raw.catalogUrl) ?? asString(raw.catalog_url);
    const isNestedCatalog = mediaType === AI_CATALOG_MEDIA_TYPE || mediaType === 'catalog';
    const catalogUrl = isNestedCatalog ? (catalogUrlRaw ?? url) : catalogUrlRaw;
    const hasInlineData = Object.prototype.hasOwnProperty.call(raw, 'data');
    const referenceCount = [url, endpoint, catalogUrlRaw].filter(Boolean).length;

    if (hasInlineData && referenceCount > 0) {
      errors.push(error('invalid_reference', path, 'Catalog resources must not mix inline data with URL references.'));
    }
    if (!hasInlineData && referenceCount > 1) {
      errors.push(error('invalid_reference', path, 'Catalog resources must include exactly one URL reference.'));
    }
    if (!hasInlineData && referenceCount === 0) {
      errors.push(error('invalid_reference', path, 'Catalog resources must include inline data or one URL reference.'));
    }

    for (const [key, reference] of Object.entries({ url, endpoint, catalogUrl })) {
      if (!reference) continue;
      const invalidUrl = validateSafeUrl(reference, `${path}.${key}`);
      if (invalidUrl) errors.push(invalidUrl);
    }

    if (isNestedCatalog) {
      if (!catalogUrl || hasInlineData || endpoint || (url && catalogUrlRaw)) {
        errors.push(error('nested_catalog_boundary', path, 'Nested catalog entries must use a single URL reference.'));
      }
    } else if (catalogUrl) {
      errors.push(error('nested_catalog_boundary', `${path}.catalogUrl`, 'Only catalog resources may reference nested catalogs.'));
    }

    const metadata = isPlainObject(raw.metadata) ? raw.metadata : undefined;
    const rapMetadata = metadata && isPlainObject(metadata.rap) ? metadata.rap : undefined;

    if (id && mediaType && name) {
      resources.push({
        id,
        type: mediaType,
        mediaType,
        name,
        description: asString(raw.description),
        url,
        endpoint,
        catalogUrl,
        trustManifest: raw.trustManifest,
        capabilities: raw.capabilities ?? metadata?.capabilities,
        payment: raw.payment ?? rapMetadata?.payment ?? metadata?.payment,
        auth: raw.auth ?? rapMetadata?.auth ?? metadata?.auth,
        raw,
      });
    }
  }

  return resources;
}

export function validateAiCatalog(input: unknown, options: AiCatalogValidationOptions = {}): AiCatalogValidationResult {
  const maxBytes = options.maxBytes ?? 64_000;
  const errors: AiCatalogValidationError[] = [];

  if (!isPlainObject(input)) {
    return { ok: false, errors: [error('malformed_catalog', '$', 'AI Catalog must be a plain object.')] };
  }

  const size = byteLength(input);
  if (size === undefined) {
    return { ok: false, errors: [error('malformed_catalog', '$', 'AI Catalog must be JSON-serializable.')] };
  }

  if (size > maxBytes) {
    return { ok: false, errors: [error('catalog_too_large', '$', `AI Catalog exceeds ${maxBytes} bytes.`)] };
  }

  const credentialLeak = containsCredentialMaterial(input);
  if (credentialLeak) return { ok: false, errors: [credentialLeak] };

  if (!asString(input.specVersion) && Object.prototype.hasOwnProperty.call(input, 'entries')) {
    errors.push(error('malformed_catalog', '$.specVersion', 'AI Catalog entries require a specVersion string.'));
  }

  const hostOrPublisher = input.host ?? input.publisher;
  const publisherPath = Object.prototype.hasOwnProperty.call(input, 'host') ? '$.host' : '$.publisher';
  const publisher = hostOrPublisher === undefined ? { id: 'unknown' } : parsePublisher(hostOrPublisher, publisherPath, errors);
  const resources = parseResources(input, errors);
  if (!publisher || errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    catalog: {
      schemaVersion: AI_CATALOG_SCHEMA_VERSION,
      publisher,
      resources,
      rawSnapshotRef: options.rawSnapshotRef,
    },
    warnings: [],
  };
}

export function createAiCatalogSnapshot(input: unknown, options: AiCatalogValidationOptions = {}): AiCatalogSnapshot {
  const result = validateAiCatalog(input, options);
  if (!result.ok) {
    throw new Error(`invalid_ai_catalog:${result.errors.map((item) => item.code).join(',')}`);
  }
  return result.catalog;
}

export const aiCatalogFixtures = {
  happyPath: {
    specVersion: '1.0',
    host: {
      identifier: 'reddi.tech',
      displayName: 'Reddi',
    },
    entries: [
      {
        identifier: 'urn:ai:reddi.tech:specialists:code-review',
        mediaType: 'application/mcp-server-card+json',
        displayName: 'Code Review Specialist',
        description: 'Reviews pull requests and emits RAP-compatible evidence.',
        url: 'https://agents.reddi.tech/code-review/mcp.json',
        metadata: {
          capabilities: ['code_review', 'risk_analysis'],
          rap: {
            payment: {
              protocol: 'rap',
              quoteMode: 'preflight',
              assets: [{ asset: 'AUDD', network: 'solana-devnet' }],
            },
            auth: {
              type: 'oauth',
              scopes: ['repo:read'],
            },
          },
        },
        trustManifest: {
          identity: 'urn:ai:reddi.tech:specialists:code-review',
          signature: {
            format: 'dsse',
            status: 'claimed',
          },
        },
      },
      {
        identifier: 'urn:ai:reddi.tech:apis:receipt-validator',
        mediaType: 'application/openapi+json',
        displayName: 'Receipt Validator API',
        url: 'https://agents.reddi.tech/apis/receipt-validator',
        metadata: {
          capabilities: ['receipt_validation'],
        },
      },
    ],
  },
  nestedCatalog: {
    specVersion: '1.0',
    host: {
      displayName: 'Reddi',
      identifier: 'reddi.tech',
    },
    entries: [
      {
        identifier: 'urn:ai:reddi.tech:catalogs:local-specialists',
        mediaType: AI_CATALOG_MEDIA_TYPE,
        displayName: 'Local Specialists Catalog',
        url: 'https://agents.reddi.tech/.well-known/local-specialists.ai-catalog.json',
      },
    ],
  },
  localhostFixture: {
    specVersion: '1.0',
    host: 'localhost',
    entries: [
      {
        identifier: 'urn:ai:localhost:fixtures:demo-specialist',
        mediaType: 'application/mcp-server-card+json',
        displayName: 'Demo MCP Specialist',
        url: 'http://localhost:4317/mcp',
      },
    ],
  },
} as const;

export const aiCatalogFixtureCases: Record<string, AiCatalogFixtureCase> = {
  happyPath: {
    description: 'Valid AI Catalog with RAP-compatible agent and API resources.',
    catalog: aiCatalogFixtures.happyPath,
    expectedValid: true,
    expectedErrorCodes: [],
  },
  nestedCatalog: {
    description: 'Valid nested catalog reference that keeps catalog boundaries explicit.',
    catalog: aiCatalogFixtures.nestedCatalog,
    expectedValid: true,
    expectedErrorCodes: [],
  },
  malformedCatalog: {
    description: 'Missing publisher and resources fails closed.',
    catalog: { name: 'not enough catalog shape' },
    expectedValid: false,
    expectedErrorCodes: ['malformed_catalog'],
  },
  unsupportedResourceType: {
    description: 'Unknown resource types are rejected.',
    catalog: {
      specVersion: '1.0',
      host: 'reddi.tech',
      entries: [
        {
          identifier: 'urn:ai:reddi.tech:unknown:thing',
          mediaType: 'not a media type!',
          displayName: 'Unsupported Thing',
          url: 'https://agents.reddi.tech/unsupported',
        },
      ],
    },
    expectedValid: false,
    expectedErrorCodes: ['unsupported_resource_type'],
  },
  unsafeUrl: {
    description: 'Non-HTTPS non-localhost references are rejected.',
    catalog: {
      specVersion: '1.0',
      host: 'reddi.tech',
      entries: [
        {
          identifier: 'urn:ai:reddi.tech:specialists:unsafe',
          mediaType: 'application/mcp-server-card+json',
          displayName: 'Unsafe Specialist',
          url: 'http://agents.reddi.tech/unsafe',
        },
      ],
    },
    expectedValid: false,
    expectedErrorCodes: ['unsafe_url'],
  },
  credentialLeakage: {
    description: 'Credential-shaped metadata is rejected before ingestion.',
    catalog: {
      specVersion: '1.0',
      host: 'reddi.tech',
      entries: [
        {
          identifier: 'urn:ai:reddi.tech:specialists:leaky',
          mediaType: 'application/mcp-server-card+json',
          displayName: 'Leaky Specialist',
          url: 'https://agents.reddi.tech/leaky',
          auth: {
            accessToken: 'tok_should_not_be_in_catalogs',
          },
        },
      ],
    },
    expectedValid: false,
    expectedErrorCodes: ['credential_leakage_rejected'],
  },
};
