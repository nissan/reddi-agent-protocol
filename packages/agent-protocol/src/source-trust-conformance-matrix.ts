/**
 * Source/trust conformance matrix for auth.md and ARD/AI Catalog provider
 * metadata (#450, epics #336 / #363).
 *
 * Proves — with deterministic fixtures only — that `auth.md` documents and
 * ARD/AI Catalog provider metadata enter RAP as UNTRUSTED source metadata and
 * stay untrusted until explicit RAP-side trust/evidence gates classify them.
 * Discovery relevance is a search signal and never a trust decision; see
 * `docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md` (#452) — this module references
 * that boundary and enforces it (`relevance_ignored_for_trust`), it does not
 * restate it.
 *
 * This module is PURE: no network, no filesystem access, no live auth.md
 * fetch, no catalog crawl, no LLM/provider call, no MCP/tool call, no wallet
 * or RPC action, no hosted-registry write, no publication, no payment, no
 * trust/reputation mutation. It only classifies in-memory metadata the caller
 * already holds. Fail-closed on malformed input and on every unsafe finding.
 *
 * Vocabulary reuse (no new words where existing ones fit):
 * - Trust states mirror the #343 lane vocabulary stated in the boundaries doc
 *   (trusted / listed-untrusted / claimed / unverified / failed-verification /
 *   blocked / needs-human-review) and overlap with the #506 actionability lane
 *   states (`claimed`, `failed_verification`, `blocked`, `needs_human_review`).
 * - Finding severities reuse the repo static-analysis vocabulary
 *   (`info` / `warning` / `blocked` — `source-diagnostics.ts`, `okf-conformance.ts`).
 * - Finding codes reuse `provider-trust.ts` reason codes wherever one exists
 *   (`malformed_trust_metadata`, `credential_leakage_rejected`,
 *   `no_trust_metadata`, `external_claim_not_verified_by_rap`, `rap_verified`,
 *   `rap_verification_failed`) and add only the auth-surface gates #450 names.
 * - auth.md registration/credential vocabulary aligns with the auth.md
 *   discovery lane (`agent-provider` / `email-verification` / `anonymous`;
 *   `access_token` / `api_key`). Identity-assertion names are DRAFT and
 *   illustrative — auth.md is an external format; confirm before relying.
 *
 * Outputs are projections consumable by:
 * - #343 provider trust registry work (`registryProjection` maps every matrix
 *   state onto the existing `ProviderTrustVerificationStatus` vocabulary and
 *   carries the normalized `ProviderTrustRecord` when one exists), and
 * - #344 source-aware diagnostics (`diagnosticsProjection` uses the
 *   `source-diagnostics.ts` lane + severity vocabulary).
 */

import { type AiCatalogSnapshot } from './ai-catalog.js';
import {
  normalizeAiCatalogProviderTrustRecord,
  providerTrustFixtures,
  type ProviderTrustRecord,
  type ProviderTrustVerificationInput,
  type ProviderTrustVerificationStatus,
} from './provider-trust.js';
import {
  type SourceDiagnosticLane,
  type SourceDiagnosticSeverity,
} from './source-diagnostics.js';

export const SOURCE_TRUST_CONFORMANCE_MATRIX_SCHEMA_VERSION = 'reddi.source-trust-conformance-matrix.v1' as const;

/** Where the boundary between discovery relevance and trust/policy/payment/evidence/reputation is defined. */
export const SOURCE_TRUST_BOUNDARIES_DOC_REF = 'docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md' as const;

/**
 * The #450 / #343 trust-state vocabulary.
 *
 * `listed_untrusted` is the mandatory ingress state: every auth.md document
 * and every ARD/AI Catalog provider entry is listed-untrusted until RAP-side
 * gates run. `unverified` means gates ran and found no trust evidence at all;
 * `claimed` means external trust claims exist but RAP has not verified them.
 */
export type SourceTrustState =
  | 'trusted'
  | 'listed_untrusted'
  | 'claimed'
  | 'unverified'
  | 'failed_verification'
  | 'blocked'
  | 'needs_human_review';

export const SOURCE_TRUST_STATES: readonly SourceTrustState[] = [
  'trusted',
  'listed_untrusted',
  'claimed',
  'unverified',
  'failed_verification',
  'blocked',
  'needs_human_review',
] as const;

/** The #450 acceptance-criteria case list; the matrix must cover every one. */
export type SourceTrustRequiredCase =
  | 'malformed_metadata'
  | 'credential_leakage'
  | 'anonymous_write_scope'
  | 'unsupported_credential_type'
  | 'unsupported_identity_assertion'
  | 'missing_trust_evidence'
  | 'high_relevance_blocked_candidate';

export const SOURCE_TRUST_REQUIRED_CASES: readonly SourceTrustRequiredCase[] = [
  'malformed_metadata',
  'credential_leakage',
  'anonymous_write_scope',
  'unsupported_credential_type',
  'unsupported_identity_assertion',
  'missing_trust_evidence',
  'high_relevance_blocked_candidate',
] as const;

/** Reuses the repo-wide static-analysis severity vocabulary. */
export type SourceTrustFindingSeverity = SourceDiagnosticSeverity;

export type SourceTrustFindingCode =
  // Reused from provider-trust.ts reason codes.
  | 'malformed_trust_metadata'
  | 'credential_leakage_rejected'
  | 'no_trust_metadata'
  | 'external_claim_not_verified_by_rap'
  | 'rap_verified'
  | 'rap_verification_failed'
  // Added for the #450 auth-surface and boundary gates.
  | 'listed_untrusted_on_entry'
  | 'malformed_source_metadata'
  | 'anonymous_write_scope_rejected'
  | 'unsupported_credential_type'
  | 'unsupported_identity_assertion'
  | 'self_asserted_verification_ignored'
  | 'relevance_ignored_for_trust';

export type SourceTrustFinding = {
  code: SourceTrustFindingCode;
  severity: SourceTrustFindingSeverity;
  path: string;
  message: string;
};

/** Supported auth.md credential types (aligned with the auth.md discovery lane). */
export const SUPPORTED_AUTH_MD_CREDENTIAL_TYPES: readonly string[] = ['access_token', 'api_key'] as const;

/** Supported auth.md registration types (aligned with the auth.md discovery lane). */
export const SUPPORTED_AUTH_MD_REGISTRATION_TYPES: readonly string[] = ['agent-provider', 'email-verification', 'anonymous'] as const;

/**
 * Supported identity-assertion mechanisms. DRAFT/illustrative — auth.md is an
 * external format and these names are unconfirmed against a live spec; the
 * fail-closed behavior (unknown assertion ⇒ blocked) is the contract, not the
 * exact allowlist.
 */
export const SUPPORTED_AUTH_MD_IDENTITY_ASSERTIONS: readonly string[] = ['publisher_domain', 'oidc_id_token'] as const;

export type AuthMdScopeDeclaration = {
  name: string;
  access: 'read' | 'write';
  /** Registration types this scope is offered to; omitted means all declared types. */
  registrationTypes?: string[];
};

/**
 * Parsed auth.md source metadata as it enters RAP: still just self-asserted
 * provider text. Nothing in this shape is trusted by import.
 */
export type AuthMdSourceMetadata = {
  url?: string;
  authorizationServer?: string;
  registrationTypes?: string[];
  credentialTypes?: string[];
  identityAssertions?: string[];
  scopes?: AuthMdScopeDeclaration[];
  publisher?: {
    id?: string;
    domain?: string;
  };
  trust?: {
    trustManifest?: unknown;
    provenance?: unknown[];
    attestations?: unknown[];
    verificationReferences?: unknown[];
    publisherIdentity?: unknown;
    /** External self-asserted status; RAP ignores it and flags it for review. */
    status?: string;
  };
  raw?: unknown;
};

export type SourceTrustCandidateSource =
  | { kind: 'auth-md'; metadata: unknown }
  | { kind: 'ai-catalog'; catalog: AiCatalogSnapshot; resourceId: string };

export type ClassifySourceTrustInput = {
  candidateId: string;
  source: SourceTrustCandidateSource;
  /** Discovery relevance — recorded and explicitly ignored for trust. */
  relevance?: {
    score?: number;
    source?: string;
  };
  /** RAP-side verification outcome, when a gate has actually run. */
  rapVerification?: ProviderTrustVerificationInput;
  /**
   * 'not_run' produces the mandatory ingress classification
   * (`listed_untrusted`) without evaluating any gate. Default: 'run'.
   */
  gates?: 'run' | 'not_run';
};

/** #343 registry consumption shape: existing provider-trust vocabulary only. */
export type SourceTrustRegistryProjection = {
  verificationStatus: ProviderTrustVerificationStatus;
  reasonCodes: SourceTrustFindingCode[];
  /** Blocked rows must never be listed as invocable registry candidates. */
  registryEligible: boolean;
  /** Present for ai-catalog sources when provider-trust normalization succeeds. */
  providerTrustRecord?: ProviderTrustRecord;
};

/** #344 diagnostics consumption shape: source-diagnostics lane + severity vocabulary. */
export type SourceTrustDiagnosticsProjectionMessage = {
  lane: SourceDiagnosticLane;
  severity: SourceDiagnosticSeverity;
  code: string;
  summary: string;
  action?: string;
};

export type SourceTrustConformanceRow = {
  schemaVersion: typeof SOURCE_TRUST_CONFORMANCE_MATRIX_SCHEMA_VERSION;
  candidateId: string;
  sourceKind: 'auth-md' | 'ai-catalog';
  /** Constant by construction: both source kinds enter untrusted-until-gated. */
  entryState: 'listed_untrusted';
  state: SourceTrustState;
  stateLabel: string;
  findings: SourceTrustFinding[];
  discoveryBoundary: {
    relevanceScore?: number;
    scoreMeaning: 'relevance_only_not_trust';
    relevanceInfluencedTrust: false;
    boundariesDocRef: typeof SOURCE_TRUST_BOUNDARIES_DOC_REF;
  };
  registryProjection: SourceTrustRegistryProjection;
  diagnosticsProjection: SourceTrustDiagnosticsProjectionMessage[];
};

export type SourceTrustConformanceFixtureCase = {
  description: string;
  requiredCase?: SourceTrustRequiredCase;
  input: ClassifySourceTrustInput;
  expectedState: SourceTrustState;
  expectedFindingCodes: SourceTrustFindingCode[];
};

export type SourceTrustConformanceMatrix = {
  schemaVersion: typeof SOURCE_TRUST_CONFORMANCE_MATRIX_SCHEMA_VERSION;
  boundary: {
    untrustedUntilGated: true;
    /** What the matrix separates trust from — defined in the boundaries doc. */
    distinguishesRelevanceFrom: readonly ['trust', 'policy', 'payment', 'evidence', 'reputation'];
    boundariesDocRef: typeof SOURCE_TRUST_BOUNDARIES_DOC_REF;
  };
  rows: Array<SourceTrustConformanceRow & { fixtureId: string; description: string; requiredCase?: SourceTrustRequiredCase }>;
  coverage: {
    states: Record<SourceTrustState, number>;
    requiredCases: Record<SourceTrustRequiredCase, number>;
    sourceKinds: Record<'auth-md' | 'ai-catalog', number>;
    missingStates: SourceTrustState[];
    missingRequiredCases: SourceTrustRequiredCase[];
    complete: boolean;
  };
};

const STATE_LABELS: Record<SourceTrustState, string> = {
  trusted: 'trusted',
  listed_untrusted: 'listed untrusted',
  claimed: 'claimed',
  unverified: 'unverified',
  failed_verification: 'failed verification',
  blocked: 'blocked',
  needs_human_review: 'needs human review',
};

// Same credential-shape heuristics as provider-trust.ts so both surfaces
// reject leakage identically.
const SENSITIVE_KEY_PATTERN = /(^|[_-])(api[_-]?key|authorization|bearer|cookie|credential|mnemonic|password|private[_-]?key|refresh[_-]?token|secret|seed|session[_-]?token|token)($|[_-])|apiKey|accessToken|refreshToken|sessionToken|privateKey/i;
const SENSITIVE_VALUE_PATTERN = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|authorization:\s*bearer\s+|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,})/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function finding(code: SourceTrustFindingCode, severity: SourceTrustFindingSeverity, path: string, message: string): SourceTrustFinding {
  return { code, severity, path, message };
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

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

type AuthSurface = {
  credentialTypes: string[];
  identityAssertions: string[];
  registrationTypes: string[];
  scopes: AuthMdScopeDeclaration[];
};

function readAuthSurface(source: Record<string, unknown>): AuthSurface {
  const scopesRaw = Array.isArray(source.scopes) ? source.scopes : [];
  const scopes: AuthMdScopeDeclaration[] = [];
  for (const entry of scopesRaw) {
    if (!isPlainObject(entry)) continue;
    const name = typeof entry.name === 'string' ? entry.name : '';
    const access = entry.access === 'write' ? 'write' : 'read';
    scopes.push({
      name,
      access,
      registrationTypes: Array.isArray(entry.registrationTypes) ? stringArray(entry.registrationTypes) : undefined,
    });
  }
  return {
    credentialTypes: stringArray(source.credentialTypes),
    identityAssertions: stringArray(source.identityAssertions),
    registrationTypes: stringArray(source.registrationTypes),
    scopes,
  };
}

/**
 * Fail-closed auth-surface gates shared by both source kinds: anonymous write
 * scopes, unsupported credential types, and unsupported identity assertions
 * are all rejected regardless of how relevant the candidate looks.
 */
function evaluateAuthSurface(surface: AuthSurface, basePath: string, findings: SourceTrustFinding[]): void {
  for (let index = 0; index < surface.scopes.length; index += 1) {
    const scope = surface.scopes[index];
    if (scope.access !== 'write') continue;
    const offeredTo = scope.registrationTypes ?? surface.registrationTypes;
    if (offeredTo.includes('anonymous')) {
      findings.push(finding(
        'anonymous_write_scope_rejected',
        'blocked',
        `${basePath}.scopes[${index}]`,
        `write scope "${scope.name}" is offered to anonymous registrations; anonymous write scopes fail closed.`,
      ));
    }
  }

  for (const credentialType of surface.credentialTypes) {
    if (!SUPPORTED_AUTH_MD_CREDENTIAL_TYPES.includes(credentialType)) {
      findings.push(finding(
        'unsupported_credential_type',
        'blocked',
        `${basePath}.credentialTypes`,
        `credential type "${credentialType}" is not supported (supported: ${SUPPORTED_AUTH_MD_CREDENTIAL_TYPES.join(', ')}).`,
      ));
    }
  }

  for (const assertion of surface.identityAssertions) {
    if (!SUPPORTED_AUTH_MD_IDENTITY_ASSERTIONS.includes(assertion)) {
      findings.push(finding(
        'unsupported_identity_assertion',
        'blocked',
        `${basePath}.identityAssertions`,
        `identity assertion "${assertion}" is not supported (supported: ${SUPPORTED_AUTH_MD_IDENTITY_ASSERTIONS.join(', ')}).`,
      ));
    }
  }
}

function hasAuthMdTrustClaims(trust: Record<string, unknown> | undefined): boolean {
  if (!trust) return false;
  return Boolean(
    trust.trustManifest
      || trust.publisherIdentity
      || (Array.isArray(trust.provenance) && trust.provenance.length > 0)
      || (Array.isArray(trust.attestations) && trust.attestations.length > 0)
      || (Array.isArray(trust.verificationReferences) && trust.verificationReferences.length > 0),
  );
}

type GateOutcome = {
  findings: SourceTrustFinding[];
  hasTrustClaims: boolean;
  providerTrustRecord?: ProviderTrustRecord;
};

function runAuthMdGates(metadata: unknown, rapVerification?: ProviderTrustVerificationInput): GateOutcome {
  const findings: SourceTrustFinding[] = [];

  if (!isPlainObject(metadata)) {
    findings.push(finding('malformed_source_metadata', 'blocked', '$', 'auth.md metadata must be a plain object; malformed metadata fails closed.'));
    return { findings, hasTrustClaims: false };
  }

  const credentialPath = findCredentialMaterial(metadata);
  if (credentialPath) {
    findings.push(finding('credential_leakage_rejected', 'blocked', credentialPath, 'auth.md metadata contains credential-shaped material; it is rejected, never stored.'));
  }

  evaluateAuthSurface(readAuthSurface(metadata), '$', findings);

  const trust = isPlainObject(metadata.trust) ? metadata.trust : undefined;
  if (trust && typeof trust.status === 'string' && trust.status.toLowerCase() === 'verified') {
    findings.push(finding(
      'self_asserted_verification_ignored',
      'warning',
      '$.trust.status',
      'external metadata self-asserts a verified status; external claims cannot verify themselves — routed to human review.',
    ));
  }

  const hasTrustClaims = hasAuthMdTrustClaims(trust);
  appendVerificationFindings(hasTrustClaims, rapVerification, findings);
  return { findings, hasTrustClaims };
}

function runAiCatalogGates(catalog: AiCatalogSnapshot, resourceId: string, rapVerification?: ProviderTrustVerificationInput): GateOutcome {
  const findings: SourceTrustFinding[] = [];
  const result = normalizeAiCatalogProviderTrustRecord(catalog, resourceId, rapVerification ? { verification: rapVerification } : {});

  if (!result.ok) {
    for (const error of result.errors) {
      const code: SourceTrustFindingCode = error.code === 'malformed_trust_metadata'
        ? 'malformed_trust_metadata'
        : error.code === 'credential_leakage_rejected'
          ? 'credential_leakage_rejected'
          : 'malformed_source_metadata';
      findings.push(finding(code, 'blocked', error.path, error.message));
    }
    return { findings, hasTrustClaims: false };
  }

  const resource = catalog.resources.find((item) => item.id === resourceId);
  if (resource && isPlainObject(resource.auth)) {
    evaluateAuthSurface(readAuthSurface(resource.auth), '$.auth', findings);
  }

  const record = result.record;
  const hasTrustClaims = record.verification.status !== 'unverified';
  switch (record.verification.status) {
    case 'verified':
      findings.push(finding('rap_verified', 'info', '$', 'RAP-side verification marked this provider as verified.'));
      break;
    case 'failed_verification':
      findings.push(finding('rap_verification_failed', 'blocked', '$', 'RAP-side verification failed for this provider.'));
      break;
    case 'claimed':
      findings.push(finding('external_claim_not_verified_by_rap', 'warning', '$', 'external trust claims are present but RAP has not verified them.'));
      break;
    case 'unverified':
      findings.push(finding('no_trust_metadata', 'warning', '$', 'no trust evidence is attached to this provider entry.'));
      break;
  }

  return { findings, hasTrustClaims, providerTrustRecord: record };
}

function appendVerificationFindings(hasTrustClaims: boolean, rapVerification: ProviderTrustVerificationInput | undefined, findings: SourceTrustFinding[]): void {
  if (rapVerification?.status === 'verified') {
    findings.push(finding('rap_verified', 'info', '$', 'RAP-side verification marked this source as verified.'));
    return;
  }
  if (rapVerification?.status === 'failed_verification') {
    findings.push(finding('rap_verification_failed', 'blocked', '$', `RAP-side verification failed${rapVerification.failureReasons?.length ? `: ${rapVerification.failureReasons.join('; ')}` : '.'}`));
    return;
  }
  if (hasTrustClaims) {
    findings.push(finding('external_claim_not_verified_by_rap', 'warning', '$', 'external trust claims are present but RAP has not verified them.'));
    return;
  }
  findings.push(finding('no_trust_metadata', 'warning', '$', 'no trust evidence is attached to this source metadata.'));
}

function deriveState(outcome: GateOutcome, rapVerification?: ProviderTrustVerificationInput): SourceTrustState {
  const blockedFindings = outcome.findings.filter((item) => item.severity === 'blocked');
  const verificationFailed = outcome.findings.some((item) => item.code === 'rap_verification_failed')
    || rapVerification?.status === 'failed_verification';

  // Fail-closed precedence: any blocking finding wins, even over a failed
  // verification record, because blocked rows must never be registry-eligible.
  if (blockedFindings.some((item) => item.code !== 'rap_verification_failed')) return 'blocked';
  if (verificationFailed) return 'failed_verification';

  const needsReview = outcome.findings.some((item) => item.code === 'self_asserted_verification_ignored');
  const verified = outcome.findings.some((item) => item.code === 'rap_verified');
  const warnings = outcome.findings.filter((item) => item.severity === 'warning');

  if (needsReview) return 'needs_human_review';
  if (verified) {
    // Verified with residual warnings does not silently become trusted.
    return warnings.length > 0 ? 'needs_human_review' : 'trusted';
  }
  return outcome.hasTrustClaims ? 'claimed' : 'unverified';
}

function registryStatusFor(state: SourceTrustState, hasTrustClaims: boolean): ProviderTrustVerificationStatus {
  switch (state) {
    case 'trusted':
      return 'verified';
    case 'failed_verification':
    case 'blocked':
      return 'failed_verification';
    case 'claimed':
      return 'claimed';
    case 'needs_human_review':
      return hasTrustClaims ? 'claimed' : 'unverified';
    case 'listed_untrusted':
    case 'unverified':
      return 'unverified';
  }
}

function findingLane(code: SourceTrustFindingCode): SourceDiagnosticLane {
  switch (code) {
    case 'relevance_ignored_for_trust':
      return 'capability_match';
    case 'listed_untrusted_on_entry':
      return 'discovery_source';
    default:
      return 'trust_evidence';
  }
}

function buildDiagnosticsProjection(row: {
  candidateId: string;
  state: SourceTrustState;
  findings: SourceTrustFinding[];
  relevanceScore?: number;
}): SourceTrustDiagnosticsProjectionMessage[] {
  const messages: SourceTrustDiagnosticsProjectionMessage[] = [];

  messages.push({
    lane: 'capability_match',
    severity: 'info',
    code: 'relevance_only_not_trust',
    summary: row.relevanceScore === undefined
      ? `Candidate ${row.candidateId} has no relevance score; relevance would not affect trust either way.`
      : `Candidate ${row.candidateId} has relevance score ${row.relevanceScore}; relevance is a search signal, never a trust decision (${SOURCE_TRUST_BOUNDARIES_DOC_REF}).`,
  });

  for (const item of row.findings) {
    messages.push({
      lane: findingLane(item.code),
      severity: item.severity,
      code: item.code,
      summary: item.message,
      action: item.severity === 'blocked'
        ? 'Fail closed: exclude this candidate from registry listing, policy preflight, payment, and invocation.'
        : item.severity === 'warning'
          ? 'Run RAP-side trust verification before treating this candidate as trusted.'
          : undefined,
    });
  }

  messages.push({
    lane: 'trust_evidence',
    severity: row.state === 'trusted' ? 'info' : row.state === 'blocked' || row.state === 'failed_verification' ? 'blocked' : 'warning',
    code: `source_trust_state_${row.state}`,
    summary: `Source/trust conformance state: ${STATE_LABELS[row.state]}.`,
    action: row.state === 'needs_human_review' ? 'Route to operator review; do not auto-upgrade trust.' : undefined,
  });

  return messages;
}

export function classifySourceTrustCandidate(input: ClassifySourceTrustInput): SourceTrustConformanceRow {
  const gatesRun = input.gates !== 'not_run';
  const findings: SourceTrustFinding[] = [];
  let outcome: GateOutcome = { findings: [], hasTrustClaims: false };

  findings.push(finding(
    'listed_untrusted_on_entry',
    'info',
    '$',
    `${input.source.kind} metadata enters RAP as untrusted source metadata; no trust is granted by ingestion.`,
  ));

  if (gatesRun) {
    outcome = input.source.kind === 'auth-md'
      ? runAuthMdGates(input.source.metadata, input.rapVerification)
      : runAiCatalogGates(input.source.catalog, input.source.resourceId, input.rapVerification);
    findings.push(...outcome.findings);
  }

  if (input.relevance?.score !== undefined) {
    findings.push(finding(
      'relevance_ignored_for_trust',
      'info',
      '$.relevance.score',
      `relevance score ${input.relevance.score} is recorded for search/ranking only and is ignored by every trust gate.`,
    ));
  }

  const state: SourceTrustState = gatesRun ? deriveState(outcome, input.rapVerification) : 'listed_untrusted';

  return {
    schemaVersion: SOURCE_TRUST_CONFORMANCE_MATRIX_SCHEMA_VERSION,
    candidateId: input.candidateId,
    sourceKind: input.source.kind,
    entryState: 'listed_untrusted',
    state,
    stateLabel: STATE_LABELS[state],
    findings,
    discoveryBoundary: {
      relevanceScore: input.relevance?.score,
      scoreMeaning: 'relevance_only_not_trust',
      relevanceInfluencedTrust: false,
      boundariesDocRef: SOURCE_TRUST_BOUNDARIES_DOC_REF,
    },
    registryProjection: {
      verificationStatus: registryStatusFor(state, outcome.hasTrustClaims),
      reasonCodes: findings.map((item) => item.code),
      registryEligible: state !== 'blocked',
      providerTrustRecord: outcome.providerTrustRecord,
    },
    diagnosticsProjection: buildDiagnosticsProjection({
      candidateId: input.candidateId,
      state,
      findings,
      relevanceScore: input.relevance?.score,
    }),
  };
}

const AUTH_MD_TRUSTED_METADATA: AuthMdSourceMetadata = {
  url: 'https://agents.reddi.tech/.well-known/auth.md',
  authorizationServer: 'https://auth.reddi.tech',
  registrationTypes: ['agent-provider', 'email-verification'],
  credentialTypes: ['access_token', 'api_key'],
  identityAssertions: ['publisher_domain', 'oidc_id_token'],
  scopes: [
    { name: 'catalog.read', access: 'read' },
    { name: 'listings.write', access: 'write', registrationTypes: ['agent-provider'] },
  ],
  publisher: { id: 'reddi.tech', domain: 'reddi.tech' },
  trust: {
    trustManifest: 'https://agents.reddi.tech/trust-manifest.json',
    provenance: ['https://agents.reddi.tech/provenance/auth.json'],
    attestations: [{ type: 'build-provenance', ref: 'sha256:auth-md-attestation-fixture' }],
    verificationReferences: ['https://agents.reddi.tech/verification/auth.json'],
    publisherIdentity: { domain: 'reddi.tech', status: 'claimed' },
  },
};

/**
 * Fixture cases proving every #450 state and required case, across BOTH
 * source kinds. Deterministic, in-memory, no live fetch anywhere.
 */
export const sourceTrustConformanceFixtureCases: Record<string, SourceTrustConformanceFixtureCase> = {
  trustedAuthMd: {
    description: 'auth.md metadata with full trust evidence and a passing RAP-side verification gate becomes trusted.',
    input: {
      candidateId: 'auth-md:reddi.tech',
      source: { kind: 'auth-md', metadata: AUTH_MD_TRUSTED_METADATA },
      rapVerification: { status: 'verified', verifier: 'rap-fixture-verifier', checkedAt: '2026-07-06T00:00:00Z' },
    },
    expectedState: 'trusted',
    expectedFindingCodes: ['listed_untrusted_on_entry', 'rap_verified'],
  },
  listedUntrustedEntryArd: {
    description: 'ARD/AI Catalog provider metadata that has only been ingested (no gates run) is listed-untrusted.',
    input: {
      candidateId: 'ai-catalog:urn:ai:reddi.tech:specialists:code-review:entry',
      source: { kind: 'ai-catalog', catalog: providerTrustFixtures.verifiedCatalog, resourceId: 'urn:ai:reddi.tech:specialists:code-review' },
      gates: 'not_run',
    },
    expectedState: 'listed_untrusted',
    expectedFindingCodes: ['listed_untrusted_on_entry'],
  },
  listedUntrustedEntryAuthMd: {
    description: 'auth.md metadata that has only been ingested (no gates run) is listed-untrusted.',
    input: {
      candidateId: 'auth-md:reddi.tech:entry',
      source: { kind: 'auth-md', metadata: AUTH_MD_TRUSTED_METADATA },
      gates: 'not_run',
    },
    expectedState: 'listed_untrusted',
    expectedFindingCodes: ['listed_untrusted_on_entry'],
  },
  claimedArd: {
    description: 'ARD/AI Catalog provider metadata with external trust claims stays claimed until RAP verifies it.',
    input: {
      candidateId: 'ai-catalog:urn:ai:reddi.tech:specialists:code-review',
      source: { kind: 'ai-catalog', catalog: providerTrustFixtures.verifiedCatalog, resourceId: 'urn:ai:reddi.tech:specialists:code-review' },
    },
    expectedState: 'claimed',
    expectedFindingCodes: ['listed_untrusted_on_entry', 'external_claim_not_verified_by_rap'],
  },
  unverifiedAuthMdMissingTrustEvidence: {
    description: 'auth.md metadata with no trust evidence at all is unverified (missing-trust-evidence case).',
    requiredCase: 'missing_trust_evidence',
    input: {
      candidateId: 'auth-md:example.com:no-trust-evidence',
      source: {
        kind: 'auth-md',
        metadata: {
          url: 'https://agents.example.com/.well-known/auth.md',
          authorizationServer: 'https://auth.example.com',
          registrationTypes: ['email-verification'],
          credentialTypes: ['access_token'],
          scopes: [{ name: 'catalog.read', access: 'read' }],
        } satisfies AuthMdSourceMetadata,
      },
    },
    expectedState: 'unverified',
    expectedFindingCodes: ['listed_untrusted_on_entry', 'no_trust_metadata'],
  },
  failedVerificationArd: {
    description: 'ARD/AI Catalog provider metadata whose RAP-side verification failed is failed-verification.',
    input: {
      candidateId: 'ai-catalog:urn:ai:reddi.tech:specialists:code-review:failed',
      source: { kind: 'ai-catalog', catalog: providerTrustFixtures.verifiedCatalog, resourceId: 'urn:ai:reddi.tech:specialists:code-review' },
      rapVerification: { status: 'failed_verification', verifier: 'rap-fixture-verifier', failureReasons: ['signature did not match trust manifest'] },
    },
    expectedState: 'failed_verification',
    expectedFindingCodes: ['listed_untrusted_on_entry', 'rap_verification_failed'],
  },
  malformedAuthMdMetadata: {
    description: 'malformed auth.md metadata (not even an object) fails closed to blocked.',
    requiredCase: 'malformed_metadata',
    input: {
      candidateId: 'auth-md:example.com:malformed',
      source: { kind: 'auth-md', metadata: 42 },
    },
    expectedState: 'blocked',
    expectedFindingCodes: ['listed_untrusted_on_entry', 'malformed_source_metadata'],
  },
  malformedArdTrustMetadata: {
    description: 'ARD/AI Catalog provider metadata with malformed trust metadata fails closed to blocked.',
    requiredCase: 'malformed_metadata',
    input: {
      candidateId: 'ai-catalog:urn:example:agents:malformed-trust',
      source: { kind: 'ai-catalog', catalog: providerTrustFixtures.malformedTrustCatalog, resourceId: 'urn:example:agents:malformed-trust' },
    },
    expectedState: 'blocked',
    expectedFindingCodes: ['listed_untrusted_on_entry', 'malformed_trust_metadata'],
  },
  credentialLeakageAuthMd: {
    description: 'auth.md metadata carrying credential-shaped material is rejected outright.',
    requiredCase: 'credential_leakage',
    input: {
      candidateId: 'auth-md:example.com:credential-leak',
      source: {
        kind: 'auth-md',
        metadata: {
          url: 'https://agents.example.com/.well-known/auth.md',
          authorizationServer: 'https://auth.example.com',
          credentialTypes: ['access_token'],
          raw: {
            example: 'Authorization: Bearer fixture-not-a-real-credential',
          },
        } satisfies AuthMdSourceMetadata,
      },
    },
    expectedState: 'blocked',
    expectedFindingCodes: ['listed_untrusted_on_entry', 'credential_leakage_rejected'],
  },
  anonymousWriteScopeAuthMd: {
    description: 'auth.md metadata offering a write scope to anonymous registrations fails closed.',
    requiredCase: 'anonymous_write_scope',
    input: {
      candidateId: 'auth-md:example.com:anonymous-write',
      source: {
        kind: 'auth-md',
        metadata: {
          url: 'https://agents.example.com/.well-known/auth.md',
          authorizationServer: 'https://auth.example.com',
          registrationTypes: ['anonymous', 'email-verification'],
          credentialTypes: ['access_token'],
          scopes: [
            { name: 'catalog.read', access: 'read' },
            { name: 'listings.write', access: 'write', registrationTypes: ['anonymous'] },
          ],
        } satisfies AuthMdSourceMetadata,
      },
    },
    expectedState: 'blocked',
    expectedFindingCodes: ['listed_untrusted_on_entry', 'anonymous_write_scope_rejected'],
  },
  unsupportedCredentialTypeAuthMd: {
    description: 'auth.md metadata declaring an unsupported credential type fails closed.',
    requiredCase: 'unsupported_credential_type',
    input: {
      candidateId: 'auth-md:example.com:unsupported-credential',
      source: {
        kind: 'auth-md',
        metadata: {
          url: 'https://agents.example.com/.well-known/auth.md',
          authorizationServer: 'https://auth.example.com',
          credentialTypes: ['access_token', 'implicit_browser_grant'],
          scopes: [{ name: 'catalog.read', access: 'read' }],
        } satisfies AuthMdSourceMetadata,
      },
    },
    expectedState: 'blocked',
    expectedFindingCodes: ['listed_untrusted_on_entry', 'unsupported_credential_type'],
  },
  unsupportedIdentityAssertionAuthMd: {
    description: 'auth.md metadata declaring an unsupported identity assertion fails closed.',
    requiredCase: 'unsupported_identity_assertion',
    input: {
      candidateId: 'auth-md:example.com:unsupported-assertion',
      source: {
        kind: 'auth-md',
        metadata: {
          url: 'https://agents.example.com/.well-known/auth.md',
          authorizationServer: 'https://auth.example.com',
          credentialTypes: ['access_token'],
          identityAssertions: ['self_signed_screenshot'],
          scopes: [{ name: 'catalog.read', access: 'read' }],
        } satisfies AuthMdSourceMetadata,
      },
    },
    expectedState: 'blocked',
    expectedFindingCodes: ['listed_untrusted_on_entry', 'unsupported_identity_assertion'],
  },
  anonymousWriteScopeArd: {
    description: 'ARD/AI Catalog provider auth metadata offering anonymous write scopes fails closed too.',
    requiredCase: 'anonymous_write_scope',
    input: {
      candidateId: 'ai-catalog:urn:example:agents:anonymous-write',
      source: {
        kind: 'ai-catalog',
        catalog: {
          schemaVersion: 'ai-catalog.v1',
          publisher: { id: 'example.com' },
          rawSnapshotRef: 'sha256:anonymous-write-fixture',
          resources: [
            {
              id: 'urn:example:agents:anonymous-write',
              type: 'application/mcp-server-card+json',
              mediaType: 'application/mcp-server-card+json',
              name: 'Anonymous Write Agent',
              url: 'https://agents.example.com/anonymous-write/mcp.json',
              auth: {
                registrationTypes: ['anonymous'],
                scopes: [{ name: 'listings.write', access: 'write' }],
              },
              raw: {
                identifier: 'urn:example:agents:anonymous-write',
                displayName: 'Anonymous Write Agent',
                mediaType: 'application/mcp-server-card+json',
                url: 'https://agents.example.com/anonymous-write/mcp.json',
              },
            },
          ],
        },
        resourceId: 'urn:example:agents:anonymous-write',
      },
    },
    expectedState: 'blocked',
    expectedFindingCodes: ['listed_untrusted_on_entry', 'anonymous_write_scope_rejected'],
  },
  highRelevanceBlockedArd: {
    description: 'a maximally relevant ARD/AI Catalog candidate with credential leakage is still blocked; relevance never rescues trust.',
    requiredCase: 'high_relevance_blocked_candidate',
    input: {
      candidateId: 'ai-catalog:urn:example:agents:credential-bearing',
      source: { kind: 'ai-catalog', catalog: providerTrustFixtures.credentialBearingCatalog, resourceId: 'urn:example:agents:credential-bearing' },
      relevance: { score: 0.99, source: 'fixture-ranker' },
    },
    expectedState: 'blocked',
    expectedFindingCodes: ['listed_untrusted_on_entry', 'credential_leakage_rejected', 'relevance_ignored_for_trust'],
  },
  needsHumanReviewAuthMd: {
    description: 'auth.md metadata that self-asserts a verified status is routed to human review, never auto-trusted.',
    input: {
      candidateId: 'auth-md:example.com:self-asserted-verified',
      source: {
        kind: 'auth-md',
        metadata: {
          url: 'https://agents.example.com/.well-known/auth.md',
          authorizationServer: 'https://auth.example.com',
          credentialTypes: ['access_token'],
          scopes: [{ name: 'catalog.read', access: 'read' }],
          trust: {
            trustManifest: 'https://agents.example.com/trust-manifest.json',
            status: 'verified',
          },
        } satisfies AuthMdSourceMetadata,
      },
    },
    expectedState: 'needs_human_review',
    expectedFindingCodes: ['listed_untrusted_on_entry', 'self_asserted_verification_ignored'],
  },
};

export function buildSourceTrustConformanceMatrix(
  cases: Record<string, SourceTrustConformanceFixtureCase> = sourceTrustConformanceFixtureCases,
): SourceTrustConformanceMatrix {
  const rows = Object.entries(cases).map(([fixtureId, fixture]) => ({
    fixtureId,
    description: fixture.description,
    requiredCase: fixture.requiredCase,
    ...classifySourceTrustCandidate(fixture.input),
  }));

  const states = Object.fromEntries(SOURCE_TRUST_STATES.map((state) => [state, 0])) as Record<SourceTrustState, number>;
  const requiredCases = Object.fromEntries(SOURCE_TRUST_REQUIRED_CASES.map((item) => [item, 0])) as Record<SourceTrustRequiredCase, number>;
  const sourceKinds: Record<'auth-md' | 'ai-catalog', number> = { 'auth-md': 0, 'ai-catalog': 0 };

  for (const row of rows) {
    states[row.state] += 1;
    sourceKinds[row.sourceKind] += 1;
    if (row.requiredCase) requiredCases[row.requiredCase] += 1;
  }

  const missingStates = SOURCE_TRUST_STATES.filter((state) => states[state] === 0);
  const missingRequiredCases = SOURCE_TRUST_REQUIRED_CASES.filter((item) => requiredCases[item] === 0);

  return {
    schemaVersion: SOURCE_TRUST_CONFORMANCE_MATRIX_SCHEMA_VERSION,
    boundary: {
      untrustedUntilGated: true,
      distinguishesRelevanceFrom: ['trust', 'policy', 'payment', 'evidence', 'reputation'],
      boundariesDocRef: SOURCE_TRUST_BOUNDARIES_DOC_REF,
    },
    rows,
    coverage: {
      states,
      requiredCases,
      sourceKinds,
      missingStates,
      missingRequiredCases,
      complete: missingStates.length === 0
        && missingRequiredCases.length === 0
        && sourceKinds['auth-md'] > 0
        && sourceKinds['ai-catalog'] > 0,
    },
  };
}
