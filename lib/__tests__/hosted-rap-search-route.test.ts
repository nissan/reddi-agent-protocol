jest.mock("@/lib/registry/bridge", () => {
  throw new Error("live registry bridge must not be imported by marketplace catalog search route");
});

jest.mock("@solana/web3.js", () => {
  throw new Error("Solana RPC helpers must not be imported by marketplace catalog search route");
});

describe("hosted RAP search route", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("returns a read-only hosted catalog search response", async () => {
    const { GET } = await import("@/app/api/hosted-rap/search/route");

    const res = await GET(new Request("https://app.example.test/api/hosted-rap/search?q=approve&capability=claude-plugin"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      result: {
        schemaVersion: "reddi.hosted-rap-search.v1",
        query: {
          q: "approve",
          tags: ["claude-plugin"],
          mediaType: null,
          limit: 25,
          sort: "relevance",
        },
        total: 1,
        source: {
          kind: "hosted-rap-registry",
          catalogUrl: "/.well-known/ai-catalog.json",
          fixtureBacked: true,
          readOnly: true,
        },
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
      },
    });
    expect(body.result.discoveryCandidates[0]).toMatchObject({
      sourceKind: "hosted-rap-registry",
      policyPreflightRequired: true,
    });
    expect(body.result.results[0]).toMatchObject({
      listing: {
        sourceClass: "hosted-by-rap",
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

  it("returns empty results for unmatched queries without exposing blocked records as entries", async () => {
    const { GET } = await import("@/app/api/hosted-rap/search/route");

    const res = await GET(new Request("https://app.example.test/api/hosted-rap/search?q=malformed"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.result.results).toEqual([]);
    expect(body.result.discoveryCandidates).toEqual([]);
    expect(body.result.blocked.map((item: { fixtureKey: string }) => item.fixtureKey)).toEqual([
      "approveReadyDraft",
      "rejectedMalformedConnector",
    ]);
  });
});
