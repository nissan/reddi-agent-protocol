import {
  deriveDiscoveryActionabilityMatrix,
  deriveHostedDiscoveryActionabilityMatrix,
  type DiscoveryActionabilityLaneId,
  type DiscoveryActionabilityMatrix,
} from "@/lib/manager/discovery-actionability-matrix";
import {
  searchHostedMarketplaceCatalog,
  type MarketplaceCatalogSearchResult,
} from "@/lib/manager/marketplace-public-search";
import {
  getStaticAgentStackReviewWorkspace,
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
  DISCOVERY_SOURCE_BOUNDARY,
  describeDiscoveryReadinessState,
  describeDiscoverySourceFacet,
  describeSourceTrustState,
  mapAdapterAttestationStateToSourceTrustState,
  sourceTrustStateFromLaneState,
  type DiscoverySourceAvailability,
  importedFieldsFor,
  type DiscoverySourceFacetId,
  type MarketplaceCandidateCardModel,
} from "@/lib/discovery/source-facets";

/**
 * Marketplace candidate cards for the #381 discovery source facets.
 *
 * Thin, read-only adapters that project the existing fixture-backed discovery
 * surfaces onto one card read model for `/agents`:
 *
 * - hosted RAP registry catalog search (#369, `marketplace-public-search.ts`)
 *   through the #577 hosted actionability matrix adapter,
 * - ARD / AI Catalog static-stack operator review fixtures (#383) through the
 *   #577 static-import actionability matrix adapter,
 * - Circle x402 / Pay.sh externally listed catalog snapshots (fixture
 *   artifacts on disk; absent artifacts degrade to an explicit
 *   "no candidates exist" availability note, never an error).
 *
 * No new trust logic: trust states are the #593 vocabulary (the adapters'
 * legacy `externally_listed_unattested` literal is mapped, not propagated),
 * readiness states are #577 actionability-lane states. This module performs
 * no network call, no payment, no endpoint invocation, no wallet/RPC action,
 * and no registry/trust/reputation mutation.
 */

export const MARKETPLACE_CANDIDATE_CARDS_SCHEMA_VERSION =
  "reddi.discovery-marketplace-candidate-cards.v1" as const;

export type MarketplaceCandidateCardsResult = {
  schemaVersion: typeof MARKETPLACE_CANDIDATE_CARDS_SCHEMA_VERSION;
  generatedAt: string;
  cards: MarketplaceCandidateCardModel[];
  sources: DiscoverySourceAvailability[];
  trustBoundary: typeof DISCOVERY_SOURCE_BOUNDARY;
  guardrails: {
    endpointInvocation: false;
    walletSigning: false;
    rpcCall: false;
    livePayment: false;
    publication: false;
    trustMutation: false;
    reputationMutation: false;
  };
};

const GUARDRAILS: MarketplaceCandidateCardsResult["guardrails"] = {
  endpointInvocation: false,
  walletSigning: false,
  rpcCall: false,
  livePayment: false,
  publication: false,
  trustMutation: false,
  reputationMutation: false,
};

function lane(matrix: DiscoveryActionabilityMatrix, laneId: DiscoveryActionabilityLaneId) {
  const found = matrix.lanes.find((cell) => cell.lane === laneId);
  if (!found) throw new Error(`actionability matrix missing lane: ${laneId}`);
  return found;
}

function card(
  input: Omit<MarketplaceCandidateCardModel, "sourceLabel" | "trustBoundaryNote"> & {
    trustBoundaryNote?: string;
  },
): MarketplaceCandidateCardModel {
  return {
    ...input,
    sourceLabel: describeDiscoverySourceFacet(input.sourceFacet).label,
    trustBoundaryNote: input.trustBoundaryNote ?? DISCOVERY_SOURCE_BOUNDARY.note,
  };
}

// ── Hosted RAP registry (#369 search read model + #577 hosted matrix) ─────────

export function buildHostedRapCandidateCards(
  result: MarketplaceCatalogSearchResult = searchHostedMarketplaceCatalog(),
): MarketplaceCandidateCardModel[] {
  const cards = result.results.map((item) => {
    const matrix = deriveHostedDiscoveryActionabilityMatrix(item, {
      generatedAt: result.generatedAt,
      catalogRef: result.source.catalogRef,
    });
    const identity = lane(matrix, "identity_evidence");
    const actionability = lane(matrix, "actionability");
    return card({
      id: `hosted-rap:${item.candidate.identifier}`,
      sourceFacet: "hosted-rap",
      name: item.candidate.name,
      description: item.candidate.description ?? "Hosted RAP catalog listing.",
      resourceType: item.candidate.resourceType,
      mediaType: item.candidate.mediaType,
      trust: describeSourceTrustState(sourceTrustStateFromLaneState(identity.state)),
      readiness: describeDiscoveryReadinessState(actionability.state),
      renderState: "untrusted",
      reasonCodes: [...identity.reasonCodes, ...actionability.reasonCodes],
      tags: item.listing.disclosureLabels,
      taskTypes: [],
      importedFields: importedFieldsFor("hosted-rap"),
      trustBoundaryNote: matrix.discoveryTrustBoundary.note,
    });
  });

  const blocked = result.blocked.map((item) =>
    card({
      id: `hosted-rap:blocked:${item.listingId}`,
      sourceFacet: "hosted-rap",
      name: item.listingId,
      description:
        "This hosted catalog record failed export gating and is excluded from the public catalog.",
      resourceType: "marketplace listing record",
      mediaType: "application/json",
      trust: describeSourceTrustState("blocked"),
      readiness: describeDiscoveryReadinessState("blocked"),
      renderState: "blocked",
      reasonCodes: [item.recordState, item.readinessStatus, ...item.reasons],
      tags: [],
      taskTypes: [],
      importedFields: importedFieldsFor("hosted-rap"),
    }),
  );

  return [...cards, ...blocked];
}

// ── ARD / AI Catalog static-stack imports (#383 fixtures + #577 matrix) ───────

export function buildArdCatalogCandidateCards(
  workspace: OperatorDiscoveryWorkspaceView = getStaticAgentStackReviewWorkspace(),
): MarketplaceCandidateCardModel[] {
  return workspace.candidates.map((candidate) => {
    const matrix = deriveDiscoveryActionabilityMatrix(candidate);
    const identity = lane(matrix, "identity_evidence");
    const actionability = lane(matrix, "actionability");
    const trustState = sourceTrustStateFromLaneState(identity.state);
    const blocked =
      actionability.state === "blocked" ||
      actionability.state === "production_disabled" ||
      trustState === "blocked" ||
      trustState === "failed_verification";
    return card({
      id: `ard-catalog:${candidate.id}`,
      sourceFacet: "ard-catalog",
      name: candidate.title,
      description: candidate.description,
      resourceType: candidate.sourceKindSummary || "agent stack snapshot",
      mediaType: matrix.provenance.originKind,
      trust: describeSourceTrustState(trustState),
      readiness: describeDiscoveryReadinessState(actionability.state),
      renderState: blocked ? "blocked" : "ard-imported",
      reasonCodes: [...identity.reasonCodes, ...actionability.reasonCodes],
      tags: candidate.riskCategories,
      taskTypes: [],
      importedFields: importedFieldsFor("ard-catalog"),
      trustBoundaryNote: matrix.discoveryTrustBoundary.note,
    });
  });
}

// ── Circle x402 / Pay.sh externally listed catalogs ──────────────────────────

export function buildCircleX402CandidateCards(
  catalog: CircleX402Catalog = safeLoad(() => loadCircleX402Catalog(), "circle-x402"),
): { cards: MarketplaceCandidateCardModel[]; availability: Omit<DiscoverySourceAvailability, "facet" | "label"> } {
  if (!catalog.ok) {
    return {
      cards: [],
      availability: {
        available: false,
        count: 0,
        note: catalog.error ?? "Circle x402 catalog snapshot is not ingested; no candidates exist from this source.",
      },
    };
  }
  const cards = catalog.candidates.map((candidate) => {
    const hasBlocker = candidate.diagnostics.some((item) => item.severity === "blocker");
    return card({
      id: `circle-x402:${candidate.candidateId}`,
      sourceFacet: "circle-x402",
      name: candidate.providerName,
      description: candidate.resource,
      resourceType: "x402 discovery resource",
      mediaType: "application/json",
      trust: describeSourceTrustState(
        mapAdapterAttestationStateToSourceTrustState(candidate.attestationState),
      ),
      readiness: describeDiscoveryReadinessState(hasBlocker ? "blocked" : "live_gated"),
      renderState: hasBlocker ? "blocked" : "untrusted",
      reasonCodes: candidate.diagnostics.map((item) => item.code),
      tags: [candidate.category, ...candidate.taskTypes],
      taskTypes: [],
      importedFields: importedFieldsFor("circle-x402"),
    });
  });
  return {
    cards,
    availability: {
      available: true,
      count: cards.length,
      note: `Fixture-backed Circle x402 catalog snapshot (${catalog.sourcePath}).`,
    },
  };
}

export function buildPayShCandidateCards(
  catalog: PayShCatalog = safeLoad(() => loadPayShCatalog(), "pay-sh"),
): { cards: MarketplaceCandidateCardModel[]; availability: Omit<DiscoverySourceAvailability, "facet" | "label"> } {
  if (!catalog.ok) {
    return {
      cards: [],
      availability: {
        available: false,
        count: 0,
        note: catalog.error ?? "Pay.sh catalog snapshot is not ingested; no candidates exist from this source.",
      },
    };
  }
  const cards = catalog.candidates.map((candidate) => {
    const hasBlocker = candidate.diagnostics.some((item) => item.severity === "blocker");
    return card({
      id: `pay-sh:${candidate.candidateId}`,
      sourceFacet: "pay-sh",
      name: candidate.providerName,
      description: candidate.serviceUrl ?? candidate.providerFqn,
      resourceType: "pay.sh catalog provider",
      mediaType: "application/json",
      trust: describeSourceTrustState(
        mapAdapterAttestationStateToSourceTrustState(candidate.attestationState),
      ),
      readiness: describeDiscoveryReadinessState(hasBlocker ? "blocked" : "live_gated"),
      renderState: hasBlocker ? "blocked" : "untrusted",
      reasonCodes: candidate.diagnostics.map((item) => item.code),
      tags: [candidate.category, ...candidate.taskTypes],
      taskTypes: [],
      importedFields: importedFieldsFor("pay-sh"),
    });
  });
  return {
    cards,
    availability: {
      available: true,
      count: cards.length,
      note: `Fixture-backed Pay.sh catalog snapshot (${catalog.sourcePath}).`,
    },
  };
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

// ── Combined read model for /agents ──────────────────────────────────────────

export function buildMarketplaceCandidateCards(options?: {
  hosted?: MarketplaceCatalogSearchResult;
  ard?: OperatorDiscoveryWorkspaceView;
  circle?: CircleX402Catalog;
  paySh?: PayShCatalog;
  generatedAt?: string;
}): MarketplaceCandidateCardsResult {
  const hostedResult = options?.hosted ?? searchHostedMarketplaceCatalog();
  const hostedCards = buildHostedRapCandidateCards(hostedResult);
  const ardCards = buildArdCatalogCandidateCards(options?.ard ?? getStaticAgentStackReviewWorkspace());
  const circle = buildCircleX402CandidateCards(options?.circle ?? safeLoad(() => loadCircleX402Catalog(), "circle-x402"));
  const paySh = buildPayShCandidateCards(options?.paySh ?? safeLoad(() => loadPayShCatalog(), "pay-sh"));

  const sources: DiscoverySourceAvailability[] = [
    availability("hosted-rap", {
      available: true,
      count: hostedCards.length,
      note: "Read-only projection of the gated marketplace public-export snapshot.",
    }),
    availability("ard-catalog", {
      available: true,
      count: ardCards.length,
      note: "Deterministic ARD / AI Catalog static-stack review fixtures.",
    }),
    availability("circle-x402", circle.availability),
    availability("pay-sh", paySh.availability),
  ];

  return {
    schemaVersion: MARKETPLACE_CANDIDATE_CARDS_SCHEMA_VERSION,
    generatedAt: options?.generatedAt ?? hostedResult.generatedAt,
    cards: [...hostedCards, ...ardCards, ...circle.cards, ...paySh.cards],
    sources,
    trustBoundary: DISCOVERY_SOURCE_BOUNDARY,
    guardrails: GUARDRAILS,
  };
}

function availability(
  facet: DiscoverySourceFacetId,
  input: Omit<DiscoverySourceAvailability, "facet" | "label">,
): DiscoverySourceAvailability {
  return { facet, label: describeDiscoverySourceFacet(facet).label, ...input };
}
