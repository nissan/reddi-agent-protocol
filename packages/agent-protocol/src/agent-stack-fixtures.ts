export const AGENT_STACK_FIXTURE_CORPUS_SCHEMA_VERSION = 'reddi.agent-stack-fixture-corpus.v1' as const;
export const STATIC_AGENT_STACK_INGESTION_RESULT_SCHEMA_VERSION = 'reddi.static-agent-stack-ingestion-result.v1' as const;
export const STATIC_AGENT_STACK_CAPABILITY_INVENTORY_SCHEMA_VERSION = 'reddi.static-agent-stack-capability-inventory.v1' as const;
export const STATIC_AGENT_STACK_DRAFT_PAYLOADS_SCHEMA_VERSION = 'reddi.static-agent-stack-draft-payloads.v1' as const;
export const STATIC_AGENT_STACK_OPERATOR_REVIEW_PAYLOAD_SCHEMA_VERSION = 'reddi.static-agent-stack-operator-review-payload.v1' as const;

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
  parseErrorLocation?: string;
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

export type StaticAgentStackIngestionStatus =
  | 'ready_for_draft'
  | 'partial_success'
  | 'blocked';

export type StaticAgentStackInventoryEntry = {
  id: string;
  name: string;
  kind: AgentStackFixtureSurfaceKind;
  sourcePath: string;
  runtimeSurface?: string;
  category?: string;
  commands: string[];
  skills: string[];
  toolGrants: string[];
  authDependencies: string[];
  dataDependencies: string[];
  safetyHints: string[];
  humanReviewHints: string[];
  writeCapable: boolean;
  contentTrustBoundary: AgentStackFixtureSurface['contentTrustBoundary'];
};

export type StaticAgentStackCapabilityInventoryEntry = {
  capabilityId: string;
  capabilityName: string;
  sourceKind: AgentStackFixtureSurfaceKind;
  sourcePath: string;
  runtimeSurface?: string;
  category?: string;
  commands: string[];
  skills: string[];
  toolGrants: string[];
  authDependencies: string[];
  dataDependencies: string[];
  safetyHints: string[];
  humanReviewHints: string[];
  writeCapable: boolean;
  sideEffectRisk: 'none' | 'read' | 'write' | 'execute';
  contentTrustBoundary: AgentStackFixtureSurface['contentTrustBoundary'];
  provenance: {
    corpusId: string;
    sourceUrl: string;
    checkedCommit: string;
    checkedRef?: string;
    license?: string;
  };
};

export type StaticAgentStackParserDiagnostic = {
  path: string;
  sourceKind: AgentStackFixtureSurfaceKind | 'validation-warning';
  severity: AgentStackFixtureValidationWarning['severity'];
  code: string;
  message: string;
};

export type StaticAgentStackCapabilityInventoryBundle = {
  schemaVersion: typeof STATIC_AGENT_STACK_CAPABILITY_INVENTORY_SCHEMA_VERSION;
  corpusId: string;
  source: AgentStackFixtureSource;
  entries: StaticAgentStackCapabilityInventoryEntry[];
  parserDiagnostics: StaticAgentStackParserDiagnostic[];
  rejectedEntries: StaticAgentStackRejectedEntry[];
};

export type StaticAgentStackConnectorDiagnostic = {
  path: string;
  sourceKind: 'mcp-connector-config';
  diagnosticLane: 'mcp_connector_metadata';
  parseStatus: AgentStackFixtureFile['parseStatus'];
  parseErrorLocation?: string;
  severity: AgentStackFixtureValidationWarning['severity'];
  warningCodes: string[];
  blocksDraftPayload: boolean;
  operatorReviewRequired: boolean;
  message: string;
};

export type StaticAgentStackRiskCategory =
  | 'executable_hook'
  | 'installer_or_update_script'
  | 'deploy_capable_command'
  | 'wallet_rpc_capable_metadata'
  | 'local_binary_requirement'
  | 'env_required_connector'
  | 'mcp_launcher_execution'
  | 'external_submodule'
  | 'permission_policy';

export type StaticAgentStackRiskDiagnostic = {
  path: string;
  sourceKind: AgentStackFixtureSurfaceKind | 'validation-warning';
  diagnosticLane: 'static_fixture_risk_taxonomy';
  category: StaticAgentStackRiskCategory;
  severity: AgentStackFixtureValidationWarning['severity'];
  warningCodes: string[];
  blocksDraftPayload: boolean;
  operatorReviewRequired: boolean;
  message: string;
};

export type StaticAgentStackRejectedEntry = {
  path: string;
  reasonCode: string;
  message: string;
};

export type StaticAgentStackDraftPayloadReadiness = {
  status: 'ready' | 'needs_review' | 'blocked';
  blockers: string[];
  payloadRefs: string[];
};

export type StaticAgentStackDraftStateCode =
  | 'listing_draft'
  | 'missing_payment'
  | 'missing_endpoint'
  | 'malformed_connector'
  | 'missing_connector'
  | 'static_risk_review_required'
  | 'rejected_entry'
  | 'unsafe_metadata_warning';

export type StaticAgentStackDraftState = {
  code: StaticAgentStackDraftStateCode;
  severity: AgentStackFixtureValidationWarning['severity'];
  path?: string;
  message: string;
};

export type StaticAgentStackDraftProfile = {
  schemaVersion: 'reddi.agent-profile.draft.v1';
  profileId: string;
  displayName: string;
  sourceType: 'static-agent-stack-fixture';
  source: AgentStackFixtureSource;
  capabilities: StaticAgentStackCapabilityInventoryEntry[];
  invocation: {
    endpointType: 'static-fixture-only';
    endpointUrl?: string;
    missingEndpoint: boolean;
  };
  payment: {
    status: 'missing_payment_setup';
    activation: 'disabled';
  };
  trust: {
    sourceAuthenticity: 'verified_source_snapshot';
    contentTrust: 'untrusted_imported_content';
    verifiedProviderTrust: false;
  };
  policyRequirements: string[];
  evidenceExpectations: string[];
  rawSnapshotRefs: string[];
};

export type StaticAgentStackAiCatalogFragment = {
  specVersion: '1.0';
  resources: Array<{
    id: string;
    type: 'agent-stack-draft';
    mediaType: 'application/vnd.reddi.agent-profile+json';
    name: string;
    description: string;
    capabilities: string[];
    source: {
      url: string;
      checkedCommit: string;
      checkedRef?: string;
    };
    trust: {
      status: 'unverified';
      note: string;
    };
    payment: {
      status: 'missing_payment_setup';
    };
  }>;
};

export type StaticAgentStackListingPayload = {
  schemaVersion: 'reddi.registry-listing.draft.v1';
  listingId: string;
  status: 'draft' | 'needs_review' | 'blocked';
  profileRef: string;
  publicationDisabled: true;
  operatorReviewRequired: true;
  states: StaticAgentStackDraftState[];
};

export type StaticAgentStackDraftPayloads = {
  schemaVersion: typeof STATIC_AGENT_STACK_DRAFT_PAYLOADS_SCHEMA_VERSION;
  profile: StaticAgentStackDraftProfile;
  aiCatalogFragment: StaticAgentStackAiCatalogFragment;
  listing: StaticAgentStackListingPayload;
};

export type StaticAgentStackOperatorReviewStatus =
  | 'approve_ready'
  | 'request_changes'
  | 'rejected'
  | 'suspended';

export type StaticAgentStackOperatorReviewStateCode =
  | 'approve_ready_draft'
  | 'rejected_malformed_connector'
  | 'request_changes_missing_payment'
  | 'unsafe_metadata_warning'
  | 'suspended_imported_listing'
  | 'static_risk_blocker';

export type StaticAgentStackOperatorReviewItem = {
  id: string;
  state: StaticAgentStackOperatorReviewStateCode;
  severity: AgentStackFixtureValidationWarning['severity'];
  path?: string;
  source:
    | 'draft_payload'
    | 'connector_diagnostic'
    | 'risk_diagnostic'
    | 'rejected_entry'
    | 'validation_warning';
  reasonCodes: string[];
  message: string;
  blocksPublication: boolean;
  recommendedAction:
    | 'approve_after_readiness_gates'
    | 'request_payment_setup'
    | 'request_endpoint_binding'
    | 'reject_or_fix_malformed_connector'
    | 'review_static_risk'
    | 'review_unsafe_metadata'
    | 'keep_suspended';
};

export type StaticAgentStackOperatorReviewGroup = {
  groupId: string;
  name: string;
  sourceKind: AgentStackFixtureSurfaceKind;
  sourcePath: string;
  runtimeSurface?: string;
  capabilityRefs: string[];
  writeCapable: boolean;
  humanReviewRequired: boolean;
  rawSnapshotRefs: string[];
};

export type StaticAgentStackOperatorReviewPayload = {
  schemaVersion: typeof STATIC_AGENT_STACK_OPERATOR_REVIEW_PAYLOAD_SCHEMA_VERSION;
  reviewId: string;
  corpusId: string;
  status: StaticAgentStackOperatorReviewStatus;
  source: {
    sourceUrl: string;
    checkedCommit: string;
    checkedRef?: string;
    sourceAuthenticity: 'source_snapshot_recorded';
    providerTrust: 'unverified';
    importedContentTrust: 'untrusted';
  };
  publication: {
    disabled: true;
    requiresOperatorApproval: true;
    readinessGateRefs: ['#373', '#377'];
  };
  payment: {
    status: 'missing_payment_setup';
    activation: 'disabled';
    operatorAction: 'request_payment_setup';
  };
  groups: StaticAgentStackOperatorReviewGroup[];
  reviewItems: StaticAgentStackOperatorReviewItem[];
  buyerPreview: {
    capabilityRelevance: 'static_capability_inventory_only';
    sourceAuthenticity: 'snapshot_recorded_not_provider_trust';
    trustEvidence: 'unverified_until_operator_review';
    paymentReadiness: 'missing_payment_setup';
    safetyRisk: 'operator_review_required';
    reputation: 'none_for_imported_fixture';
  };
  rawSnapshotRefs: string[];
};

export type StaticAgentStackOperatorReviewFixtureState =
  | 'approve_ready_draft'
  | 'request_changes_draft'
  | 'rejected_draft'
  | 'suspended_draft';

export type StaticAgentStackOperatorReviewFixtureViewport = {
  name: 'mobile' | 'tablet' | 'desktop';
  width: number;
  height: number;
  requiredStates: StaticAgentStackOperatorReviewStateCode[];
  requiredGroupKinds: AgentStackFixtureSurfaceKind[];
};

export type StaticAgentStackOperatorReviewFixture = {
  fixtureId: string;
  description: string;
  fixtureState: StaticAgentStackOperatorReviewFixtureState;
  queueState: StaticAgentStackOperatorReviewStatus;
  uiTestRefs: string[];
  operatorReviewPayload: StaticAgentStackOperatorReviewPayload;
  requiredReviewItemStates: StaticAgentStackOperatorReviewStateCode[];
  requiredGroupKinds: AgentStackFixtureSurfaceKind[];
  requiredRiskCategories: StaticAgentStackRiskCategory[];
  viewportCoverage: StaticAgentStackOperatorReviewFixtureViewport[];
  staticOnly: true;
  guardrails: readonly string[];
};

export type StaticAgentStackIngestionResult = {
  schemaVersion: typeof STATIC_AGENT_STACK_INGESTION_RESULT_SCHEMA_VERSION;
  corpusId: string;
  title: string;
  source: AgentStackFixtureSource;
  status: StaticAgentStackIngestionStatus;
  inventory: StaticAgentStackInventoryEntry[];
  capabilityInventory: StaticAgentStackCapabilityInventoryBundle;
  connectorDiagnostics: StaticAgentStackConnectorDiagnostic[];
  riskDiagnostics: StaticAgentStackRiskDiagnostic[];
  rejectedEntries: StaticAgentStackRejectedEntry[];
  warnings: AgentStackFixtureValidationWarning[];
  draftPayloadReadiness: StaticAgentStackDraftPayloadReadiness;
  draftPayloads: StaticAgentStackDraftPayloads;
  operatorReviewPayload: StaticAgentStackOperatorReviewPayload;
  staticOnly: true;
  nonGoals: string[];
};

const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/i;
const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
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
const STATIC_RISK_CODE_MAP: Record<string, {
  category: StaticAgentStackRiskCategory;
  severity: AgentStackFixtureValidationWarning['severity'];
  blocksDraftPayload: boolean;
  message: string;
}> = {
  deploy_capable_commands: {
    category: 'deploy_capable_command',
    severity: 'blocked',
    blocksDraftPayload: true,
    message: 'Deploy-capable command metadata must be reviewed before draft publication.',
  },
  wallet_rpc_adjacent_commands: {
    category: 'wallet_rpc_capable_metadata',
    severity: 'blocked',
    blocksDraftPayload: true,
    message: 'Wallet, signing, or RPC-capable command metadata must be reviewed before draft publication.',
  },
  npx_mcp_execution: {
    category: 'mcp_launcher_execution',
    severity: 'warning',
    blocksDraftPayload: true,
    message: 'npx-launched MCP metadata must be reviewed before draft publication.',
  },
  env_required_connector: {
    category: 'env_required_connector',
    severity: 'warning',
    blocksDraftPayload: true,
    message: 'Environment-required connector metadata must be reviewed before draft publication.',
  },
  local_binary_required: {
    category: 'local_binary_requirement',
    severity: 'warning',
    blocksDraftPayload: true,
    message: 'Local-binary connector metadata must be reviewed before draft publication.',
  },
  executable_hooks: {
    category: 'executable_hook',
    severity: 'blocked',
    blocksDraftPayload: true,
    message: 'Executable hook metadata must be reviewed before draft publication.',
  },
  mainnet_deploy_guard_required: {
    category: 'deploy_capable_command',
    severity: 'blocked',
    blocksDraftPayload: true,
    message: 'Mainnet deploy guard metadata must be reviewed before draft publication.',
  },
  permission_policy: {
    category: 'permission_policy',
    severity: 'warning',
    blocksDraftPayload: false,
    message: 'Permission policy metadata requires operator review before enablement.',
  },
  private_path_denylist: {
    category: 'permission_policy',
    severity: 'warning',
    blocksDraftPayload: false,
    message: 'Private-path denylist metadata requires operator review before enablement.',
  },
  external_submodules_declared: {
    category: 'external_submodule',
    severity: 'blocked',
    blocksDraftPayload: true,
    message: 'External submodule declarations must be reviewed before draft publication.',
  },
  installer_script_non_executable_fixture: {
    category: 'installer_or_update_script',
    severity: 'blocked',
    blocksDraftPayload: true,
    message: 'Installer, update, or test script metadata must be reviewed before draft publication.',
  },
  mcp_connector_requires_operator_review: {
    category: 'env_required_connector',
    severity: 'warning',
    blocksDraftPayload: true,
    message: 'Connector metadata that requires credentials, hosted services, or local binaries must be reviewed before draft publication.',
  },
  executable_hooks_require_operator_review: {
    category: 'executable_hook',
    severity: 'blocked',
    blocksDraftPayload: true,
    message: 'Executable hook metadata must be reviewed before draft publication.',
  },
  solana_deploy_command_requires_operator_review: {
    category: 'deploy_capable_command',
    severity: 'blocked',
    blocksDraftPayload: true,
    message: 'Deploy-capable Solana command metadata must be reviewed before draft publication.',
  },
  external_submodules_not_initialized: {
    category: 'external_submodule',
    severity: 'warning',
    blocksDraftPayload: true,
    message: 'External submodule declarations must be reviewed before draft publication.',
  },
};

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
  if (!isNonEmptyString(value) || !RFC3339_UTC_PATTERN.test(value)) {
    errors.push(error('invalid_timestamp', path, 'crawlTimestamp must be an ISO timestamp'));
    return;
  }

  const parsed = new Date(value);
  const normalized = value.includes('.') ? value : value.replace('Z', '.000Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== normalized) {
    errors.push(error('invalid_timestamp', path, 'crawlTimestamp must be a valid ISO timestamp'));
  }
}

function validateStringArray(value: unknown, path: string, errors: AgentStackFixtureValidationError[]): void {
  if (!isStringArray(value) || value.length === 0 || value.some((item) => !item.trim())) {
    errors.push(error('malformed_fixture_corpus', path, 'field must be a non-empty string array'));
  }
}

function validateOptionalString(value: unknown, path: string, errors: AgentStackFixtureValidationError[]): void {
  if (value !== undefined && !isNonEmptyString(value)) {
    errors.push(error('malformed_fixture_corpus', path, 'field must be a non-empty string when present'));
  }
}

function validateOptionalStringArray(value: unknown, path: string, errors: AgentStackFixtureValidationError[]): void {
  if (value !== undefined && (!isStringArray(value) || value.some((item) => !item.trim()))) {
    errors.push(error('malformed_fixture_corpus', path, 'field must be a string array when present'));
  }
}

function validateOptionalBoolean(value: unknown, path: string, errors: AgentStackFixtureValidationError[]): void {
  if (value !== undefined && typeof value !== 'boolean') {
    errors.push(error('malformed_fixture_corpus', path, 'field must be a boolean when present'));
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
  validateOptionalString(value.category, `${path}.category`, errors);
  validateOptionalString(value.runtimeSurface, `${path}.runtimeSurface`, errors);
  validateOptionalStringArray(value.commands, `${path}.commands`, errors);
  validateOptionalStringArray(value.skills, `${path}.skills`, errors);
  validateOptionalStringArray(value.toolGrants, `${path}.toolGrants`, errors);
  validateOptionalStringArray(value.authDependencies, `${path}.authDependencies`, errors);
  validateOptionalStringArray(value.dataDependencies, `${path}.dataDependencies`, errors);
  validateOptionalStringArray(value.safetyHints, `${path}.safetyHints`, errors);
  validateOptionalStringArray(value.humanReviewHints, `${path}.humanReviewHints`, errors);
  validateOptionalBoolean(value.writeCapable, `${path}.writeCapable`, errors);
  validateOptionalStringArray(value.notes, `${path}.notes`, errors);
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
  validateOptionalString(value.parseErrorLocation, `${path}.parseErrorLocation`, errors);
  validateOptionalString(value.mediaType, `${path}.mediaType`, errors);
  validateOptionalString(value.summary, `${path}.summary`, errors);
  validateOptionalStringArray(value.warningCodes, `${path}.warningCodes`, errors);
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
    validateOptionalString(input.source.checkedRef, '$.source.checkedRef', errors);
    validateOptionalString(input.source.license, '$.source.license', errors);
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

function connectorMessage(file: AgentStackFixtureFile, warning?: AgentStackFixtureValidationWarning): string {
  if (warning?.message) return warning.message;
  switch (file.parseStatus) {
    case 'valid':
      return 'Connector metadata is statically valid.';
    case 'malformed':
      return 'Connector metadata is malformed and must be diagnosed before draft publication.';
    case 'missing':
      return 'Connector metadata file is missing.';
    case 'not_parsed':
    default:
      return 'Connector metadata is recorded but not parsed yet.';
  }
}

function connectorBlocksDraftPayload(diagnostic: Pick<StaticAgentStackConnectorDiagnostic, 'parseStatus'>): boolean {
  return diagnostic.parseStatus === 'malformed' || diagnostic.parseStatus === 'missing';
}

function connectorRequiresOperatorReview(file: AgentStackFixtureFile, warning?: AgentStackFixtureValidationWarning): boolean {
  return file.parseStatus !== 'valid' || (file.warningCodes?.length ?? 0) > 0 || warning !== undefined;
}

function maxSeverity(
  left: AgentStackFixtureValidationWarning['severity'],
  right: AgentStackFixtureValidationWarning['severity'],
): AgentStackFixtureValidationWarning['severity'] {
  if (left === 'blocked' || right === 'blocked') return 'blocked';
  if (left === 'warning' || right === 'warning') return 'warning';
  return 'info';
}

function createRiskDiagnostics(corpus: AgentStackFixtureCorpus): StaticAgentStackRiskDiagnostic[] {
  const byPathAndCategory = new Map<string, StaticAgentStackRiskDiagnostic>();
  const addRisk = (
    path: string,
    sourceKind: StaticAgentStackRiskDiagnostic['sourceKind'],
    code: string,
    severityOverride?: AgentStackFixtureValidationWarning['severity'],
  ): void => {
    const mapped = STATIC_RISK_CODE_MAP[code];
    if (!mapped) return;

    const key = `${path}:${mapped.category}`;
    const severity = severityOverride ? maxSeverity(mapped.severity, severityOverride) : mapped.severity;
    const existing = byPathAndCategory.get(key);
    if (existing) {
      byPathAndCategory.set(key, {
        ...existing,
        severity: maxSeverity(existing.severity, severity),
        warningCodes: existing.warningCodes.includes(code) ? existing.warningCodes : [...existing.warningCodes, code],
        blocksDraftPayload: existing.blocksDraftPayload || mapped.blocksDraftPayload,
        operatorReviewRequired: true,
      });
      return;
    }

    byPathAndCategory.set(key, {
      path,
      sourceKind,
      diagnosticLane: 'static_fixture_risk_taxonomy',
      category: mapped.category,
      severity,
      warningCodes: [code],
      blocksDraftPayload: mapped.blocksDraftPayload,
      operatorReviewRequired: true,
      message: mapped.message,
    });
  };

  for (const file of corpus.files) {
    for (const code of file.warningCodes ?? []) {
      addRisk(file.path, file.kind, code);
    }
  }

  for (const warning of corpus.validationWarnings) {
    addRisk(warning.path, 'validation-warning', warning.code, warning.severity);
  }

  return [...byPathAndCategory.values()].sort((left, right) => (
    left.path.localeCompare(right.path)
    || left.category.localeCompare(right.category)
  ));
}

function sideEffectRiskFromSurface(surface: AgentStackFixtureSurface): StaticAgentStackCapabilityInventoryEntry['sideEffectRisk'] {
  const combinedHints = [
    ...(surface.commands ?? []),
    ...(surface.toolGrants ?? []),
    ...(surface.safetyHints ?? []),
    surface.runtimeSurface ?? '',
  ].join(' ').toLowerCase();
  if (
    combinedHints.includes('hook')
    || combinedHints.includes('bash')
    || combinedHints.includes('shell')
    || combinedHints.includes('deploy')
    || combinedHints.includes('install')
    || combinedHints.includes('npx')
  ) {
    return 'execute';
  }
  if (surface.writeCapable) return 'write';
  if (combinedHints.includes('rpc') || combinedHints.includes('browser') || combinedHints.includes('api')) return 'read';
  return 'none';
}

function createCapabilityInventoryBundle(
  corpus: AgentStackFixtureCorpus,
  inventory: StaticAgentStackInventoryEntry[],
  rejectedEntries: StaticAgentStackRejectedEntry[],
): StaticAgentStackCapabilityInventoryBundle {
  const inventoryById = new Map(inventory.map((entry) => [entry.id, entry]));
  const entries = corpus.surfaces
    .filter((surface) => surface.kind !== 'validation-warning')
    .map((surface): StaticAgentStackCapabilityInventoryEntry => {
      const inventoryEntry = inventoryById.get(surface.id);
      return {
        capabilityId: surface.id,
        capabilityName: surface.name,
        sourceKind: surface.kind,
        sourcePath: surface.path,
        runtimeSurface: surface.runtimeSurface,
        category: surface.category,
        commands: inventoryEntry?.commands ?? [],
        skills: inventoryEntry?.skills ?? [],
        toolGrants: inventoryEntry?.toolGrants ?? [],
        authDependencies: inventoryEntry?.authDependencies ?? [],
        dataDependencies: inventoryEntry?.dataDependencies ?? [],
        safetyHints: inventoryEntry?.safetyHints ?? [],
        humanReviewHints: inventoryEntry?.humanReviewHints ?? [],
        writeCapable: inventoryEntry?.writeCapable ?? false,
        sideEffectRisk: sideEffectRiskFromSurface(surface),
        contentTrustBoundary: surface.contentTrustBoundary,
        provenance: {
          corpusId: corpus.id,
          sourceUrl: corpus.source.sourceUrl,
          checkedCommit: corpus.source.checkedCommit,
          checkedRef: corpus.source.checkedRef,
          license: corpus.source.license,
        },
      };
    });
  const malformedFileDiagnostics = corpus.files
    .filter((file) => file.parseStatus === 'malformed')
    .map((file): StaticAgentStackParserDiagnostic => ({
      path: file.path,
      sourceKind: file.kind,
      severity: 'blocked',
      code: 'malformed_static_metadata',
      message: file.parseErrorLocation
        ? `Static metadata is malformed at ${file.parseErrorLocation}.`
        : 'Static metadata is malformed.',
    }));
  const warningDiagnostics = corpus.validationWarnings.map((warning): StaticAgentStackParserDiagnostic => ({
    path: warning.path,
    sourceKind: 'validation-warning',
    severity: warning.severity,
    code: warning.code,
    message: warning.message,
  }));

  return {
    schemaVersion: STATIC_AGENT_STACK_CAPABILITY_INVENTORY_SCHEMA_VERSION,
    corpusId: corpus.id,
    source: corpus.source,
    entries,
    parserDiagnostics: [...malformedFileDiagnostics, ...warningDiagnostics].sort((left, right) => (
      left.path.localeCompare(right.path)
      || left.code.localeCompare(right.code)
    )),
    rejectedEntries,
  };
}

function readinessFromCorpus(
  corpus: AgentStackFixtureCorpus,
  connectorDiagnostics: StaticAgentStackConnectorDiagnostic[],
  riskDiagnostics: StaticAgentStackRiskDiagnostic[],
  rejectedEntries: StaticAgentStackRejectedEntry[],
): StaticAgentStackDraftPayloadReadiness {
  const blockers = [
    ...rejectedEntries.map((entry) => entry.reasonCode),
    ...riskDiagnostics
      .filter((diagnostic) => diagnostic.blocksDraftPayload)
      .map((diagnostic) => `static_risk:${diagnostic.category}:${diagnostic.path}`),
    ...connectorDiagnostics
      .filter((diagnostic) => diagnostic.parseStatus === 'malformed')
      .map((diagnostic) => `malformed_connector:${diagnostic.path}`),
    ...connectorDiagnostics
      .filter((diagnostic) => diagnostic.parseStatus === 'missing')
      .map((diagnostic) => `missing_connector:${diagnostic.path}`),
  ];

  if (blockers.length > 0) {
    return { status: 'blocked', blockers, payloadRefs: [] };
  }

  if (
    corpus.validationWarnings.length > 0
    || connectorDiagnostics.some((diagnostic) => diagnostic.parseStatus !== 'valid')
    || riskDiagnostics.some((diagnostic) => diagnostic.operatorReviewRequired)
  ) {
    return {
      status: 'needs_review',
      blockers: ['operator_review_required'],
      payloadRefs: [],
    };
  }

  return {
    status: 'ready',
    blockers: [],
    payloadRefs: [`static-ingestion:${corpus.id}:draft-profile`, `static-ingestion:${corpus.id}:draft-listing`],
  };
}

function draftStateSeverityFromReadiness(status: StaticAgentStackDraftPayloadReadiness['status']): StaticAgentStackListingPayload['status'] {
  if (status === 'blocked') return 'blocked';
  if (status === 'needs_review') return 'needs_review';
  return 'draft';
}

function rawSnapshotRefsForCorpus(corpus: AgentStackFixtureCorpus): string[] {
  return [
    `source:${corpus.source.sourceUrl}#${corpus.source.checkedCommit}`,
    ...(corpus.source.localResearchArtifactPath ? [`local:${corpus.source.localResearchArtifactPath}`] : []),
  ];
}

function createDraftPayloads(
  corpus: AgentStackFixtureCorpus,
  capabilityInventory: StaticAgentStackCapabilityInventoryBundle,
  connectorDiagnostics: StaticAgentStackConnectorDiagnostic[],
  riskDiagnostics: StaticAgentStackRiskDiagnostic[],
  rejectedEntries: StaticAgentStackRejectedEntry[],
  warnings: AgentStackFixtureValidationWarning[],
  draftPayloadReadiness: StaticAgentStackDraftPayloadReadiness,
): StaticAgentStackDraftPayloads {
  const draftStates: StaticAgentStackDraftState[] = [
    {
      code: 'listing_draft',
      severity: 'info',
      message: 'Imported static fixture is a draft only until operator approval and readiness gates pass.',
    },
    {
      code: 'missing_payment',
      severity: 'warning',
      message: 'Imported static fixture has no payment setup; payment activation is disabled.',
    },
    {
      code: 'missing_endpoint',
      severity: 'warning',
      message: 'Imported static fixture has no invocation endpoint; endpoint binding must be supplied before publication.',
    },
    ...connectorDiagnostics
      .filter((diagnostic) => diagnostic.parseStatus === 'malformed' || diagnostic.parseStatus === 'missing')
      .map((diagnostic): StaticAgentStackDraftState => ({
        code: diagnostic.parseStatus === 'missing' ? 'missing_connector' : 'malformed_connector',
        severity: 'blocked',
        path: diagnostic.path,
        message: diagnostic.message,
      })),
    ...riskDiagnostics
      .filter((diagnostic) => diagnostic.operatorReviewRequired)
      .map((diagnostic): StaticAgentStackDraftState => ({
        code: 'static_risk_review_required',
        severity: diagnostic.blocksDraftPayload ? 'blocked' : diagnostic.severity,
        path: diagnostic.path,
        message: diagnostic.message,
      })),
    ...rejectedEntries.map((entry): StaticAgentStackDraftState => ({
      code: 'rejected_entry',
      severity: 'blocked',
      path: entry.path,
      message: entry.message,
    })),
    ...warnings
      .filter((warning) => warning.severity !== 'blocked')
      .map((warning): StaticAgentStackDraftState => ({
        code: 'unsafe_metadata_warning',
        severity: warning.severity,
        path: warning.path,
        message: warning.message,
      })),
  ];
  const profileId = `draft-profile:${corpus.id}`;
  const listingId = `draft-listing:${corpus.id}`;
  const capabilityLabels = capabilityInventory.entries.flatMap((entry) => [
    entry.capabilityName,
    ...entry.commands,
    ...entry.skills,
  ]);

  return {
    schemaVersion: STATIC_AGENT_STACK_DRAFT_PAYLOADS_SCHEMA_VERSION,
    profile: {
      schemaVersion: 'reddi.agent-profile.draft.v1',
      profileId,
      displayName: corpus.title,
      sourceType: 'static-agent-stack-fixture',
      source: corpus.source,
      capabilities: capabilityInventory.entries,
      invocation: {
        endpointType: 'static-fixture-only',
        missingEndpoint: true,
      },
      payment: {
        status: 'missing_payment_setup',
        activation: 'disabled',
      },
      trust: {
        sourceAuthenticity: 'verified_source_snapshot',
        contentTrust: 'untrusted_imported_content',
        verifiedProviderTrust: false,
      },
      policyRequirements: [
        'operator_review_required',
        'payment_setup_required',
        'endpoint_binding_required',
      ],
      evidenceExpectations: [
        'source_snapshot_reference',
        'operator_review_record',
        'readiness_gate_result',
      ],
      rawSnapshotRefs: rawSnapshotRefsForCorpus(corpus),
    },
    aiCatalogFragment: {
      specVersion: '1.0',
      resources: [{
        id: `urn:reddi:agent-stack-draft:${corpus.id}`,
        type: 'agent-stack-draft',
        mediaType: 'application/vnd.reddi.agent-profile+json',
        name: corpus.title,
        description: 'Draft RAP profile generated from an untrusted static agent-stack fixture.',
        capabilities: [...new Set(capabilityLabels)].sort(),
        source: {
          url: corpus.source.sourceUrl,
          checkedCommit: corpus.source.checkedCommit,
          checkedRef: corpus.source.checkedRef,
        },
        trust: {
          status: 'unverified',
          note: 'Source snapshot is recorded, but imported content and provider trust are unverified until RAP review.',
        },
        payment: {
          status: 'missing_payment_setup',
        },
      }],
    },
    listing: {
      schemaVersion: 'reddi.registry-listing.draft.v1',
      listingId,
      status: draftStateSeverityFromReadiness(draftPayloadReadiness.status),
      profileRef: profileId,
      publicationDisabled: true,
      operatorReviewRequired: true,
      states: draftStates,
    },
  };
}

function reviewItemId(corpusId: string, state: StaticAgentStackOperatorReviewStateCode, path?: string): string {
  return `operator-review:${corpusId}:${state}${path ? `:${path}` : ''}`;
}

function statusFromReviewItems(reviewItems: StaticAgentStackOperatorReviewItem[]): StaticAgentStackOperatorReviewStatus {
  if (reviewItems.some((item) => item.state === 'suspended_imported_listing')) return 'suspended';
  if (reviewItems.some((item) => item.state === 'rejected_malformed_connector' || item.state === 'static_risk_blocker')) return 'rejected';
  if (reviewItems.some((item) => item.state === 'request_changes_missing_payment' || item.state === 'unsafe_metadata_warning')) {
    return 'request_changes';
  }
  return 'approve_ready';
}

function createOperatorReviewPayload(
  corpus: AgentStackFixtureCorpus,
  capabilityInventory: StaticAgentStackCapabilityInventoryBundle,
  connectorDiagnostics: StaticAgentStackConnectorDiagnostic[],
  riskDiagnostics: StaticAgentStackRiskDiagnostic[],
  rejectedEntries: StaticAgentStackRejectedEntry[],
  warnings: AgentStackFixtureValidationWarning[],
  draftPayloads: StaticAgentStackDraftPayloads,
): StaticAgentStackOperatorReviewPayload {
  const rawSnapshotRefs = rawSnapshotRefsForCorpus(corpus);
  const reviewItems: StaticAgentStackOperatorReviewItem[] = [
    {
      id: reviewItemId(corpus.id, 'approve_ready_draft'),
      state: 'approve_ready_draft',
      severity: 'info',
      source: 'draft_payload',
      reasonCodes: ['operator_approval_required', 'readiness_gates_required'],
      message: 'Draft listing cannot become public until operator approval and readiness gates pass.',
      blocksPublication: true,
      recommendedAction: 'approve_after_readiness_gates',
    },
    {
      id: reviewItemId(corpus.id, 'request_changes_missing_payment'),
      state: 'request_changes_missing_payment',
      severity: 'warning',
      source: 'draft_payload',
      reasonCodes: ['missing_payment_setup'],
      message: 'Payment setup is missing; payment activation remains disabled.',
      blocksPublication: true,
      recommendedAction: 'request_payment_setup',
    },
    {
      id: reviewItemId(corpus.id, 'request_changes_missing_payment', 'invocation-endpoint'),
      state: 'request_changes_missing_payment',
      severity: 'warning',
      path: 'invocation-endpoint',
      source: 'draft_payload',
      reasonCodes: ['missing_endpoint_binding'],
      message: 'Invocation endpoint binding is missing and must be supplied before publication.',
      blocksPublication: true,
      recommendedAction: 'request_endpoint_binding',
    },
    ...connectorDiagnostics
      .filter((diagnostic) => diagnostic.parseStatus === 'malformed' || diagnostic.parseStatus === 'missing')
      .map((diagnostic): StaticAgentStackOperatorReviewItem => ({
        id: reviewItemId(corpus.id, 'rejected_malformed_connector', diagnostic.path),
        state: 'rejected_malformed_connector',
        severity: 'blocked',
        path: diagnostic.path,
        source: 'connector_diagnostic',
        reasonCodes: diagnostic.warningCodes,
        message: diagnostic.message,
        blocksPublication: true,
        recommendedAction: 'reject_or_fix_malformed_connector',
      })),
    ...riskDiagnostics
      .filter((diagnostic) => diagnostic.operatorReviewRequired)
      .map((diagnostic): StaticAgentStackOperatorReviewItem => ({
        id: reviewItemId(corpus.id, 'static_risk_blocker', diagnostic.path),
        state: 'static_risk_blocker',
        severity: diagnostic.blocksDraftPayload ? 'blocked' : diagnostic.severity,
        path: diagnostic.path,
        source: 'risk_diagnostic',
        reasonCodes: diagnostic.warningCodes,
        message: diagnostic.message,
        blocksPublication: true,
        recommendedAction: 'review_static_risk',
      })),
    ...rejectedEntries.map((entry): StaticAgentStackOperatorReviewItem => ({
      id: reviewItemId(corpus.id, 'suspended_imported_listing', entry.path),
      state: 'suspended_imported_listing',
      severity: 'blocked',
      path: entry.path,
      source: 'rejected_entry',
      reasonCodes: [entry.reasonCode],
      message: entry.message,
      blocksPublication: true,
      recommendedAction: 'keep_suspended',
    })),
    ...warnings
      .filter((warning) => warning.severity !== 'blocked')
      .map((warning): StaticAgentStackOperatorReviewItem => ({
        id: reviewItemId(corpus.id, 'unsafe_metadata_warning', warning.path),
        state: 'unsafe_metadata_warning',
        severity: warning.severity,
        path: warning.path,
        source: 'validation_warning',
        reasonCodes: [warning.code],
        message: warning.message,
        blocksPublication: warning.severity === 'warning',
        recommendedAction: 'review_unsafe_metadata',
      })),
  ];

  return {
    schemaVersion: STATIC_AGENT_STACK_OPERATOR_REVIEW_PAYLOAD_SCHEMA_VERSION,
    reviewId: `operator-review:${corpus.id}`,
    corpusId: corpus.id,
    status: statusFromReviewItems(reviewItems),
    source: {
      sourceUrl: corpus.source.sourceUrl,
      checkedCommit: corpus.source.checkedCommit,
      checkedRef: corpus.source.checkedRef,
      sourceAuthenticity: 'source_snapshot_recorded',
      providerTrust: 'unverified',
      importedContentTrust: 'untrusted',
    },
    publication: {
      disabled: true,
      requiresOperatorApproval: true,
      readinessGateRefs: ['#373', '#377'],
    },
    payment: {
      status: 'missing_payment_setup',
      activation: 'disabled',
      operatorAction: 'request_payment_setup',
    },
    groups: capabilityInventory.entries.map((entry): StaticAgentStackOperatorReviewGroup => ({
      groupId: `operator-review-group:${entry.capabilityId}`,
      name: entry.capabilityName,
      sourceKind: entry.sourceKind,
      sourcePath: entry.sourcePath,
      runtimeSurface: entry.runtimeSurface,
      capabilityRefs: [entry.capabilityId, ...entry.commands, ...entry.skills],
      writeCapable: entry.writeCapable,
      humanReviewRequired: (
        entry.humanReviewHints.length > 0
        || entry.writeCapable
        || entry.sideEffectRisk === 'write'
        || entry.sideEffectRisk === 'execute'
      ),
      rawSnapshotRefs,
    })),
    reviewItems,
    buyerPreview: {
      capabilityRelevance: 'static_capability_inventory_only',
      sourceAuthenticity: 'snapshot_recorded_not_provider_trust',
      trustEvidence: 'unverified_until_operator_review',
      paymentReadiness: 'missing_payment_setup',
      safetyRisk: 'operator_review_required',
      reputation: 'none_for_imported_fixture',
    },
    rawSnapshotRefs: draftPayloads.profile.rawSnapshotRefs,
  };
}

export function createStaticAgentStackIngestionResult(
  input: unknown,
  options: AgentStackFixtureValidationOptions = {},
): StaticAgentStackIngestionResult {
  const corpus = createAgentStackFixtureCorpus(input, options);
  const warningByPath = new Map(corpus.validationWarnings.map((warning) => [warning.path, warning]));
  const connectorFilesByPath = new Map(
    corpus.files
      .filter((file) => file.kind === 'mcp-connector-config')
      .map((file) => [file.path, file]),
  );
  const connectorDiagnostics = corpus.files
    .filter((file) => file.kind === 'mcp-connector-config')
    .map((file): StaticAgentStackConnectorDiagnostic => {
      const warning = warningByPath.get(file.path);
      return {
        path: file.path,
        sourceKind: 'mcp-connector-config',
        diagnosticLane: 'mcp_connector_metadata',
        parseStatus: file.parseStatus,
        ...(file.parseStatus === 'malformed' && file.parseErrorLocation ? { parseErrorLocation: file.parseErrorLocation } : {}),
        severity: warning?.severity ?? (file.parseStatus === 'valid' ? 'info' : 'warning'),
        warningCodes: file.warningCodes ?? [],
        blocksDraftPayload: connectorBlocksDraftPayload(file),
        operatorReviewRequired: connectorRequiresOperatorReview(file, warning),
        message: connectorMessage(file, warning),
      };
    })
    .concat(corpus.surfaces
      .filter((surface) => surface.kind === 'mcp-connector-config' && !connectorFilesByPath.has(surface.path))
      .map((surface): StaticAgentStackConnectorDiagnostic => ({
        path: surface.path,
        sourceKind: 'mcp-connector-config',
        diagnosticLane: 'mcp_connector_metadata',
        parseStatus: 'missing',
        severity: 'blocked',
        warningCodes: ['missing_mcp_connector_config'],
        blocksDraftPayload: true,
        operatorReviewRequired: true,
        message: 'MCP connector surface has no matching static connector metadata file.',
      })));
  const riskDiagnostics = createRiskDiagnostics(corpus);
  const rejectedEntries = corpus.validationWarnings
    .filter((warning) => warning.severity === 'blocked')
    .map((warning): StaticAgentStackRejectedEntry => ({
      path: warning.path,
      reasonCode: warning.code,
      message: warning.message,
    }));
  const inventory = corpus.surfaces
    .filter((surface) => surface.kind !== 'validation-warning')
    .map((surface): StaticAgentStackInventoryEntry => ({
      id: surface.id,
      name: surface.name,
      kind: surface.kind,
      sourcePath: surface.path,
      runtimeSurface: surface.runtimeSurface,
      category: surface.category,
      commands: surface.commands ?? [],
      skills: surface.skills ?? [],
      toolGrants: surface.toolGrants ?? [],
      authDependencies: surface.authDependencies ?? [],
      dataDependencies: surface.dataDependencies ?? [],
      safetyHints: surface.safetyHints ?? [],
      humanReviewHints: surface.humanReviewHints ?? [],
      writeCapable: surface.writeCapable ?? false,
      contentTrustBoundary: surface.contentTrustBoundary,
    }));
  const capabilityInventory = createCapabilityInventoryBundle(corpus, inventory, rejectedEntries);
  const draftPayloadReadiness = readinessFromCorpus(corpus, connectorDiagnostics, riskDiagnostics, rejectedEntries);
  const draftPayloads = createDraftPayloads(
    corpus,
    capabilityInventory,
    connectorDiagnostics,
    riskDiagnostics,
    rejectedEntries,
    corpus.validationWarnings,
    draftPayloadReadiness,
  );
  const operatorReviewPayload = createOperatorReviewPayload(
    corpus,
    capabilityInventory,
    connectorDiagnostics,
    riskDiagnostics,
    rejectedEntries,
    corpus.validationWarnings,
    draftPayloads,
  );
  const status: StaticAgentStackIngestionStatus = rejectedEntries.length > 0
    ? 'blocked'
    : draftPayloadReadiness.status !== 'ready'
      ? 'partial_success'
      : 'ready_for_draft';

  return {
    schemaVersion: STATIC_AGENT_STACK_INGESTION_RESULT_SCHEMA_VERSION,
    corpusId: corpus.id,
    title: corpus.title,
    source: corpus.source,
    status,
    inventory,
    capabilityInventory,
    connectorDiagnostics,
    riskDiagnostics,
    rejectedEntries,
    warnings: corpus.validationWarnings,
    draftPayloadReadiness,
    draftPayloads,
    operatorReviewPayload,
    staticOnly: true,
    nonGoals: corpus.nonGoals,
  };
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
        commands: ['statically discovered command metadata'],
        skills: ['statically discovered skill metadata'],
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
        parseErrorLocation: 'line 1 column 1',
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
  solanaAiKit: {
    schemaVersion: AGENT_STACK_FIXTURE_CORPUS_SCHEMA_VERSION,
    id: 'agent-stack-fixture:solanabr-solana-ai-kit:2026-06-19',
    title: 'Solana AI Kit public agent-stack fixture',
    source: {
      sourceUrl: 'https://github.com/solanabr/solana-ai-kit',
      checkedCommit: '4fb9d3d619467e068c1cf3120d3933aa933aeb21',
      checkedRef: 'main',
      license: 'MIT',
      sourceNotes: [
        'Public GitHub repository snapshot only; fixture does not install the kit, plugins, submodules, hooks, or MCP servers.',
        'Fixture records high-level Solana agent-stack surfaces for onboarding analyser parser, connector diagnostics, and operator-review tests.',
      ],
      authenticityNotes: [
        'GitHub repository metadata showed owner solanabr, MIT license, and default branch main during local analysis.',
        'Latest inspected commit was 4fb9d3d619467e068c1cf3120d3933aa933aeb21 with subject "feat: v2.0.2 - deny browser-wallet storage access + gate-bash-secrets PreToolUse hook".',
        'Local analysis confirmed a Solana-focused agent configuration toolkit with plugin metadata, agents, commands, MCP declarations, hooks, rules, skills, and submodule declarations.',
      ],
      crawlTimestamp: '2026-06-19T15:53:00.000Z',
      localResearchArtifactPath: 'projects/reddi-agent-protocol/research/SOLANABR-SOLANA-AI-KIT-ANALYSIS-2026-06-19.md',
    },
    surfaces: [
      {
        id: 'surface:solana-ai-kit:marketplace',
        name: 'Solana AI Kit marketplace metadata',
        kind: 'repo-marketplace-metadata',
        path: '.claude-plugin/marketplace.json',
        runtimeSurface: 'claude-plugin-marketplace',
        category: 'solana-agent-stack',
        contentTrustBoundary: 'metadata_only',
        notes: ['Marketplace metadata is source metadata, not RAP publication approval.'],
      },
      {
        id: 'surface:solana-ai-kit:plugin',
        name: 'Solana AI Kit Claude plugin manifest',
        kind: 'claude-plugin',
        path: 'plugin/.claude-plugin/plugin.json',
        runtimeSurface: 'claude-code-plugin',
        commands: ['solana-ai-kit namespaced commands'],
        skills: ['plugin skill hub'],
        toolGrants: ['plugin exposes MCP and hooks that require operator review before draft listing'],
        safetyHints: ['Treat plugin manifest and plugin-distributed commands as untrusted public metadata.'],
        humanReviewHints: ['Review plugin metadata before generating RAP listing copy.'],
        writeCapable: true,
        contentTrustBoundary: 'untrusted_public_text',
      },
      {
        id: 'surface:solana-ai-kit:agents',
        name: 'Solana specialist agent definitions',
        kind: 'subagent',
        path: '.claude/agents/*.md',
        runtimeSurface: 'claude-subagent',
        skills: ['solana architecture', 'anchor', 'pinocchio', 'token-2022', 'qa', 'mobile', 'frontend'],
        safetyHints: ['Agent instructions are untrusted text and cannot become RAP policy.'],
        humanReviewHints: ['Operator should review specialist claims before listing capabilities.'],
        contentTrustBoundary: 'untrusted_public_text',
      },
      {
        id: 'surface:solana-ai-kit:commands',
        name: 'Solana workflow commands',
        kind: 'command',
        path: '.claude/commands/*.md',
        runtimeSurface: 'claude-code-command',
        commands: ['audit-solana', 'build-program', 'debug-user-tx', 'deploy', 'generate-idl-client', 'profile-cu'],
        toolGrants: ['bash', 'git', 'solana-cli', 'anchor', 'cargo', 'npx'],
        safetyHints: ['Commands include deploy, RPC, wallet, and shell workflow guidance; ingestion must never execute them.'],
        humanReviewHints: ['Deploy-capable and wallet/RPC-capable command metadata requires explicit operator review.'],
        writeCapable: true,
        contentTrustBoundary: 'untrusted_public_text',
      },
      {
        id: 'surface:solana-ai-kit:mcp',
        name: 'Solana AI Kit MCP connector declarations',
        kind: 'mcp-connector-config',
        path: '.mcp.json',
        runtimeSurface: 'mcp-connector-config',
        authDependencies: ['HELIUS_API_KEY', 'optional hosted or local MCP server credentials'],
        dataDependencies: ['Solana RPC data', 'Solana docs', 'browser automation data', 'local Surfpool state'],
        safetyHints: ['Connector declarations include npx-launched and local-binary MCP servers; diagnostics are static only.'],
        humanReviewHints: ['Operator review required before enabling any connector, API key, hosted MCP, local binary, or wallet/RPC adjacent tool.'],
        contentTrustBoundary: 'metadata_only',
      },
      {
        id: 'surface:solana-ai-kit:hooks',
        name: 'Claude hooks and permission policy',
        kind: 'command',
        path: 'plugin/hooks/hooks.json',
        runtimeSurface: 'claude-code-hooks',
        commands: ['SessionStart', 'Stop', 'PostToolUse', 'PreToolUse'],
        toolGrants: ['bash', 'pre-commit hooks', 'pre-deploy hooks'],
        safetyHints: ['Hooks are executable shell metadata and must be review-gated before any draft publication.'],
        humanReviewHints: ['Review hook behavior, private-path deny rules, formatting hooks, commit hooks, and deploy hooks.'],
        writeCapable: true,
        contentTrustBoundary: 'untrusted_public_text',
      },
      {
        id: 'surface:solana-ai-kit:rules-skills',
        name: 'Solana rules and skill hub',
        kind: 'skill',
        path: '.claude/skills/*.md',
        runtimeSurface: 'claude-skill',
        skills: ['Anchor rules', 'Pinocchio rules', 'Rust rules', 'TypeScript rules', 'Token-2022 guide'],
        safetyHints: ['Rules and skill markdown are untrusted checklist/reference text.'],
        humanReviewHints: ['Use as acceptance-criteria inspiration only; do not copy claims into listing without review.'],
        contentTrustBoundary: 'untrusted_public_text',
      },
      {
        id: 'surface:solana-ai-kit:external-submodules',
        name: 'External skill submodule declarations',
        kind: 'skill',
        path: '.gitmodules',
        runtimeSurface: 'git-submodule-declarations',
        dataDependencies: ['18 external skill repositories declared but not initialized in the static fixture'],
        safetyHints: ['Submodule declarations are inventory only; ingestion must not clone or update them.'],
        humanReviewHints: ['Review external source, license, and install risk before any derived listing.'],
        contentTrustBoundary: 'metadata_only',
      },
      {
        id: 'surface:solana-ai-kit:operator-review-warning',
        name: 'Solana AI Kit operator-review blockers',
        kind: 'validation-warning',
        path: 'plugin/hooks/hooks.json',
        safetyHints: ['Executable hooks and deploy-capable commands are preserved as review blockers.'],
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
        summary: 'Repository-level marketplace metadata for the Solana AI Kit plugin.',
      },
      {
        path: 'plugin/.claude-plugin/plugin.json',
        kind: 'claude-plugin',
        present: true,
        parseStatus: 'not_parsed',
        mediaType: 'application/json',
        summary: 'Plugin manifest declaring package metadata, MCP server config, hooks, license, and keywords.',
      },
      {
        path: '.claude/agents/*.md',
        kind: 'subagent',
        present: true,
        parseStatus: 'not_parsed',
        mediaType: 'text/markdown',
        summary: 'Fifteen Solana-focused agent definitions represented as untrusted static metadata.',
      },
      {
        path: '.claude/commands/*.md',
        kind: 'command',
        present: true,
        parseStatus: 'not_parsed',
        mediaType: 'text/markdown',
        warningCodes: ['deploy_capable_commands', 'wallet_rpc_adjacent_commands'],
        summary: 'Twenty-nine workflow command definitions including deploy, debug-user-tx, audit, and IDL/client generation.',
      },
      {
        path: '.mcp.json',
        kind: 'mcp-connector-config',
        present: true,
        parseStatus: 'valid',
        mediaType: 'application/json',
        warningCodes: ['npx_mcp_execution', 'env_required_connector', 'local_binary_required'],
        summary: 'Seven MCP server declarations: Helius, solana-dev, Context7, Playwright, context-mode, memsearch, and Surfpool.',
      },
      {
        path: 'plugin/hooks/hooks.json',
        kind: 'command',
        present: true,
        parseStatus: 'not_parsed',
        mediaType: 'application/json',
        warningCodes: ['executable_hooks', 'mainnet_deploy_guard_required'],
        summary: 'Claude Code hook metadata with shell commands for session, formatting, commit, and deploy gates.',
      },
      {
        path: '.claude/settings.json',
        kind: 'command',
        present: true,
        parseStatus: 'not_parsed',
        mediaType: 'application/json',
        warningCodes: ['permission_policy', 'private_path_denylist'],
        summary: 'Claude Code permissions, sandbox, MCP, and hook policy metadata.',
      },
      {
        path: '.gitmodules',
        kind: 'skill',
        present: true,
        parseStatus: 'not_parsed',
        mediaType: 'text/plain',
        warningCodes: ['external_submodules_declared'],
        summary: 'Eighteen external skill submodule declarations; ingestion must not initialize them.',
      },
      {
        path: 'install.sh',
        kind: 'command',
        present: true,
        parseStatus: 'not_parsed',
        mediaType: 'text/x-shellscript',
        warningCodes: ['installer_script_non_executable_fixture'],
        summary: 'Installer script recorded as static file metadata only.',
      },
    ],
    validationWarnings: [
      {
        code: 'mcp_connector_requires_operator_review',
        severity: 'warning',
        path: '.mcp.json',
        message: 'MCP declarations include npx-launched servers, env-required connectors, hosted connectors, and a local Surfpool binary requirement; diagnostics remain static until #404.',
      },
      {
        code: 'executable_hooks_require_operator_review',
        severity: 'blocked',
        path: 'plugin/hooks/hooks.json',
        message: 'Executable hook metadata must be operator-reviewed and cannot be exposed as draft-ready imported listing behavior.',
      },
      {
        code: 'solana_deploy_command_requires_operator_review',
        severity: 'blocked',
        path: '.claude/commands/deploy.md',
        message: 'Deploy-capable Solana command guidance must stay static and blocked from draft publication until reviewed.',
      },
      {
        code: 'external_submodules_not_initialized',
        severity: 'info',
        path: '.gitmodules',
        message: 'External skill submodules are source declarations only; fixture ingestion must not clone, update, or execute them.',
      },
      {
        code: 'untrusted_solana_agent_text',
        severity: 'info',
        path: '.claude/agents/*.md',
        message: 'Public Solana agent, rule, skill, and command text is untrusted fixture content and cannot alter analyser behavior.',
      },
    ],
    staticOnly: true,
    nonGoals: [
      'Do not install Solana AI Kit, its plugin, or its submodules.',
      'Do not execute install.sh, update.sh, tests, hooks, commands, or agent instructions.',
      'Do not contact MCP servers, Solana RPC, wallets, paid providers, or local Surfpool services.',
      'Do not add Helius, QuickNode, Pyth, Nansen, wallet, or provider credentials.',
      'Do not implement AUDD, x402, Quasar, receipt, or payment behavior from this fixture.',
      'Do not publish imported Solana AI Kit surfaces as payable RAP listings without operator review.',
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
  solanaAiKit: {
    description: 'Valid public Solana AI Kit static agent-stack fixture corpus.',
    corpus: agentStackFixtureCorpora.solanaAiKit,
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

const operatorReviewFixtureGuardrails = [
  'Static fixture only: do not execute imported hooks, commands, skills, installers, tests, or agent instructions.',
  'Do not fetch repositories, submodules, MCP servers, RPC endpoints, wallets, paid providers, or payment rails.',
  'Do not store secrets, private operational metadata, credential-shaped values, wallet keys, or provider tokens.',
  'Do not activate live payment, publication, provider trust, reputation, registry listing, or endpoint binding from this fixture.',
] as const;

const operatorReviewViewportCoverage = (
  requiredStates: StaticAgentStackOperatorReviewStateCode[],
  requiredGroupKinds: AgentStackFixtureSurfaceKind[],
): StaticAgentStackOperatorReviewFixtureViewport[] => [
  {
    name: 'mobile',
    width: 390,
    height: 844,
    requiredStates,
    requiredGroupKinds,
  },
  {
    name: 'tablet',
    width: 834,
    height: 1112,
    requiredStates,
    requiredGroupKinds,
  },
  {
    name: 'desktop',
    width: 1440,
    height: 900,
    requiredStates,
    requiredGroupKinds,
  },
];

const createReadyAnthropicOperatorReviewPayload = (): StaticAgentStackOperatorReviewPayload => (
  createStaticAgentStackIngestionResult({
    ...agentStackFixtureCorpora.anthropicFinancialServices,
    files: agentStackFixtureCorpora.anthropicFinancialServices.files.map((file) => file.kind === 'mcp-connector-config'
      ? {
        ...file,
        parseStatus: 'valid',
        parseErrorLocation: undefined,
        warningCodes: [],
      }
      : file),
    validationWarnings: [],
  }).operatorReviewPayload
);

const createSuspendedAnthropicOperatorReviewPayload = (): StaticAgentStackOperatorReviewPayload => (
  createStaticAgentStackIngestionResult({
    ...agentStackFixtureCorpora.anthropicFinancialServices,
    validationWarnings: [
      ...agentStackFixtureCorpora.anthropicFinancialServices.validationWarnings,
      {
        code: 'unsafe_metadata',
        severity: 'blocked',
        path: 'plugins/partner-plugins/example/plugin.json',
        message: 'Unsafe imported metadata must stay suspended until operator review replaces or removes it.',
      },
    ],
  }).operatorReviewPayload
);

const approveReadyDraftPayload = createReadyAnthropicOperatorReviewPayload();
const rejectedDraftPayload = createStaticAgentStackIngestionResult(agentStackFixtureCorpora.anthropicFinancialServices).operatorReviewPayload;
const suspendedDraftPayload = createSuspendedAnthropicOperatorReviewPayload();
const solanaBlockedPayload = createStaticAgentStackIngestionResult(agentStackFixtureCorpora.solanaAiKit).operatorReviewPayload;

export const agentStackOperatorReviewFixtureStates = {
  approveReadyDraft: {
    fixtureId: 'agent-stack-operator-review-fixture:approve-ready-draft',
    description: 'Approve-ready draft review frame for imported repo and plugin groups; publication and payment stay disabled.',
    fixtureState: 'approve_ready_draft',
    queueState: approveReadyDraftPayload.status,
    uiTestRefs: [
      'storybook:agent-stack/operator-review/approve-ready-draft',
      'playwright:agent-stack-operator-review-approve-ready-draft',
    ],
    operatorReviewPayload: approveReadyDraftPayload,
    requiredReviewItemStates: ['approve_ready_draft'],
    requiredGroupKinds: ['repo-marketplace-metadata', 'claude-plugin'],
    requiredRiskCategories: [],
    viewportCoverage: operatorReviewViewportCoverage(
      ['approve_ready_draft'],
      ['repo-marketplace-metadata', 'claude-plugin'],
    ),
    staticOnly: true,
    guardrails: operatorReviewFixtureGuardrails,
  },
  requestChangesMissingPayment: {
    fixtureId: 'agent-stack-operator-review-fixture:request-changes-missing-payment',
    description: 'Request-changes draft review frame for missing payment and endpoint setup.',
    fixtureState: 'request_changes_draft',
    queueState: approveReadyDraftPayload.status,
    uiTestRefs: [
      'storybook:agent-stack/operator-review/request-changes-missing-payment',
      'playwright:agent-stack-operator-review-request-changes-missing-payment',
    ],
    operatorReviewPayload: approveReadyDraftPayload,
    requiredReviewItemStates: ['request_changes_missing_payment'],
    requiredGroupKinds: ['repo-marketplace-metadata', 'claude-plugin'],
    requiredRiskCategories: [],
    viewportCoverage: operatorReviewViewportCoverage(
      ['request_changes_missing_payment'],
      ['repo-marketplace-metadata', 'claude-plugin'],
    ),
    staticOnly: true,
    guardrails: operatorReviewFixtureGuardrails,
  },
  rejectedMalformedConnector: {
    fixtureId: 'agent-stack-operator-review-fixture:rejected-malformed-connector',
    description: 'Rejected draft review frame for malformed connector and unsafe metadata warnings.',
    fixtureState: 'rejected_draft',
    queueState: rejectedDraftPayload.status,
    uiTestRefs: [
      'storybook:agent-stack/operator-review/rejected-malformed-connector',
      'playwright:agent-stack-operator-review-rejected-malformed-connector',
    ],
    operatorReviewPayload: rejectedDraftPayload,
    requiredReviewItemStates: [
      'rejected_malformed_connector',
      'unsafe_metadata_warning',
      'request_changes_missing_payment',
    ],
    requiredGroupKinds: ['repo-marketplace-metadata', 'claude-plugin', 'mcp-connector-config'],
    requiredRiskCategories: [],
    viewportCoverage: operatorReviewViewportCoverage(
      ['rejected_malformed_connector', 'unsafe_metadata_warning', 'request_changes_missing_payment'],
      ['repo-marketplace-metadata', 'claude-plugin', 'mcp-connector-config'],
    ),
    staticOnly: true,
    guardrails: operatorReviewFixtureGuardrails,
  },
  suspendedUnsafeMetadata: {
    fixtureId: 'agent-stack-operator-review-fixture:suspended-unsafe-metadata',
    description: 'Suspended draft review frame for blocked unsafe imported metadata.',
    fixtureState: 'suspended_draft',
    queueState: suspendedDraftPayload.status,
    uiTestRefs: [
      'storybook:agent-stack/operator-review/suspended-unsafe-metadata',
      'playwright:agent-stack-operator-review-suspended-unsafe-metadata',
    ],
    operatorReviewPayload: suspendedDraftPayload,
    requiredReviewItemStates: ['suspended_imported_listing', 'unsafe_metadata_warning'],
    requiredGroupKinds: ['repo-marketplace-metadata', 'claude-plugin', 'mcp-connector-config'],
    requiredRiskCategories: [],
    viewportCoverage: operatorReviewViewportCoverage(
      ['suspended_imported_listing', 'unsafe_metadata_warning'],
      ['repo-marketplace-metadata', 'claude-plugin', 'mcp-connector-config'],
    ),
    staticOnly: true,
    guardrails: operatorReviewFixtureGuardrails,
  },
  solanaAiKitBlocked: {
    fixtureId: 'agent-stack-operator-review-fixture:solana-ai-kit-blocked',
    description: 'Solana AI Kit blocked review frame for hooks, deploy commands, env-required MCPs, local binaries, and submodules.',
    fixtureState: 'suspended_draft',
    queueState: solanaBlockedPayload.status,
    uiTestRefs: [
      'storybook:agent-stack/operator-review/solana-ai-kit-blocked',
      'playwright:agent-stack-operator-review-solana-ai-kit-blocked',
    ],
    operatorReviewPayload: solanaBlockedPayload,
    requiredReviewItemStates: ['static_risk_blocker', 'suspended_imported_listing'],
    requiredGroupKinds: ['repo-marketplace-metadata', 'claude-plugin', 'command', 'mcp-connector-config', 'skill'],
    requiredRiskCategories: [
      'executable_hook',
      'deploy_capable_command',
      'env_required_connector',
      'local_binary_requirement',
      'external_submodule',
    ],
    viewportCoverage: operatorReviewViewportCoverage(
      ['static_risk_blocker', 'suspended_imported_listing'],
      ['repo-marketplace-metadata', 'claude-plugin', 'command', 'mcp-connector-config', 'skill'],
    ),
    staticOnly: true,
    guardrails: operatorReviewFixtureGuardrails,
  },
} as const satisfies Record<string, StaticAgentStackOperatorReviewFixture>;
