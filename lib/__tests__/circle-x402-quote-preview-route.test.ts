jest.mock("@/lib/integrations/source-adapter/circle-x402-quote-preview", () => ({
  buildCircleX402QuotePreview: jest.fn(),
}));

describe("Circle x402 quote preview route", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("requires candidateId", async () => {
    const { POST } = await import("@/app/api/source-adapters/circle-x402/quote-preview/route");
    const res = await POST(
      new Request("http://localhost/api/source-adapters/circle-x402/quote-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: "preview" }),
      })
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe("candidateId is required");
    expect(data.mode).toBe("dry-run-quote-preview");
  });

  it("returns a dry-run quote preview without allowing live payment", async () => {
    const { buildCircleX402QuotePreview } = await import("@/lib/integrations/source-adapter/circle-x402-quote-preview");
    (buildCircleX402QuotePreview as jest.Mock).mockReturnValue({
      ok: true,
      mode: "dry-run-quote-preview",
      candidate: { candidateId: "circle-x402:provider:path", providerName: "Provider" },
      task: "Preview Provider",
      routePreview: {
        requestedSource: "circle-x402",
        candidateSource: "circle-x402",
        strictSourceMatch: true,
        routeState: "external_unattested_candidate",
        plannerPolicy: {
          preferredSource: "circle-x402",
          strictSourceMatch: true,
          requireAttestationBeforeTrust: true,
          livePaymentAllowed: false,
        },
      },
      quotePreview: {
        currency: "USDC",
        network: "eip155:8453",
        rail: "circle_gateway",
        estimatedUsd: 0.005,
      },
      paymentSupport: {
        supportStates: ["discovery_visible", "externally_listed_unattested", "x402_required", "dry_run_quote_preview", "live_payment_disabled"],
        diagnostics: [],
        livePaymentAllowed: false,
        trustUpgradeAllowed: false,
        reputationMutationAllowed: false,
        publicationReady: false,
      },
      requiredGates: ["User explicitly approves live x402 payment experiment."],
      trustNotes: ["Preview only: no x402 payment header is created and no external endpoint is invoked."],
    });

    const { POST } = await import("@/app/api/source-adapters/circle-x402/quote-preview/route");
    const res = await POST(
      new Request("http://localhost/api/source-adapters/circle-x402/quote-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId: "circle-x402:provider:path", task: "Preview Provider" }),
      })
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(buildCircleX402QuotePreview).toHaveBeenCalledWith({
      candidateId: "circle-x402:provider:path",
      task: "Preview Provider",
    });
    expect(data.mode).toBe("dry-run-quote-preview");
    expect(data.routePreview.plannerPolicy.livePaymentAllowed).toBe(false);
    expect(data.paymentSupport.livePaymentAllowed).toBe(false);
    expect(data.paymentSupport.trustUpgradeAllowed).toBe(false);
    expect(data.paymentSupport.reputationMutationAllowed).toBe(false);
    expect(data.paymentSupport.publicationReady).toBe(false);
    expect(data.paymentSupport.supportStates).toContain("live_payment_disabled");
    expect(data.requiredGates[0]).toContain("approves");
  });

  it("returns 404 when a candidate cannot be found", async () => {
    const { buildCircleX402QuotePreview } = await import("@/lib/integrations/source-adapter/circle-x402-quote-preview");
    (buildCircleX402QuotePreview as jest.Mock).mockReturnValue({
      ok: false,
      mode: "dry-run-quote-preview",
      candidate: null,
      task: "Preview",
      routePreview: null,
      quotePreview: null,
      paymentSupport: null,
      requiredGates: [],
      trustNotes: [],
      error: "Circle x402 candidate not found: missing",
    });

    const { POST } = await import("@/app/api/source-adapters/circle-x402/quote-preview/route");
    const res = await POST(
      new Request("http://localhost/api/source-adapters/circle-x402/quote-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId: "missing" }),
      })
    );
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.ok).toBe(false);
    expect(data.error).toContain("not found");
  });
});
