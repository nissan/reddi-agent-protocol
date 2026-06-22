import {
  buildCircleX402SourceManifest,
  circleX402DiscoveryResourceToCandidate,
  CIRCLE_X402_SOURCE_PROFILE,
  getCircleX402Diagnostics,
  getCircleX402SupportStates,
  mapCircleX402CategoryToTaskTypes,
  type CircleX402DiscoveryResource,
} from "@/lib/integrations/source-adapter/profiles/circle-x402";
import { getSourceProfile } from "@/lib/integrations/source-adapter/profiles";
import { validateSourceAdapterManifest } from "@/lib/integrations/source-adapter/schema";

describe("source adapter circle-x402 profile", () => {
  it("is discoverable via source registry", () => {
    const profile = getSourceProfile("circle-x402");
    expect(profile).toBeTruthy();
    expect(profile?.source).toBe("circle-x402");
    expect(profile?.roles).toContain("specialist");
    expect(profile?.roles).toContain("consumer");
  });

  it("maps Circle discovery categories into RAP task types", () => {
    expect(mapCircleX402CategoryToTaskTypes("WEB_SEARCH_RESEARCH")).toEqual(["research", "web-search"]);
    expect(mapCircleX402CategoryToTaskTypes("FINANCIAL_ANALYSIS")).toEqual(["financial-analysis", "market-data"]);
    expect(mapCircleX402CategoryToTaskTypes("UNKNOWN_VENDOR_CATEGORY")).toEqual(["external-api"]);
  });

  it("builds a valid Circle x402 specialist manifest", () => {
    const manifest = buildCircleX402SourceManifest({
      role: "specialist",
      runtime: "circle-gateway",
      taskTypes: ["research", "web-search"],
    });

    const validation = validateSourceAdapterManifest(manifest);
    expect(validation.ok).toBe(true);
    expect(manifest.source).toBe(CIRCLE_X402_SOURCE_PROFILE.source);
    expect(manifest.paymentPolicy).toBe("x402_required");
  });

  it("converts a Circle Discovery resource into an unattested RAP specialist candidate", () => {
    const resource: CircleX402DiscoveryResource = {
      resource: "https://api.example.com/v1/search/research",
      type: "http",
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          maxAmountRequired: "5000",
          payTo: "0x1234567890123456789012345678901234567890",
        },
      ],
      metadata: {
        provider: {
          name: "Example Research API",
          category: "WEB_SEARCH_RESEARCH",
          tags: ["research", "web"],
        },
        description: "Paid research endpoint",
        supportsCircleGateway: true,
        supportsVanillax402: true,
      },
    };

    const candidate = circleX402DiscoveryResourceToCandidate(resource);

    expect(candidate.candidateId).toBe("circle-x402:api.example.com:v1-search-research");
    expect(candidate.providerName).toBe("Example Research API");
    expect(candidate.taskTypes).toEqual(["research", "web-search"]);
    expect(candidate.attestationState).toBe("externally_listed_unattested");
    expect(candidate.supportStates).toEqual([
      "discovery_visible",
      "externally_listed_unattested",
      "x402_required",
      "dry_run_quote_preview",
      "live_payment_disabled",
    ]);
    expect(candidate.diagnostics).toEqual([]);
    expect(candidate.payment[0]).toMatchObject({
      rail: "circle_gateway",
      network: "eip155:8453",
      priceUsdc: 0.005,
    });
    expect(validateSourceAdapterManifest(candidate.sourceAdapter).ok).toBe(true);
    expect(candidate.trustNotes.join(" ")).toContain("Not RAP-attested");
    expect(candidate.trustNotes.join(" ")).toContain("live-payment-disabled");
  });

  it("exports explicit Circle x402 support states without implying live payment", () => {
    expect(getCircleX402SupportStates()).toEqual([
      "discovery_visible",
      "externally_listed_unattested",
      "x402_required",
      "dry_run_quote_preview",
      "live_payment_disabled",
    ]);
  });

  it("flags missing price and payee as blockers without upgrading trust", () => {
    const resource: CircleX402DiscoveryResource = {
      resource: "https://api.example.com/v1/report",
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        },
      ],
      metadata: {
        provider: {
          name: "Missing Price API",
          category: "FINANCIAL_ANALYSIS",
        },
        supportsCircleGateway: true,
      },
    };

    const candidate = circleX402DiscoveryResourceToCandidate(resource);

    expect(candidate.payment[0].priceUsdc).toBeUndefined();
    expect(candidate.diagnostics.map((item) => item.code)).toEqual(["missing_price", "missing_payee"]);
    expect(candidate.diagnostics.every((item) => item.severity === "blocker")).toBe(true);
    expect(candidate.attestationState).toBe("externally_listed_unattested");
    expect(candidate.trustNotes.join(" ")).toContain("diagnostics do not upgrade trust");
  });

  it("flags unsupported networks while preserving original Circle payment metadata", () => {
    const resource: CircleX402DiscoveryResource = {
      resource: "https://api.example.com/v1/legacy",
      accepts: [
        {
          scheme: "exact",
          network: "eip155:1",
          asset: "USDC",
          maxAmountRequired: "1000",
          payTo: "0x1234567890123456789012345678901234567890",
        },
      ],
      metadata: {
        provider: {
          name: "Legacy Mainnet API",
          category: "UNKNOWN_VENDOR_CATEGORY",
        },
      },
    };

    const candidate = circleX402DiscoveryResourceToCandidate(resource);

    expect(candidate.payment[0]).toMatchObject({
      network: "eip155:1",
      maxAmountRequired: "1000",
      payTo: "0x1234567890123456789012345678901234567890",
    });
    expect(candidate.diagnostics).toEqual([
      {
        code: "unsupported_network",
        severity: "blocker",
        detail: "Circle x402 payment network is unsupported or missing: eip155:1.",
      },
    ]);
  });

  it("flags resources without payment requirements", () => {
    const diagnostics = getCircleX402Diagnostics({
      resource: "https://api.example.com/v1/free-looking",
      accepts: [],
    });

    expect(diagnostics).toEqual([
      {
        code: "no_payment_requirements",
        severity: "blocker",
        detail: "Circle x402 resource does not declare any payment requirements.",
      },
    ]);
  });

  it("keeps malformed resources as blocked candidates instead of throwing", () => {
    const candidate = circleX402DiscoveryResourceToCandidate({
      resource: "not a url",
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          asset: "USDC",
          maxAmountRequired: "1000",
          payTo: "0x1234567890123456789012345678901234567890",
        },
      ],
    });

    expect(candidate.candidateId).toBe("circle-x402:malformed:not-a-url");
    expect(candidate.diagnostics).toEqual([
      {
        code: "malformed_resource",
        severity: "blocker",
        detail: "Circle x402 resource URL is malformed.",
      },
    ]);
  });
});
