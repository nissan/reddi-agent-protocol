import { validateAiCatalog } from "@reddi/agent-protocol/ai-catalog";

import {
  getFixtureBackedMarketplacePublicExportSnapshot,
} from "@/lib/manager/marketplace-public-export-fixtures";
import type {
  MarketplacePublicCatalogResource,
  MarketplacePublicExportBlock,
  MarketplacePublicExportSnapshot,
} from "@/lib/manager/marketplace-public-export";

export const MARKETPLACE_CATALOG_SEARCH_SCHEMA_VERSION = "reddi.hosted-rap-search.v1" as const;
export const DISCOVERY_CANDIDATE_SCHEMA_VERSION = "reddi.discovery-candidate.v1" as const;

export type HostedMarketplaceDiscoveryCandidate = {
  schemaVersion: typeof DISCOVERY_CANDIDATE_SCHEMA_VERSION;
  sourceKind: "hosted-rap-registry";
  identifier: string;
  publisher?: {
    id: string;
    name?: string;
    domain?: string;
  };
  name: string;
  description?: string;
  resourceType: string;
  mediaType: string;
  providerTrust: {
    schemaVersion: "reddi.provider-trust.v1";
    provider: {
      id: string;
      name?: string;
      domain?: string;
    };
    verification: {
      status: "unverified";
    };
  };
  relevance: {
    score: number;
    reason: "catalog_search_match";
    source: "hosted-rap-registry";
  };
  rawSnapshotRef?: string;
  policyPreflightRequired: true;
};

export type HostedMarketplaceDiscoveryDiagnostic = {
  code: "candidate_ready_for_policy_preflight";
  path: string;
  message: string;
};

export type MarketplaceCatalogSearchSort = "relevance" | "name" | "listing_id";

export type MarketplaceCatalogSearchQuery = {
  q?: string;
  tags?: string[];
  mediaType?: string;
  limit?: number;
  sort?: MarketplaceCatalogSearchSort;
};

export type MarketplaceHostedSearchResultItem = {
  candidate: HostedMarketplaceDiscoveryCandidate;
  listing: {
    listingId: string;
    fixtureKey: string;
    sourceClass: "hosted-by-rap";
    endpointHealth: "not_probed";
    paymentActivation: "disabled";
    rapAttested: false;
    reputationAssigned: false;
    disclosureLabels: string[];
  };
  match: {
    score: number;
    matchedFields: string[];
    scoreMeaning: "relevance_only_not_trust";
  };
};

export type MarketplaceCatalogSearchResult = {
  schemaVersion: typeof MARKETPLACE_CATALOG_SEARCH_SCHEMA_VERSION;
  generatedAt: string;
  source: {
    kind: "hosted-rap-registry";
    catalogUrl: "/.well-known/ai-catalog.json";
    catalogRef: string;
    fixtureBacked: true;
    readOnly: true;
  };
  query: {
    q: string | null;
    tags: string[];
    mediaType: string | null;
    limit: number;
    sort: MarketplaceCatalogSearchSort;
  };
  total: number;
  results: MarketplaceHostedSearchResultItem[];
  discoveryCandidates: HostedMarketplaceDiscoveryCandidate[];
  diagnostics: HostedMarketplaceDiscoveryDiagnostic[];
  blocked: Array<Pick<MarketplacePublicExportBlock, "listingId" | "fixtureKey" | "recordState" | "readinessStatus" | "reasons">>;
  guardrails: {
    discoveryOnly: true;
    policyPreflightRequired: true;
    livePublication: false;
    livePayment: false;
    walletSigning: false;
    rpcProbe: false;
    mcpCall: false;
    providerCall: false;
    reputationAssignment: false;
  };
};

const defaultLimit = 25;
const maxLimit = 50;

export function searchHostedMarketplaceCatalog(
  query: MarketplaceCatalogSearchQuery = {},
  snapshot: MarketplacePublicExportSnapshot = getFixtureBackedMarketplacePublicExportSnapshot(),
): MarketplaceCatalogSearchResult {
  const normalizedQuery = normalizeQuery(query);
  const scoredEntries = snapshot.aiCatalog.entries
    .map((entry) => matchEntry(entry, normalizedQuery.q, normalizedQuery.tags, normalizedQuery.mediaType))
    .filter((item) => item.score > 0);

  const sortedEntries = sortEntries(scoredEntries, normalizedQuery.sort)
    .slice(0, normalizedQuery.limit)
    .map((item) => item.entry);

  const catalog = {
    ...snapshot.aiCatalog,
    entries: sortedEntries,
  };
  const validation = validateAiCatalog(JSON.parse(JSON.stringify(catalog)));
  if (!validation.ok) {
    throw new Error(`invalid_hosted_marketplace_catalog:${validation.errors.map((item) => item.code).join(",")}`);
  }

  const relevanceScores = Object.fromEntries(
    scoredEntries.map((item) => [item.entry.identifier, item.score]),
  );
  const discoveryCandidates = validation.catalog.resources.map((resource) => ({
    schemaVersion: DISCOVERY_CANDIDATE_SCHEMA_VERSION,
    sourceKind: "hosted-rap-registry" as const,
    identifier: resource.id,
    publisher: validation.catalog.publisher,
    name: resource.name,
    description: resource.description,
    resourceType: resource.type,
    mediaType: resource.mediaType,
    providerTrust: {
      schemaVersion: "reddi.provider-trust.v1" as const,
      provider: {
        id: resource.id,
        name: resource.name,
        domain: validation.catalog.publisher.domain,
      },
      verification: {
        status: "unverified" as const,
      },
    },
    relevance: {
      score: relevanceScores[resource.id] ?? 0,
      reason: "catalog_search_match" as const,
      source: "hosted-rap-registry" as const,
    },
    rawSnapshotRef: validation.catalog.rawSnapshotRef,
    policyPreflightRequired: true as const,
  }));

  const candidateById = new Map(discoveryCandidates.map((candidate) => [candidate.identifier, candidate]));
  const matchById = new Map(scoredEntries.map((item) => [item.entry.identifier, item]));
  const results = sortedEntries.map((entry) => {
    const candidate = candidateById.get(entry.identifier);
    const match = matchById.get(entry.identifier);
    if (!candidate || !match) {
      throw new Error(`invariant: missing hosted search candidate for ${entry.identifier}`);
    }
    return {
      candidate,
      listing: {
        listingId: entry.data.listingId,
        fixtureKey: entry.data.fixtureKey,
        sourceClass: "hosted-by-rap" as const,
        endpointHealth: entry.data.endpoint.healthStatus,
        paymentActivation: entry.data.payment.activation,
        rapAttested: entry.data.trust.rapAttested,
        reputationAssigned: entry.data.trust.reputationAssigned,
        disclosureLabels: entry.data.disclosureLabels,
      },
      match: {
        score: match.score,
        matchedFields: match.matchedFields,
        scoreMeaning: "relevance_only_not_trust" as const,
      },
    };
  });

  return {
    schemaVersion: MARKETPLACE_CATALOG_SEARCH_SCHEMA_VERSION,
    generatedAt: snapshot.generatedAt,
    source: {
      kind: "hosted-rap-registry",
      catalogUrl: "/.well-known/ai-catalog.json",
      catalogRef: snapshot.host.identifier,
      fixtureBacked: true,
      readOnly: true,
    },
    query: normalizedQuery,
    total: results.length,
    results,
    discoveryCandidates,
    diagnostics: [{
      code: "candidate_ready_for_policy_preflight",
      path: "$.results",
      message: "Hosted RAP search candidates require explicit RAP policy preflight before quote, payment, invocation, trust, or reputation claims.",
    }],
    blocked: snapshot.blocked.map((item) => ({
      listingId: item.listingId,
      fixtureKey: item.fixtureKey,
      recordState: item.recordState,
      readinessStatus: item.readinessStatus,
      reasons: item.reasons,
    })),
    guardrails: {
      discoveryOnly: true,
      policyPreflightRequired: true,
      livePublication: false,
      livePayment: false,
      walletSigning: false,
      rpcProbe: false,
      mcpCall: false,
      providerCall: false,
      reputationAssignment: false,
    },
  };
}

export function marketplaceCatalogSearchQueryFromUrl(url: URL): MarketplaceCatalogSearchQuery {
  return {
    q: url.searchParams.get("q") ?? undefined,
    tags: parseCsv(url.searchParams.get("capabilities") ?? url.searchParams.get("capability") ?? url.searchParams.get("tags") ?? url.searchParams.get("tag")),
    mediaType: url.searchParams.get("mediaType") ?? undefined,
    limit: parseLimit(url.searchParams.get("limit")),
    sort: parseSort(url.searchParams.get("sort") ?? url.searchParams.get("sortBy")),
  };
}

function normalizeQuery(query: MarketplaceCatalogSearchQuery): MarketplaceCatalogSearchResult["query"] {
  return {
    q: normalizeTerm(query.q) ?? null,
    tags: uniqueStrings(query.tags?.map(normalizeTerm).filter(isString) ?? []),
    mediaType: normalizeTerm(query.mediaType) ?? null,
    limit: clampLimit(query.limit),
    sort: query.sort ?? "relevance",
  };
}

function matchEntry(
  entry: MarketplacePublicCatalogResource,
  q: string | null,
  tags: string[],
  mediaType: string | null,
) {
  const fields = {
    identifier: entry.identifier,
    displayName: `${entry.displayName} ${entry.data.displayName}`,
    description: `${entry.description} ${entry.data.summary}`,
    capabilities: [
      ...entry.data.capabilities.tags,
      ...entry.data.capabilities.groupKinds,
      ...entry.data.capabilities.capabilityRefs,
    ].join(" "),
    mediaType: entry.mediaType,
  };
  const matchedFields = Object.entries(fields)
    .filter(([, value]) => q === null || value.toLowerCase().includes(q))
    .map(([field]) => field);

  const queryScore = q === null ? 1 : matchedFields.length > 0 ? 1 : 0;
  if (queryScore === 0 || (mediaType !== null && entry.mediaType.toLowerCase() !== mediaType)) {
    return { entry, score: 0, matchedFields: [] };
  }

  const entryTags = new Set(entry.data.capabilities.tags.map((tag) => tag.toLowerCase()));
  const tagMatches = tags.filter((tag) => entryTags.has(tag)).length;
  if (tags.length > 0 && tagMatches === 0) {
    return { entry, score: 0, matchedFields: [] };
  }

  return {
    entry,
    score: Math.min(1, queryScore + tagMatches / Math.max(tags.length, 1) * 0.25),
    matchedFields: uniqueStrings([
      ...matchedFields,
      ...(tagMatches > 0 ? ["capabilities"] : []),
      ...(mediaType !== null ? ["mediaType"] : []),
    ]),
  };
}

function sortEntries(
  entries: Array<{ entry: MarketplacePublicCatalogResource; score: number; matchedFields: string[] }>,
  sort: MarketplaceCatalogSearchSort,
) {
  return [...entries].sort((a, b) => {
    if (sort === "name") return a.entry.displayName.localeCompare(b.entry.displayName);
    if (sort === "listing_id") return a.entry.data.listingId.localeCompare(b.entry.data.listingId);
    if (a.score !== b.score) return b.score - a.score;
    return a.entry.displayName.localeCompare(b.entry.displayName);
  });
}

function parseCsv(value: string | null) {
  if (!value) return [];
  return value.split(",").map(normalizeTerm).filter(isString);
}

function parseLimit(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseSort(value: string | null): MarketplaceCatalogSearchSort | undefined {
  return value === "name" || value === "listing_id" || value === "relevance" ? value : undefined;
}

function clampLimit(value: number | undefined) {
  if (!value) return defaultLimit;
  return Math.max(1, Math.min(maxLimit, Math.floor(value)));
}

function normalizeTerm(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function isString(value: string | undefined): value is string {
  return typeof value === "string";
}
