import {
  searchHostedMarketplaceCatalog,
} from "@/lib/manager/marketplace-public-search";

jest.mock("@/lib/registry/bridge", () => {
  throw new Error("live registry bridge must not be imported by marketplace catalog search");
});

jest.mock("@solana/web3.js", () => {
  throw new Error("Solana RPC helpers must not be imported by marketplace catalog search");
});

describe("hosted marketplace catalog search", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("searches only exported hosted catalog entries and normalizes discovery candidates", () => {
    const result = searchHostedMarketplaceCatalog({ q: "approve", tags: ["claude-plugin"], limit: 10 });

    expect(result).toMatchObject({
      schemaVersion: "reddi.hosted-rap-search.v1",
      source: {
        kind: "hosted-rap-registry",
        catalogUrl: "/.well-known/ai-catalog.json",
        fixtureBacked: true,
        readOnly: true,
      },
      total: 1,
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
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      candidate: {
        sourceKind: "hosted-rap-registry",
        identifier: "urn:reddi:marketplace-listing:approveReadyDraft",
        policyPreflightRequired: true,
      },
      listing: {
        fixtureKey: "approveReadyDraft",
        sourceClass: "hosted-by-rap",
        endpointHealth: "not_probed",
        paymentActivation: "disabled",
        rapAttested: false,
        reputationAssigned: false,
      },
      match: {
        scoreMeaning: "relevance_only_not_trust",
        matchedFields: expect.arrayContaining(["displayName", "capabilities"]),
      },
    });
    expect(result.discoveryCandidates).toHaveLength(1);
    expect(result.discoveryCandidates[0]).toMatchObject({
      sourceKind: "hosted-rap-registry",
      identifier: "urn:reddi:marketplace-listing:approveReadyDraft",
      policyPreflightRequired: true,
      relevance: {
        source: "hosted-rap-registry",
      },
    });
  });

  it("keeps blocked records visible only as diagnostics, not searchable entries", () => {
    const result = searchHostedMarketplaceCatalog({ q: "malformed" });

    expect(result.total).toBe(0);
    expect(result.results).toEqual([]);
    expect(result.discoveryCandidates).toEqual([]);
    expect(result.blocked.map((item) => item.fixtureKey)).toEqual([
      "approveReadyDraft",
      "rejectedMalformedConnector",
    ]);
    expect(result.blocked.find((item) => item.fixtureKey === "rejectedMalformedConnector")?.reasons).toEqual([
      "readiness_not_publish_ready:blocked",
      "publication_not_allowed",
      "publish_audit_malformed",
      "unsafe_metadata",
    ]);
  });

  it("does not convert discovery relevance into payment, trust, or reputation approval", () => {
    const result = searchHostedMarketplaceCatalog({ q: "approve" });
    const [candidate] = result.discoveryCandidates;

    expect((candidate as { quote?: unknown }).quote).toBeUndefined();
    expect(candidate.providerTrust?.verification.status).toBe("unverified");
    expect(candidate.policyPreflightRequired).toBe(true);
    expect(result.results[0]).toMatchObject({
      listing: {
        endpointHealth: "not_probed",
        paymentActivation: "disabled",
        rapAttested: false,
        reputationAssigned: false,
      },
      match: {
        scoreMeaning: "relevance_only_not_trust",
      },
    });
  });

  it("supports deterministic capability and media type filters", () => {
    const matched = searchHostedMarketplaceCatalog({
      tags: ["claude-plugin"],
      mediaType: "application/vnd.reddi.marketplace-listing+json",
    });
    const unmatched = searchHostedMarketplaceCatalog({
      tags: ["missing-capability"],
      mediaType: "application/vnd.reddi.marketplace-listing+json",
    });

    expect(matched.total).toBe(1);
    expect(unmatched.total).toBe(0);
  });
});
