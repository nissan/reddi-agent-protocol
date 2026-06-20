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
  endpoint_count?: number;
  has_metering?: boolean;
  has_free_tier?: boolean;
  min_price_usd?: number;
  max_price_usd?: number;
  sha?: string;
};

export type PayShDevnetSupportState = "provider_declared" | "challenge_detected" | "unknown";

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

function providerMentionsDevnet(provider: PayShCatalogProvider) {
  return [provider.fqn, provider.title, provider.description, provider.use_case, provider.category, provider.service_url]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes("devnet"));
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
      ...(serviceUrl ? [] : ["Provider service URL is missing or non-HTTPS, so live probing stays disabled."]),
      ...(sourceHash ? [] : ["Pay.sh catalog source hash is missing, so fixture provenance is incomplete."]),
    ],
  };
}
