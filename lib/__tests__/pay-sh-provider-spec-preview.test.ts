import { buildPayShProviderSpecPreview } from "@/lib/integrations/source-adapter/pay-sh-provider-spec-preview";
import { payShCatalogProviderToCandidate, type PayShCatalogProvider } from "@/lib/integrations/source-adapter/profiles/pay-sh";

const validProvider: PayShCatalogProvider = {
  fqn: "reddi/market-intel/stablecoin-feed",
  title: "Stablecoin Feed",
  description: "Reviewed market data feed.",
  category: "finance",
  service_url: "https://stablecoin-feed.example.com",
  docs_url: "https://stablecoin-feed.example.com/docs",
  endpoint_count: 3,
  has_metering: true,
  has_free_tier: false,
  min_price_usd: 0.01,
  max_price_usd: 0.05,
  payment_rails: ["x402"],
  networks: ["solana"],
  sha: "source-hash-123",
};

function previewInput(provider: PayShCatalogProvider = validProvider) {
  return {
    candidate: payShCatalogProviderToCandidate(provider),
    listing: {
      name: "stablecoin-feed",
      subdomain: "stablecoin-feed",
      title: "Stablecoin Feed",
      description: "Reviewed RAP listing preview for a Pay.sh-compatible market data provider.",
      version: "1.0.0",
      operatorNotes: ["Operator reviewed Pay.sh provider metadata."],
    },
    operatorApproval: {
      approved: true,
      evidenceRef: "evidence:operator-approval:pay-sh-preview",
    },
    publication: {
      status: "eligible" as const,
      evidenceRef: "evidence:publication:eligible",
    },
  };
}

describe("Pay.sh provider spec preview", () => {
  it("generates a no-spend provider spec preview for an eligible reviewed listing", () => {
    const preview = buildPayShProviderSpecPreview(previewInput());

    expect(preview.status).toBe("preview_ready");
    expect(preview.boundaries).toEqual({
      submittedToPaySh: false,
      listedOnPaySh: false,
      sandboxTested: false,
      livePaymentEnabled: false,
    });
    expect(preview.spec).toMatchObject({
      name: "stablecoin-feed",
      subdomain: "stablecoin-feed",
      fqn: "reddi/market-intel/stablecoin-feed",
      title: "Stablecoin Feed",
      category: "finance",
      version: "1.0.0",
      routing: {
        serviceUrl: "https://stablecoin-feed.example.com/",
      },
      endpoints: {
        count: 3,
        source: "pay-sh-catalog-preview",
      },
      pricing: {
        currency: "USDC",
        network: "solana",
        minUsd: 0.01,
        maxUsd: 0.05,
        hasMetering: true,
      },
      evidence: {
        operatorApprovalRef: "evidence:operator-approval:pay-sh-preview",
        publicationEvidenceRef: "evidence:publication:eligible",
        sourceHash: "source-hash-123",
      },
    });
    expect(preview.payMd).toContain("Not submitted to Pay.sh.");
    expect(preview.payMd).toContain("Live payment is disabled.");
    expect(preview.providerYaml).toContain('listed_on_pay_sh: false');
    expect(preview.providerYaml).toContain('live_payment_enabled: false');
  });

  it("blocks previews when pricing metadata is missing", () => {
    const provider: PayShCatalogProvider = {
      ...validProvider,
      min_price_usd: undefined,
      max_price_usd: undefined,
      has_free_tier: undefined,
    };
    const preview = buildPayShProviderSpecPreview(previewInput(provider));

    expect(preview.status).toBe("blocked");
    expect(preview.blockers.map((item) => item.code)).toContain("catalog_diagnostic_blocker");
    expect(preview.blockers.map((item) => item.diagnosticCode)).toContain("missing_price");
    expect(preview.payMd).toBeUndefined();
    expect(preview.providerYaml).toBeUndefined();
  });

  it("blocks previews when the endpoint boundary is invalid", () => {
    const preview = buildPayShProviderSpecPreview(
      previewInput({
        ...validProvider,
        service_url: "http://stablecoin-feed.example.com",
        endpoint_count: 0,
      })
    );

    expect(preview.status).toBe("blocked");
    expect(preview.blockers.map((item) => item.code)).toContain("invalid_endpoint");
    expect(preview.blockers.map((item) => item.diagnosticCode)).toEqual(expect.arrayContaining(["zero_endpoints", "unstable_provider_url"]));
  });

  it("blocks previews for unsupported Pay.sh categories", () => {
    const preview = buildPayShProviderSpecPreview(
      previewInput({
        ...validProvider,
        category: "unknown_vendor_category",
      })
    );

    expect(preview.status).toBe("blocked");
    expect(preview.blockers).toContainEqual({
      code: "unsupported_category",
      detail: "Pay.sh preview category 'unknown_vendor_category' is not in RAP's supported provider spec export set.",
    });
  });

  it("blocks previews for unsafe metadata", () => {
    const preview = buildPayShProviderSpecPreview(
      previewInput({
        ...validProvider,
        category: "credential_tools",
      })
    );

    expect(preview.status).toBe("blocked");
    expect(preview.blockers).toContainEqual({
      code: "unsafe_metadata",
      diagnosticCode: "unsafe_category_use_case",
      detail: "Pay.sh catalog provider category or use case is unsafe for marketplace publication without separate review.",
    });
  });

  it("blocks previews without operator approval evidence", () => {
    const input = previewInput();
    const preview = buildPayShProviderSpecPreview({
      ...input,
      operatorApproval: {
        approved: false,
        evidenceRef: "",
      },
    });

    expect(preview.status).toBe("blocked");
    expect(preview.blockers).toContainEqual({
      code: "operator_approval_missing",
      detail: "Pay.sh provider spec preview requires explicit operator approval evidence.",
    });
  });

  it("blocks previews when the RAP listing is not publication eligible", () => {
    const input = previewInput();
    const preview = buildPayShProviderSpecPreview({
      ...input,
      publication: {
        status: "blocked",
        evidenceRef: "evidence:publication:blocked",
      },
    });

    expect(preview.status).toBe("blocked");
    expect(preview.blockers).toContainEqual({
      code: "publication_ineligible",
      detail: "Pay.sh provider spec preview requires a publication-eligible RAP listing.",
    });
  });
});
