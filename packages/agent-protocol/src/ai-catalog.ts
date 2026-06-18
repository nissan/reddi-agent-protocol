export const AI_CATALOG_SCHEMA_VERSION = 'ai-catalog.v1' as const;

export type AiCatalogResourceType =
  | 'agent'
  | 'api'
  | 'mcp_server'
  | 'mcp-server'
  | 'skill'
  | 'tool'
  | 'catalog'
  | 'a2a_agent'
  | 'a2a-agent';

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

const SUPPORTED_RESOURCE_TYPES = new Set<AiCatalogResourceType>([
  'agent',
  'api',
  'mcp_server',
  'mcp-server',
  'skill',
  'tool',
  'catalog',
  'a2a_agent',
  'a2a-agent',
]);

const AI_URN_PATTERN = /^urn:ai:[a-z0-9][a-z0-9.-]*:[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/i;
const SECRET_KEY_PATTERN = /(api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|client[_-]?secret|authorization|bearer|password|secret)/i;
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

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
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

  if (parsed.protocol === 'https:') return undefined;

  const localhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  if (parsed.protocol === 'http:' && localhost) return undefined;

  return error('unsafe_url', path, 'Reference URLs must use HTTPS, except localhost HTTP fixtures.');
}

function parsePublisher(value: unknown, errors: AiCatalogValidationError[]): AiCatalogPublisherSnapshot | undefined {
  if (typeof value === 'string' && value.trim()) return { id: value.trim() };
  if (!isPlainObject(value)) {
    errors.push(error('malformed_catalog', '$.publisher', 'Catalog publisher must be a string or object.'));
    return undefined;
  }

  const id = asString(value.id) ?? asString(value.domain) ?? asString(value.name);
  if (!id) {
    errors.push(error('malformed_catalog', '$.publisher.id', 'Catalog publisher must include id, domain, or name.'));
    return undefined;
  }

  return {
    id,
    name: asString(value.name),
    domain: asString(value.domain),
  };
}

function parseResources(value: Record<string, unknown>, errors: AiCatalogValidationError[]): AiCatalogResourceSnapshot[] {
  const rawResources = value.resources ?? value.items;
  if (!Array.isArray(rawResources)) {
    errors.push(error('malformed_catalog', '$.resources', 'Catalog must include a resources or items array.'));
    return [];
  }

  const resources: AiCatalogResourceSnapshot[] = [];
  for (let index = 0; index < rawResources.length; index += 1) {
    const path = `$.resources[${index}]`;
    const raw = rawResources[index];
    if (!isPlainObject(raw)) {
      errors.push(error('malformed_catalog', path, 'Catalog resource must be an object.'));
      continue;
    }

    const id = asString(raw.id);
    if (!id || !AI_URN_PATTERN.test(id)) {
      errors.push(error('invalid_identifier', `${path}.id`, 'Resource id must be a domain-anchored urn:ai identifier.'));
    }

    const type = asString(raw.type) as AiCatalogResourceType | undefined;
    if (!type || !SUPPORTED_RESOURCE_TYPES.has(type)) {
      errors.push(error('unsupported_resource_type', `${path}.type`, 'Resource type is not supported by RAP AI Catalog ingestion.'));
    }

    const name = asString(raw.name);
    if (!name) {
      errors.push(error('malformed_catalog', `${path}.name`, 'Catalog resource must include a non-empty name.'));
    }

    const url = asString(raw.url);
    const endpoint = asString(raw.endpoint);
    const catalogUrl = asString(raw.catalogUrl) ?? asString(raw.catalog_url);
    const hasInlineData = Object.prototype.hasOwnProperty.call(raw, 'data');
    const referenceCount = [url, endpoint, catalogUrl].filter(Boolean).length;

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

    if (type === 'catalog') {
      if (!catalogUrl || hasInlineData || url || endpoint) {
        errors.push(error('nested_catalog_boundary', path, 'Nested catalog resources must use catalogUrl only.'));
      }
    } else if (catalogUrl) {
      errors.push(error('nested_catalog_boundary', `${path}.catalogUrl`, 'Only catalog resources may reference nested catalogs.'));
    }

    if (id && type && SUPPORTED_RESOURCE_TYPES.has(type) && name) {
      resources.push({
        id,
        type,
        name,
        description: asString(raw.description),
        url,
        endpoint,
        catalogUrl,
        trustManifest: raw.trustManifest,
        capabilities: raw.capabilities,
        payment: raw.payment,
        auth: raw.auth,
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

  if (byteLength(input) > maxBytes) {
    return { ok: false, errors: [error('catalog_too_large', '$', `AI Catalog exceeds ${maxBytes} bytes.`)] };
  }

  const credentialLeak = containsCredentialMaterial(input);
  if (credentialLeak) return { ok: false, errors: [credentialLeak] };

  const publisher = parsePublisher(input.publisher, errors);
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
    publisher: {
      id: 'reddi.tech',
      name: 'Reddi',
      domain: 'reddi.tech',
    },
    resources: [
      {
        id: 'urn:ai:reddi.tech:specialists:code-review',
        type: 'agent',
        name: 'Code Review Specialist',
        description: 'Reviews pull requests and emits RAP-compatible evidence.',
        endpoint: 'https://agents.reddi.tech/code-review',
        capabilities: ['code_review', 'risk_analysis'],
        trustManifest: {
          url: 'https://agents.reddi.tech/.well-known/trust/code-review.json',
          signature: {
            format: 'dsse',
            status: 'claimed',
          },
        },
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
      {
        id: 'urn:ai:reddi.tech:apis:receipt-validator',
        type: 'api',
        name: 'Receipt Validator API',
        url: 'https://agents.reddi.tech/apis/receipt-validator',
        capabilities: ['receipt_validation'],
      },
    ],
  },
  nestedCatalog: {
    publisher: 'reddi.tech',
    resources: [
      {
        id: 'urn:ai:reddi.tech:catalogs:local-specialists',
        type: 'catalog',
        name: 'Local Specialists Catalog',
        catalogUrl: 'https://agents.reddi.tech/.well-known/local-specialists.ai-catalog.json',
      },
    ],
  },
  localhostFixture: {
    publisher: 'localhost',
    resources: [
      {
        id: 'urn:ai:localhost:fixtures:demo-specialist',
        type: 'mcp_server',
        name: 'Demo MCP Specialist',
        endpoint: 'http://localhost:4317/mcp',
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
      publisher: 'reddi.tech',
      resources: [
        {
          id: 'urn:ai:reddi.tech:unknown:thing',
          type: 'model_context_plugin',
          name: 'Unsupported Thing',
          endpoint: 'https://agents.reddi.tech/unsupported',
        },
      ],
    },
    expectedValid: false,
    expectedErrorCodes: ['unsupported_resource_type'],
  },
  unsafeUrl: {
    description: 'Non-HTTPS non-localhost references are rejected.',
    catalog: {
      publisher: 'reddi.tech',
      resources: [
        {
          id: 'urn:ai:reddi.tech:specialists:unsafe',
          type: 'agent',
          name: 'Unsafe Specialist',
          endpoint: 'http://agents.reddi.tech/unsafe',
        },
      ],
    },
    expectedValid: false,
    expectedErrorCodes: ['unsafe_url'],
  },
  credentialLeakage: {
    description: 'Credential-shaped metadata is rejected before ingestion.',
    catalog: {
      publisher: 'reddi.tech',
      resources: [
        {
          id: 'urn:ai:reddi.tech:specialists:leaky',
          type: 'agent',
          name: 'Leaky Specialist',
          endpoint: 'https://agents.reddi.tech/leaky',
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
