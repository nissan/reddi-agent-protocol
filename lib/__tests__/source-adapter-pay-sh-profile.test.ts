import {
  buildPayShEnvironmentCapabilities,
  buildPayShSourceManifest,
  mapPayShCategoryToTaskTypes,
  payShCatalogProviderToCandidate,
  PAY_SH_SOURCE_PROFILE,
  type PayShCatalogProvider,
} from "@/lib/integrations/source-adapter/profiles/pay-sh";
import { getSourceProfile } from "@/lib/integrations/source-adapter/profiles";
import { validateSourceAdapterManifest } from "@/lib/integrations/source-adapter/schema";

describe("source adapter pay-sh profile", () => {
  it("is discoverable via source registry", () => {
    const profile = getSourceProfile("pay-sh");
    expect(profile).toBeTruthy();
    expect(profile?.source).toBe("pay-sh");
    expect(profile?.roles).toContain("specialist");
    expect(profile?.roles).toContain("consumer");
  });

  it("maps Pay.sh categories into RAP task types", () => {
    expect(mapPayShCategoryToTaskTypes("finance")).toEqual(["market-data", "financial-analysis"]);
    expect(mapPayShCategoryToTaskTypes("messaging")).toEqual(["communications", "email", "workflow-automation"]);
    expect(mapPayShCategoryToTaskTypes("UNKNOWN_VENDOR_CATEGORY")).toEqual(["external-api"]);
  });

  it("builds a valid Pay.sh specialist manifest", () => {
    const manifest = buildPayShSourceManifest({
      role: "specialist",
      runtime: "mcp",
      taskTypes: ["market-data"],
    });

    const validation = validateSourceAdapterManifest(manifest);
    expect(validation.ok).toBe(true);
    expect(manifest.source).toBe(PAY_SH_SOURCE_PROFILE.source);
    expect(manifest.paymentPolicy).toBe("x402_required");
  });

  it("converts a Pay.sh catalog provider into an unattested RAP specialist candidate", () => {
    const provider: PayShCatalogProvider = {
      fqn: "merit-systems/stablecrypto/market-data",
      title: "StableCrypto",
      description: "Market data APIs",
      category: "finance",
      service_url: "https://stablecrypto.dev",
      endpoint_count: 105,
      has_metering: true,
      has_free_tier: false,
      min_price_usd: 0.01,
      max_price_usd: 0.01,
      sha: "2858c649a49c995a",
    };

    const candidate = payShCatalogProviderToCandidate(provider);

    expect(candidate.candidateId).toBe("pay-sh:merit-systems:stablecrypto:market-data");
    expect(candidate.providerName).toBe("StableCrypto");
    expect(candidate.serviceUrl).toBe("https://stablecrypto.dev/");
    expect(candidate.sourceMetadata).toEqual({
      sourceUrl: "https://pay.sh/api/catalog",
      sourceHash: "2858c649a49c995a",
      rawProviderFqn: "merit-systems/stablecrypto/market-data",
    });
    expect(candidate.taskTypes).toEqual(["market-data", "financial-analysis"]);
    expect(candidate.pricing).toMatchObject({
      currency: "USDC",
      network: "solana",
      minUsd: 0.01,
      maxUsd: 0.01,
      hasMetering: true,
    });
    expect(candidate.environmentCapabilities.sandbox).toMatchObject({
      supported: true,
      network: "localnet",
      defaultRpcUrl: "https://402.surfnet.dev:8899",
      localRpcUrl: "http://localhost:8899",
      funding: "surfpool_fake_sol_usdc",
    });
    expect(candidate.environmentCapabilities.devnet.support).toBe("unknown");
    expect(candidate.environmentCapabilities.mainnet).toMatchObject({
      supported: true,
      network: "mainnet",
      livePaymentAllowed: false,
    });
    expect(candidate.attestationState).toBe("externally_listed_unattested");
    expect(validateSourceAdapterManifest(candidate.sourceAdapter).ok).toBe(true);
    expect(candidate.trustNotes.join(" ")).toContain("Not RAP-attested");
  });

  it("fails closed for missing source hash, missing price, missing endpoint count, and non-HTTPS service URLs", () => {
    const candidate = payShCatalogProviderToCandidate({
      fqn: "unsafe/provider",
      title: "Unsafe Provider",
      category: "data",
      service_url: "http://unsafe.example.com",
    });

    expect(candidate.serviceUrl).toBeUndefined();
    expect(candidate.endpointCount).toBe(0);
    expect(candidate.pricing).toMatchObject({
      minUsd: 0,
      maxUsd: 0,
      hasFreeTier: true,
      hasMetering: false,
    });
    expect(candidate.sourceMetadata).toEqual({
      sourceUrl: "https://pay.sh/api/catalog",
      sourceHash: undefined,
      rawProviderFqn: "unsafe/provider",
    });
    expect(candidate.attestationState).toBe("externally_listed_unattested");
    expect(candidate.trustNotes.join(" ")).toContain("non-HTTPS");
    expect(candidate.trustNotes.join(" ")).toContain("source hash is missing");
  });

  it("preserves provider sandbox URLs for Pay.sh sandbox/localnet testing", () => {
    const capabilities = buildPayShEnvironmentCapabilities({
      fqn: "example/provider",
      title: "Example Provider",
      category: "data",
      service_url: "https://api.example.com",
      sandbox_service_url: "https://sandbox.example.com",
    });

    expect(capabilities.sandbox.providerSandboxServiceUrl).toBe("https://sandbox.example.com");
    expect(capabilities.sandbox.notes.join(" ")).toContain("sandbox_service_url");
    expect(capabilities.sandbox.notes.join(" ")).toContain("localnet/Surfpool");
  });

  it("marks devnet as provider-declared only when metadata says so", () => {
    const capabilities = buildPayShEnvironmentCapabilities({
      fqn: "quicknode/rpc",
      title: "QuickNode",
      description: "Pay-per-request RPC with Solana devnet support.",
      category: "compute",
      service_url: "https://x402.quicknode.com",
    });

    expect(capabilities.devnet).toMatchObject({
      support: "provider_declared",
      network: "devnet",
      detection: "provider_metadata",
    });
    expect(capabilities.devnet.notes.join(" ")).toContain("challenge");
  });
});
