/**
 * #385 — Generated RAP profile review editor (UI adapter).
 *
 * Thin, pure adapter between the profile review/editor UI
 * (`/onboarding/profile-editor`) and the shipped #575 analyser-handoff
 * contracts + #576 onboarding state machine. It contains NO new validation
 * logic: every accept/reject decision is made by
 * `validateOnboardingIntakeDescriptor` / `runOnboardingAnalyserHandoff`
 * (`reddi.onboarding-*.v1`), field provenance comes from the #575 five-way
 * partition (discovered / inferred / user_provided / verified / blocked), and
 * save/continue gating uses the #576 state machine's blocking-gate semantics
 * via `applyOnboardingStateTransition` (`reddi.onboarding-state-machine.v1`).
 *
 * Boundary (per docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md):
 * - Drafts are static/fixture-backed. Nothing here fetches, probes, invokes,
 *   publishes, pays, mutates trust or reputation, or stores secrets.
 * - Operator edits are re-run through the #575 fail-closed validator; a
 *   credential-shaped or private-URL edit is rejected and never kept.
 * - Continue decisions are local read-model events only (scope
 *   `local_read_model_only`); `published_candidate` and everything else in the
 *   #576 model stays internal with a hard-false publication ledger.
 */

import {
  ONBOARDING_INTAKE_DESCRIPTOR_SCHEMA_VERSION,
  partitionOnboardingEntryFieldsByProvenance,
  runOnboardingAnalyserHandoff,
  type OnboardingAnalyserHandoffSuccess,
  type OnboardingCapabilityInventoryEntry,
  type OnboardingDeclaredCapability,
  type OnboardingFailClosedReasonCode,
  type OnboardingFieldProvenance,
  type OnboardingIntakeValidationError,
  type OnboardingProvenancedField,
  type OnboardingReadinessLane,
  type OnboardingSourceKind,
} from "@reddi/agent-protocol/onboarding-analyser-handoff";
import {
  ONBOARDING_STATE_TRANSITION_EVENT_SCHEMA_VERSION,
  applyOnboardingStateTransition,
  createOnboardingAssistantReadModel,
  listOnboardingStateTransitions,
  type OnboardingAssistantReadModel,
  type OnboardingAssistantState,
  type OnboardingBlockingGate,
  type OnboardingGateReasonCode,
  type OnboardingStateTransitionError,
  type OnboardingStateTransitionRecord,
} from "@reddi/agent-protocol/onboarding-state-machine";

export const PROFILE_REVIEW_VIEW_SCHEMA_VERSION = "reddi.onboarding-profile-review-view.v1" as const;
export const PROFILE_REVIEW_ISSUE = 385 as const;

/** Deterministic timestamps: fixture capture date, then the review decision. */
export const PROFILE_REVIEW_BASELINE_TIMESTAMP = "2026-07-06T00:00:00Z" as const;
export const PROFILE_REVIEW_DECISION_TIMESTAMP = "2026-07-06T00:00:01Z" as const;

const FIXTURE_COMMIT = "b4e9d3fa2c815076b4e9d3fa2c815076b4e9d3fa";

// ---------------------------------------------------------------------------
// Fixture scenarios (static — nothing is ever fetched)
// ---------------------------------------------------------------------------

export type ProfileReviewScenarioId = "complete" | "missing-required" | "inferred-warnings";

export type ProfileReviewScenario = {
  id: ProfileReviewScenarioId;
  label: string;
  description: string;
  sourceKind: OnboardingSourceKind;
};

export const PROFILE_REVIEW_SCENARIOS: readonly ProfileReviewScenario[] = Object.freeze([
  {
    id: "complete",
    label: "Complete profile",
    description:
      "MCP metadata snapshot with declared capabilities, endpoint, auth hints, pricing, and payment metadata. Readiness needs operator review; nothing is blocked.",
    sourceKind: "mcp-metadata",
  },
  {
    id: "missing-required",
    label: "Missing required fields",
    description:
      "A2A card snapshot with no display name, no endpoint, and no payment metadata. Payment readiness fails closed until the fields are supplied or the block is explicitly deferred.",
    sourceKind: "a2a-card",
  },
  {
    id: "inferred-warnings",
    label: "Inferred-field warnings",
    description:
      "OpenAPI snapshot whose capabilities declare no side-effect hints — the analyser infers risk (including execute) heuristically, and inferred fields carry review warnings.",
    sourceKind: "openapi",
  },
] as const);

export function getProfileReviewScenario(id: ProfileReviewScenarioId): ProfileReviewScenario {
  const scenario = PROFILE_REVIEW_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`unknown profile review scenario: ${id}`);
  return scenario;
}

type ScenarioSeed = {
  intakeId: string;
  sourceKind: OnboardingSourceKind;
  sourceUrl?: string;
  checkedCommit?: string;
  displayName?: string;
  description?: string;
  contactRef?: string;
  capabilities: OnboardingDeclaredCapability[];
  endpointUrl?: string;
  authHints?: string[];
  pricingHints?: string[];
  payment?: { settlementAddress?: string; network?: string; price?: string; currency?: string };
};

const SCENARIO_SEEDS: Record<ProfileReviewScenarioId, ScenarioSeed> = {
  complete: {
    intakeId: "profile-review-complete",
    sourceKind: "mcp-metadata",
    sourceUrl: "https://fixtures.example.com/mcp/review-complete-card.json",
    checkedCommit: FIXTURE_COMMIT,
    displayName: "Fixture summarizer MCP server",
    description: "Static MCP server metadata snapshot used by the #385 review-editor fixture pathway.",
    contactRef: "operator:review-fixture",
    capabilities: [
      {
        name: "summarize-document",
        description: "Summarize a provided document into key points.",
        inputShape: '{ "document": "string" }',
        outputShape: '{ "summary": "string" }',
        sideEffectHint: "none",
      },
      {
        name: "list-issues",
        description: "Read and list issues from a public tracker.",
        inputShape: '{ "repo": "string" }',
        outputShape: '{ "issues": "array" }',
        sideEffectHint: "read",
      },
      {
        name: "draft-release-notes",
        description: "Draft release notes from repository metadata.",
        inputShape: '{ "tag": "string" }',
        outputShape: '{ "notes": "string" }',
        // No sideEffectHint: the analyser infers this one (renders as inferred).
      },
    ],
    endpointUrl: "https://fixtures.example.com/mcp/review-complete/invoke",
    authHints: ["api-key header (name only, no value)"],
    pricingHints: ["per-call flat rate"],
    payment: {
      settlementAddress: "FixtureSettlementAddress1111111111111111111",
      network: "solana-devnet",
      price: "2.50",
      currency: "AUDD",
    },
  },
  "missing-required": {
    intakeId: "profile-review-missing-required",
    sourceKind: "a2a-card",
    sourceUrl: "https://fixtures.example.com/.well-known/review-missing-agent-card.json",
    description: "Static A2A agent card snapshot with incomplete metadata (#385 fixture).",
    capabilities: [
      {
        name: "translate-text",
        description: "Translate text between declared language pairs.",
        sideEffectHint: "none",
        // No inputShape/outputShape: those fields stay blocked until supplied.
      },
    ],
  },
  "inferred-warnings": {
    intakeId: "profile-review-inferred",
    sourceKind: "openapi",
    sourceUrl: "https://fixtures.example.com/openapi/review-inferred.json",
    checkedCommit: FIXTURE_COMMIT,
    displayName: "Fixture workflow service",
    description: "Static OpenAPI snapshot whose operations declare no side-effect hints (#385 fixture).",
    capabilities: [
      {
        name: "execute-workflow",
        description: "Run a deployment script for the configured workflow.",
        inputShape: '{ "workflowId": "string" }',
        outputShape: '{ "runId": "string" }',
      },
      {
        name: "update-records",
        description: "Create or update records in the managed dataset.",
        inputShape: '{ "records": "array" }',
        outputShape: '{ "updated": "number" }',
      },
      {
        name: "search-index",
        description: "Search the public index and list matching entries.",
        inputShape: '{ "query": "string" }',
        outputShape: '{ "results": "array" }',
      },
    ],
    endpointUrl: "https://fixtures.example.com/openapi/review-inferred/invoke",
    authHints: ["oauth2 client-credentials (scopes only, no secrets)"],
    payment: {
      settlementAddress: "FixtureSettlementAddress1111111111111111111",
      network: "solana-devnet",
      price: "1.25",
      currency: "AUDD",
    },
  },
};

// ---------------------------------------------------------------------------
// Operator edits (re-validated by #575 — this module adds no rules)
// ---------------------------------------------------------------------------

export const PROFILE_EDITABLE_FIELD_KEYS = [
  "displayName",
  "contactRef",
  "endpointUrl",
  "settlementAddress",
  "network",
  "price",
  "currency",
] as const;

export type ProfileEditableFieldKey = (typeof PROFILE_EDITABLE_FIELD_KEYS)[number];

/** Operator-typed overrides. Empty/whitespace values mean "keep as generated". */
export type ProfileReviewEdits = Partial<Record<ProfileEditableFieldKey, string>>;

export const PROFILE_FIELD_LABELS: Record<ProfileEditableFieldKey, string> = {
  displayName: "Display name",
  contactRef: "Publisher contact reference",
  endpointUrl: "Invocation endpoint URL",
  settlementAddress: "Settlement address",
  network: "Payment network",
  price: "Price",
  currency: "Currency",
};

function trimmedEdit(edits: ProfileReviewEdits, key: ProfileEditableFieldKey): string | undefined {
  const value = edits[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Keys the operator actually overrode (non-empty after trim). */
export function listOverriddenKeys(edits: ProfileReviewEdits): ProfileEditableFieldKey[] {
  return PROFILE_EDITABLE_FIELD_KEYS.filter((key) => trimmedEdit(edits, key) !== undefined);
}

/**
 * Build the candidate intake descriptor for the #575 validator, merging the
 * scenario's discovered fixture metadata with operator edits. Deliberately
 * performs no validation of its own — malformed or private endpoint URLs and
 * credential-shaped material are rejected by
 * `validateOnboardingIntakeDescriptor` inside the handoff.
 */
export function buildProfileReviewDescriptorCandidate(
  scenarioId: ProfileReviewScenarioId,
  edits: ProfileReviewEdits = {},
): unknown {
  const seed = SCENARIO_SEEDS[scenarioId];

  const endpointUrl = trimmedEdit(edits, "endpointUrl") ?? seed.endpointUrl;
  const payment = {
    settlementAddress: trimmedEdit(edits, "settlementAddress") ?? seed.payment?.settlementAddress,
    network: trimmedEdit(edits, "network") ?? seed.payment?.network,
    price: trimmedEdit(edits, "price") ?? seed.payment?.price,
    currency: trimmedEdit(edits, "currency") ?? seed.payment?.currency,
  };
  const hasPayment = Object.values(payment).some((value) => value !== undefined);

  const operatorDisplayName = trimmedEdit(edits, "displayName");
  const operatorContactRef = trimmedEdit(edits, "contactRef") ?? seed.contactRef;

  return {
    schemaVersion: ONBOARDING_INTAKE_DESCRIPTOR_SCHEMA_VERSION,
    intakeId: seed.intakeId,
    sourceKind: seed.sourceKind,
    ingestionMode: "static-fixture",
    source: {
      ...(seed.sourceUrl ? { sourceUrl: seed.sourceUrl } : {}),
      snapshotRef: `fixtures/onboarding/profile-review/${seed.intakeId}.json`,
      ...(seed.checkedCommit ? { checkedCommit: seed.checkedCommit, checkedRef: "main" } : {}),
      crawlTimestamp: PROFILE_REVIEW_BASELINE_TIMESTAMP,
    },
    declaredMetadata: {
      ...(seed.displayName ? { displayName: seed.displayName } : {}),
      ...(seed.description ? { description: seed.description } : {}),
      capabilities: seed.capabilities,
      ...(endpointUrl ? { endpointUrls: [endpointUrl] } : {}),
      ...(seed.authHints ? { authHints: seed.authHints } : {}),
      ...(seed.pricingHints ? { pricingHints: seed.pricingHints } : {}),
      ...(hasPayment ? { paymentMetadata: payment } : {}),
    },
    ...(operatorDisplayName || operatorContactRef
      ? {
          operatorProvided: {
            ...(operatorDisplayName ? { displayName: operatorDisplayName } : {}),
            ...(operatorContactRef ? { contactRef: operatorContactRef } : {}),
          },
        }
      : {}),
    staticOnly: true,
  };
}

// ---------------------------------------------------------------------------
// Inline validation issues (projected from #575 validator errors — no new rules)
// ---------------------------------------------------------------------------

export type ProfileFieldIssue = {
  field: ProfileEditableFieldKey | "form";
  code: OnboardingIntakeValidationError["code"];
  message: string;
  /** Clear recovery action for the operator. */
  recovery: string;
};

const RECOVERY_BY_CODE: Partial<Record<OnboardingIntakeValidationError["code"], string>> = {
  private_url_blocked:
    "Use a public HTTPS URL. Private, localhost, and link-local hosts are blocked fail-closed and cannot be recorded.",
  credential_leakage_rejected:
    "Remove the credential-shaped material and re-enter the value. Auth is recorded as names/hints only — never secrets. The rejected input was discarded.",
  malformed_intake_descriptor: "Enter a valid value (for URLs: a full https:// address) and apply the edits again.",
  untrusted_imported_content_rejected:
    "Imported content cannot self-assert trust or verification. Remove the claim; trust is assigned only by operator review with evidence.",
};

function fieldForErrorPath(path: string): ProfileEditableFieldKey | "form" {
  if (/endpointUrls/.test(path)) return "endpointUrl";
  if (/settlementAddress/.test(path)) return "settlementAddress";
  if (/paymentMetadata\.network/.test(path)) return "network";
  if (/paymentMetadata\.price/.test(path)) return "price";
  if (/paymentMetadata\.currency/.test(path)) return "currency";
  if (/paymentMetadata/.test(path)) return "settlementAddress";
  if (/displayName/.test(path)) return "displayName";
  if (/contactRef/.test(path)) return "contactRef";
  return "form";
}

function toFieldIssues(errors: OnboardingIntakeValidationError[]): ProfileFieldIssue[] {
  return errors.map((error) => ({
    field: fieldForErrorPath(error.path),
    code: error.code,
    message: error.message,
    recovery:
      RECOVERY_BY_CODE[error.code] ?? "Correct the value and apply the edits again — the draft was not changed.",
  }));
}

// ---------------------------------------------------------------------------
// Review outcome (regenerate the draft through the #575 handoff)
// ---------------------------------------------------------------------------

export type ProfileReviewOutcome =
  | {
      status: "review";
      handoff: OnboardingAnalyserHandoffSuccess;
      readModel: OnboardingAssistantReadModel;
      nextStates: readonly OnboardingAssistantState[];
      overriddenKeys: ProfileEditableFieldKey[];
    }
  | { status: "blocked_secret"; issues: ProfileFieldIssue[] }
  | { status: "invalid_edits"; issues: ProfileFieldIssue[] };

function buildDraftReadModel(handoff: OnboardingAnalyserHandoffSuccess): OnboardingAssistantReadModel | null {
  const readinessGateReasons: OnboardingGateReasonCode[] = [...handoff.readiness.failClosedReasons];
  const blockingGates: OnboardingBlockingGate[] = [
    {
      gate: "operator_approval",
      reasonCodes: ["operator_approval_pending"],
      note: "Operator review is required before anything becomes public, payable, or trusted.",
    },
    ...(handoff.readiness.overall === "blocked"
      ? [
          {
            gate: "readiness" as const,
            reasonCodes:
              readinessGateReasons.length > 0
                ? readinessGateReasons
                : (["readiness_blocked"] as OnboardingGateReasonCode[]),
            note: "Readiness lanes fail closed until the missing inputs are supplied.",
          },
        ]
      : []),
  ];
  const init = createOnboardingAssistantReadModel({
    draftId: `draft:${handoff.intake.intakeId}`,
    sourceSnapshotRef: handoff.intake.source.snapshotRef,
    readinessResultRef: handoff.readiness.profileRef,
    readinessOverall: handoff.readiness.overall,
    createdAt: PROFILE_REVIEW_BASELINE_TIMESTAMP,
    blockingGates,
  });
  return init.ok ? init.readModel : null;
}

/**
 * Regenerate the profile draft with the operator's edits applied. Pure and
 * deterministic. Invalid edits fail closed with per-field issues and no draft
 * change; credential-shaped edits are classified separately so the UI can
 * state the value was discarded.
 */
export function runProfileReview(
  scenarioId: ProfileReviewScenarioId,
  edits: ProfileReviewEdits = {},
): ProfileReviewOutcome {
  const candidate = buildProfileReviewDescriptorCandidate(scenarioId, edits);
  const result = runOnboardingAnalyserHandoff(candidate);
  if (!result.ok) {
    const issues = toFieldIssues(result.errors);
    if (result.errors.some((error) => error.code === "credential_leakage_rejected")) {
      // Never echo the rejected material: issues carry code + recovery only.
      return { status: "blocked_secret", issues };
    }
    return { status: "invalid_edits", issues };
  }
  const readModel = buildDraftReadModel(result);
  if (!readModel) {
    return {
      status: "invalid_edits",
      issues: [
        {
          field: "form",
          code: "malformed_intake_descriptor",
          message: "the onboarding state machine rejected the draft read model; review fails closed",
          recovery: "Reset the editor and start from the fixture scenario again.",
        },
      ],
    };
  }
  return {
    status: "review",
    handoff: result,
    readModel,
    nextStates: listOnboardingStateTransitions(readModel.state),
    overriddenKeys: listOverriddenKeys(edits),
  };
}

// ---------------------------------------------------------------------------
// View model (field rows with five-way provenance)
// ---------------------------------------------------------------------------

export type ProfileFieldRow = {
  key: string;
  label: string;
  /** Rendered value; null renders honestly as blocked/unavailable. */
  value: string | null;
  provenance: OnboardingFieldProvenance;
  blockedReason?: OnboardingFailClosedReasonCode;
  editable?: ProfileEditableFieldKey;
  required?: boolean;
  /** Non-empty for inferred fields that deserve operator attention. */
  warning?: string;
};

export type ProfileCapabilityView = {
  capabilityId: string;
  tag: string;
  provenance: OnboardingFieldProvenance;
  sideEffectRisk: string;
  riskProvenance: OnboardingFieldProvenance;
  riskWarning?: string;
  fields: ProfileFieldRow[];
  provenancePartition: Record<OnboardingFieldProvenance, string[]>;
};

export type ProfileUnavailableSection = {
  id: "tools" | "skills" | "downstream-calls" | "context-requirements";
  label: string;
  note: string;
};

/**
 * Sections issue #385 asks for that `reddi.onboarding-rap-profile-draft.v1`
 * does not carry as distinct fields. They render honestly as unavailable
 * instead of being fabricated from capability text.
 */
export const PROFILE_UNAVAILABLE_SECTIONS: readonly ProfileUnavailableSection[] = Object.freeze([
  {
    id: "tools",
    label: "Tools",
    note: "The profile-draft contract carries a single capabilities list; it does not distinguish tools from other capabilities. MCP tool metadata arrives as capability entries above.",
  },
  {
    id: "skills",
    label: "Skills",
    note: "Not carried by reddi.onboarding-rap-profile-draft.v1 — skills are not a separate field; declared capabilities are the only capability surface.",
  },
  {
    id: "downstream-calls",
    label: "Downstream calls",
    note: "Not carried by the contract. Invocation is contract-disabled (invocationAllowed: false) and no downstream call graph exists in static metadata.",
  },
  {
    id: "context-requirements",
    label: "Context requirements",
    note: "Not carried as a distinct field. The closest carried fields are the policy requirements and evidence expectations listed above.",
  },
] as const);

export type ProfileReviewViewModel = {
  schemaVersion: typeof PROFILE_REVIEW_VIEW_SCHEMA_VERSION;
  identity: ProfileFieldRow[];
  capabilities: ProfileCapabilityView[];
  capabilityTags: { tag: string; provenance: OnboardingFieldProvenance }[];
  invocation: ProfileFieldRow[];
  authRequirements: string[];
  pricing: ProfileFieldRow[];
  payment: { rows: ProfileFieldRow[]; status: string; missingFields: string[]; activation: "disabled" };
  trust: ProfileFieldRow[];
  policyRequirements: string[];
  evidenceExpectations: string[];
  unavailableSections: readonly ProfileUnavailableSection[];
  provenanceCounts: Record<OnboardingFieldProvenance, number>;
};

function provenancedRow(
  key: string,
  label: string,
  field: OnboardingProvenancedField<unknown>,
  extras: Partial<ProfileFieldRow> = {},
): ProfileFieldRow {
  const rawValue = field.value;
  const value =
    rawValue === undefined ? null : Array.isArray(rawValue) ? rawValue.join(", ") : String(rawValue);
  return {
    key,
    label,
    value,
    provenance: field.provenance,
    ...(field.blockedReason ? { blockedReason: field.blockedReason } : {}),
    ...extras,
  };
}

function overrideProvenance(
  row: ProfileFieldRow,
  overriddenKeys: ProfileEditableFieldKey[],
): ProfileFieldRow {
  if (row.editable && overriddenKeys.includes(row.editable)) {
    return { ...row, provenance: "user_provided", blockedReason: undefined };
  }
  return row;
}

const INFERRED_WARNING = "Inferred by analyser heuristics — confirm against operator intent during review.";
const INFERRED_RISK_WARNING: Record<string, string> = {
  execute:
    "Inferred EXECUTE risk from capability text. Confirm before review — execute-class capabilities require the strictest scope review.",
  write: "Inferred WRITE risk from capability text. Confirm the mutation surface before review.",
  read: INFERRED_WARNING,
  none: INFERRED_WARNING,
};

function capabilityView(entry: OnboardingCapabilityInventoryEntry): ProfileCapabilityView {
  const risk = entry.sideEffectRisk.value ?? "unknown";
  const riskInferred = entry.sideEffectRisk.provenance === "inferred";
  const fields: ProfileFieldRow[] = [
    provenancedRow(`${entry.capabilityId}.description`, "Description", entry.description),
    provenancedRow(`${entry.capabilityId}.inputShape`, "Input shape", entry.inputShape),
    provenancedRow(`${entry.capabilityId}.outputShape`, "Output shape", entry.outputShape),
    provenancedRow(`${entry.capabilityId}.sideEffectRisk`, "Side-effect risk", entry.sideEffectRisk, {
      ...(riskInferred ? { warning: INFERRED_RISK_WARNING[risk] ?? INFERRED_WARNING } : {}),
    }),
    provenancedRow(`${entry.capabilityId}.endpointUrl`, "Endpoint URL", entry.endpointUrl),
    provenancedRow(`${entry.capabilityId}.authHints`, "Auth hints", entry.authHints),
    provenancedRow(`${entry.capabilityId}.pricingHints`, "Pricing hints", entry.pricingHints),
  ];
  return {
    capabilityId: entry.capabilityId,
    tag: entry.name.value ?? "(blocked)",
    provenance: entry.name.provenance,
    sideEffectRisk: risk,
    riskProvenance: entry.sideEffectRisk.provenance,
    ...(riskInferred ? { riskWarning: INFERRED_RISK_WARNING[risk] ?? INFERRED_WARNING } : {}),
    fields,
    provenancePartition: partitionOnboardingEntryFieldsByProvenance(entry),
  };
}

/** Project the #575 profile draft into renderable field rows with provenance. */
export function buildProfileReviewViewModel(
  handoff: OnboardingAnalyserHandoffSuccess,
  overriddenKeys: ProfileEditableFieldKey[] = [],
): ProfileReviewViewModel {
  const profile = handoff.rapProfileDraft;
  const paymentMetadata = profile.payment.metadata;

  const identity: ProfileFieldRow[] = [
    overrideProvenance(
      provenancedRow("identity.displayName", PROFILE_FIELD_LABELS.displayName, profile.identity.displayName, {
        editable: "displayName",
        required: true,
      }),
      overriddenKeys,
    ),
    {
      key: "identity.sourceKind",
      label: "Source kind",
      value: profile.identity.sourceKind,
      provenance: "discovered",
    },
    overrideProvenance(
      provenancedRow(
        "identity.publisherContactRef",
        PROFILE_FIELD_LABELS.contactRef,
        profile.identity.publisherContactRef,
        { editable: "contactRef" },
      ),
      overriddenKeys,
    ),
  ];

  const endpointValue = profile.invocation.endpointUrls[0];
  const invocation: ProfileFieldRow[] = [
    overrideProvenance(
      {
        key: "invocation.endpointUrl",
        label: PROFILE_FIELD_LABELS.endpointUrl,
        value: endpointValue ?? null,
        provenance: endpointValue ? "discovered" : "blocked",
        ...(endpointValue ? {} : { blockedReason: "missing_evidence" as const }),
        editable: "endpointUrl",
      },
      overriddenKeys,
    ),
    {
      key: "invocation.invocationAllowed",
      label: "Invocation allowed",
      value: "false (contract-disabled)",
      provenance: "discovered",
    },
    {
      key: "healthChecks.status",
      label: "Health checks",
      value: `${profile.healthChecks.status} (probes disabled)`,
      provenance: "discovered",
    },
  ];

  const paymentFieldKeys = ["settlementAddress", "network", "price", "currency"] as const;
  const paymentRows: ProfileFieldRow[] = paymentFieldKeys.map((key) =>
    overrideProvenance(
      {
        key: `payment.${key}`,
        label: PROFILE_FIELD_LABELS[key],
        value: paymentMetadata?.[key] ?? null,
        provenance: paymentMetadata?.[key] ? "discovered" : "blocked",
        ...(paymentMetadata?.[key] ? {} : { blockedReason: "missing_payment_metadata" as const }),
        editable: key,
        required: true,
      },
      overriddenKeys,
    ),
  );

  const pricing: ProfileFieldRow[] = [
    {
      key: "pricing.price",
      label: "Declared price",
      value:
        paymentMetadata?.price && paymentMetadata?.currency
          ? `${paymentMetadata.price} ${paymentMetadata.currency}`
          : null,
      provenance: paymentMetadata?.price ? "discovered" : "blocked",
      ...(paymentMetadata?.price ? {} : { blockedReason: "missing_payment_metadata" as const }),
    },
    ...handoff.capabilityInventory.entries.slice(0, 1).map((entry) =>
      provenancedRow("pricing.hints", "Pricing hints", entry.pricingHints),
    ),
  ];

  const trust: ProfileFieldRow[] = [
    {
      key: "trust.sourceAuthenticity",
      label: "Source authenticity",
      value: profile.trust.sourceAuthenticity,
      provenance: profile.trust.sourceAuthenticity === "snapshot_recorded" ? "discovered" : "blocked",
      ...(profile.trust.sourceAuthenticity === "snapshot_recorded"
        ? {}
        : { blockedReason: "missing_evidence" as const }),
    },
    {
      key: "trust.importedContentTrust",
      label: "Imported content trust",
      value: profile.trust.importedContentTrust,
      provenance: "discovered",
    },
    {
      key: "trust.verifiedProviderTrust",
      label: "Verified provider trust",
      value: String(profile.trust.verifiedProviderTrust),
      provenance: "discovered",
    },
    {
      key: "reputation.status",
      label: "Reputation",
      value: profile.reputation.status,
      provenance: "discovered",
    },
  ];

  const capabilities = handoff.capabilityInventory.entries.map(capabilityView);

  const rows = [
    ...identity,
    ...capabilities.flatMap((capability) => capability.fields),
    ...invocation,
    ...paymentRows,
    ...pricing,
    ...trust,
  ];
  const provenanceCounts: Record<OnboardingFieldProvenance, number> = {
    discovered: 0,
    inferred: 0,
    user_provided: 0,
    verified: 0,
    blocked: 0,
  };
  for (const row of rows) provenanceCounts[row.provenance] += 1;
  for (const capability of capabilities) provenanceCounts[capability.provenance] += 1;

  return {
    schemaVersion: PROFILE_REVIEW_VIEW_SCHEMA_VERSION,
    identity,
    capabilities,
    capabilityTags: capabilities.map((capability) => ({ tag: capability.tag, provenance: capability.provenance })),
    invocation,
    authRequirements: profile.authRequirements,
    pricing,
    payment: {
      rows: paymentRows,
      status: profile.payment.status,
      missingFields: profile.payment.missingFields,
      activation: "disabled",
    },
    trust,
    policyRequirements: profile.policyRequirements,
    evidenceExpectations: profile.evidenceExpectations,
    unavailableSections: PROFILE_UNAVAILABLE_SECTIONS,
    provenanceCounts,
  };
}

// ---------------------------------------------------------------------------
// Diff view: discovered metadata vs generated RAP profile fields
// ---------------------------------------------------------------------------

export type ProfileDiffStatus = "unchanged" | "operator_edited" | "inferred" | "generated_added" | "blocked";

export type ProfileDiffRow = {
  field: string;
  discovered: string | null;
  generated: string | null;
  status: ProfileDiffStatus;
};

/**
 * Field-by-field diff between the scenario's discovered (imported) metadata
 * and the currently generated RAP profile draft. Generator-added fields
 * (policy requirements, evidence expectations, trust posture, payment status)
 * are marked `generated_added`; operator overrides are `operator_edited`.
 */
export function buildProfileDiff(
  scenarioId: ProfileReviewScenarioId,
  current: OnboardingAnalyserHandoffSuccess,
  overriddenKeys: ProfileEditableFieldKey[],
): ProfileDiffRow[] {
  const seed = SCENARIO_SEEDS[scenarioId];
  const profile = current.rapProfileDraft;
  const rows: ProfileDiffRow[] = [];

  function push(
    field: string,
    discovered: string | null,
    generated: string | null,
    editable?: ProfileEditableFieldKey,
    inferred = false,
  ): void {
    let status: ProfileDiffStatus;
    if (editable && overriddenKeys.includes(editable)) status = "operator_edited";
    else if (inferred) status = "inferred";
    else if (generated === null) status = "blocked";
    else if (discovered === null) status = "generated_added";
    else status = "unchanged";
    rows.push({ field, discovered, generated, status });
  }

  push(
    PROFILE_FIELD_LABELS.displayName,
    seed.displayName ?? null,
    profile.identity.displayName.value ?? null,
    "displayName",
  );
  push(
    PROFILE_FIELD_LABELS.contactRef,
    seed.contactRef ?? null,
    profile.identity.publisherContactRef.value ?? null,
    "contactRef",
  );
  push(
    PROFILE_FIELD_LABELS.endpointUrl,
    seed.endpointUrl ?? null,
    profile.invocation.endpointUrls[0] ?? null,
    "endpointUrl",
  );

  const paymentKeys = ["settlementAddress", "network", "price", "currency"] as const;
  for (const key of paymentKeys) {
    push(
      PROFILE_FIELD_LABELS[key],
      seed.payment?.[key] ?? null,
      profile.payment.metadata?.[key] ?? null,
      key,
    );
  }
  push("Payment status", null, profile.payment.status);
  push("Payment activation", null, profile.payment.activation);

  current.capabilityInventory.entries.forEach((entry, index) => {
    const declared = seed.capabilities[index];
    push(
      `Capability "${entry.name.value ?? declared?.name ?? index}" side-effect risk`,
      declared?.sideEffectHint ?? null,
      entry.sideEffectRisk.value ?? null,
      undefined,
      entry.sideEffectRisk.provenance === "inferred",
    );
  });

  push("Auth requirements", seed.authHints?.join(", ") ?? null, profile.authRequirements.join(", ") || null);
  push("Policy requirements", null, profile.policyRequirements.join(", "));
  push("Evidence expectations", null, profile.evidenceExpectations.join(", "));
  push("Imported content trust", null, profile.trust.importedContentTrust);
  push("Reputation", null, profile.reputation.status);

  return rows;
}

// ---------------------------------------------------------------------------
// Save/continue gate (#576 blocking-gate semantics)
// ---------------------------------------------------------------------------

export type ProfileGateEvaluation = {
  /** True while any readiness lane fails closed. */
  blocked: boolean;
  blockedLanes: OnboardingReadinessLane[];
  failClosedReasons: OnboardingFailClosedReasonCode[];
  /** A non-empty deferral reason is required while blocked. */
  deferralReasonRequired: boolean;
  deferralReasonSupplied: boolean;
  canContinue: boolean;
  continueTarget: OnboardingAssistantState;
  continueLabel: string;
};

/**
 * Evaluate the save/continue gate. Continue is disabled while readiness is
 * blocked, unless the operator explicitly defers with a reason — in which case
 * the draft routes to the matching #576 gate state instead of operator
 * approval. Local read-model semantics only.
 */
export function evaluateProfileGate(
  handoff: OnboardingAnalyserHandoffSuccess,
  deferralReason: string,
): ProfileGateEvaluation {
  const blocked = handoff.readiness.overall === "blocked";
  const blockedLanes = handoff.readiness.lanes.filter((lane) => lane.status === "blocked");
  const failClosedReasons = handoff.readiness.failClosedReasons;
  const deferralReasonSupplied = deferralReason.trim().length > 0;
  const canContinue = !blocked || deferralReasonSupplied;
  const continueTarget: OnboardingAssistantState = blocked
    ? failClosedReasons.includes("missing_payment_metadata")
      ? "payment_setup_required"
      : "needs_provider_input"
    : "pending_operator_approval";
  return {
    blocked,
    blockedLanes,
    failClosedReasons,
    deferralReasonRequired: blocked,
    deferralReasonSupplied,
    canContinue,
    continueTarget,
    continueLabel: blocked
      ? `Defer blocking issues → ${continueTarget}`
      : "Save review → pending operator approval",
  };
}

export type ProfileContinueDecision =
  | {
      ok: true;
      deferred: boolean;
      readModel: OnboardingAssistantReadModel;
      record: OnboardingStateTransitionRecord;
      nextStates: readonly OnboardingAssistantState[];
    }
  | { ok: false; errors: OnboardingStateTransitionError[] };

/**
 * Record the save/continue decision as a #576 local read-model transition.
 * Resolved drafts move `draft -> pending_operator_approval`; blocked drafts
 * may only move when explicitly deferred with a reason, routing to
 * `payment_setup_required` / `needs_provider_input` with the matching open
 * blocking gate carried on the event. No publication side effect exists:
 * the returned read model's publication ledger stays hard-false.
 */
export function recordProfileContinueDecision(
  handoff: OnboardingAnalyserHandoffSuccess,
  readModel: OnboardingAssistantReadModel,
  deferralReason: string,
): ProfileContinueDecision {
  const gate = evaluateProfileGate(handoff, deferralReason);
  if (!gate.canContinue) {
    return {
      ok: false,
      errors: [
        {
          code: "unresolved_blocking_gates",
          path: "$.deferralReason",
          message:
            "blocking readiness issues must be resolved or explicitly deferred with a reason before continuing",
        },
      ],
    };
  }

  const deferred = gate.blocked;
  const reasonCodes: OnboardingGateReasonCode[] =
    gate.failClosedReasons.length > 0 ? [...gate.failClosedReasons] : ["readiness_blocked"];

  const blockingGates: OnboardingBlockingGate[] = [
    {
      gate: "operator_approval",
      reasonCodes: ["operator_approval_pending"],
      note: "Operator approval remains required before anything becomes public, payable, or trusted.",
    },
    ...(deferred
      ? [
          {
            gate:
              gate.continueTarget === "payment_setup_required"
                ? ("payment_setup" as const)
                : ("provider_input" as const),
            reasonCodes:
              gate.continueTarget === "payment_setup_required"
                ? (["missing_payment_metadata"] as OnboardingGateReasonCode[])
                : (["provider_input_required"] as OnboardingGateReasonCode[]),
            note: `Deferred by operator: ${deferralReason.trim()}`,
          },
          {
            gate: "readiness" as const,
            reasonCodes,
            note: "Readiness lanes still fail closed; the deferral records why review continues anyway.",
          },
        ]
      : []),
  ];

  const result = applyOnboardingStateTransition(readModel, {
    schemaVersion: ONBOARDING_STATE_TRANSITION_EVENT_SCHEMA_VERSION,
    eventId: `review-decision:${readModel.draftId}`,
    to: gate.continueTarget,
    reason: deferred
      ? `Blocking readiness issues explicitly deferred by operator: ${deferralReason.trim()}`
      : "Operator review complete — profile draft submitted for operator approval.",
    actorType: "operator",
    actorRef: "operator:profile-review-editor",
    occurredAt: PROFILE_REVIEW_DECISION_TIMESTAMP,
    sourceSnapshotRef: readModel.sourceSnapshotRef,
    readinessResultRef: handoff.readiness.profileRef,
    readinessOverall: handoff.readiness.overall,
    blockingGates,
  });

  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }
  return {
    ok: true,
    deferred,
    readModel: result.readModel,
    record: result.record,
    nextStates: listOnboardingStateTransitions(result.readModel.state),
  };
}
