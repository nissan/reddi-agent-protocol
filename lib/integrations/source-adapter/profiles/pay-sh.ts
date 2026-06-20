import { SOURCE_ADAPTER_VERSION, type SourceAdapterManifest, type SourceAdapterRole } from "@/lib/integrations/source-adapter/schema";

export const PAY_SH_SOURCE_ID = "pay-sh" as const;

export type PayShProviderCategory =
  | "ai_ml"
  | "compute"
  | "data"
  | "finance"
  | "messaging"
  | "media"
  | "shopping"
  | "solana_infrastructure"
  | string;

export type PayShCatalogProvider = {
  fqn: string;
  title: string;
  description?: string;
  use_case?: string;
  category?: PayShProviderCategory;
  service_url?: string;
  sandbox_service_url?: string;
  detail_url?: string;
  docs_url?: string;
  openapi_url?: string;
  payment_rails?: string[];
  networks?: string[];
  endpoint_count?: number;
  has_metering?: boolean;
  has_free_tier?: boolean;
  min_price_usd?: number;
  max_price_usd?: number;
  sha?: string;
};

export type PayShDevnetSupportState = "provider_declared" | "challenge_detected" | "unknown";
export type PayShCatalogSupportState =
  | "catalog_visible"
  | "pay_sh_compatible_unknown"
  | "sandbox_untested"
  | "dry_run_only"
  | "live_disabled";
export type PayShCatalogDiagnosticCode =
  | "missing_price"
  | "zero_endpoints"
  | "missing_openapi_detail"
  | "unsupported_rail_network"
  | "unstable_provider_url"
  | "unsafe_category_use_case"
  | "malformed_provider_identity";

export type PayShCatalogDiagnostic = {
  code: PayShCatalogDiagnosticCode;
  severity: "warning" | "blocker";
  detail: string;
};

export type PayShEnvironmentCapabilities = {
  sandbox: {
    supported: true;
    network: "localnet";
    defaultRpcUrl: "https://402.surfnet.dev:8899";
    localRpcUrl: "http://localhost:8899";
    command: "pay --sandbox curl <sandbox endpoint>";
    funding: "surfpool_fake_sol_usdc";
    providerSandboxServiceUrl?: string;
    notes: string[];
  };
  devnet: {
    support: PayShDevnetSupportState;
    network: "devnet";
    detection: "provider_metadata" | "payment_challenge" | "not_detected";
    notes: string[];
  };
  mainnet: {
    supported: true;
    network: "mainnet";
    livePaymentAllowed: false;
    requirements: string[];
  };
};

export type ReddiPayShCandidate = {
  candidateId: string;
  source: typeof PAY_SH_SOURCE_ID;
  providerFqn: string;
  providerName: string;
  serviceUrl?: string;
  sourceMetadata: {
    sourceUrl: "https://pay.sh/api/catalog";
    sourceHash?: string;
    rawProviderFqn: string;
  };
  category: string;
  taskTypes: string[];
  endpointCount: number;
  pricing: {
    currency: "USDC";
    network: "solana";
    minUsd: number;
    maxUsd: number;
    hasFreeTier: boolean;
    hasMetering: boolean;
  };
  environmentCapabilities: PayShEnvironmentCapabilities;
  supportStates: PayShCatalogSupportState[];
  diagnostics: PayShCatalogDiagnostic[];
  sourceAdapter: SourceAdapterManifest;
  attestationState: "externally_listed_unattested";
  trustNotes: string[];
};

export const PAY_SH_SOURCE_PROFILE = {
  source: PAY_SH_SOURCE_ID,
  roles: ["specialist", "consumer"] as SourceAdapterRole[],
  runtimes: ["http", "mcp", "pay-cli", "x402", "mpp", "solana-usdc"],
  defaultPaymentPolicy: "x402_required" as const,
  defaultAttestationState: "externally_listed_unattested" as const,
  capabilityHints: {
    specialist: ["pay-sh", "x402", "mpp", "paid-api", "solana-usdc", "external-service"],
    consumer: ["discover", "quote", "pay", "verify-receipt", "mcp"],
  },
};

const CATEGORY_TASK_TYPES: Record<string, string[]> = {
  ai_ml: ["ai-inference", "model-api", "media-generation"],
  compute: ["developer-tooling", "infrastructure", "rpc"],
  data: ["research", "data-enrichment"],
  finance: ["market-data", "financial-analysis"],
  messaging: ["communications", "email", "workflow-automation"],
  media: ["media-generation", "creative-generation"],
  shopping: ["shopping", "ecommerce-intelligence"],
  solana_infrastructure: ["solana-infrastructure", "rpc", "onchain-data"],
};

export function mapPayShCategoryToTaskTypes(category: PayShProviderCategory | undefined) {
  if (!category) return ["external-api"];
  return CATEGORY_TASK_TYPES[category] ?? ["external-api"];
}

function stableCandidateId(fqn: string) {
  return `${PAY_SH_SOURCE_ID}:${fqn.replace(/\//g, ":").replace(/[^a-zA-Z0-9:-]+/g, "-").replace(/^[:\-]+|[:\-]+$/g, "").toLowerCase()}`;
}

function validHttpsUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function hasNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function providerMentionsDevnet(provider: PayShCatalogProvider) {
  return [provider.fqn, provider.title, provider.description, provider.use_case, provider.category, provider.service_url]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes("devnet"));
}

function declaresUnsupportedRailOrNetwork(provider: PayShCatalogProvider) {
  const rails = provider.payment_rails?.map((item) => item.toLowerCase().trim()).filter(Boolean) ?? [];
  const networks = provider.networks?.map((item) => item.toLowerCase().trim()).filter(Boolean) ?? [];
  const unsupportedRails = rails.some((rail) => rail !== "x402" && rail !== "mpp");
  const unsupportedNetworks =
    networks.length > 0 && networks.some((network) => network !== "solana" && network !== "localnet" && network !== "devnet" && network !== "mainnet");
  return unsupportedRails || unsupportedNetworks;
}

function hasUnsafePayShCategoryOrUseCase(provider: PayShCatalogProvider) {
  const haystack = [provider.category, provider.use_case, provider.description, provider.title]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /(^|[^a-z0-9])(adult|gambling|credential|credentials|surveillance|weapon|exploit|malware|phishing)([^a-z0-9]|$)/.test(
    haystack
  );
}

export function getPayShCatalogDiagnostics(provider: PayShCatalogProvider): PayShCatalogDiagnostic[] {
  const diagnostics: PayShCatalogDiagnostic[] = [];
  const hasPrice =
    provider.has_free_tier === true ||
    Number.isFinite(provider.min_price_usd) ||
    Number.isFinite(provider.max_price_usd);

  if (!hasNonEmptyString(provider.fqn) || !hasNonEmptyString(provider.title)) {
    diagnostics.push({
      code: "malformed_provider_identity",
      severity: "blocker",
      detail: "Pay.sh catalog provider requires non-empty fqn and title before RAP can use it as a source candidate.",
    });
  }

  if (!hasPrice) {
    diagnostics.push({
      code: "missing_price",
      severity: "blocker",
      detail: "Pay.sh catalog provider does not declare price or free-tier metadata.",
    });
  }

  if (!Number.isFinite(provider.endpoint_count) || (provider.endpoint_count ?? 0) <= 0) {
    diagnostics.push({
      code: "zero_endpoints",
      severity: "blocker",
      detail: "Pay.sh catalog provider does not declare at least one callable endpoint.",
    });
  }

  if (!hasNonEmptyString(provider.openapi_url) && !hasNonEmptyString(provider.detail_url) && !hasNonEmptyString(provider.docs_url)) {
    diagnostics.push({
      code: "missing_openapi_detail",
      severity: "warning",
      detail: "Pay.sh catalog provider does not expose OpenAPI, detail, or docs metadata in the fixture.",
    });
  }

  if (declaresUnsupportedRailOrNetwork(provider)) {
    diagnostics.push({
      code: "unsupported_rail_network",
      severity: "blocker",
      detail: "Pay.sh catalog provider declares payment rail or network metadata outside RAP's Pay.sh x402/MPP Solana boundary.",
    });
  }

  if (!validHttpsUrl(provider.service_url)) {
    diagnostics.push({
      code: "unstable_provider_url",
      severity: "blocker",
      detail: "Pay.sh catalog provider service URL is missing, malformed, or non-HTTPS.",
    });
  }

  if (hasUnsafePayShCategoryOrUseCase(provider)) {
    diagnostics.push({
      code: "unsafe_category_use_case",
      severity: "blocker",
      detail: "Pay.sh catalog provider category or use case is unsafe for marketplace publication without separate review.",
    });
  }

  return diagnostics;
}

export function getPayShCatalogSupportStates(): PayShCatalogSupportState[] {
  return ["catalog_visible", "pay_sh_compatible_unknown", "sandbox_untested", "dry_run_only", "live_disabled"];
}

export function buildPayShEnvironmentCapabilities(provider: PayShCatalogProvider): PayShEnvironmentCapabilities {
  const sandboxServiceUrl = provider.sandbox_service_url?.trim() || undefined;
  const devnetDeclared = providerMentionsDevnet(provider);

  return {
    sandbox: {
      supported: true,
      network: "localnet",
      defaultRpcUrl: "https://402.surfnet.dev:8899",
      localRpcUrl: "http://localhost:8899",
      command: "pay --sandbox curl <sandbox endpoint>",
      funding: "surfpool_fake_sol_usdc",
      providerSandboxServiceUrl: sandboxServiceUrl,
      notes: [
        sandboxServiceUrl
          ? "Provider metadata includes a sandbox_service_url; use it for no-real-funds pre-go-live tests."
          : "No provider sandbox_service_url is declared; use Pay.sh debugger/demo flows or RAP mocks for provider payloads.",
        "Sandbox maps to Pay.sh localnet/Surfpool, not Solana devnet.",
        "Sandbox tests must not create mainnet wallets, top up funds, or invoke real paid provider calls.",
      ],
    },
    devnet: {
      support: devnetDeclared ? "provider_declared" : "unknown",
      network: "devnet",
      detection: devnetDeclared ? "provider_metadata" : "not_detected",
      notes: devnetDeclared
        ? [
            "Provider metadata mentions devnet; verify the actual x402/MPP challenge before treating devnet as supported.",
            "Devnet support is provider/challenge-dependent and is not implied for all Pay.sh providers.",
          ]
        : [
            "No devnet support detected in provider metadata.",
            "Only enable devnet if a provider declares it or a payment challenge identifies Solana devnet.",
          ],
    },
    mainnet: {
      supported: true,
      network: "mainnet",
      livePaymentAllowed: false,
      requirements: [
        "explicit_user_approval_per_experiment",
        "endpoint_allowlist",
        "tiny_spend_cap",
        "receipt_capture",
        "rap_attestation_before_trust_credit",
      ],
    },
  };
}

export function buildPayShSourceManifest(input: {
  role: Extract<SourceAdapterRole, "specialist" | "consumer">;
  runtime?: "http" | "mcp" | "pay-cli";
  taskTypes: string[];
  inputModes?: string[];
  outputModes?: string[];
}): SourceAdapterManifest {
  return {
    version: SOURCE_ADAPTER_VERSION,
    source: PAY_SH_SOURCE_ID,
    role: input.role,
    runtime: input.runtime ?? "http",
    capabilities: {
      taskTypes: input.taskTypes,
      inputModes: input.inputModes ?? ["json", "text"],
      outputModes: input.outputModes ?? ["json"],
    },
    paymentPolicy: PAY_SH_SOURCE_PROFILE.defaultPaymentPolicy,
    failurePolicy: {
      maxRetries: 0,
      refundOnFailure: false,
    },
  };
}

export function payShCatalogProviderToCandidate(provider: PayShCatalogProvider): ReddiPayShCandidate {
  const category = provider.category ?? "unknown";
  const taskTypes = mapPayShCategoryToTaskTypes(category);
  const minUsd = Math.max(0, provider.min_price_usd ?? 0);
  const maxUsd = Math.max(minUsd, provider.max_price_usd ?? minUsd);
  const serviceUrl = validHttpsUrl(provider.service_url);
  const sourceHash = provider.sha?.trim() || undefined;
  const diagnostics = getPayShCatalogDiagnostics(provider);

  return {
    candidateId: stableCandidateId(provider.fqn),
    source: PAY_SH_SOURCE_ID,
    providerFqn: provider.fqn,
    providerName: provider.title,
    serviceUrl,
    sourceMetadata: {
      sourceUrl: "https://pay.sh/api/catalog",
      sourceHash,
      rawProviderFqn: provider.fqn,
    },
    category,
    taskTypes,
    endpointCount: provider.endpoint_count ?? 0,
    pricing: {
      currency: "USDC",
      network: "solana",
      minUsd,
      maxUsd,
      hasFreeTier: provider.has_free_tier === true || minUsd === 0,
      hasMetering: provider.has_metering === true,
    },
    environmentCapabilities: buildPayShEnvironmentCapabilities(provider),
    supportStates: getPayShCatalogSupportStates(),
    diagnostics,
    sourceAdapter: buildPayShSourceManifest({
      role: "specialist",
      runtime: "http",
      taskTypes,
    }),
    attestationState: PAY_SH_SOURCE_PROFILE.defaultAttestationState,
    trustNotes: [
      "Imported from Pay.sh catalog as external Solana x402/MPP metadata.",
      "Not RAP-attested until a RAP attestor verifies output, receipt, and evidence.",
      "Preview only: RAP has not created a Pay.sh wallet, top-up, or paid API call for this candidate.",
      "Pay.sh support state is catalog-visible/dry-run-only/live-disabled until RAP evidence gates approve a narrower claim.",
      ...(diagnostics.length ? ["Pay.sh catalog diagnostics do not upgrade trust, settlement, reputation, or publication readiness."] : []),
      ...(serviceUrl ? [] : ["Provider service URL is missing or non-HTTPS, so live probing stays disabled."]),
      ...(sourceHash ? [] : ["Pay.sh catalog source hash is missing, so fixture provenance is incomplete."]),
    ],
  };
}
