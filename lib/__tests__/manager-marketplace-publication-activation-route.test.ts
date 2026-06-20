jest.mock("@/lib/registry/bridge", () => {
  throw new Error("live registry bridge must not be imported by marketplace publication activation route");
});

jest.mock("@solana/web3.js", () => {
  throw new Error("Solana RPC helpers must not be imported by marketplace publication activation route");
});

jest.mock("@/lib/onboarding/x402-settlement", () => {
  throw new Error("live payment settlement must not be imported by marketplace publication activation route");
}, { virtual: true });

describe("manager marketplace publication activation route", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("returns a read-only fixture-backed dry-run activation decision", async () => {
    const { GET } = await import("@/app/api/manager/marketplace-publication-activation/route");

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      guardrails: {
        readOnly: true,
        fixtureBacked: true,
        dryRunOnly: true,
        livePublication: false,
        livePayment: false,
        hostedRegistryWrite: false,
        walletSigning: false,
        rpcProbe: false,
        mcpCall: false,
        providerCall: false,
        reputationAssignment: false,
      },
      result: {
        schemaVersion: "reddi.marketplace-publication-activation.v1",
        status: "dry_run_ready",
        mode: "dry_run",
        source: "public_export_item",
        reasonCodes: ["dry_run_activation_ready"],
        outputs: {
          hostedRap: "dry_run_only",
          ardCatalog: "dry_run_only",
          publicExportSnapshot: "dry_run_only",
        },
        activationPlan: {
          hostedRegistryWrite: false,
          ardCatalogWrite: false,
          livePublication: false,
          walletSigning: false,
          rpcProbe: false,
          livePayment: false,
          providerCall: false,
          mcpCall: false,
        },
      },
    });
    expect(body.result.evidenceRefs).toEqual(expect.arrayContaining([
      "evidence:activation:approve-ready",
      "evidence:activation-intent:approve-ready",
      "evidence:operator-action:publish",
    ]));
  });
});
