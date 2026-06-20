import { validateAiCatalog } from "@reddi/agent-protocol/ai-catalog";

jest.mock("@/lib/registry/bridge", () => {
  throw new Error("live registry bridge must not be imported by well-known AI Catalog route");
});

jest.mock("@solana/web3.js", () => {
  throw new Error("Solana RPC helpers must not be imported by well-known AI Catalog route");
});

describe("well-known AI Catalog route", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("returns the fixture-backed hosted marketplace AI Catalog", async () => {
    const { GET } = await import("@/app/.well-known/ai-catalog.json/route");

    const res = await GET();
    const body = await res.json();
    const catalogValidation = validateAiCatalog(JSON.parse(JSON.stringify(body)));

    expect(res.status).toBe(200);
    expect(catalogValidation.ok).toBe(true);
    expect(body).toMatchObject({
      specVersion: "1.0",
      host: {
        identifier: "urn:reddi:marketplace:hosted-imported-agent-stacks",
      },
      entries: [
        expect.objectContaining({
          identifier: "urn:reddi:marketplace-listing:approveReadyDraft",
          mediaType: "application/vnd.reddi.marketplace-listing+json",
        }),
      ],
    });
  });

  it("keeps the well-known catalog non-live", async () => {
    const { GET } = await import("@/app/.well-known/ai-catalog.json/route");

    const res = await GET();
    const body = await res.json();
    const [entry] = body.entries;

    expect(entry.data.endpoint).toMatchObject({
      liveUrl: null,
      healthStatus: "not_probed",
    });
    expect(entry.data.payment).toMatchObject({
      activation: "disabled",
      settlement: "dry_run_only",
    });
    expect(entry.data.trust).toMatchObject({
      rapAttested: false,
      reputationAssigned: false,
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
  });
});
