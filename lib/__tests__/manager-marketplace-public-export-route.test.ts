import { validateAiCatalog } from "@reddi/agent-protocol/ai-catalog";

jest.mock("@/lib/registry/bridge", () => {
  throw new Error("live registry bridge must not be imported by marketplace public export route");
});

jest.mock("@solana/web3.js", () => {
  throw new Error("Solana RPC helpers must not be imported by marketplace public export route");
});

describe("manager marketplace public export route", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("returns a read-only fixture-backed export snapshot", async () => {
    const { GET } = await import("@/app/api/manager/marketplace-public-export/route");

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      guardrails: {
        readOnly: true,
        fixtureBacked: true,
        livePublication: false,
        livePayment: false,
        walletSigning: false,
        rpcProbe: false,
        mcpCall: false,
        providerCall: false,
        reputationAssignment: false,
      },
      result: {
        schemaVersion: "reddi.marketplace-public-export.v1",
        exported: expect.any(Array),
        blocked: expect.any(Array),
        aiCatalog: {
          specVersion: "1.0",
          entries: expect.any(Array),
        },
      },
    });
    expect(body.result.exported).toHaveLength(1);
    expect(body.result.blocked).toHaveLength(2);
    expect(body.result.aiCatalog.entries).toHaveLength(1);
    const catalogValidation = validateAiCatalog(JSON.parse(JSON.stringify(body.result.aiCatalog)));
    expect(catalogValidation.ok).toBe(true);
  });

  it("keeps exported catalog entries non-live and hides blocked records from AI Catalog output", async () => {
    const { GET } = await import("@/app/api/manager/marketplace-public-export/route");

    const res = await GET();
    const body = await res.json();
    const [entry] = body.result.aiCatalog.entries;

    expect(entry.data).toMatchObject({
      endpoint: {
        liveUrl: null,
        healthStatus: "not_probed",
      },
      payment: {
        activation: "disabled",
        settlement: "dry_run_only",
      },
      trust: {
        rapAttested: false,
        reputationAssigned: false,
      },
    });
    expect(entry.metadata.rap.boundaries).toMatchObject({
      livePaymentAllowed: false,
      walletSigningAllowed: false,
      rpcProbeAllowed: false,
      mcpCallAllowed: false,
      reputationAssignmentAllowed: false,
      publicationAllowed: true,
      hostedExportAllowed: true,
      ardCatalogExportAllowed: true,
    });
    expect(body.result.blocked.map((item: { fixtureKey: string }) => item.fixtureKey)).toEqual([
      "approveReadyDraft",
      "rejectedMalformedConnector",
    ]);
    expect(body.result.aiCatalog.entries.map((item: { identifier: string }) => item.identifier)).toEqual([
      "urn:reddi:marketplace-listing:approveReadyDraft",
    ]);
  });
});
