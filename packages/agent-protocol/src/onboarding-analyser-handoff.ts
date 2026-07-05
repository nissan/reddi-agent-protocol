/**
 * Onboarding analyser handoff contracts + no-network fixture matrix (#509).
 *
 * Defines the stable typed handoff shapes for the AI onboarding analyser
 * pipeline before implementation splits across endpoint inspection (#459/#371),
 * profile generation (#372), readiness analysis (#373), seller wrapper
 * generation (#375), and operator review UI lanes:
 *
 *   intake descriptor
 *     -> normalized capability inventory
 *     -> generated RAP profile draft
 *     -> readiness result
 *     -> seller wrapper / payment-plan draft
 *     -> listing / export draft
 *
 * This module is PURE and offline-only. It performs no network fetch, plugin
 * install, command execution, MCP call, endpoint invocation, wallet/RPC call,
 * paid call, secret read, hosted write, publication, or reputation mutation.
 * It only validates and re-shapes in-memory fixture descriptors that the
 * caller already holds. All imported metadata is treated as UNTRUSTED data:
 * it can never instruct the analyser to run commands, read secrets, publish
 * listings, enable payments, or upgrade its own trust.
 *
 * Field provenance is separated into exactly five categories:
 * discovered (present in imported metadata), inferred (derived by analyser
 * heuristics), user_provided (supplied by the operator), verified (backed by
 * non-empty evidence refs), and blocked (absent or disallowed until supplied
 * and reviewed).
 */

export const ONBOARDING_INTAKE_DESCRIPTOR_SCHEMA_VERSION = 'reddi.onboarding-intake-descriptor.v1' as const;
export const ONBOARDING_CAPABILITY_INVENTORY_SCHEMA_VERSION = 'reddi.onboarding-capability-inventory.v1' as const;
export const ONBOARDING_RAP_PROFILE_DRAFT_SCHEMA_VERSION = 'reddi.onboarding-rap-profile-draft.v1' as const;
export const ONBOARDING_READINESS_RESULT_SCHEMA_VERSION = 'reddi.onboarding-readiness-result.v1' as const;
export const ONBOARDING_SELLER_WRAPPER_DRAFT_SCHEMA_VERSION = 'reddi.onboarding-seller-wrapper-draft.v1' as const;
export const ONBOARDING_LISTING_EXPORT_DRAFT_SCHEMA_VERSION = 'reddi.onboarding-listing-export-draft.v1' as const;
export const ONBOARDING_ANALYSER_HANDOFF_SCHEMA_VERSION = 'reddi.onboarding-analyser-handoff.v1' as const;
export const ONBOARDING_ANALYSER_FIXTURE_MATRIX_SCHEMA_VERSION = 'reddi.onboarding-analyser-fixture-matrix.v1' as const;

/** Issue anchors so downstream implementations can trace contract ownership. */
export const ONBOARDING_ANALYSER_HANDOFF_ISSUE = 509 as const;
export const ONBOARDING_ANALYSER_HANDOFF_PARENT_ISSUES = Object.freeze({
  onboardingAssistantEpic: 370,
  capabilityInventoryFeature: 371,
  rapProfileSchemaTask: 372,
  readinessAnalysisFeature: 373,
  liveAdapterSplitTask: 459,
} as const);

/**
 * Hard no-live boundary. Every guardrail is `false` by construction and every
 * emitted payload carries this object so downstream consumers can assert the
 * boundary instead of trusting prose.
 */
export const ONBOARDING_ANALYSER_GUARDRAILS = Object.freeze({
  networkFetchAllowed: false,
  pluginInstallAllowed: false,
  commandExecutionAllowed: false,
  mcpCallAllowed: false,
  endpointInvocationAllowed: false,
  walletOrRpcAllowed: false,
  paidCallAllowed: false,
  secretReadAllowed: false,
  hostedWriteAllowed: false,
  publicationAllowed: false,
  reputationMutationAllowed: false,
  liveAuthRegistrationAllowed: false,
} as const);

export type OnboardingAnalyserGuardrails = typeof ONBOARDING_ANALYSER_GUARDRAILS;

export type OnboardingSourceKind =
  | 'mcp-metadata'
  | 'openapi'
  | 'a2a-card'
  | 'ard-ai-catalog'
  | 'manual-descriptor'
  | 'static-agent-stack-snapshot';

/** Golden fixture classes the no-network matrix must cover (issue #509). */
export type OnboardingFixtureClass =
  | OnboardingSourceKind
  | 'malformed-input'
  | 'credential-shaped-input'
  | 'partial-metadata';

export const ONBOARDING_FIXTURE_CLASSES: readonly OnboardingFixtureClass[] = Object.freeze([
  'mcp-metadata',
  'openapi',
  'a2a-card',
  'ard-ai-catalog',
  'manual-descriptor',
  'static-agent-stack-snapshot',
  'malformed-input',
  'credential-shaped-input',
  'partial-metadata',
]);

/** Fail-closed reasons required by #509. */
export type OnboardingFailClosedReasonCode =
  | 'private_url_blocked'
  | 'credential_leakage_rejected'
  | 'command_execution_rejected'
  | 'paid_call_rejected'
  | 'wallet_rpc_rejected'
  | 'missing_payment_metadata'
  | 'missing_evidence'
  | 'untrusted_imported_content_rejected';

export type OnboardingIntakeValidationErrorCode =
  | OnboardingFailClosedReasonCode
  | 'malformed_intake_descriptor'
  | 'forbidden_operation_rejected';

export type OnboardingIntakeValidationError = {
  code: OnboardingIntakeValidationErrorCode;
  path: string;
  message: string;
};

/**
 * Operations imported metadata (or a caller) may request. Every one of them is
 * forbidden in this contract module and fails closed at intake.
 */
export type OnboardingForbiddenOperation =
  | 'network_fetch'
  | 'plugin_install'
  | 'command_execution'
  | 'mcp_call'
  | 'endpoint_invocation'
  | 'wallet_rpc'
  | 'paid_call'
  | 'secret_read'
  | 'hosted_write'
  | 'publication'
  | 'reputation_mutation';

const FORBIDDEN_OPERATION_REASONS: Record<OnboardingForbiddenOperation, OnboardingIntakeValidationErrorCode> = {
  network_fetch: 'forbidden_operation_rejected',
  plugin_install: 'command_execution_rejected',
  command_execution: 'command_execution_rejected',
  mcp_call: 'forbidden_operation_rejected',
  endpoint_invocation: 'forbidden_operation_rejected',
  wallet_rpc: 'wallet_rpc_rejected',
  paid_call: 'paid_call_rejected',
  secret_read: 'forbidden_operation_rejected',
  hosted_write: 'forbidden_operation_rejected',
  publication: 'forbidden_operation_rejected',
  reputation_mutation: 'forbidden_operation_rejected',
};

// ---------------------------------------------------------------------------
// Stage 1 — intake descriptor
// ---------------------------------------------------------------------------

export type OnboardingIntakeSource = {
  /** Public HTTPS source URL. Optional for manual descriptors. Never fetched here. */
  sourceUrl?: string;
  /** Reference to the already-captured static snapshot the descriptor came from. */
  snapshotRef: string;
  checkedCommit?: string;
  checkedRef?: string;
  license?: string;
  /** RFC3339 UTC timestamp recorded when the snapshot was captured. */
  crawlTimestamp: string;
};

export type OnboardingDeclaredCapability = {
  name: string;
  description?: string;
  inputShape?: string;
  outputShape?: string;
  examplePrompts?: string[];
  sideEffectHint?: 'none' | 'read' | 'write' | 'execute';
};

export type OnboardingDeclaredPaymentMetadata = {
  settlementAddress?: string;
  network?: string;
  price?: string;
  currency?: string;
};

export type OnboardingIntakeDeclaredMetadata = {
  displayName?: string;
  description?: string;
  capabilities: OnboardingDeclaredCapability[];
  endpointUrls?: string[];
  authHints?: string[];
  pricingHints?: string[];
  paymentMetadata?: OnboardingDeclaredPaymentMetadata;
  rateLimitHints?: string[];
  termsUrl?: string;
  /**
   * Self-asserted trust/verification claims found in imported content.
   * Imported content can never self-assert trust: any non-empty entry fails
   * closed with `untrusted_imported_content_rejected`.
   */
  trustClaims?: string[];
};

export type OnboardingIntakeOperatorProvided = {
  displayName?: string;
  description?: string;
  contactRef?: string;
};

export type OnboardingIntakeDescriptor = {
  schemaVersion: typeof ONBOARDING_INTAKE_DESCRIPTOR_SCHEMA_VERSION;
  intakeId: string;
  sourceKind: OnboardingSourceKind;
  /** This contract module only accepts already-captured static fixtures. */
  ingestionMode: 'static-fixture';
  source: OnboardingIntakeSource;
  declaredMetadata: OnboardingIntakeDeclaredMetadata;
  operatorProvided?: OnboardingIntakeOperatorProvided;
  /** Any recognised forbidden operation here fails closed. */
  requestedOperations?: string[];
  staticOnly: true;
};

export type OnboardingIntakeValidationResult =
  | { ok: true; descriptor: OnboardingIntakeDescriptor }
  | { ok: false; errors: OnboardingIntakeValidationError[] };

// ---------------------------------------------------------------------------
// Field provenance
// ---------------------------------------------------------------------------

export type OnboardingFieldProvenance =
  | 'discovered'
  | 'inferred'
  | 'user_provided'
  | 'verified'
  | 'blocked';

export type OnboardingProvenancedField<T> = {
  provenance: OnboardingFieldProvenance;
  value?: T;
  /** Non-empty iff provenance is `verified`. */
  evidenceRefs: string[];
  /** Present iff provenance is `blocked`. */
  blockedReason?: OnboardingFailClosedReasonCode;
};

export type OnboardingFieldProvenancePartition = Record<OnboardingFieldProvenance, string[]>;

/**
 * Upgrade a field to `verified` provenance. Fails closed: verification without
 * at least one evidence ref is rejected with `missing_evidence`.
 */
export function verifyOnboardingField<T>(
  field: OnboardingProvenancedField<T>,
  evidenceRefs: string[],
): { ok: true; field: OnboardingProvenancedField<T> } | { ok: false; reasonCode: 'missing_evidence' } {
  const refs = evidenceRefs.map((ref) => ref.trim()).filter((ref) => ref.length > 0);
  if (refs.length === 0 || field.value === undefined) {
    return { ok: false, reasonCode: 'missing_evidence' };
  }
  return {
    ok: true,
    field: { provenance: 'verified', value: field.value, evidenceRefs: refs },
  };
}

// ---------------------------------------------------------------------------
// Stage 2 — normalized capability inventory
// ---------------------------------------------------------------------------

export type OnboardingSideEffectRisk = 'none' | 'read' | 'write' | 'execute';

export type OnboardingCapabilityInventoryEntry = {
  capabilityId: string;
  name: OnboardingProvenancedField<string>;
  description: OnboardingProvenancedField<string>;
  inputShape: OnboardingProvenancedField<string>;
  outputShape: OnboardingProvenancedField<string>;
  sideEffectRisk: OnboardingProvenancedField<OnboardingSideEffectRisk>;
  endpointUrl: OnboardingProvenancedField<string>;
  authHints: OnboardingProvenancedField<string[]>;
  pricingHints: OnboardingProvenancedField<string[]>;
  contentTrustBoundary: 'untrusted_imported_content';
};

export type OnboardingInventoryDiagnostic = {
  severity: 'info' | 'warning' | 'blocked';
  code: string;
  path: string;
  message: string;
};

export type OnboardingCapabilityInventory = {
  schemaVersion: typeof ONBOARDING_CAPABILITY_INVENTORY_SCHEMA_VERSION;
  intakeRef: string;
  sourceKind: OnboardingSourceKind;
  source: OnboardingIntakeSource;
  entries: OnboardingCapabilityInventoryEntry[];
  diagnostics: OnboardingInventoryDiagnostic[];
  rawSnapshotRefs: string[];
  staticOnly: true;
};

// ---------------------------------------------------------------------------
// Stage 3 — generated RAP profile draft
// ---------------------------------------------------------------------------

export type OnboardingRapProfileDraft = {
  schemaVersion: typeof ONBOARDING_RAP_PROFILE_DRAFT_SCHEMA_VERSION;
  profileId: string;
  intakeRef: string;
  identity: {
    displayName: OnboardingProvenancedField<string>;
    sourceKind: OnboardingSourceKind;
    publisherContactRef: OnboardingProvenancedField<string>;
  };
  provenance: OnboardingIntakeSource;
  capabilities: OnboardingCapabilityInventoryEntry[];
  invocation: {
    endpointUrls: string[];
    missingEndpoint: boolean;
    /** Static contract: invocation is never allowed from this module. */
    invocationAllowed: false;
  };
  authRequirements: string[];
  payment: {
    metadata?: OnboardingDeclaredPaymentMetadata;
    status: 'declared_unverified' | 'missing_payment_metadata';
    missingFields: string[];
    activation: 'disabled';
  };
  policyRequirements: string[];
  evidenceExpectations: string[];
  healthChecks: {
    status: 'not_probed';
    probesAllowed: false;
  };
  trust: {
    sourceAuthenticity: 'snapshot_recorded' | 'unrecorded';
    importedContentTrust: 'untrusted';
    verifiedProviderTrust: false;
  };
  reputation: {
    status: 'unproven';
    receiptRefs: string[];
  };
  rawSnapshotRefs: string[];
  staticOnly: true;
};

// ---------------------------------------------------------------------------
// Stage 4 — readiness result
// ---------------------------------------------------------------------------

export type OnboardingReadinessLaneKey =
  | 'capability_fit'
  | 'source_identity'
  | 'static_source_authenticity'
  | 'imported_content_trust'
  | 'trust_evidence'
  | 'payment_readiness'
  | 'policy_fit'
  | 'endpoint_safety'
  | 'auth_scope_risk'
  | 'data_retention_risk'
  | 'reputation_readiness';

export const ONBOARDING_READINESS_LANES: readonly OnboardingReadinessLaneKey[] = Object.freeze([
  'capability_fit',
  'source_identity',
  'static_source_authenticity',
  'imported_content_trust',
  'trust_evidence',
  'payment_readiness',
  'policy_fit',
  'endpoint_safety',
  'auth_scope_risk',
  'data_retention_risk',
  'reputation_readiness',
]);

export type OnboardingReadinessLaneStatus = 'ready' | 'needs_operator_review' | 'blocked';

export type OnboardingReadinessLane = {
  lane: OnboardingReadinessLaneKey;
  status: OnboardingReadinessLaneStatus;
  reasonCodes: OnboardingFailClosedReasonCode[];
  recommendations: string[];
};

/**
 * `publish_ready` exists for downstream #373 implementations that add
 * verification lanes; the static contract path never emits it because
 * imported content trust cannot be verified without operator review.
 */
export type OnboardingOverallReadiness = 'blocked' | 'needs_operator_review' | 'publish_ready';

export type OnboardingReadinessResult = {
  schemaVersion: typeof ONBOARDING_READINESS_RESULT_SCHEMA_VERSION;
  profileRef: string;
  lanes: OnboardingReadinessLane[];
  overall: OnboardingOverallReadiness;
  failClosedReasons: OnboardingFailClosedReasonCode[];
  staticOnly: true;
};

// ---------------------------------------------------------------------------
// Stage 5 — seller wrapper / payment-plan draft
// ---------------------------------------------------------------------------

export type OnboardingSellerWrapperDraft = {
  schemaVersion: typeof ONBOARDING_SELLER_WRAPPER_DRAFT_SCHEMA_VERSION;
  wrapperId: string;
  profileRef: string;
  /** Planned wrapper route names only — nothing is mounted or invoked here. */
  wrapperRoutes: {
    quoteRoute: string;
    policyPreflightRoute: string;
    invocationRoute: string;
    receiptHook: string;
    evidenceHook: string;
  };
  paymentPlan: {
    railAsset?: string;
    network?: string;
    priceUnits?: string;
    settlementAddress?: string;
    status: 'draft_ready_for_review' | 'draft_incomplete';
    missingFields: string[];
    activation: 'disabled';
    livePaymentApproved: false;
  };
  guardrails: OnboardingAnalyserGuardrails;
  staticOnly: true;
};

// ---------------------------------------------------------------------------
// Stage 6 — listing / export draft
// ---------------------------------------------------------------------------

export type OnboardingListingDraftState = {
  code:
    | 'listing_draft'
    | 'missing_payment'
    | 'missing_endpoint'
    | 'imported_content_untrusted'
    | 'operator_review_required'
    | 'readiness_blocked';
  severity: 'info' | 'warning' | 'blocked';
  message: string;
};

export type OnboardingListingExportDraft = {
  schemaVersion: typeof ONBOARDING_LISTING_EXPORT_DRAFT_SCHEMA_VERSION;
  listingId: string;
  profileRef: string;
  readinessRef: string;
  status: 'blocked' | 'needs_operator_review';
  publicationDisabled: true;
  operatorReviewRequired: true;
  exportFragments: {
    aiCatalog: {
      specVersion: '1.0';
      id: string;
      type: 'onboarding-analyser-draft';
      name: string;
      capabilities: string[];
      trust: { status: 'unverified'; note: string };
      payment: { status: 'declared_unverified' | 'missing_payment_setup' };
    };
  };
  states: OnboardingListingDraftState[];
  staticOnly: true;
};

// ---------------------------------------------------------------------------
// Handoff result
// ---------------------------------------------------------------------------

export type OnboardingAnalyserHandoffSuccess = {
  ok: true;
  schemaVersion: typeof ONBOARDING_ANALYSER_HANDOFF_SCHEMA_VERSION;
  intake: OnboardingIntakeDescriptor;
  capabilityInventory: OnboardingCapabilityInventory;
  rapProfileDraft: OnboardingRapProfileDraft;
  readiness: OnboardingReadinessResult;
  sellerWrapperDraft: OnboardingSellerWrapperDraft;
  listingExportDraft: OnboardingListingExportDraft;
  guardrails: OnboardingAnalyserGuardrails;
  staticOnly: true;
};

export type OnboardingAnalyserHandoffFailure = {
  ok: false;
  schemaVersion: typeof ONBOARDING_ANALYSER_HANDOFF_SCHEMA_VERSION;
  failClosed: true;
  errors: OnboardingIntakeValidationError[];
  guardrails: OnboardingAnalyserGuardrails;
  staticOnly: true;
};

export type OnboardingAnalyserHandoffResult =
  | OnboardingAnalyserHandoffSuccess
  | OnboardingAnalyserHandoffFailure;

// ---------------------------------------------------------------------------
// Validation internals
// ---------------------------------------------------------------------------

const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SECRET_KEY_PATTERN = /(^|[_-])(api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|client[_-]?secret|authorization|bearer|cookie|password|secret|seed|session[_-]?token|signature|token)($|[_-])|apiKey|accessToken|refreshToken|sessionToken|privateKey/i;
const SECRET_VALUE_PATTERN = /(authorization:\s*bearer\s+|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,}|xox[baprs]-|ghp_[a-z0-9]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const PRIVATE_HOST_PATTERN = /^(localhost|0\.0\.0\.0|127\.(?:\d{1,3}\.){2}\d{1,3}|10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3})\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3})\.\d{1,3}|169\.254\.(?:\d{1,3})\.\d{1,3}|\[?::1\]?)$/i;
const PRIVATE_HOST_SUFFIXES = ['.local', '.internal', '.lan', '.home.arpa'];
const SIDE_EFFECT_RISKS: readonly OnboardingSideEffectRisk[] = ['none', 'read', 'write', 'execute'];
const SOURCE_KINDS: readonly OnboardingSourceKind[] = [
  'mcp-metadata',
  'openapi',
  'a2a-card',
  'ard-ai-catalog',
  'manual-descriptor',
  'static-agent-stack-snapshot',
];

function intakeError(
  code: OnboardingIntakeValidationErrorCode,
  path: string,
  message: string,
): OnboardingIntakeValidationError {
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

function isOptionalString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}

function isPrivateOrLocalUrl(parsed: URL): boolean {
  const host = parsed.hostname.toLowerCase();
  if (PRIVATE_HOST_PATTERN.test(host)) return true;
  return PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function validatePublicHttpsUrl(
  value: unknown,
  path: string,
  errors: OnboardingIntakeValidationError[],
): void {
  if (!isNonEmptyString(value)) {
    errors.push(intakeError('malformed_intake_descriptor', path, 'URL must be a non-empty string'));
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    errors.push(intakeError('malformed_intake_descriptor', path, 'URL must be a valid URL'));
    return;
  }
  if (parsed.protocol !== 'https:') {
    errors.push(intakeError('private_url_blocked', path, 'URL must use public HTTPS'));
  }
  if (isPrivateOrLocalUrl(parsed)) {
    errors.push(intakeError('private_url_blocked', path, 'private, localhost, or link-local URLs are blocked'));
  }
  if (parsed.username || parsed.password) {
    errors.push(intakeError('credential_leakage_rejected', path, 'URL must not embed credentials'));
  }
  for (const key of parsed.searchParams.keys()) {
    if (SECRET_KEY_PATTERN.test(key)) {
      errors.push(intakeError('credential_leakage_rejected', `${path}.${key}`, 'URL must not include credential-shaped query keys'));
    }
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

function validateDeclaredCapability(
  value: unknown,
  path: string,
  errors: OnboardingIntakeValidationError[],
): void {
  if (!isPlainObject(value)) {
    errors.push(intakeError('malformed_intake_descriptor', path, 'capability must be an object'));
    return;
  }
  if (!isNonEmptyString(value.name)) {
    errors.push(intakeError('malformed_intake_descriptor', `${path}.name`, 'capability name must be a non-empty string'));
  }
  for (const key of ['description', 'inputShape', 'outputShape'] as const) {
    if (!isOptionalString(value[key])) {
      errors.push(intakeError('malformed_intake_descriptor', `${path}.${key}`, `capability ${key} must be a non-empty string when present`));
    }
  }
  if (!isOptionalStringArray(value.examplePrompts)) {
    errors.push(intakeError('malformed_intake_descriptor', `${path}.examplePrompts`, 'examplePrompts must be a string array when present'));
  }
  if (value.sideEffectHint !== undefined && !SIDE_EFFECT_RISKS.includes(value.sideEffectHint as OnboardingSideEffectRisk)) {
    errors.push(intakeError('malformed_intake_descriptor', `${path}.sideEffectHint`, 'sideEffectHint is unsupported'));
  }
}

/**
 * Validate an intake descriptor. Fails closed on malformed shapes, private or
 * credential-shaped URLs, credential-shaped metadata, self-asserted trust
 * claims, and any requested forbidden operation.
 */
export function validateOnboardingIntakeDescriptor(input: unknown): OnboardingIntakeValidationResult {
  if (!isPlainObject(input)) {
    return { ok: false, errors: [intakeError('malformed_intake_descriptor', '$', 'intake descriptor must be a plain object')] };
  }

  const credentialPath = findCredentialMaterial(input);
  if (credentialPath) {
    return {
      ok: false,
      errors: [intakeError('credential_leakage_rejected', credentialPath, 'intake descriptor must not contain credential-shaped material')],
    };
  }

  const errors: OnboardingIntakeValidationError[] = [];

  if (input.schemaVersion !== ONBOARDING_INTAKE_DESCRIPTOR_SCHEMA_VERSION) {
    errors.push(intakeError('malformed_intake_descriptor', '$.schemaVersion', `expected ${ONBOARDING_INTAKE_DESCRIPTOR_SCHEMA_VERSION}`));
  }
  if (!isNonEmptyString(input.intakeId)) {
    errors.push(intakeError('malformed_intake_descriptor', '$.intakeId', 'intakeId must be a non-empty string'));
  }
  if (!SOURCE_KINDS.includes(input.sourceKind as OnboardingSourceKind)) {
    errors.push(intakeError('malformed_intake_descriptor', '$.sourceKind', 'sourceKind is unsupported'));
  }
  if (input.ingestionMode !== 'static-fixture') {
    errors.push(intakeError('malformed_intake_descriptor', '$.ingestionMode', 'contract intake only accepts static-fixture ingestion'));
  }
  if (input.staticOnly !== true) {
    errors.push(intakeError('malformed_intake_descriptor', '$.staticOnly', 'intake descriptor must declare staticOnly=true'));
  }

  if (!isPlainObject(input.source)) {
    errors.push(intakeError('malformed_intake_descriptor', '$.source', 'source must be an object'));
  } else {
    if (input.source.sourceUrl !== undefined) {
      validatePublicHttpsUrl(input.source.sourceUrl, '$.source.sourceUrl', errors);
    }
    if (!isNonEmptyString(input.source.snapshotRef)) {
      errors.push(intakeError('malformed_intake_descriptor', '$.source.snapshotRef', 'snapshotRef must be a non-empty string'));
    }
    if (!isOptionalString(input.source.checkedCommit) || !isOptionalString(input.source.checkedRef) || !isOptionalString(input.source.license)) {
      errors.push(intakeError('malformed_intake_descriptor', '$.source', 'checkedCommit/checkedRef/license must be non-empty strings when present'));
    }
    if (!isNonEmptyString(input.source.crawlTimestamp) || !RFC3339_UTC_PATTERN.test(input.source.crawlTimestamp)) {
      errors.push(intakeError('malformed_intake_descriptor', '$.source.crawlTimestamp', 'crawlTimestamp must be an RFC3339 UTC timestamp'));
    }
  }

  if (!isPlainObject(input.declaredMetadata)) {
    errors.push(intakeError('malformed_intake_descriptor', '$.declaredMetadata', 'declaredMetadata must be an object'));
  } else {
    const metadata = input.declaredMetadata;
    if (!isOptionalString(metadata.displayName) || !isOptionalString(metadata.description) || !isOptionalString(metadata.termsUrl)) {
      errors.push(intakeError('malformed_intake_descriptor', '$.declaredMetadata', 'displayName/description/termsUrl must be non-empty strings when present'));
    }
    if (!Array.isArray(metadata.capabilities)) {
      errors.push(intakeError('malformed_intake_descriptor', '$.declaredMetadata.capabilities', 'capabilities must be an array'));
    } else {
      metadata.capabilities.forEach((capability, index) => {
        validateDeclaredCapability(capability, `$.declaredMetadata.capabilities[${index}]`, errors);
      });
    }
    if (!isOptionalStringArray(metadata.endpointUrls)) {
      errors.push(intakeError('malformed_intake_descriptor', '$.declaredMetadata.endpointUrls', 'endpointUrls must be a string array when present'));
    } else if (metadata.endpointUrls) {
      metadata.endpointUrls.forEach((url, index) => {
        validatePublicHttpsUrl(url, `$.declaredMetadata.endpointUrls[${index}]`, errors);
      });
    }
    for (const key of ['authHints', 'pricingHints', 'rateLimitHints', 'trustClaims'] as const) {
      if (!isOptionalStringArray(metadata[key])) {
        errors.push(intakeError('malformed_intake_descriptor', `$.declaredMetadata.${key}`, `${key} must be a string array when present`));
      }
    }
    if (metadata.paymentMetadata !== undefined && !isPlainObject(metadata.paymentMetadata)) {
      errors.push(intakeError('malformed_intake_descriptor', '$.declaredMetadata.paymentMetadata', 'paymentMetadata must be an object when present'));
    }
    const trustClaims = Array.isArray(metadata.trustClaims) ? metadata.trustClaims.filter((claim) => isNonEmptyString(claim)) : [];
    if (trustClaims.length > 0) {
      errors.push(intakeError(
        'untrusted_imported_content_rejected',
        '$.declaredMetadata.trustClaims',
        'imported content cannot self-assert trust, verification, approval, or live payment status',
      ));
    }
  }

  if (input.operatorProvided !== undefined) {
    if (!isPlainObject(input.operatorProvided)) {
      errors.push(intakeError('malformed_intake_descriptor', '$.operatorProvided', 'operatorProvided must be an object when present'));
    } else {
      for (const key of ['displayName', 'description', 'contactRef'] as const) {
        if (!isOptionalString(input.operatorProvided[key])) {
          errors.push(intakeError('malformed_intake_descriptor', `$.operatorProvided.${key}`, `${key} must be a non-empty string when present`));
        }
      }
    }
  }

  if (input.requestedOperations !== undefined) {
    if (!isOptionalStringArray(input.requestedOperations)) {
      errors.push(intakeError('malformed_intake_descriptor', '$.requestedOperations', 'requestedOperations must be a string array when present'));
    } else {
      (input.requestedOperations as string[]).forEach((operation, index) => {
        const reason = FORBIDDEN_OPERATION_REASONS[operation as OnboardingForbiddenOperation];
        if (reason) {
          errors.push(intakeError(reason, `$.requestedOperations[${index}]`, `requested operation "${operation}" is forbidden in the no-network contract path`));
        } else {
          errors.push(intakeError('forbidden_operation_rejected', `$.requestedOperations[${index}]`, `requested operation "${operation}" is not recognised and is rejected fail-closed`));
        }
      });
    }
  }

  return errors.length === 0
    ? { ok: true, descriptor: input as unknown as OnboardingIntakeDescriptor }
    : { ok: false, errors };
}

// ---------------------------------------------------------------------------
// Stage builders (pure, deterministic)
// ---------------------------------------------------------------------------

function discoveredField<T>(value: T | undefined): OnboardingProvenancedField<T> {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) {
    return { provenance: 'blocked', evidenceRefs: [], blockedReason: 'missing_evidence' };
  }
  return { provenance: 'discovered', value, evidenceRefs: [] };
}

function userProvidedField<T>(value: T | undefined): OnboardingProvenancedField<T> {
  if (value === undefined) {
    return { provenance: 'blocked', evidenceRefs: [], blockedReason: 'missing_evidence' };
  }
  return { provenance: 'user_provided', value, evidenceRefs: [] };
}

function inferSideEffectRisk(capability: OnboardingDeclaredCapability): OnboardingSideEffectRisk {
  const haystack = [capability.name, capability.description ?? ''].join(' ').toLowerCase();
  if (/\b(exec|execute|shell|command|deploy|install|script)\b/.test(haystack)) return 'execute';
  if (/\b(write|create|update|delete|mutate|post|put|patch)\b/.test(haystack)) return 'write';
  if (/\b(read|get|list|search|fetch|query|lookup)\b/.test(haystack)) return 'read';
  return 'none';
}

function rawSnapshotRefs(source: OnboardingIntakeSource): string[] {
  return [
    `snapshot:${source.snapshotRef}`,
    ...(source.sourceUrl ? [`source:${source.sourceUrl}${source.checkedCommit ? `#${source.checkedCommit}` : ''}`] : []),
  ];
}

/** Normalize a validated intake descriptor into a capability inventory. */
export function buildOnboardingCapabilityInventory(
  descriptor: OnboardingIntakeDescriptor,
): OnboardingCapabilityInventory {
  const diagnostics: OnboardingInventoryDiagnostic[] = [];
  const sharedAuthHints = descriptor.declaredMetadata.authHints ?? [];
  const sharedPricingHints = descriptor.declaredMetadata.pricingHints ?? [];
  const endpointUrls = descriptor.declaredMetadata.endpointUrls ?? [];

  const entries = descriptor.declaredMetadata.capabilities.map((capability, index): OnboardingCapabilityInventoryEntry => {
    const sideEffectRisk: OnboardingProvenancedField<OnboardingSideEffectRisk> = capability.sideEffectHint !== undefined
      ? { provenance: 'discovered', value: capability.sideEffectHint, evidenceRefs: [] }
      : { provenance: 'inferred', value: inferSideEffectRisk(capability), evidenceRefs: [] };

    const entry: OnboardingCapabilityInventoryEntry = {
      capabilityId: `${descriptor.intakeId}:capability:${index}`,
      name: discoveredField(capability.name),
      description: capability.description !== undefined
        ? discoveredField(capability.description)
        : userProvidedField(descriptor.operatorProvided?.description),
      inputShape: discoveredField(capability.inputShape),
      outputShape: discoveredField(capability.outputShape),
      sideEffectRisk,
      endpointUrl: discoveredField(endpointUrls[0]),
      authHints: discoveredField(sharedAuthHints.length > 0 ? sharedAuthHints : undefined),
      pricingHints: discoveredField(sharedPricingHints.length > 0 ? sharedPricingHints : undefined),
      contentTrustBoundary: 'untrusted_imported_content',
    };

    for (const [fieldName, field] of Object.entries({
      inputShape: entry.inputShape,
      outputShape: entry.outputShape,
      endpointUrl: entry.endpointUrl,
      authHints: entry.authHints,
    })) {
      if (field.provenance === 'blocked') {
        diagnostics.push({
          severity: 'warning',
          code: 'missing_evidence',
          path: `$.entries[${index}].${fieldName}`,
          message: `${fieldName} is missing from imported metadata and stays blocked until supplied and reviewed`,
        });
      }
    }

    return entry;
  });

  if (entries.length === 0) {
    diagnostics.push({
      severity: 'blocked',
      code: 'missing_evidence',
      path: '$.entries',
      message: 'no capabilities were declared; capability fit cannot be assessed',
    });
  }

  return {
    schemaVersion: ONBOARDING_CAPABILITY_INVENTORY_SCHEMA_VERSION,
    intakeRef: descriptor.intakeId,
    sourceKind: descriptor.sourceKind,
    source: descriptor.source,
    entries,
    diagnostics,
    rawSnapshotRefs: rawSnapshotRefs(descriptor.source),
    staticOnly: true,
  };
}

const REQUIRED_PAYMENT_FIELDS = ['settlementAddress', 'network', 'price', 'currency'] as const;

function missingPaymentFields(metadata: OnboardingDeclaredPaymentMetadata | undefined): string[] {
  if (!metadata) return [...REQUIRED_PAYMENT_FIELDS];
  return REQUIRED_PAYMENT_FIELDS.filter((field) => !isNonEmptyString(metadata[field]));
}

/** Generate the RAP profile draft handed to readiness analysis and review. */
export function buildOnboardingRapProfileDraft(
  descriptor: OnboardingIntakeDescriptor,
  inventory: OnboardingCapabilityInventory,
): OnboardingRapProfileDraft {
  const endpointUrls = descriptor.declaredMetadata.endpointUrls ?? [];
  const paymentMetadata = descriptor.declaredMetadata.paymentMetadata;
  const missingFields = missingPaymentFields(paymentMetadata);
  const operatorDisplayName = descriptor.operatorProvided?.displayName;
  const displayName: OnboardingProvenancedField<string> = operatorDisplayName !== undefined
    ? userProvidedField(operatorDisplayName)
    : discoveredField(descriptor.declaredMetadata.displayName);

  return {
    schemaVersion: ONBOARDING_RAP_PROFILE_DRAFT_SCHEMA_VERSION,
    profileId: `draft-profile:${descriptor.intakeId}`,
    intakeRef: descriptor.intakeId,
    identity: {
      displayName,
      sourceKind: descriptor.sourceKind,
      publisherContactRef: userProvidedField(descriptor.operatorProvided?.contactRef),
    },
    provenance: descriptor.source,
    capabilities: inventory.entries,
    invocation: {
      endpointUrls,
      missingEndpoint: endpointUrls.length === 0,
      invocationAllowed: false,
    },
    authRequirements: descriptor.declaredMetadata.authHints ?? [],
    payment: {
      metadata: paymentMetadata,
      status: missingFields.length === 0 ? 'declared_unverified' : 'missing_payment_metadata',
      missingFields,
      activation: 'disabled',
    },
    policyRequirements: [
      'operator_review_required',
      'payment_verification_required',
      ...(endpointUrls.length === 0 ? ['endpoint_binding_required'] : []),
    ],
    evidenceExpectations: [
      'source_snapshot_reference',
      'operator_review_record',
      'readiness_gate_result',
    ],
    healthChecks: { status: 'not_probed', probesAllowed: false },
    trust: {
      sourceAuthenticity: isNonEmptyString(descriptor.source.checkedCommit) ? 'snapshot_recorded' : 'unrecorded',
      importedContentTrust: 'untrusted',
      verifiedProviderTrust: false,
    },
    reputation: { status: 'unproven', receiptRefs: [] },
    rawSnapshotRefs: inventory.rawSnapshotRefs,
    staticOnly: true,
  };
}

function lane(
  key: OnboardingReadinessLaneKey,
  status: OnboardingReadinessLaneStatus,
  reasonCodes: OnboardingFailClosedReasonCode[],
  recommendations: string[],
): OnboardingReadinessLane {
  return { lane: key, status, reasonCodes, recommendations };
}

/**
 * Analyse readiness lanes for a generated profile draft. Missing or
 * unverifiable data fails closed; ARD/search relevance and source authenticity
 * are never treated as trust in imported content or agent behaviour.
 */
export function analyzeOnboardingReadiness(profile: OnboardingRapProfileDraft): OnboardingReadinessResult {
  const lanes: OnboardingReadinessLane[] = [
    profile.capabilities.length > 0
      ? lane('capability_fit', 'ready', [], ['confirm capability descriptions against operator intent during review'])
      : lane('capability_fit', 'blocked', ['missing_evidence'], ['supply at least one capability before drafting a listing']),
    profile.provenance.sourceUrl || profile.identity.publisherContactRef.provenance === 'user_provided'
      ? lane('source_identity', 'needs_operator_review', [], ['source identity is recorded but unverified'])
      : lane('source_identity', 'blocked', ['missing_evidence'], ['record a public source URL or operator contact reference']),
    profile.trust.sourceAuthenticity === 'snapshot_recorded'
      ? lane('static_source_authenticity', 'ready', [], ['snapshot authenticity is recorded; it is NOT trust in imported content'])
      : lane('static_source_authenticity', 'needs_operator_review', ['missing_evidence'], ['record a checked commit for the source snapshot']),
    lane('imported_content_trust', 'needs_operator_review', [], ['imported prompts, connector metadata, and claims stay untrusted until operator review']),
    lane('trust_evidence', 'needs_operator_review', ['missing_evidence'], ['no verified evidence yet; attach receipts or attestations to upgrade']),
    profile.payment.status === 'declared_unverified'
      ? lane('payment_readiness', 'needs_operator_review', [], ['payment metadata is declared but unverified; activation stays disabled'])
      : lane('payment_readiness', 'blocked', ['missing_payment_metadata'], [`supply missing payment fields: ${profile.payment.missingFields.join(', ')}`]),
    lane('policy_fit', 'needs_operator_review', [], profile.policyRequirements),
    profile.invocation.missingEndpoint
      ? lane('endpoint_safety', 'needs_operator_review', ['missing_evidence'], ['no invocation endpoint declared; endpoint binding and safety review required'])
      : lane('endpoint_safety', 'needs_operator_review', [], ['declared endpoints are public HTTPS but uninvoked and unverified']),
    profile.authRequirements.length > 0
      ? lane('auth_scope_risk', 'needs_operator_review', [], ['review declared auth requirements for scope and custody risk'])
      : lane('auth_scope_risk', 'needs_operator_review', ['missing_evidence'], ['auth requirements are undeclared; confirm before wrapping']),
    lane('data_retention_risk', 'needs_operator_review', [], ['data retention behaviour is unknown from static metadata']),
    lane('reputation_readiness', 'needs_operator_review', [], ['reputation starts unproven until backed by verifiable receipts or attestations']),
  ];

  const failClosedReasons = [...new Set(lanes.flatMap((item) => item.reasonCodes))];
  const overall: OnboardingOverallReadiness = lanes.some((item) => item.status === 'blocked')
    ? 'blocked'
    : 'needs_operator_review';

  return {
    schemaVersion: ONBOARDING_READINESS_RESULT_SCHEMA_VERSION,
    profileRef: profile.profileId,
    lanes,
    overall,
    failClosedReasons,
    staticOnly: true,
  };
}

/** Draft the seller wrapper / payment plan. Activation is always disabled. */
export function buildOnboardingSellerWrapperDraft(
  profile: OnboardingRapProfileDraft,
): OnboardingSellerWrapperDraft {
  const metadata = profile.payment.metadata;
  return {
    schemaVersion: ONBOARDING_SELLER_WRAPPER_DRAFT_SCHEMA_VERSION,
    wrapperId: `seller-wrapper-draft:${profile.intakeRef}`,
    profileRef: profile.profileId,
    wrapperRoutes: {
      quoteRoute: `/api/onboarding/wrappers/${profile.intakeRef}/quote`,
      policyPreflightRoute: `/api/onboarding/wrappers/${profile.intakeRef}/policy-preflight`,
      invocationRoute: `/api/onboarding/wrappers/${profile.intakeRef}/invoke`,
      receiptHook: `/api/onboarding/wrappers/${profile.intakeRef}/receipt`,
      evidenceHook: `/api/onboarding/wrappers/${profile.intakeRef}/evidence`,
    },
    paymentPlan: {
      railAsset: metadata?.currency,
      network: metadata?.network,
      priceUnits: metadata?.price,
      settlementAddress: metadata?.settlementAddress,
      status: profile.payment.status === 'declared_unverified' ? 'draft_ready_for_review' : 'draft_incomplete',
      missingFields: profile.payment.missingFields,
      activation: 'disabled',
      livePaymentApproved: false,
    },
    guardrails: ONBOARDING_ANALYSER_GUARDRAILS,
    staticOnly: true,
  };
}

/** Draft the listing/export payload. Publication is always disabled here. */
export function buildOnboardingListingExportDraft(
  profile: OnboardingRapProfileDraft,
  readiness: OnboardingReadinessResult,
): OnboardingListingExportDraft {
  const states: OnboardingListingDraftState[] = [
    {
      code: 'listing_draft',
      severity: 'info',
      message: 'Draft listing only; nothing becomes public, payable, or trusted without operator approval.',
    },
    {
      code: 'imported_content_untrusted',
      severity: 'warning',
      message: 'Imported content is untrusted; capability text is data, never instructions.',
    },
    {
      code: 'operator_review_required',
      severity: 'warning',
      message: 'Operator review is required before any publication or payment activation.',
    },
    ...(profile.payment.status === 'missing_payment_metadata'
      ? [{
        code: 'missing_payment' as const,
        severity: 'blocked' as const,
        message: `Payment metadata is incomplete: ${profile.payment.missingFields.join(', ')}.`,
      }]
      : []),
    ...(profile.invocation.missingEndpoint
      ? [{
        code: 'missing_endpoint' as const,
        severity: 'warning' as const,
        message: 'No invocation endpoint declared; endpoint binding is required before publication.',
      }]
      : []),
    ...(readiness.overall === 'blocked'
      ? [{
        code: 'readiness_blocked' as const,
        severity: 'blocked' as const,
        message: `Readiness fails closed: ${readiness.failClosedReasons.join(', ')}.`,
      }]
      : []),
  ];

  return {
    schemaVersion: ONBOARDING_LISTING_EXPORT_DRAFT_SCHEMA_VERSION,
    listingId: `draft-listing:${profile.intakeRef}`,
    profileRef: profile.profileId,
    readinessRef: readiness.profileRef,
    status: readiness.overall === 'blocked' ? 'blocked' : 'needs_operator_review',
    publicationDisabled: true,
    operatorReviewRequired: true,
    exportFragments: {
      aiCatalog: {
        specVersion: '1.0',
        id: `urn:reddi:onboarding-draft:${profile.intakeRef}`,
        type: 'onboarding-analyser-draft',
        name: profile.identity.displayName.value ?? profile.intakeRef,
        capabilities: profile.capabilities
          .map((entry) => entry.name.value)
          .filter((name): name is string => name !== undefined)
          .sort(),
        trust: {
          status: 'unverified',
          note: 'Source snapshot is recorded, but imported content and provider trust are unverified until RAP review.',
        },
        payment: {
          status: profile.payment.status === 'declared_unverified' ? 'declared_unverified' : 'missing_payment_setup',
        },
      },
    },
    states,
    staticOnly: true,
  };
}

/**
 * Run the full contract handoff: intake -> capability inventory -> RAP profile
 * draft -> readiness result -> seller wrapper draft -> listing/export draft.
 * Pure and deterministic; fails closed with intake errors on invalid input.
 */
export function runOnboardingAnalyserHandoff(input: unknown): OnboardingAnalyserHandoffResult {
  const validation = validateOnboardingIntakeDescriptor(input);
  if (!validation.ok) {
    return {
      ok: false,
      schemaVersion: ONBOARDING_ANALYSER_HANDOFF_SCHEMA_VERSION,
      failClosed: true,
      errors: validation.errors,
      guardrails: ONBOARDING_ANALYSER_GUARDRAILS,
      staticOnly: true,
    };
  }

  const descriptor = validation.descriptor;
  const capabilityInventory = buildOnboardingCapabilityInventory(descriptor);
  const rapProfileDraft = buildOnboardingRapProfileDraft(descriptor, capabilityInventory);
  const readiness = analyzeOnboardingReadiness(rapProfileDraft);
  const sellerWrapperDraft = buildOnboardingSellerWrapperDraft(rapProfileDraft);
  const listingExportDraft = buildOnboardingListingExportDraft(rapProfileDraft, readiness);

  return {
    ok: true,
    schemaVersion: ONBOARDING_ANALYSER_HANDOFF_SCHEMA_VERSION,
    intake: descriptor,
    capabilityInventory,
    rapProfileDraft,
    readiness,
    sellerWrapperDraft,
    listingExportDraft,
    guardrails: ONBOARDING_ANALYSER_GUARDRAILS,
    staticOnly: true,
  };
}

/**
 * Partition every provenanced field in a capability inventory entry into the
 * five provenance buckets required by #509.
 */
export function partitionOnboardingEntryFieldsByProvenance(
  entry: OnboardingCapabilityInventoryEntry,
): OnboardingFieldProvenancePartition {
  const partition: OnboardingFieldProvenancePartition = {
    discovered: [],
    inferred: [],
    user_provided: [],
    verified: [],
    blocked: [],
  };
  const fields: Record<string, OnboardingProvenancedField<unknown>> = {
    name: entry.name,
    description: entry.description,
    inputShape: entry.inputShape,
    outputShape: entry.outputShape,
    sideEffectRisk: entry.sideEffectRisk,
    endpointUrl: entry.endpointUrl,
    authHints: entry.authHints,
    pricingHints: entry.pricingHints,
  };
  for (const [fieldName, field] of Object.entries(fields)) {
    partition[field.provenance].push(fieldName);
  }
  return partition;
}

// ---------------------------------------------------------------------------
// No-network golden fixture matrix
// ---------------------------------------------------------------------------

export type OnboardingAnalyserFixtureCase = {
  key: string;
  fixtureClass: OnboardingFixtureClass;
  description: string;
  descriptor: unknown;
  expectedValid: boolean;
  expectedErrorCodes: OnboardingIntakeValidationErrorCode[];
  expectedOverallReadiness?: Exclude<OnboardingOverallReadiness, 'publish_ready'>;
  expectedFailClosedReasons?: OnboardingFailClosedReasonCode[];
};

const FIXTURE_COMMIT = 'a3f8c2e91b7d4650a3f8c2e91b7d4650a3f8c2e9';
const FIXTURE_TIMESTAMP = '2026-07-06T00:00:00Z';
const FIXTURE_PAYMENT: OnboardingDeclaredPaymentMetadata = {
  settlementAddress: 'FixtureSettlementAddress1111111111111111111',
  network: 'solana-devnet',
  price: '2.50',
  currency: 'AUDD',
};

type OnboardingFixtureDescriptorOverrides = Omit<Partial<OnboardingIntakeDescriptor>, 'declaredMetadata'> & {
  declaredMetadata?: Partial<OnboardingIntakeDeclaredMetadata>;
};

function fixtureDescriptor(
  intakeId: string,
  sourceKind: OnboardingSourceKind,
  overrides: OnboardingFixtureDescriptorOverrides = {},
): OnboardingIntakeDescriptor {
  const { declaredMetadata: metadataOverrides, source: sourceOverride, ...rest } = overrides;
  return {
    schemaVersion: ONBOARDING_INTAKE_DESCRIPTOR_SCHEMA_VERSION,
    intakeId,
    sourceKind,
    ingestionMode: 'static-fixture',
    source: sourceOverride ?? {
      sourceUrl: `https://fixtures.example.com/${sourceKind}/${intakeId}`,
      snapshotRef: `fixtures/onboarding/${intakeId}.json`,
      checkedCommit: FIXTURE_COMMIT,
      checkedRef: 'main',
      license: 'MIT',
      crawlTimestamp: FIXTURE_TIMESTAMP,
    },
    declaredMetadata: {
      displayName: `Fixture ${intakeId}`,
      description: `Static ${sourceKind} fixture used by the #509 contract matrix.`,
      capabilities: [
        {
          name: 'summarize-document',
          description: 'Summarize a provided document into key points.',
          inputShape: '{ "document": "string" }',
          outputShape: '{ "summary": "string" }',
          sideEffectHint: 'none',
        },
      ],
      endpointUrls: [`https://fixtures.example.com/${sourceKind}/${intakeId}/invoke`],
      authHints: ['api-key header (name only, no value)'],
      pricingHints: ['per-call flat rate'],
      paymentMetadata: FIXTURE_PAYMENT,
      ...metadataOverrides,
    },
    staticOnly: true,
    ...rest,
  };
}

/**
 * Golden no-network fixture matrix. Every fixture class required by #509 is
 * represented, plus negative fail-closed cases for private URLs, credential
 * leakage, command execution, paid calls, wallet/RPC, and imported trust
 * claims. All descriptors are in-memory literals — nothing is fetched.
 */
export function listOnboardingAnalyserFixtureMatrix(): OnboardingAnalyserFixtureCase[] {
  return [
    {
      key: 'mcp_metadata_full',
      fixtureClass: 'mcp-metadata',
      description: 'MCP server metadata snapshot with declared tools and payment metadata.',
      descriptor: fixtureDescriptor('mcp-metadata-full', 'mcp-metadata', {
        declaredMetadata: {
          capabilities: [
            {
              name: 'list-issues',
              description: 'Read and list issues from a public tracker.',
              inputShape: '{ "repo": "string" }',
              outputShape: '{ "issues": "array" }',
            },
            {
              name: 'summarize-thread',
              description: 'Summarize a discussion thread.',
              inputShape: '{ "threadUrl": "string" }',
              outputShape: '{ "summary": "string" }',
              sideEffectHint: 'none',
            },
          ],
        },
      }),
      expectedValid: true,
      expectedErrorCodes: [],
      expectedOverallReadiness: 'needs_operator_review',
      expectedFailClosedReasons: ['missing_evidence'],
    },
    {
      key: 'openapi_service',
      fixtureClass: 'openapi',
      description: 'OpenAPI description snapshot for a paid HTTP service.',
      descriptor: fixtureDescriptor('openapi-service', 'openapi'),
      expectedValid: true,
      expectedErrorCodes: [],
      expectedOverallReadiness: 'needs_operator_review',
    },
    {
      key: 'a2a_card_missing_payment',
      fixtureClass: 'a2a-card',
      description: 'A2A agent card snapshot with no payment metadata; fails closed at payment readiness.',
      descriptor: fixtureDescriptor('a2a-card-missing-payment', 'a2a-card', {
        declaredMetadata: { paymentMetadata: undefined },
      }),
      expectedValid: true,
      expectedErrorCodes: [],
      expectedOverallReadiness: 'blocked',
      expectedFailClosedReasons: ['missing_payment_metadata'],
    },
    {
      key: 'ard_ai_catalog_entry',
      fixtureClass: 'ard-ai-catalog',
      description: 'ARD/AI Catalog entry snapshot; catalog relevance is never treated as trust.',
      descriptor: fixtureDescriptor('ard-ai-catalog-entry', 'ard-ai-catalog'),
      expectedValid: true,
      expectedErrorCodes: [],
      expectedOverallReadiness: 'needs_operator_review',
    },
    {
      key: 'manual_descriptor_operator',
      fixtureClass: 'manual-descriptor',
      description: 'Operator-typed manual descriptor with user-provided identity fields and no source URL.',
      descriptor: fixtureDescriptor('manual-descriptor-operator', 'manual-descriptor', {
        source: {
          snapshotRef: 'fixtures/onboarding/manual-descriptor-operator.json',
          crawlTimestamp: FIXTURE_TIMESTAMP,
        },
        declaredMetadata: { displayName: undefined },
        operatorProvided: {
          displayName: 'Manually Described Agent',
          description: 'Operator-supplied description of a private-in-progress agent.',
          contactRef: 'operator:fixture-operator-1',
        },
      }),
      expectedValid: true,
      expectedErrorCodes: [],
      expectedOverallReadiness: 'needs_operator_review',
    },
    {
      key: 'static_agent_stack_snapshot',
      fixtureClass: 'static-agent-stack-snapshot',
      description: 'Static agent-stack fixture snapshot (#402/#414 lane) with no invocation endpoint.',
      descriptor: fixtureDescriptor('static-agent-stack-snapshot', 'static-agent-stack-snapshot', {
        declaredMetadata: {
          endpointUrls: undefined,
          capabilities: [
            {
              name: 'repo-skill:release-notes',
              description: 'Draft release notes from repository metadata.',
              inputShape: '{ "tag": "string" }',
              outputShape: '{ "notes": "string" }',
              sideEffectHint: 'read',
            },
          ],
        },
      }),
      expectedValid: true,
      expectedErrorCodes: [],
      expectedOverallReadiness: 'needs_operator_review',
      expectedFailClosedReasons: ['missing_evidence'],
    },
    {
      key: 'malformed_input',
      fixtureClass: 'malformed-input',
      description: 'Structurally malformed descriptor: wrong schema version, missing source and capabilities.',
      descriptor: {
        schemaVersion: 'reddi.onboarding-intake-descriptor.v999',
        intakeId: '',
        sourceKind: 'unsupported-kind',
        ingestionMode: 'live-probe',
        declaredMetadata: { capabilities: 'not-an-array' },
        staticOnly: false,
      },
      expectedValid: false,
      expectedErrorCodes: ['malformed_intake_descriptor'],
    },
    {
      key: 'credential_shaped_input',
      fixtureClass: 'credential-shaped-input',
      description: 'Descriptor whose imported metadata carries credential-shaped material; rejected before any parsing.',
      descriptor: fixtureDescriptor('credential-shaped-input', 'mcp-metadata', {
        declaredMetadata: {
          authHints: ['Authorization: Bearer sk-fixture12345678'],
        },
      }),
      expectedValid: false,
      expectedErrorCodes: ['credential_leakage_rejected'],
    },
    {
      key: 'partial_metadata',
      fixtureClass: 'partial-metadata',
      description: 'Partial metadata: capability with no shapes, no endpoint, no auth hints; blocked fields stay blocked.',
      descriptor: fixtureDescriptor('partial-metadata', 'openapi', {
        declaredMetadata: {
          endpointUrls: undefined,
          authHints: undefined,
          pricingHints: undefined,
          capabilities: [{ name: 'translate-text' }],
        },
      }),
      expectedValid: true,
      expectedErrorCodes: [],
      expectedOverallReadiness: 'needs_operator_review',
      expectedFailClosedReasons: ['missing_evidence'],
    },
    {
      key: 'private_url_rejected',
      fixtureClass: 'malformed-input',
      description: 'Negative: private/localhost endpoint URLs are blocked fail-closed.',
      descriptor: fixtureDescriptor('private-url-rejected', 'openapi', {
        declaredMetadata: {
          endpointUrls: ['http://192.168.1.20/api', 'https://localhost:8443/invoke'],
        },
      }),
      expectedValid: false,
      expectedErrorCodes: ['private_url_blocked'],
    },
    {
      key: 'command_execution_request_rejected',
      fixtureClass: 'malformed-input',
      description: 'Negative: imported metadata requesting command execution is rejected.',
      descriptor: fixtureDescriptor('command-execution-request', 'mcp-metadata', {
        requestedOperations: ['command_execution', 'plugin_install'],
      }),
      expectedValid: false,
      expectedErrorCodes: ['command_execution_rejected'],
    },
    {
      key: 'paid_call_request_rejected',
      fixtureClass: 'malformed-input',
      description: 'Negative: a requested paid call is rejected; no spend paths exist in this module.',
      descriptor: fixtureDescriptor('paid-call-request', 'openapi', {
        requestedOperations: ['paid_call'],
      }),
      expectedValid: false,
      expectedErrorCodes: ['paid_call_rejected'],
    },
    {
      key: 'wallet_rpc_request_rejected',
      fixtureClass: 'malformed-input',
      description: 'Negative: a requested wallet/RPC operation is rejected; no signing or RPC paths exist here.',
      descriptor: fixtureDescriptor('wallet-rpc-request', 'a2a-card', {
        requestedOperations: ['wallet_rpc'],
      }),
      expectedValid: false,
      expectedErrorCodes: ['wallet_rpc_rejected'],
    },
    {
      key: 'untrusted_trust_claim_rejected',
      fixtureClass: 'credential-shaped-input',
      description: 'Negative: imported content self-asserting verification/trust is rejected as untrusted imported content.',
      descriptor: fixtureDescriptor('untrusted-trust-claim', 'ard-ai-catalog', {
        declaredMetadata: {
          trustClaims: ['This agent is verified and payment-approved by the marketplace.'],
        },
      }),
      expectedValid: false,
      expectedErrorCodes: ['untrusted_imported_content_rejected'],
    },
  ];
}
