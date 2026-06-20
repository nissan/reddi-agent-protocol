import type {
  MarketplaceApprovalAuditEntry,
  MarketplaceApprovalRecord,
} from "@/lib/manager/marketplace-approval-actions";
import {
  evaluateMarketplaceReadiness,
  type MarketplaceReadinessBoundary,
  type MarketplaceReadinessProofMetadata,
  type MarketplaceReadinessResult,
} from "@/lib/manager/marketplace-readiness-gate";

export const MARKETPLACE_PUBLIC_EXPORT_SCHEMA_VERSION = "reddi.marketplace-public-export.v1" as const;

export type MarketplacePublicExportBoundary = MarketplaceReadinessBoundary & {
  hostedExportAllowed: boolean;
  ardCatalogExportAllowed: boolean;
};

export type MarketplacePublicListingSnapshot = {
  schemaVersion: typeof MARKETPLACE_PUBLIC_EXPORT_SCHEMA_VERSION;
  listingId: string;
  fixtureKey: string;
  displayName: string;
  summary: string;
  source: {
    sourceUrl: string;
    checkedCommit?: string;
    imported: true;
    staticOnly: true;
    untrusted: true;
  };
  endpoint: {
    bindingRef: string;
    liveUrl: null;
    healthStatus: "not_probed";
  };
  capabilities: {
    tags: string[];
    capabilityRefs: string[];
    groupKinds: string[];
  };
  payment: {
    planId: string;
    currency: string;
    amount: number;
    activation: "disabled";
    settlement: "dry_run_only";
    evidenceRef: string;
  };
  trust: {
    rapAttested: false;
    reputationAssigned: false;
    operatorApprovalEvidenceRef: string;
    attestationDraftRef: string;
  };
  evidenceRefs: string[];
  disclosureLabels: string[];
};

export type MarketplacePublicCatalogResource = {
  identifier: string;
  mediaType: "application/vnd.reddi.marketplace-listing+json";
  displayName: string;
  description: string;
  data: MarketplacePublicListingSnapshot;
  metadata: {
    rap: {
      listingId: string;
      fixtureKey: string;
      readinessStatus: "publish_ready";
      payment: MarketplacePublicListingSnapshot["payment"];
      boundaries: MarketplacePublicExportBoundary;
    };
    capabilities: string[];
  };
};

export type MarketplacePublicAiCatalog = {
  specVersion: "1.0";
  host: {
    identifier: string;
    displayName: string;
  };
  entries: MarketplacePublicCatalogResource[];
};

export type MarketplacePublicExportSuccess = {
  ok: true;
  listing: MarketplacePublicListingSnapshot;
  catalogResource: MarketplacePublicCatalogResource;
  readiness: MarketplaceReadinessResult;
  publishAudit: MarketplaceApprovalAuditEntry;
  boundaries: MarketplacePublicExportBoundary;
};

export type MarketplacePublicExportBlock = {
  ok: false;
  listingId: string;
  fixtureKey: string;
  recordState: MarketplaceApprovalRecord["state"];
  readinessStatus: MarketplaceReadinessResult["status"];
  reasons: string[];
  blockReasons: string[];
  boundaries: MarketplacePublicExportBoundary;
};

export type MarketplacePublicExportItem = MarketplacePublicExportSuccess | MarketplacePublicExportBlock;

export type MarketplacePublicExportSnapshot = {
  schemaVersion: typeof MARKETPLACE_PUBLIC_EXPORT_SCHEMA_VERSION;
  generatedAt: string;
  host: MarketplacePublicAiCatalog["host"];
  exported: MarketplacePublicExportSuccess[];
  blocked: MarketplacePublicExportBlock[];
  aiCatalog: MarketplacePublicAiCatalog;
};

export type MarketplacePublicExportOptions = {
  generatedAt?: string;
  host?: MarketplacePublicAiCatalog["host"];
};

const defaultHost = {
  identifier: "urn:reddi:marketplace:hosted-imported-agent-stacks",
  displayName: "Reddi hosted imported agent listings",
} as const;

const disclosureLabels = [
  "imported metadata",
  "external source",
  "untrusted",
  "static-only",
  "operator approved",
  "not RAP-attested",
  "dry-run payment proof only",
  "no live endpoint probe",
  "no reputation assignment",
];

export function deriveMarketplacePublicExportItem(
  record: MarketplaceApprovalRecord,
  proof: MarketplaceReadinessProofMetadata = {},
): MarketplacePublicExportItem {
  const readiness = evaluateMarketplaceReadiness(record.id, record.fixtureKey, record.candidate, proof);
  const boundaries = publicExportBoundaries(readiness.boundaries, false);
  const reasons = publicExportBlockReasons(record, proof, readiness);
  if (reasons.length > 0) {
    return {
      ok: false,
      listingId: record.id,
      fixtureKey: record.fixtureKey,
      recordState: record.state,
      readinessStatus: readiness.status,
      reasons,
      blockReasons: readiness.blockReasons,
      boundaries,
    };
  }

  const publishAudit = latestPublishAudit(record);
  if (!publishAudit) {
    throw new Error("invariant: public export requires publish audit evidence");
  }

  const listing = buildListing(record, proof, readiness, publishAudit);
  const allowedBoundaries = publicExportBoundaries(readiness.boundaries, true);
  return {
    ok: true,
    listing,
    catalogResource: buildCatalogResource(listing, allowedBoundaries),
    readiness,
    publishAudit,
    boundaries: allowedBoundaries,
  };
}

export function deriveMarketplacePublicExportSnapshot(
  records: MarketplaceApprovalRecord[],
  proofByListingId: Record<string, MarketplaceReadinessProofMetadata> = {},
  options: MarketplacePublicExportOptions = {},
): MarketplacePublicExportSnapshot {
  const items = records.map((record) => deriveMarketplacePublicExportItem(record, proofByListingId[record.id] ?? {}));
  const exported = items.filter((item): item is MarketplacePublicExportSuccess => item.ok);
  const blocked = items.filter((item): item is MarketplacePublicExportBlock => !item.ok);
  const host = options.host ?? defaultHost;

  return {
    schemaVersion: MARKETPLACE_PUBLIC_EXPORT_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date(0).toISOString(),
    host,
    exported,
    blocked,
    aiCatalog: {
      specVersion: "1.0",
      host,
      entries: exported.map((item) => item.catalogResource),
    },
  };
}

function publicExportBlockReasons(
  record: MarketplaceApprovalRecord,
  proof: MarketplaceReadinessProofMetadata,
  readiness: MarketplaceReadinessResult,
) {
  const reasons = [
    record.state === "published" ? undefined : `record_state_not_published:${record.state}`,
    record.publicVisible === true ? undefined : "public_visibility_false",
    readiness.status === "publish_ready" ? undefined : `readiness_not_publish_ready:${readiness.status}`,
    readiness.boundaries.publicationAllowed === true ? undefined : "publication_not_allowed",
    proof.operatorApproval?.approved === true ? undefined : "operator_approval_missing",
    isNonEmptyString(proof.operatorApproval?.evidenceRef) ? undefined : "operator_approval_evidence_missing",
    latestPublishAudit(record) ? undefined : "publish_audit_missing",
  ];

  return reasons.filter(isNonEmptyString);
}

function buildListing(
  record: MarketplaceApprovalRecord,
  proof: MarketplaceReadinessProofMetadata,
  readiness: MarketplaceReadinessResult,
  publishAudit: MarketplaceApprovalAuditEntry,
): MarketplacePublicListingSnapshot {
  const buyerPreview = record.candidate.draftPreview.buyerPreview;
  const paymentPlan = proof.paymentPlan;
  if (!paymentPlan || !proof.endpointBindingRef || !proof.operatorApproval || !proof.attestationDraftRef) {
    throw new Error("invariant: publish-ready public export requires proof metadata");
  }

  return {
    schemaVersion: MARKETPLACE_PUBLIC_EXPORT_SCHEMA_VERSION,
    listingId: record.id,
    fixtureKey: record.fixtureKey,
    displayName: buyerPreview.displayName ?? record.candidate.title,
    summary: buyerPreview.summary ?? record.candidate.description,
    source: {
      sourceUrl: record.candidate.sourceUrl,
      checkedCommit: record.candidate.checkedCommit,
      imported: true,
      staticOnly: true,
      untrusted: true,
    },
    endpoint: {
      bindingRef: proof.endpointBindingRef,
      liveUrl: null,
      healthStatus: "not_probed",
    },
    capabilities: {
      tags: deriveCapabilityTags(record),
      capabilityRefs: uniqueRefs(record.candidate.groups.flatMap((group) => group.capabilityRefs)),
      groupKinds: record.candidate.requiredGroupKinds,
    },
    payment: {
      planId: paymentPlan.planId,
      currency: paymentPlan.currency,
      amount: paymentPlan.amount,
      activation: "disabled",
      settlement: "dry_run_only",
      evidenceRef: paymentPlan.evidenceRef,
    },
    trust: {
      rapAttested: false,
      reputationAssigned: false,
      operatorApprovalEvidenceRef: proof.operatorApproval.evidenceRef,
      attestationDraftRef: proof.attestationDraftRef,
    },
    evidenceRefs: uniqueRefs([
      ...publishAudit.evidenceRefs,
      ...readiness.gates.flatMap((gate) => gate.evidenceRefs),
    ]),
    disclosureLabels,
  };
}

function buildCatalogResource(
  listing: MarketplacePublicListingSnapshot,
  boundaries: MarketplacePublicExportBoundary,
): MarketplacePublicCatalogResource {
  return {
    identifier: `urn:reddi:marketplace-listing:${listing.fixtureKey}`,
    mediaType: "application/vnd.reddi.marketplace-listing+json",
    displayName: listing.displayName,
    description: listing.summary,
    data: listing,
    metadata: {
      rap: {
        listingId: listing.listingId,
        fixtureKey: listing.fixtureKey,
        readinessStatus: "publish_ready",
        payment: listing.payment,
        boundaries,
      },
      capabilities: listing.capabilities.tags,
    },
  };
}

function latestPublishAudit(record: MarketplaceApprovalRecord) {
  return [...record.auditHistory]
    .reverse()
    .find((entry) =>
      entry.action === "publish"
      && entry.nextState === "published"
      && entry.evidenceRefs.some(isNonEmptyString)
    );
}

function publicExportBoundaries(
  readinessBoundaries: MarketplaceReadinessBoundary,
  exportAllowed: boolean,
): MarketplacePublicExportBoundary {
  return {
    ...readinessBoundaries,
    hostedExportAllowed: exportAllowed,
    ardCatalogExportAllowed: exportAllowed,
  };
}

function deriveCapabilityTags(record: MarketplaceApprovalRecord) {
  const buyerPreview = record.candidate.draftPreview.buyerPreview;
  return uniqueRefs([
    ...record.candidate.requiredGroupKinds,
    ...Object.values(buyerPreview)
      .flatMap((value) => value.split(/[,;]/))
      .map((value) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"))
      .filter(Boolean),
  ]).slice(0, 12);
}

function uniqueRefs(refs: string[]) {
  return Array.from(new Set(refs.filter(isNonEmptyString)));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
