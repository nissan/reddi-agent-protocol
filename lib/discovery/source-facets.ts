// Type-only import: the canonical #593 vocabulary module uses ESM-style
// relative `.js` imports that the app bundler cannot resolve from source, so
// runtime values are mirrored below (compile-time checked against the types
// here, and asserted equal to the canonical module in
// `lib/__tests__/discovery-source-facets.test.ts`).
import type { SourceTrustState } from "@reddi/agent-protocol/source-trust-conformance-matrix";

import type {
  DiscoveryActionabilityLaneState,
} from "@/lib/manager/discovery-actionability-matrix";
import { describeDiscoveryLaneState } from "@/lib/manager/discovery-actionability-matrix";

/**
 * Discovery source facets for marketplace candidates (#381).
 *
 * Client-safe, pure vocabulary + classification helpers over the existing
 * modules — the #577 discovery actionability matrix
 * (`lib/manager/discovery-actionability-matrix.ts`) and the #593 source-trust
 * vocabulary (`@reddi/agent-protocol/source-trust-conformance-matrix`).
 * No new trust logic lives here: trust states are the #593 words, tones are
 * the #577 tone buckets, and every mapping fails closed to `listed_untrusted`
 * (the mandatory ingress state).
 *
 * Discovery relevance and source badges are never RAP trust, payment
 * approval, or endpoint authorization — see
 * `docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md` (#452).
 */

export const DISCOVERY_SOURCE_FACETS_SCHEMA_VERSION =
  "reddi.discovery-source-facets.v1" as const;

export type DiscoverySourceFacetId =
  | "rap-registry"
  | "ard-catalog"
  | "circle-x402"
  | "pay-sh"
  | "openrouter"
  | "local-demo"
  | "hosted-rap";

export type DiscoverySourceFacet = {
  id: DiscoverySourceFacetId;
  label: string;
  description: string;
};

export const DISCOVERY_SOURCE_FACETS: readonly DiscoverySourceFacet[] = [
  {
    id: "rap-registry",
    label: "RAP registry",
    description: "Specialists registered in the on-chain RAP registry (devnet).",
  },
  {
    id: "ard-catalog",
    label: "ARD AI Catalog",
    description: "Candidates imported from ARD / AI Catalog static snapshots; untrusted until Decide gates run.",
  },
  {
    id: "circle-x402",
    label: "Circle x402",
    description: "Externally listed Circle x402 discovery resources (fixture-backed catalog snapshot).",
  },
  {
    id: "pay-sh",
    label: "Pay.sh",
    description: "Externally listed Pay.sh catalog providers (fixture-backed catalog snapshot).",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "Hosted OpenRouter specialist profiles bridged into the registry index.",
  },
  {
    id: "local-demo",
    label: "Local / demo",
    description: "Local capability-index or demo/dogfood specialists not observed on-chain.",
  },
  {
    id: "hosted-rap",
    label: "Hosted RAP registry",
    description: "Future hosted RAP registry catalog — read-only projection of the gated public-export snapshot.",
  },
] as const;

export const DISCOVERY_SOURCE_FACET_IDS: readonly DiscoverySourceFacetId[] =
  DISCOVERY_SOURCE_FACETS.map((facet) => facet.id);

const FACET_BY_ID = new Map(DISCOVERY_SOURCE_FACETS.map((facet) => [facet.id, facet]));

export function isDiscoverySourceFacetId(value: string): value is DiscoverySourceFacetId {
  return FACET_BY_ID.has(value as DiscoverySourceFacetId);
}

export function describeDiscoverySourceFacet(id: DiscoverySourceFacetId): DiscoverySourceFacet {
  const facet = FACET_BY_ID.get(id);
  if (!facet) throw new Error(`unknown discovery source facet: ${id}`);
  return facet;
}

// ── URL-addressable filter state (querystring) ────────────────────────────────

export const DISCOVERY_SOURCE_QUERY_PARAM = "source" as const;
export const DISCOVERY_TASK_QUERY_PARAM = "task" as const;

/** Parse the CSV `source` querystring value; unknown facet ids are dropped. */
export function parseDiscoverySourceFacetParam(value: string | null | undefined): DiscoverySourceFacetId[] {
  if (!value) return [];
  const seen = new Set<DiscoverySourceFacetId>();
  for (const raw of value.split(",")) {
    const trimmed = raw.trim().toLowerCase();
    if (isDiscoverySourceFacetId(trimmed)) seen.add(trimmed);
  }
  return DISCOVERY_SOURCE_FACET_IDS.filter((id) => seen.has(id));
}

/** Serialize selected facets back to the CSV `source` querystring value (stable order). */
export function serializeDiscoverySourceFacetParam(facets: readonly DiscoverySourceFacetId[]): string {
  const selected = new Set(facets);
  return DISCOVERY_SOURCE_FACET_IDS.filter((id) => selected.has(id)).join(",");
}

// ── #593 trust vocabulary reuse (no new trust words) ─────────────────────────

export type DiscoveryTrustTone = ReturnType<typeof describeDiscoveryLaneState>["tone"];

/**
 * Runtime mirror of the #593 `SOURCE_TRUST_STATES` list. The `satisfies`
 * clause plus the exhaustive `Record<SourceTrustState, …>` maps below make
 * drift from the canonical vocabulary a compile error; the jest suite also
 * asserts equality against `@reddi/agent-protocol/source-trust-conformance-matrix`.
 */
export const SOURCE_TRUST_STATE_VALUES = [
  "trusted",
  "listed_untrusted",
  "claimed",
  "unverified",
  "failed_verification",
  "blocked",
  "needs_human_review",
] as const satisfies readonly SourceTrustState[];

export type DiscoveryTrustBadge = {
  state: SourceTrustState;
  label: string;
  tone: DiscoveryTrustTone;
};

const SOURCE_TRUST_STATE_LABELS: Record<SourceTrustState, string> = {
  trusted: "trusted",
  listed_untrusted: "listed untrusted",
  claimed: "claimed",
  unverified: "unverified",
  failed_verification: "failed verification",
  blocked: "blocked",
  needs_human_review: "needs human review",
};

/** Presentational tone buckets reusing the #577 tone vocabulary. */
const SOURCE_TRUST_STATE_TONES: Record<SourceTrustState, DiscoveryTrustTone> = {
  trusted: "positive",
  listed_untrusted: "caution",
  claimed: "caution",
  unverified: "caution",
  failed_verification: "negative",
  blocked: "negative",
  needs_human_review: "caution",
};

export function describeSourceTrustState(state: SourceTrustState): DiscoveryTrustBadge {
  return { state, label: SOURCE_TRUST_STATE_LABELS[state], tone: SOURCE_TRUST_STATE_TONES[state] };
}

/**
 * Map the legacy adapter-profile attestation literal
 * (`externally_listed_unattested`, surviving only in the Circle x402 / Pay.sh
 * adapter profiles) onto the finalized #593 source-class vocabulary.
 * Unknown inputs fail closed to `listed_untrusted` — the mandatory ingress
 * state; nothing is upgraded by mapping.
 */
export function mapAdapterAttestationStateToSourceTrustState(state: string): SourceTrustState {
  if ((SOURCE_TRUST_STATE_VALUES as readonly string[]).includes(state)) {
    return state as SourceTrustState;
  }
  // `externally_listed_unattested` and anything unrecognized: ingress state.
  return "listed_untrusted";
}

/**
 * Map a #577 actionability-matrix lane state onto the #593 trust vocabulary
 * (used for the identity-evidence lane). Fails closed to `listed_untrusted`.
 */
export function sourceTrustStateFromLaneState(state: DiscoveryActionabilityLaneState): SourceTrustState {
  switch (state) {
    case "verified":
      return "trusted";
    case "claimed":
      return "claimed";
    case "self_asserted":
      return "unverified";
    case "failed_verification":
      return "failed_verification";
    case "blocked":
    case "production_disabled":
      return "blocked";
    case "needs_human_review":
      return "needs_human_review";
    default:
      return "listed_untrusted";
  }
}

export type DiscoveryReadinessBadge = {
  state: DiscoveryActionabilityLaneState;
  label: string;
  tone: DiscoveryTrustTone;
};

export function describeDiscoveryReadinessState(state: DiscoveryActionabilityLaneState): DiscoveryReadinessBadge {
  const { stateLabel, tone } = describeDiscoveryLaneState(state);
  return { state, label: stateLabel, tone };
}

// ── Registry listing source classification ───────────────────────────────────

/**
 * Structural (client-safe) subset of `SpecialistListing` used to classify a
 * registry listing's discovery source facet — the full type lives in the
 * server-only registry bridge.
 */
export type SpecialistListingSourceInput = {
  pda: string;
  capabilities?: {
    agent_composition?: {
      control_loop?: string;
      marketplace_agent_calls?: string[];
      non_marketplace_agent_calls?: string[];
    };
    manifest?: {
      marketplace_agent_calls?: string[];
      non_marketplace_agent_calls?: string[];
    };
  } | null;
};

const OPENROUTER_CONTROL_LOOP = "openrouter-x402-specialist-runtime";

/**
 * Classify a `/api/registry` listing into its discovery source facet:
 * OpenRouter-bridged profiles, on-chain RAP registry entries (PDA observed),
 * or local/demo capability-index entries.
 */
export function classifySpecialistListingSourceFacet(
  listing: SpecialistListingSourceInput,
): Extract<DiscoverySourceFacetId, "rap-registry" | "openrouter" | "local-demo"> {
  const composition = listing.capabilities?.agent_composition;
  const manifest = listing.capabilities?.manifest;
  const calls = [
    ...(composition?.marketplace_agent_calls ?? []),
    ...(composition?.non_marketplace_agent_calls ?? []),
    ...(manifest?.marketplace_agent_calls ?? []),
    ...(manifest?.non_marketplace_agent_calls ?? []),
  ];
  const isOpenRouter =
    composition?.control_loop === OPENROUTER_CONTROL_LOOP ||
    calls.some((call) => call.startsWith("openrouter:"));
  if (isOpenRouter) return "openrouter";
  if (listing.pda && listing.pda.length > 0) return "rap-registry";
  return "local-demo";
}

// ── Marketplace candidate card read model ────────────────────────────────────

/**
 * Distinct rendering lanes for marketplace candidate cards. RAP-native
 * registry listings render through the existing `SpecialistCard`; everything
 * else renders through `MarketplaceCandidateCard` in one of these states.
 */
export type MarketplaceCandidateRenderState = "ard-imported" | "untrusted" | "blocked";

/**
 * Card fields whose value can come from text this repository did not author.
 * Only the fields a source actually populates from an imported snapshot are
 * declared imported; a field carrying repository fixture prose, a repository
 * constant, or a derived label is repository-owned regardless of which card
 * renders it.
 */
export type MarketplaceCandidateField = "name" | "description" | "resourceType" | "mediaType" | "tags";

/**
 * Per-source field provenance for the `data-claim-scope="external"` marker.
 *
 * Hosted-RAP cards project `marketplace-public-export` fixtures: the name and
 * summary are repository listing prose, the media type is a repository
 * constant, and the tags are the repository-owned `disclosureLabels`
 * vocabulary. ARD cards project `agent-stack-fixtures` the same way, down to a
 * title derived from the fixture key and a media type from a repository union.
 * Only the Circle x402 / Pay.sh catalog snapshots transcribe third-party text,
 * and only in the fields those snapshots populate.
 *
 * Declared here rather than in the builder so the card, the builder, and the
 * checks that hold them to it all read one source of truth.
 */
export const MARKETPLACE_CANDIDATE_IMPORTED_FIELDS = {
  "hosted-rap": [],
  "ard-catalog": [],
  "circle-x402": ["name", "description", "tags"],
  "pay-sh": ["name", "description", "tags"],
} as const satisfies Partial<Record<DiscoverySourceFacetId, readonly MarketplaceCandidateField[]>>;

export type MarketplaceCandidateSourceFacetId = keyof typeof MARKETPLACE_CANDIDATE_IMPORTED_FIELDS;

export function importedFieldsFor(
  facet: MarketplaceCandidateSourceFacetId,
): MarketplaceCandidateField[] {
  return [...MARKETPLACE_CANDIDATE_IMPORTED_FIELDS[facet]];
}

export type MarketplaceCandidateCardModel = {
  id: string;
  sourceFacet: DiscoverySourceFacetId;
  sourceLabel: string;
  name: string;
  description: string;
  /** What kind of resource this candidate is (e.g. mcp-server-card, http endpoint). */
  resourceType: string;
  /** Declared media type / snapshot kind for the candidate metadata. */
  mediaType: string;
  /** #593 source-trust vocabulary — never blended with relevance. */
  trust: DiscoveryTrustBadge;
  /** #577 actionability-lane vocabulary (actionability / hireability lane). */
  readiness: DiscoveryReadinessBadge;
  renderState: MarketplaceCandidateRenderState;
  reasonCodes: string[];
  tags: string[];
  /** RAP task-type ids where the source declares them; external vocab stays in tags. */
  taskTypes: string[];
  /** Trust-boundary copy carried per card (discovery ≠ trust). */
  trustBoundaryNote: string;
  /** Fields this card populates from imported, non-repository-authored text. */
  importedFields: MarketplaceCandidateField[];
};

export type DiscoverySourceAvailability = {
  facet: DiscoverySourceFacetId;
  label: string;
  available: boolean;
  count: number;
  note: string;
};

// ── Discovery / trust boundary copy (criterion 5 — #452 boundaries doc) ──────

export const DISCOVERY_SOURCE_BOUNDARY = {
  // Mirrors SOURCE_TRUST_BOUNDARIES_DOC_REF (asserted equal in jest).
  docRef: "docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md",
  note:
    "Discovery only: source badges, relevance, and listing metadata are never RAP trust, attestation, payment approval, or endpoint authorization. No paid call, wallet action, or endpoint invocation happens from discovery cards — every hire path stays behind Decide gates.",
} as const;
