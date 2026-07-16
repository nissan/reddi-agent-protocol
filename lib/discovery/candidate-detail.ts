import {
  deriveDiscoveryActionabilityMatrix,
  deriveHostedDiscoveryActionabilityMatrix,
  type DiscoveryActionabilityMatrix,
} from "@/lib/manager/discovery-actionability-matrix";
import {
  searchHostedMarketplaceCatalog,
  type MarketplaceCatalogSearchResult,
} from "@/lib/manager/marketplace-public-search";
import {
  getStaticAgentStackReviewWorkspace,
  type OperatorDiscoveryCandidateView,
  type OperatorDiscoveryWorkspaceView,
} from "@/lib/manager/static-agent-stack-review";
import {
  loadCircleX402Catalog,
  type CircleX402Catalog,
} from "@/lib/integrations/source-adapter/circle-x402-catalog";
import {
  loadPayShCatalog,
  type PayShCatalog,
} from "@/lib/integrations/source-adapter/pay-sh-catalog";
import {
  buildArdCatalogCandidateCards,
  buildCircleX402CandidateCards,
  buildHostedRapCandidateCards,
  buildPayShCandidateCards,
} from "@/lib/discovery/marketplace-candidate-cards";
import {
  DISCOVERY_SOURCE_BOUNDARY,
  describeDiscoverySourceFacet,
  isDiscoverySourceFacetId,
  type DiscoverySourceFacetId,
  type MarketplaceCandidateCardModel,
} from "@/lib/discovery/source-facets";

/**
 * Discovery candidate detail read model (#382).
 *
 * Deep-linkable detail view data for the #381 marketplace candidate cards —
 * ARD / AI Catalog static-stack imports (#383 fixtures), hosted RAP registry
 * catalog listings (#369 snapshot), and the Circle x402 / Pay.sh externally
 * listed fixture catalogs. The detail is a strict superset of the card model:
 * the embedded `card` is produced by the exact #381 builders (drift-locked by
 * reuse), the six-lane matrix comes from the #577 adapters where one exists,
 * trust words are the #593 vocabulary, and every unknown/absent value is
 * `null` so the UI can render "unavailable" honestly instead of inventing a
 * value.
 *
 * Read-only and fixture-backed: no network call, endpoint invocation, paid
 * call, wallet/RPC action, publication, or trust/reputation mutation happens
 * here — see `docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md`.
 */

export const DISCOVERY_CANDIDATE_DETAIL_SCHEMA_VERSION =
  "reddi.discovery-candidate-detail.v1" as const;

/** Source classes the candidate detail route serves. RAP-native registry
 * specialists (rap-registry / openrouter / local-demo) keep their existing
 * `/agents/[wallet]` detail page and are rejected here as `unsupported_id`. */
export const DETAIL_CANDIDATE_FACETS = [
  "hosted-rap",
  "ard-catalog",
  "circle-x402",
  "pay-sh",
] as const satisfies readonly DiscoverySourceFacetId[];

export type DetailCandidateFacetId = (typeof DETAIL_CANDIDATE_FACETS)[number];

export type DiscoveryCandidateDetailAvailability =
  | "found"
  | "not_found"
  | "source_unavailable"
  | "unsupported_id";

// ── Lifecycle strip (#382 criterion: discovered / RAP-wrapped / attested /
//    payment-ready / hireable rendered as separate, never-blended states) ────

export type DiscoveryLifecycleStageId =
  | "discovered"
  | "rap_wrapped"
  | "attested"
  | "payment_ready"
  | "hireable";

export const DISCOVERY_LIFECYCLE_STAGE_ORDER: readonly DiscoveryLifecycleStageId[] = [
  "discovered",
  "rap_wrapped",
  "attested",
  "payment_ready",
  "hireable",
];

export const DISCOVERY_LIFECYCLE_STAGE_LABELS: Record<DiscoveryLifecycleStageId, string> = {
  discovered: "Discovered",
  rap_wrapped: "RAP-wrapped",
  attested: "Attested",
  payment_ready: "Payment-ready",
  hireable: "Hireable",
};

export type DiscoveryLifecycleStage = {
  id: DiscoveryLifecycleStageId;
  label: string;
  reached: boolean;
  note: string;
};

/**
 * All candidates served by this route are discovery-stage records: none is
 * RAP-wrapped, attested, payment-ready, or hireable (those flags are literal
 * `false` / `disabled` in every source read model). The notes carry the
 * per-source reason so the UI never implies a later stage was evaluated.
 */
function discoveredOnlyLifecycle(notes: {
  discovered: string;
  rapWrapped: string;
  attested: string;
  paymentReady: string;
  hireable: string;
}): DiscoveryLifecycleStage[] {
  return [
    { id: "discovered", label: DISCOVERY_LIFECYCLE_STAGE_LABELS.discovered, reached: true, note: notes.discovered },
    { id: "rap_wrapped", label: DISCOVERY_LIFECYCLE_STAGE_LABELS.rap_wrapped, reached: false, note: notes.rapWrapped },
    { id: "attested", label: DISCOVERY_LIFECYCLE_STAGE_LABELS.attested, reached: false, note: notes.attested },
    { id: "payment_ready", label: DISCOVERY_LIFECYCLE_STAGE_LABELS.payment_ready, reached: false, note: notes.paymentReady },
    { id: "hireable", label: DISCOVERY_LIFECYCLE_STAGE_LABELS.hireable, reached: false, note: notes.hireable },
  ];
}

// ── Detail shape ──────────────────────────────────────────────────────────────

/** A labelled metadata field; `value: null` renders "unavailable" honestly. */
export type DiscoveryCandidateDetailField = {
  id: string;
  label: string;
  value: string | null;
};

export type DiscoveryCandidateDetailSection = {
  id: "provenance" | "identity" | "endpoint" | "payment" | "trust_manifest";
  title: string;
  fields: DiscoveryCandidateDetailField[];
};

export type DiscoveryCandidateValidationFinding = {
  id: string;
  source: string;
  state: string;
  severity: string;
  message: string;
  reasonCodes: string[];
  blocksPublication: boolean;
};

export type DiscoveryCandidateCapabilityGroup = {
  id: string;
  name: string;
  sourceKind: string;
  sourcePath: string;
  runtimeSurface: string;
  capabilityRefs: string[];
  writeCapable: boolean;
  humanReviewRequired: boolean;
};

const GUARDRAILS = {
  endpointInvocation: false,
  walletSigning: false,
  rpcCall: false,
  livePayment: false,
  publication: false,
  trustMutation: false,
  reputationMutation: false,
} as const;

export type DiscoveryCandidateDetail = {
  schemaVersion: typeof DISCOVERY_CANDIDATE_DETAIL_SCHEMA_VERSION;
  id: string;
  /** The exact #381 card model — the card and detail can never disagree. */
  card: MarketplaceCandidateCardModel;
  lifecycle: DiscoveryLifecycleStage[];
  /** Full six-lane #577 matrix where an adapter exists for the source class. */
  matrix: DiscoveryActionabilityMatrix | null;
  /** Honest explanation whenever `matrix` is null; never both null. */
  matrixUnavailableReason: string | null;
  sections: DiscoveryCandidateDetailSection[];
  capabilityTags: string[];
  capabilityGroups: DiscoveryCandidateCapabilityGroup[];
  /** Full, untruncated gating reason codes (the card slices to 8). */
  gatingReasons: string[];
  validationFindings: DiscoveryCandidateValidationFinding[];
  /** Import/source guardrail + trust notes carried verbatim from the source read model. */
  guardrailNotes: string[];
  evidenceRefs: string[];
  rawSnapshotRefs: string[];
  /** Operator recovery actions for blocked/unsafe candidates; empty when none apply. */
  recoveryActions: string[];
  trustBoundary: typeof DISCOVERY_SOURCE_BOUNDARY;
  guardrails: typeof GUARDRAILS;
};

export type DiscoveryCandidateDetailResult =
  | {
      schemaVersion: typeof DISCOVERY_CANDIDATE_DETAIL_SCHEMA_VERSION;
      availability: "found";
      id: string;
      sourceFacet: DetailCandidateFacetId;
      detail: DiscoveryCandidateDetail;
      trustBoundary: typeof DISCOVERY_SOURCE_BOUNDARY;
      guardrails: typeof GUARDRAILS;
    }
  | {
      schemaVersion: typeof DISCOVERY_CANDIDATE_DETAIL_SCHEMA_VERSION;
      availability: Exclude<DiscoveryCandidateDetailAvailability, "found">;
      id: string;
      sourceFacet: DiscoverySourceFacetId | null;
      reason: string;
      recoveryActions: string[];
      trustBoundary: typeof DISCOVERY_SOURCE_BOUNDARY;
      guardrails: typeof GUARDRAILS;
    };

// ── Id parsing ────────────────────────────────────────────────────────────────

export type ParsedDiscoveryCandidateDetailId = {
  facet: DetailCandidateFacetId;
  rest: string;
};

/**
 * Card ids are `<facet>:<source-native id>` (from the #381 builders). Returns
 * null for anything that is not a well-formed candidate-detail id — including
 * registry-native facets, which have their own `/agents/[wallet]` detail.
 */
export function parseDiscoveryCandidateDetailId(id: string): ParsedDiscoveryCandidateDetailId | null {
  const separator = id.indexOf(":");
  if (separator <= 0 || separator === id.length - 1) return null;
  const prefix = id.slice(0, separator);
  const rest = id.slice(separator + 1);
  if (!(DETAIL_CANDIDATE_FACETS as readonly string[]).includes(prefix)) return null;
  return { facet: prefix as DetailCandidateFacetId, rest };
}

// ── Field helpers ─────────────────────────────────────────────────────────────

function field(id: string, label: string, value: string | null | undefined): DiscoveryCandidateDetailField {
  return { id, label, value: value == null || value === "" ? null : value };
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function safeLoad<T extends { ok: boolean }>(loader: () => T, source: string): T {
  try {
    return loader();
  } catch (error) {
    return {
      ok: false,
      error: `Failed to read ${source} catalog snapshot: ${error instanceof Error ? error.message : "unknown error"}`,
    } as unknown as T;
  }
}

function unavailableResult(
  availability: Exclude<DiscoveryCandidateDetailAvailability, "found">,
  id: string,
  sourceFacet: DiscoverySourceFacetId | null,
  reason: string,
  recoveryActions: string[],
): DiscoveryCandidateDetailResult {
  return {
    schemaVersion: DISCOVERY_CANDIDATE_DETAIL_SCHEMA_VERSION,
    availability,
    id,
    sourceFacet,
    reason,
    recoveryActions,
    trustBoundary: DISCOVERY_SOURCE_BOUNDARY,
    guardrails: GUARDRAILS,
  };
}

function foundResult(detail: DiscoveryCandidateDetail, facet: DetailCandidateFacetId): DiscoveryCandidateDetailResult {
  return {
    schemaVersion: DISCOVERY_CANDIDATE_DETAIL_SCHEMA_VERSION,
    availability: "found",
    id: detail.id,
    sourceFacet: facet,
    detail,
    trustBoundary: DISCOVERY_SOURCE_BOUNDARY,
    guardrails: GUARDRAILS,
  };
}

const BACK_TO_DISCOVERY = "Return to /agents discovery and adjust the source filters.";

// ── Hosted RAP registry detail ────────────────────────────────────────────────

function buildHostedRapDetail(
  id: string,
  rest: string,
  result: MarketplaceCatalogSearchResult,
): DiscoveryCandidateDetailResult {
  const cards = buildHostedRapCandidateCards(result);
  const card = cards.find((item) => item.id === id);

  if (rest.startsWith("blocked:")) {
    const listingId = rest.slice("blocked:".length);
    const blocked = result.blocked.find((item) => item.listingId === listingId);
    if (!blocked || !card) {
      return unavailableResult(
        "not_found",
        id,
        "hosted-rap",
        `No blocked hosted-export record exists for listing id "${listingId}" in the current catalog snapshot.`,
        [BACK_TO_DISCOVERY],
      );
    }
    return foundResult(
      {
        schemaVersion: DISCOVERY_CANDIDATE_DETAIL_SCHEMA_VERSION,
        id,
        card,
        lifecycle: discoveredOnlyLifecycle({
          discovered: "Record exists in the hosted public-export snapshot but failed export gating.",
          rapWrapped: "Blocked export records are excluded from the public catalog and cannot be RAP-wrapped.",
          attested: "No RAP attestation exists for a blocked export record.",
          paymentReady: "Payment activation is disabled for blocked export records.",
          hireable: "Blocked records are not listed and cannot be hired.",
        }),
        matrix: null,
        matrixUnavailableReason:
          "This record failed hosted-export gating and is excluded from the public catalog snapshot, so no #577 actionability matrix is derivable for it.",
        sections: [
          {
            id: "provenance",
            title: "Source provenance",
            fields: [
              field("origin", "Origin", result.source.catalogRef),
              field("origin-kind", "Origin kind", "hosted-rap-registry"),
              field("catalog-url", "Catalog URL", result.source.catalogUrl),
              field("snapshot", "Snapshot", result.source.catalogRef),
              field("crawl-timestamp", "Snapshot generated at", result.generatedAt),
              field("self-asserted", "Metadata self-asserted", "yes — until verified"),
            ],
          },
          {
            id: "identity",
            title: "Identity & publisher",
            fields: [
              field("listing-id", "Listing id", blocked.listingId),
              field("fixture-key", "Fixture key", blocked.fixtureKey),
              field("publisher", "Publisher / host", null),
              field("verification", "Provider verification", null),
            ],
          },
          {
            id: "endpoint",
            title: "Endpoint & media",
            fields: [
              field("resource-type", "Resource type", card.resourceType),
              field("media-type", "Media type", card.mediaType),
              field("endpoint-url", "Endpoint / URL", null),
              field("endpoint-health", "Endpoint health", null),
            ],
          },
          {
            id: "payment",
            title: "Payment & auth metadata",
            fields: [
              field("record-state", "Record state", blocked.recordState),
              field("readiness-status", "Readiness status", blocked.readinessStatus),
              field("payment-activation", "Payment activation", "disabled"),
              field("auth", "Auth metadata", null),
            ],
          },
          {
            id: "trust_manifest",
            title: "Trust manifest",
            fields: [field("manifest", "Trust manifest reference", null)],
          },
        ],
        capabilityTags: [],
        capabilityGroups: [],
        gatingReasons: [blocked.recordState, blocked.readinessStatus, ...blocked.reasons],
        validationFindings: blocked.reasons.map((reason, index) => ({
          id: `${blocked.listingId}-reason-${index}`,
          source: "hosted_export_gate",
          state: blocked.recordState,
          severity: "blocked",
          message: reason,
          reasonCodes: [reason],
          blocksPublication: true,
        })),
        guardrailNotes: [],
        evidenceRefs: [],
        rawSnapshotRefs: [],
        recoveryActions: [
          "Resolve the export-gating reasons on the listing record, then regenerate the public catalog snapshot.",
          BACK_TO_DISCOVERY,
        ],
        trustBoundary: DISCOVERY_SOURCE_BOUNDARY,
        guardrails: GUARDRAILS,
      },
      "hosted-rap",
    );
  }

  const item = result.results.find((entry) => entry.candidate.identifier === rest);
  if (!item || !card) {
    return unavailableResult(
      "not_found",
      id,
      "hosted-rap",
      `No hosted RAP catalog candidate exists with identifier "${rest}" in the current snapshot.`,
      [BACK_TO_DISCOVERY],
    );
  }

  const matrix = deriveHostedDiscoveryActionabilityMatrix(item, {
    generatedAt: result.generatedAt,
    catalogRef: result.source.catalogRef,
  });
  const candidate = item.candidate;

  return foundResult(
    {
      schemaVersion: DISCOVERY_CANDIDATE_DETAIL_SCHEMA_VERSION,
      id,
      card,
      lifecycle: discoveredOnlyLifecycle({
        discovered: "Listed in the hosted RAP catalog snapshot (discovery only).",
        rapWrapped: "Hosted catalog listings are external listings; no RAP wrapper exists for this candidate.",
        attested: `RAP attested: ${yesNo(item.listing.rapAttested)} — trust is never implied by listing.`,
        paymentReady: `Payment activation is ${item.listing.paymentActivation}; no payment path exists from discovery.`,
        hireable: "Hire stays gated behind policy preflight, payment setup, and RAP attestation.",
      }),
      matrix,
      matrixUnavailableReason: null,
      sections: [
        {
          id: "provenance",
          title: "Source provenance",
          fields: [
            field("origin", "Origin", matrix.provenance.origin),
            field("origin-kind", "Origin kind", matrix.provenance.originKind),
            field("catalog-url", "Catalog URL", result.source.catalogUrl),
            field("snapshot", "Snapshot", matrix.provenance.snapshot),
            field("crawl-timestamp", "Snapshot generated at", matrix.provenance.crawlTimestamp),
            field("self-asserted", "Metadata self-asserted", "yes — until verified"),
          ],
        },
        {
          id: "identity",
          title: "Identity & publisher",
          fields: [
            field("resource-identifier", "Resource identifier", candidate.identifier),
            field("publisher", "Publisher / host", candidate.publisher?.name ?? candidate.publisher?.id ?? null),
            field("publisher-domain", "Publisher domain", candidate.publisher?.domain ?? null),
            field("verification", "Provider verification", candidate.providerTrust.verification.status),
            field("listing-id", "Listing id", item.listing.listingId),
            field(
              "relevance",
              "Discovery relevance (never trust)",
              `${candidate.relevance.score.toFixed(2)} — ${item.match.scoreMeaning}`,
            ),
          ],
        },
        {
          id: "endpoint",
          title: "Endpoint & media",
          fields: [
            field("resource-type", "Resource type", candidate.resourceType),
            field("media-type", "Media type", candidate.mediaType),
            field("endpoint-url", "Endpoint / URL", null),
            field("endpoint-health", "Endpoint health", item.listing.endpointHealth),
          ],
        },
        {
          id: "payment",
          title: "Payment & auth metadata",
          fields: [
            field("payment-activation", "Payment activation", item.listing.paymentActivation),
            field("rap-attested", "RAP attested", yesNo(item.listing.rapAttested)),
            field("reputation-assigned", "Reputation assigned", yesNo(item.listing.reputationAssigned)),
            field("auth", "Auth metadata", null),
          ],
        },
        {
          id: "trust_manifest",
          title: "Trust manifest",
          fields: [
            field("manifest-schema", "Provider trust schema", candidate.providerTrust.schemaVersion),
            field("verification-status", "Verification status", candidate.providerTrust.verification.status),
            field("manifest", "Trust manifest reference", null),
          ],
        },
      ],
      capabilityTags: item.listing.disclosureLabels,
      capabilityGroups: [],
      gatingReasons: card.reasonCodes,
      validationFindings: [],
      guardrailNotes: [],
      evidenceRefs: [],
      rawSnapshotRefs: candidate.rawSnapshotRef ? [candidate.rawSnapshotRef] : [],
      recoveryActions: [],
      trustBoundary: DISCOVERY_SOURCE_BOUNDARY,
      guardrails: GUARDRAILS,
    },
    "hosted-rap",
  );
}

// ── ARD / AI Catalog static-stack detail ──────────────────────────────────────

const ARD_RECOVERY_ACTION_LABELS: Record<string, string> = {
  approve_after_readiness_gates: "Approve only after the remaining readiness gates pass.",
  request_payment_setup: "Request payment setup before any listing draft can progress.",
  request_endpoint_binding: "Request a verified endpoint binding for the imported descriptor.",
  reject_or_fix_malformed_connector: "Fix or reject the malformed connector/descriptor entries, then re-import.",
  review_static_risk: "Review the static risk diagnostics before any approval.",
  review_unsafe_metadata: "Review the unsafe imported metadata before any approval.",
};

function buildArdCatalogDetail(
  id: string,
  rest: string,
  workspace: OperatorDiscoveryWorkspaceView,
): DiscoveryCandidateDetailResult {
  const candidate: OperatorDiscoveryCandidateView | undefined = workspace.candidates.find(
    (entry) => entry.id === rest,
  );
  const card = buildArdCatalogCandidateCards(workspace).find((entry) => entry.id === id);
  if (!candidate || !card) {
    return unavailableResult(
      "not_found",
      id,
      "ard-catalog",
      `No ARD / AI Catalog imported candidate exists with id "${rest}" in the static review fixtures.`,
      [BACK_TO_DISCOVERY],
    );
  }

  const matrix = deriveDiscoveryActionabilityMatrix(candidate);
  const findings: DiscoveryCandidateValidationFinding[] = candidate.reviewItems.map((item) => ({
    id: item.id,
    source: item.source,
    state: item.state,
    severity: item.severity,
    message: item.message,
    reasonCodes: item.reasonCodes,
    blocksPublication: item.blocksPublication,
  }));
  const recoveryActions =
    card.renderState === "blocked" || candidate.readinessBlockers.length > 0
      ? [
          ...Array.from(
            new Set(
              candidate.reviewItems
                .filter((item) => item.blocksPublication || item.severity === "blocked")
                .map((item) => ARD_RECOVERY_ACTION_LABELS[item.recommendedAction] ?? null)
                .filter((value): value is string => value !== null),
            ),
          ),
          BACK_TO_DISCOVERY,
        ]
      : [];

  return foundResult(
    {
      schemaVersion: DISCOVERY_CANDIDATE_DETAIL_SCHEMA_VERSION,
      id,
      card,
      lifecycle: discoveredOnlyLifecycle({
        discovered: "Imported from an ARD / AI Catalog static snapshot (fixture-backed review workspace).",
        rapWrapped: "Imported candidates are external and untrusted; no RAP wrapper exists until Decide gates run.",
        attested: `RAP attested: ${yesNo(candidate.rapAttested)} — imported metadata never self-asserts trust.`,
        paymentReady: `Payment status is "${candidate.draftPreview.paymentStatus}"; activation is ${candidate.draftPreview.paymentActivation}.`,
        hireable: "Publication is disabled for imported drafts; hire is not possible from discovery.",
      }),
      matrix,
      matrixUnavailableReason: null,
      sections: [
        {
          id: "provenance",
          title: "Source provenance",
          fields: [
            field("origin", "Origin", matrix.provenance.origin),
            field("origin-kind", "Origin kind", matrix.provenance.originKind),
            field("snapshot", "Snapshot", matrix.provenance.snapshot),
            field("checked-ref", "Checked ref", candidate.checkedRef),
            field("checked-commit", "Checked commit", candidate.checkedCommit),
            field("crawl-timestamp", "Crawl / snapshot time", matrix.provenance.crawlTimestamp),
            field("self-asserted", "Metadata self-asserted", "yes — until verified"),
          ],
        },
        {
          id: "identity",
          title: "Identity & publisher",
          fields: [
            field("resource-identifier", "Resource identifier", candidate.id),
            field("fixture-id", "Fixture id", candidate.fixtureId),
            field("review-status", "Review status", candidate.status),
            field("imported", "Imported / external / untrusted", `${yesNo(candidate.imported)} / ${yesNo(candidate.external)} / ${yesNo(candidate.untrusted)}`),
            field("publisher", "Publisher / host", null),
            field("verification", "Provider verification", "unverified"),
          ],
        },
        {
          id: "endpoint",
          title: "Endpoint & media",
          fields: [
            field("resource-type", "Resource type", card.resourceType),
            field("media-type", "Media type", card.mediaType),
            field("endpoint-url", "Endpoint / URL", null),
            field("endpoint-health", "Endpoint health", null),
          ],
        },
        {
          id: "payment",
          title: "Payment & auth metadata",
          fields: [
            field("payment-status", "Payment status", candidate.draftPreview.paymentStatus),
            field("payment-activation", "Payment activation", candidate.draftPreview.paymentActivation),
            field("listing-status", "Listing draft status", candidate.draftPreview.listingStatus),
            field("publication", "Publication", candidate.draftPreview.publicationDisabled ? "disabled" : null),
            field("auth", "Auth metadata", null),
          ],
        },
        {
          id: "trust_manifest",
          title: "Trust manifest",
          fields: [field("manifest", "Trust manifest reference", null)],
        },
      ],
      capabilityTags: candidate.riskCategories,
      capabilityGroups: candidate.groups.map((group) => ({
        id: group.id,
        name: group.name,
        sourceKind: group.sourceKind,
        sourcePath: group.sourcePath,
        runtimeSurface: group.runtimeSurface,
        capabilityRefs: group.capabilityRefs,
        writeCapable: group.writeCapable,
        humanReviewRequired: group.humanReviewRequired,
      })),
      gatingReasons: card.reasonCodes,
      validationFindings: findings,
      guardrailNotes: candidate.secretGuardrails,
      evidenceRefs: candidate.resultRefs,
      rawSnapshotRefs: candidate.rawSnapshotRefs,
      recoveryActions,
      trustBoundary: DISCOVERY_SOURCE_BOUNDARY,
      guardrails: GUARDRAILS,
    },
    "ard-catalog",
  );
}

// ── Circle x402 / Pay.sh externally listed detail ─────────────────────────────

const EXTERNAL_MATRIX_UNAVAILABLE =
  "No #577 actionability-matrix adapter exists for externally listed catalog snapshots yet; per-lane states are not derivable without new trust logic, so the matrix renders as unavailable instead of being invented.";

function buildCircleX402Detail(id: string, rest: string, catalog: CircleX402Catalog): DiscoveryCandidateDetailResult {
  if (!catalog.ok) {
    return unavailableResult(
      "source_unavailable",
      id,
      "circle-x402",
      catalog.error ?? "Circle x402 catalog snapshot is not ingested; no candidates exist from this source.",
      ["Ingest the Circle x402 discovery snapshot (npm run ingest:circle-x402), then reload.", BACK_TO_DISCOVERY],
    );
  }
  const candidate = catalog.candidates.find((entry) => entry.candidateId === rest);
  const card = buildCircleX402CandidateCards(catalog).cards.find((entry) => entry.id === id);
  if (!candidate || !card) {
    return unavailableResult(
      "not_found",
      id,
      "circle-x402",
      `No Circle x402 candidate exists with id "${rest}" in the ingested catalog snapshot.`,
      [BACK_TO_DISCOVERY],
    );
  }

  return foundResult(
    {
      schemaVersion: DISCOVERY_CANDIDATE_DETAIL_SCHEMA_VERSION,
      id,
      card,
      lifecycle: discoveredOnlyLifecycle({
        discovered: "Externally listed in the Circle x402 discovery snapshot (fixture-backed).",
        rapWrapped: "Externally listed resources are not RAP-wrapped.",
        attested: `Adapter attestation state is "${candidate.attestationState}" — mapped to the untrusted ingress state, never upgraded.`,
        paymentReady: "Live payment is disabled; declared x402 payment requirements are metadata only.",
        hireable: "No hire path exists for externally listed snapshots; every live path stays behind Decide gates.",
      }),
      matrix: null,
      matrixUnavailableReason: EXTERNAL_MATRIX_UNAVAILABLE,
      sections: [
        {
          id: "provenance",
          title: "Source provenance",
          fields: [
            field("origin", "Origin", catalog.summary?.source ?? null),
            field("origin-kind", "Origin kind", "externally-listed snapshot"),
            field("snapshot", "Snapshot artifact", catalog.sourcePath),
            field("crawl-timestamp", "Crawl / snapshot time", catalog.summary?.crawledAt ?? null),
            field("self-asserted", "Metadata self-asserted", "yes — until verified"),
          ],
        },
        {
          id: "identity",
          title: "Identity & publisher",
          fields: [
            field("resource-identifier", "Resource identifier", candidate.candidateId),
            field("publisher", "Publisher / host", candidate.providerName),
            field("category", "Category", candidate.category),
            field("verification", "Provider verification", "unverified"),
          ],
        },
        {
          id: "endpoint",
          title: "Endpoint & media",
          fields: [
            field("resource-type", "Resource type", card.resourceType),
            field("media-type", "Media type", card.mediaType),
            field("endpoint-url", "Endpoint / URL (never invoked from discovery)", candidate.resource),
            field("endpoint-health", "Endpoint health", null),
          ],
        },
        {
          id: "payment",
          title: "Payment & auth metadata",
          fields: [
            field("auth", "Auth / payment scheme", "x402 required (declared by the listing, unverified)"),
            field("support-states", "Support states", candidate.supportStates.join(", ")),
            ...(candidate.payment.length === 0
              ? [field("payment-rails", "Declared payment requirements", null)]
              : candidate.payment.map((rail, index) =>
                  field(
                    `payment-rail-${index}`,
                    `Declared rail ${index + 1}`,
                    [
                      rail.rail,
                      rail.scheme,
                      rail.network,
                      rail.asset,
                      rail.priceUsdc != null ? `${rail.priceUsdc} USDC` : rail.maxAmountRequired,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  ),
                )),
          ],
        },
        {
          id: "trust_manifest",
          title: "Trust manifest",
          fields: [field("manifest", "Trust manifest reference", null)],
        },
      ],
      capabilityTags: card.tags,
      capabilityGroups: [],
      gatingReasons: card.reasonCodes,
      validationFindings: candidate.diagnostics.map((item, index) => ({
        id: `${candidate.candidateId}-diagnostic-${index}`,
        source: "circle_x402_catalog",
        state: item.code,
        severity: item.severity,
        message: item.detail,
        reasonCodes: [item.code],
        blocksPublication: item.severity === "blocker",
      })),
      guardrailNotes: candidate.trustNotes,
      evidenceRefs: [],
      rawSnapshotRefs: [catalog.sourcePath],
      recoveryActions:
        card.renderState === "blocked"
          ? ["Re-ingest a corrected snapshot for this resource; malformed listings stay blocked.", BACK_TO_DISCOVERY]
          : [],
      trustBoundary: DISCOVERY_SOURCE_BOUNDARY,
      guardrails: GUARDRAILS,
    },
    "circle-x402",
  );
}

function buildPayShDetail(id: string, rest: string, catalog: PayShCatalog): DiscoveryCandidateDetailResult {
  if (!catalog.ok) {
    return unavailableResult(
      "source_unavailable",
      id,
      "pay-sh",
      catalog.error ?? "Pay.sh catalog snapshot is not ingested; no candidates exist from this source.",
      ["Ingest the Pay.sh catalog snapshot (npm run ingest:pay-sh), then reload.", BACK_TO_DISCOVERY],
    );
  }
  const candidate = catalog.candidates.find((entry) => entry.candidateId === rest);
  const card = buildPayShCandidateCards(catalog).cards.find((entry) => entry.id === id);
  if (!candidate || !card) {
    return unavailableResult(
      "not_found",
      id,
      "pay-sh",
      `No Pay.sh candidate exists with id "${rest}" in the ingested catalog snapshot.`,
      [BACK_TO_DISCOVERY],
    );
  }

  return foundResult(
    {
      schemaVersion: DISCOVERY_CANDIDATE_DETAIL_SCHEMA_VERSION,
      id,
      card,
      lifecycle: discoveredOnlyLifecycle({
        discovered: "Externally listed in the Pay.sh catalog snapshot (fixture-backed).",
        rapWrapped: "Externally listed providers are not RAP-wrapped.",
        attested: `Adapter attestation state is "${candidate.attestationState}" — mapped to the untrusted ingress state, never upgraded.`,
        paymentReady: "Live payment is disabled; declared pricing is catalog metadata only.",
        hireable: "No hire path exists for externally listed snapshots; every live path stays behind Decide gates.",
      }),
      matrix: null,
      matrixUnavailableReason: EXTERNAL_MATRIX_UNAVAILABLE,
      sections: [
        {
          id: "provenance",
          title: "Source provenance",
          fields: [
            field("origin", "Origin", candidate.sourceMetadata.sourceUrl),
            field("origin-kind", "Origin kind", "externally-listed snapshot"),
            field("snapshot", "Snapshot artifact", catalog.sourcePath),
            field("source-hash", "Source hash", candidate.sourceMetadata.sourceHash ?? null),
            field("crawl-timestamp", "Crawl / snapshot time", catalog.summary?.generated_at ?? null),
            field("self-asserted", "Metadata self-asserted", "yes — until verified"),
          ],
        },
        {
          id: "identity",
          title: "Identity & publisher",
          fields: [
            field("resource-identifier", "Resource identifier", candidate.candidateId),
            field("publisher", "Publisher / host", candidate.providerName),
            field("provider-fqn", "Provider FQN", candidate.providerFqn),
            field("category", "Category", candidate.category),
            field("verification", "Provider verification", "unverified"),
          ],
        },
        {
          id: "endpoint",
          title: "Endpoint & media",
          fields: [
            field("resource-type", "Resource type", card.resourceType),
            field("media-type", "Media type", card.mediaType),
            field("endpoint-url", "Service URL (never invoked from discovery)", candidate.serviceUrl ?? null),
            field("endpoint-count", "Declared endpoints", String(candidate.endpointCount)),
            field("endpoint-health", "Endpoint health", null),
          ],
        },
        {
          id: "payment",
          title: "Payment & auth metadata",
          fields: [
            field(
              "pricing",
              "Declared pricing (unverified)",
              `${candidate.pricing.minUsd}–${candidate.pricing.maxUsd} USD · ${candidate.pricing.currency} on ${candidate.pricing.network}` +
                `${candidate.pricing.hasFreeTier ? " · free tier" : ""}${candidate.pricing.hasMetering ? " · metered" : ""}`,
            ),
            field("support-states", "Support states", candidate.supportStates.join(", ")),
            field("auth", "Auth metadata", null),
          ],
        },
        {
          id: "trust_manifest",
          title: "Trust manifest",
          fields: [field("manifest", "Trust manifest reference", null)],
        },
      ],
      capabilityTags: card.tags,
      capabilityGroups: [],
      gatingReasons: card.reasonCodes,
      validationFindings: candidate.diagnostics.map((item, index) => ({
        id: `${candidate.candidateId}-diagnostic-${index}`,
        source: "pay_sh_catalog",
        state: item.code,
        severity: item.severity,
        message: item.detail,
        reasonCodes: [item.code],
        blocksPublication: item.severity === "blocker",
      })),
      guardrailNotes: candidate.trustNotes,
      evidenceRefs: [],
      rawSnapshotRefs: [catalog.sourcePath],
      recoveryActions:
        card.renderState === "blocked"
          ? ["Re-ingest a corrected catalog snapshot for this provider; malformed listings stay blocked.", BACK_TO_DISCOVERY]
          : [],
      trustBoundary: DISCOVERY_SOURCE_BOUNDARY,
      guardrails: GUARDRAILS,
    },
    "pay-sh",
  );
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function buildDiscoveryCandidateDetail(
  id: string,
  options?: {
    hosted?: MarketplaceCatalogSearchResult;
    ard?: OperatorDiscoveryWorkspaceView;
    circle?: CircleX402Catalog;
    paySh?: PayShCatalog;
  },
): DiscoveryCandidateDetailResult {
  const parsed = parseDiscoveryCandidateDetailId(id);
  if (!parsed) {
    const prefix = id.includes(":") ? id.slice(0, id.indexOf(":")) : id;
    const registryNative = isDiscoverySourceFacetId(prefix) && !(DETAIL_CANDIDATE_FACETS as readonly string[]).includes(prefix);
    return unavailableResult(
      "unsupported_id",
      id,
      registryNative ? (prefix as DiscoverySourceFacetId) : null,
      registryNative
        ? `${describeDiscoverySourceFacet(prefix as DiscoverySourceFacetId).label} specialists are registry-native and use the existing /agents/[wallet] detail page instead of the candidate detail route.`
        : `"${id}" is not a well-formed discovery candidate id (expected "<source-facet>:<source id>").`,
      [BACK_TO_DISCOVERY],
    );
  }

  switch (parsed.facet) {
    case "hosted-rap":
      return buildHostedRapDetail(id, parsed.rest, options?.hosted ?? searchHostedMarketplaceCatalog());
    case "ard-catalog":
      return buildArdCatalogDetail(id, parsed.rest, options?.ard ?? getStaticAgentStackReviewWorkspace());
    case "circle-x402":
      return buildCircleX402Detail(id, parsed.rest, options?.circle ?? safeLoad(() => loadCircleX402Catalog(), "circle-x402"));
    case "pay-sh":
      return buildPayShDetail(id, parsed.rest, options?.paySh ?? safeLoad(() => loadPayShCatalog(), "pay-sh"));
  }
}
