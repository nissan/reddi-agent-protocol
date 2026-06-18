export const AGENT_STACK_FIXTURE_CORPUS_SCHEMA_VERSION = 'reddi.agent-stack-fixture-corpus.v1' as const;

export type AgentStackFixtureSurfaceKind =
  | 'repo-marketplace-metadata'
  | 'claude-plugin'
  | 'managed-agent-cookbook'
  | 'mcp-connector-config'
  | 'skill'
  | 'command'
  | 'subagent'
  | 'partner-plugin'
  | 'vertical-plugin'
  | 'validation-warning';

export type AgentStackFixtureValidationErrorCode =
  | 'malformed_fixture_corpus'
  | 'invalid_source_reference'
  | 'credential_leakage_rejected'
  | 'invalid_commit_ref'
  | 'invalid_timestamp'
  | 'unsafe_url'
  | 'corpus_too_large';

export type AgentStackFixtureValidationError = {
  code: AgentStackFixtureValidationErrorCode;
  path: string;
  message: string;
};

export type AgentStackFixtureSource = {
  sourceUrl: string;
  checkedCommit: string;
  checkedRef?: string;
  license?: string;
  sourceNotes: string[];
  authenticityNotes: string[];
  crawlTimestamp: string;
  localResearchArtifactPath?: string;
};

export type AgentStackFixtureFile = {
  path: string;
  kind: AgentStackFixtureSurfaceKind;
  present: boolean;
  parseStatus: 'valid' | 'malformed' | 'not_parsed' | 'missing';
  mediaType?: string;
  summary?: string;
  warningCodes?: string[];
};

export type AgentStackFixtureSurface = {
  id: string;
  name: string;
  kind: AgentStackFixtureSurfaceKind;
  path: string;
  category?: string;
  runtimeSurface?: string;
  commands?: string[];
  skills?: string[];
  toolGrants?: string[];
  authDependencies?: string[];
  dataDependencies?: string[];
  safetyHints?: string[];
  humanReviewHints?: string[];
  writeCapable?: boolean;
  contentTrustBoundary: 'untrusted_public_text' | 'metadata_only';
  notes?: string[];
};

export type AgentStackFixtureValidationWarning = {
  code: string;
  severity: 'info' | 'warning' | 'blocked';
  path: string;
  message: string;
};

export type AgentStackFixtureCorpus = {
  schemaVersion: typeof AGENT_STACK_FIXTURE_CORPUS_SCHEMA_VERSION;
  id: string;
  title: string;
  source: AgentStackFixtureSource;
  surfaces: AgentStackFixtureSurface[];
  files: AgentStackFixtureFile[];
  validationWarnings: AgentStackFixtureValidationWarning[];
  staticOnly: true;
  nonGoals: string[];
};

export type AgentStackFixtureValidationSuccess = {
  ok: true;
  corpus: AgentStackFixtureCorpus;
  warnings: AgentStackFixtureValidationWarning[];
};

export type AgentStackFixtureValidationFailure = {
  ok: false;
  errors: AgentStackFixtureValidationError[];
};

export type AgentStackFixtureValidationResult =
  | AgentStackFixtureValidationSuccess
  | AgentStackFixtureValidationFailure;

export type AgentStackFixtureValidationOptions = {
  maxBytes?: number;
};

export type AgentStackFixtureCase = {
  description: string;
  corpus: unknown;
  expectedValid: boolean;
  expectedErrorCodes: AgentStackFixtureValidationErrorCode[];
};

const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/i;
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._~@:/+*{}[\], -]+$/;
const SECRET_KEY_PATTERN = /(^|[_-])(api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|client[_-]?secret|authorization|bearer|cookie|password|secret|seed|session[_-]?token|signature|sig|token)($|[_-])|apiKey|accessToken|refreshToken|sessionToken|privateKey|X-Goog-Signature|X-Amz-Signature/i;
const SECRET_VALUE_PATTERN = /(authorization:\s*bearer\s+|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,}|xox[baprs]-|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const SUPPORTED_SURFACE_KINDS: readonly AgentStackFixtureSurfaceKind[] = [
  'repo-marketplace-metadata',
  'claude-plugin',
  'managed-agent-cookbook',
  'mcp-connector-config',
  'skill',
  'command',
  'subagent',
  'partner-plugin',
  'vertical-plugin',
  'validation-warning',
];
const WARNING_SEVERITIES: readonly AgentStackFixtureValidationWarning['severity'][] = ['info', 'warning', 'blocked'];

function error(
  code: AgentStackFixtureValidationErrorCode,
  path: string,
  message: string,
): AgentStackFixtureValidationError {
  return { code, path, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function byteLength(value: unknown): number | undefined {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return undefined;
  }
}

function findCredentialMaterial(value: unknown, path = '$'): string | undefined {
  if (typeof value === 'string') return SECRET_VALUE_PATTERN.test(value) ? path : undefined;
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
    if (SECRET_KEY_PATTERN.test(key)) return childPath;
    const found = findCredentialMaterial(child, childPath);
    if (found) return found;
  }
  return undefined;
}

function validateSafeUrl(value: unknown, path: string, errors: AgentStackFixtureValidationError[]): void {
  if (!isNonEmptyString(value)) {
    errors.push(error('invalid_source_reference', path, 'source URL must be a non-empty string'));
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    errors.push(error('invalid_source_reference', path, 'source URL must be a valid URL'));
    return;
  }

  if (parsed.protocol !== 'https:') {
    errors.push(error('unsafe_url', path, 'source URL must use HTTPS'));
  }
  if (parsed.username || parsed.password) {
    errors.push(error('unsafe_url', path, 'source URL must not embed credentials'));
  }
  for (const key of parsed.searchParams.keys()) {
    if (SECRET_KEY_PATTERN.test(key)) {
      errors.push(error('credential_leakage_rejected', `${path}.${key}`, 'source URL must not include credential-shaped query keys'));
    }
  }
  for (const queryValue of parsed.searchParams.values()) {
    if (SECRET_VALUE_PATTERN.test(queryValue)) {
      errors.push(error('credential_leakage_rejected', path, 'source URL must not include credential-shaped query values'));
    }
  }
}

function validateTimestamp(value: unknown, path: string, errors: AgentStackFixtureValidationError[]): void {
  if (!isNonEmptyString(value) || Number.isNaN(Date.parse(value))) {
    errors.push(error('invalid_timestamp', path, 'crawlTimestamp must be an ISO timestamp'));
  }
}

function validateStringArray(value: unknown, path: string, errors: AgentStackFixtureValidationError[]): void {
  if (!isStringArray(value) || value.length === 0 || value.some((item) => !item.trim())) {
    errors.push(error('malformed_fixture_corpus', path, 'field must be a non-empty string array'));
  }
}

function validatePath(value: unknown, path: string, errors: AgentStackFixtureValidationError[]): void {
  if (!isNonEmptyString(value) || !SAFE_PATH_PATTERN.test(value)) {
    errors.push(error('invalid_source_reference', path, 'path must be a safe static source path'));
    return;
  }

  if (value.startsWith('/')) {
    errors.push(error('invalid_source_reference', path, 'path must be relative to the static fixture root'));
  }

  if (/^[A-Za-z]:\//.test(value)) {
    errors.push(error('invalid_source_reference', path, 'path must not use a drive-letter prefix'));
  }

  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    errors.push(error('invalid_source_reference', path, 'path must not use a URI scheme'));
  }

  const segments = value.split(/[/:]+/);
  if (segments.includes('..')) {
    errors.push(error('invalid_source_reference', path, 'path must not include traversal segments'));
  }
}

function validateSurface(value: unknown, path: string, errors: AgentStackFixtureValidationError[]): void {
  if (!isPlainObject(value)) {
    errors.push(error('malformed_fixture_corpus', path, 'surface must be an object'));
    return;
  }
  for (const key of ['id', 'name', 'kind', 'path'] as const) {
    if (!isNonEmptyString(value[key])) {
      errors.push(error('malformed_fixture_corpus', `${path}.${key}`, 'surface field must be a non-empty string'));
    }
  }
  if (isNonEmptyString(value.kind) && !SUPPORTED_SURFACE_KINDS.includes(value.kind as AgentStackFixtureSurfaceKind)) {
    errors.push(error('malformed_fixture_corpus', `${path}.kind`, 'surface kind is unsupported'));
  }
  validatePath(value.path, `${path}.path`, errors);
  if (!['untrusted_public_text', 'metadata_only'].includes(String(value.contentTrustBoundary))) {
    errors.push(error('malformed_fixture_corpus', `${path}.contentTrustBoundary`, 'surface must declare its content trust boundary'));
  }
}

function validateFile(value: unknown, path: string, errors: AgentStackFixtureValidationError[]): void {
  if (!isPlainObject(value)) {
    errors.push(error('malformed_fixture_corpus', path, 'file entry must be an object'));
    return;
  }
  validatePath(value.path, `${path}.path`, errors);
  if (!isNonEmptyString(value.kind)) {
    errors.push(error('malformed_fixture_corpus', `${path}.kind`, 'file kind must be a non-empty string'));
  } else if (!SUPPORTED_SURFACE_KINDS.includes(value.kind as AgentStackFixtureSurfaceKind)) {
    errors.push(error('malformed_fixture_corpus', `${path}.kind`, 'file kind is unsupported'));
  }
  if (typeof value.present !== 'boolean') {
    errors.push(error('malformed_fixture_corpus', `${path}.present`, 'file present must be a boolean'));
  }
  if (!['valid', 'malformed', 'not_parsed', 'missing'].includes(String(value.parseStatus))) {
    errors.push(error('malformed_fixture_corpus', `${path}.parseStatus`, 'file parseStatus is unsupported'));
  }
}

function validateWarning(value: unknown, path: string, errors: AgentStackFixtureValidationError[]): void {
  if (!isPlainObject(value)) {
    errors.push(error('malformed_fixture_corpus', path, 'validation warning must be an object'));
    return;
  }
  if (!isNonEmptyString(value.code)) {
    errors.push(error('malformed_fixture_corpus', `${path}.code`, 'warning code must be a non-empty string'));
  }
  if (!WARNING_SEVERITIES.includes(value.severity as AgentStackFixtureValidationWarning['severity'])) {
    errors.push(error('malformed_fixture_corpus', `${path}.severity`, 'warning severity is unsupported'));
  }
  validatePath(value.path, `${path}.path`, errors);
  if (!isNonEmptyString(value.message)) {
    errors.push(error('malformed_fixture_corpus', `${path}.message`, 'warning message must be a non-empty string'));
  }
}

export function validateAgentStackFixtureCorpus(
  input: unknown,
  options: AgentStackFixtureValidationOptions = {},
): AgentStackFixtureValidationResult {
  const maxBytes = options.maxBytes ?? 96_000;
  const errors: AgentStackFixtureValidationError[] = [];

  if (!isPlainObject(input)) {
    return { ok: false, errors: [error('malformed_fixture_corpus', '$', 'agent-stack fixture corpus must be a plain object')] };
  }

  const size = byteLength(input);
  if (size === undefined) {
    return { ok: false, errors: [error('malformed_fixture_corpus', '$', 'fixture corpus must be JSON-serializable')] };
  }
  if (size > maxBytes) {
    return { ok: false, errors: [error('corpus_too_large', '$', `fixture corpus exceeds ${maxBytes} bytes`)] };
  }

  const credentialPath = findCredentialMaterial(input);
  if (credentialPath) {
    return {
      ok: false,
      errors: [error('credential_leakage_rejected', credentialPath, 'fixture corpus must not contain credential-shaped material')],
    };
  }

  if (input.schemaVersion !== AGENT_STACK_FIXTURE_CORPUS_SCHEMA_VERSION) {
    errors.push(error('malformed_fixture_corpus', '$.schemaVersion', `expected ${AGENT_STACK_FIXTURE_CORPUS_SCHEMA_VERSION}`));
  }
  if (!isNonEmptyString(input.id)) errors.push(error('malformed_fixture_corpus', '$.id', 'id must be a non-empty string'));
  if (!isNonEmptyString(input.title)) errors.push(error('malformed_fixture_corpus', '$.title', 'title must be a non-empty string'));
  if (input.staticOnly !== true) errors.push(error('malformed_fixture_corpus', '$.staticOnly', 'fixture corpus must be staticOnly=true'));
  validateStringArray(input.nonGoals, '$.nonGoals', errors);

  if (!isPlainObject(input.source)) {
    errors.push(error('malformed_fixture_corpus', '$.source', 'source must be an object'));
  } else {
    validateSafeUrl(input.source.sourceUrl, '$.source.sourceUrl', errors);
    if (!isNonEmptyString(input.source.checkedCommit) || !COMMIT_SHA_PATTERN.test(input.source.checkedCommit)) {
      errors.push(error('invalid_commit_ref', '$.source.checkedCommit', 'checkedCommit must be a 40-character commit SHA'));
    }
    validateStringArray(input.source.sourceNotes, '$.source.sourceNotes', errors);
    validateStringArray(input.source.authenticityNotes, '$.source.authenticityNotes', errors);
    validateTimestamp(input.source.crawlTimestamp, '$.source.crawlTimestamp', errors);
    if (input.source.localResearchArtifactPath !== undefined) {
      validatePath(input.source.localResearchArtifactPath, '$.source.localResearchArtifactPath', errors);
    }
  }

  if (!Array.isArray(input.surfaces) || input.surfaces.length === 0) {
    errors.push(error('malformed_fixture_corpus', '$.surfaces', 'surfaces must be a non-empty array'));
  } else {
    input.surfaces.forEach((surface, index) => validateSurface(surface, `$.surfaces[${index}]`, errors));
  }

  if (!Array.isArray(input.files) || input.files.length === 0) {
    errors.push(error('malformed_fixture_corpus', '$.files', 'files must be a non-empty array'));
  } else {
    input.files.forEach((file, index) => validateFile(file, `$.files[${index}]`, errors));
  }

  if (!Array.isArray(input.validationWarnings)) {
    errors.push(error('malformed_fixture_corpus', '$.validationWarnings', 'validationWarnings must be an array'));
  } else {
    input.validationWarnings.forEach((warning, index) => validateWarning(warning, `$.validationWarnings[${index}]`, errors));
  }

  return errors.length === 0
    ? {
      ok: true,
      corpus: input as AgentStackFixtureCorpus,
      warnings: (input as AgentStackFixtureCorpus).validationWarnings,
    }
    : { ok: false, errors };
}

export function createAgentStackFixtureCorpus(input: unknown, options: AgentStackFixtureValidationOptions = {}): AgentStackFixtureCorpus {
  const result = validateAgentStackFixtureCorpus(input, options);
  if (!result.ok) {
    throw new Error(`invalid_agent_stack_fixture_corpus:${result.errors.map((item) => item.code).join(',')}`);
  }
  return result.corpus;
}

export const agentStackFixtureCorpora = {
  anthropicFinancialServices: {
    schemaVersion: AGENT_STACK_FIXTURE_CORPUS_SCHEMA_VERSION,
    id: 'agent-stack-fixture:anthropic-financial-services:2026-06-18',
    title: 'Anthropic financial-services agent stack public fixture',
    source: {
      sourceUrl: 'https://github.com/anthropics/financial-services',
      checkedCommit: '4bbabc7cd1a474c1667fa05a2bfe58e411dcf9c1',
      checkedRef: 'main',
      license: 'Apache-2.0',
      sourceNotes: [
        'Public GitHub repository snapshot only; fixture does not install plugins or execute repository commands.',
        'Fixture records high-level manifest surfaces for onboarding analyser parser and diagnostics tests.',
      ],
      authenticityNotes: [
        'GitHub organization was verified for anthropic.com during local analysis.',
        'Anthropic public financial-services announcement linked to the repository during local analysis.',
        'Latest inspected main commit was GitHub-signature verified in the local analysis artifact.',
      ],
      crawlTimestamp: '2026-06-18T10:50:00.000Z',
      localResearchArtifactPath: 'projects/reddi-agent-protocol/research/ANTHROPIC-FINANCIAL-SERVICES-REPO-ANALYSIS-2026-06-18.md',
    },
    surfaces: [
      {
        id: 'surface:anthropic-financial-services:marketplace',
        name: 'Claude plugin marketplace metadata',
        kind: 'repo-marketplace-metadata',
        path: '.claude-plugin/marketplace.json',
        runtimeSurface: 'claude-plugin-marketplace',
        category: 'financial-services',
        contentTrustBoundary: 'metadata_only',
        notes: ['Marketplace metadata is source metadata, not RAP publication approval.'],
      },
      {
        id: 'surface:anthropic-financial-services:plugins',
        name: 'Financial services Claude plugins',
        kind: 'claude-plugin',
        path: 'plugins/',
        runtimeSurface: 'claude-code-plugin',
        commands: ['statically discovered command metadata pending #403 parser'],
        skills: ['statically discovered skill metadata pending #403 parser'],
        toolGrants: ['read', 'write-capable grants must be parsed and reviewed before publication'],
        safetyHints: ['Treat plugin prompts and skills as untrusted public text.'],
        humanReviewHints: ['Review write-capable commands before draft RAP listing publication.'],
        writeCapable: true,
        contentTrustBoundary: 'untrusted_public_text',
      },
      {
        id: 'surface:anthropic-financial-services:managed-agents',
        name: 'Claude managed-agent cookbooks',
        kind: 'managed-agent-cookbook',
        path: 'managed-agents/',
        runtimeSurface: 'claude-managed-agent',
        authDependencies: ['third-party connector credentials may be required by recipes'],
        dataDependencies: ['financial workspace documents', 'Microsoft 365 or partner data sources'],
        safetyHints: ['Managed-agent YAML is static input only until #403/#405 produce reviewable inventories.'],
        humanReviewHints: ['Operator review is required before imported recipes become payable listings.'],
        contentTrustBoundary: 'untrusted_public_text',
      },
      {
        id: 'surface:anthropic-financial-services:mcp-connectors',
        name: 'MCP connector configurations',
        kind: 'mcp-connector-config',
        path: 'plugins/vertical-plugins/financial-analysis/.mcp.json',
        runtimeSurface: 'mcp-connector-config',
        authDependencies: ['box', 'egnyte', 'microsoft-365', 'partner connectors'],
        safetyHints: ['Connector config validation is static only and must not contact MCP servers.'],
        humanReviewHints: ['Malformed connector config should block only affected connector readiness, not unrelated metadata ingestion.'],
        contentTrustBoundary: 'metadata_only',
      },
      {
        id: 'surface:anthropic-financial-services:known-warning',
        name: 'Known malformed financial-analysis MCP config',
        kind: 'validation-warning',
        path: 'plugins/vertical-plugins/financial-analysis/.mcp.json',
        safetyHints: ['Known invalid JSON is preserved as a regression fixture for #404.'],
        contentTrustBoundary: 'metadata_only',
      },
    ],
    files: [
      {
        path: '.claude-plugin/marketplace.json',
        kind: 'repo-marketplace-metadata',
        present: true,
        parseStatus: 'not_parsed',
        mediaType: 'application/json',
        summary: 'Repository-level marketplace metadata for Claude plugin distribution.',
      },
      {
        path: 'plugins/**/plugin.json',
        kind: 'claude-plugin',
        present: true,
        parseStatus: 'not_parsed',
        mediaType: 'application/json',
        summary: 'Plugin manifests for horizontal, vertical, and partner packages.',
      },
      {
        path: 'managed-agents/**/agent.yaml',
        kind: 'managed-agent-cookbook',
        present: true,
        parseStatus: 'not_parsed',
        mediaType: 'application/yaml',
        summary: 'Managed-agent cookbook metadata; parser support belongs to #403.',
      },
      {
        path: 'plugins/vertical-plugins/financial-analysis/.mcp.json',
        kind: 'mcp-connector-config',
        present: true,
        parseStatus: 'malformed',
        mediaType: 'application/json',
        warningCodes: ['malformed_mcp_json'],
        summary: 'Known malformed connector manifest from local analysis; full diagnostics belong to #404.',
      },
    ],
    validationWarnings: [
      {
        code: 'malformed_mcp_json',
        severity: 'warning',
        path: 'plugins/vertical-plugins/financial-analysis/.mcp.json',
        message: 'Known malformed JSON should fail closed for connector diagnostics while preserving partial static ingestion.',
      },
      {
        code: 'untrusted_prompt_text',
        severity: 'info',
        path: 'plugins/',
        message: 'Public prompt, skill, and command text is untrusted fixture content and cannot alter analyser behavior.',
      },
    ],
    staticOnly: true,
    nonGoals: [
      'Do not install Claude plugins.',
      'Do not execute repository scripts, commands, managed agents, or MCP servers.',
      'Do not fetch paid/provider data or require credentials.',
      'Do not publish imported surfaces as payable RAP listings without operator review.',
    ],
  },
} as const satisfies Record<string, AgentStackFixtureCorpus>;

export const agentStackFixtureCases: Record<string, AgentStackFixtureCase> = {
  anthropicFinancialServices: {
    description: 'Valid public Anthropic financial-services agent-stack fixture corpus.',
    corpus: agentStackFixtureCorpora.anthropicFinancialServices,
    expectedValid: true,
    expectedErrorCodes: [],
  },
  malformedCorpus: {
    description: 'Missing source, files, and surfaces fails closed.',
    corpus: {
      schemaVersion: AGENT_STACK_FIXTURE_CORPUS_SCHEMA_VERSION,
      id: 'agent-stack-fixture:malformed',
      title: 'Malformed fixture',
      staticOnly: true,
      nonGoals: ['no execution'],
    },
    expectedValid: false,
    expectedErrorCodes: ['malformed_fixture_corpus'],
  },
  invalidCommit: {
    description: 'Fixture source must include an exact checked commit SHA.',
    corpus: {
      ...agentStackFixtureCorpora.anthropicFinancialServices,
      source: {
        ...agentStackFixtureCorpora.anthropicFinancialServices.source,
        checkedCommit: 'main',
      },
    },
    expectedValid: false,
    expectedErrorCodes: ['invalid_commit_ref'],
  },
  unsafeSourceUrl: {
    description: 'Fixture source URL must be HTTPS without embedded credentials.',
    corpus: {
      ...agentStackFixtureCorpora.anthropicFinancialServices,
      source: {
        ...agentStackFixtureCorpora.anthropicFinancialServices.source,
        sourceUrl: 'http://github.com/anthropics/financial-services',
      },
    },
    expectedValid: false,
    expectedErrorCodes: ['unsafe_url'],
  },
  credentialLeakage: {
    description: 'Credential-shaped metadata is rejected before fixture persistence.',
    corpus: {
      ...agentStackFixtureCorpora.anthropicFinancialServices,
      surfaces: [
        ...agentStackFixtureCorpora.anthropicFinancialServices.surfaces,
        {
          id: 'surface:leaky',
          name: 'Leaky Connector',
          kind: 'mcp-connector-config',
          path: 'plugins/leaky/.mcp.json',
          contentTrustBoundary: 'metadata_only',
          notes: ['authorization: bearer should-not-be-stored'],
        },
      ],
    },
    expectedValid: false,
    expectedErrorCodes: ['credential_leakage_rejected'],
  },
};
