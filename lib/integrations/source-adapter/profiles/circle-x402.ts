import { SOURCE_ADAPTER_VERSION, type SourceAdapterManifest, type SourceAdapterRole } from "@/lib/integrations/source-adapter/schema";

export const CIRCLE_X402_SOURCE_ID = "circle-x402" as const;

export type CircleX402Category =
  | "FINANCIAL_ANALYSIS"
  | "SOCIAL_INTELLIGENCE"
  | "WEB_SEARCH_RESEARCH"
  | "PREDICTION_MARKETS"
  | "CREATIVE"
  | "INFRASTRUCTURE"
  | string;

export type CircleX402PaymentRequirement = {
  scheme?: string;
  network?: string;
  asset?: string;
  maxAmountRequired?: string;
  payTo?: string;
};

export type CircleX402SupportState =
  | "discovery_visible"
  | "externally_listed_unattested"
  | "x402_required"
  | "dry_run_quote_preview"
  | "live_payment_disabled";

export type CircleX402DiagnosticCode =
  | "no_payment_requirements"
  | "missing_price"
  | "missing_payee"
  | "unsupported_network"
  | "malformed_resource";

export type CircleX402Diagnostic = {
  code: CircleX402DiagnosticCode;
  severity: "warning" | "blocker";
  detail: string;
};

export type CircleX402DiscoveryResource = {
  resource: string;
  type?: "http" | "mcp" | string;
  x402Version?: number;
  accepts?: CircleX402PaymentRequirement[];
  metadata?: {
    provider?: {
      name?: string;
      description?: string;
      category?: CircleX402Category;
      tags?: string[];
      website?: string;
      docsUrl?: string;
      openApiUrl?: string;
    };
    description?: string;
    supportsCircleGateway?: boolean;
    supportsVanillax402?: boolean;
  };
};

export type ReddiCircleX402Candidate = {
  candidateId: string;
  source: typeof CIRCLE_X402_SOURCE_ID;
  providerName: string;
  resource: string;
  category: string;
  taskTypes: string[];
  sourceAdapter: SourceAdapterManifest;
  payment: Array<{
    rail: "circle_gateway" | "vanilla_x402";
    scheme: string;
    network: string;
    asset?: string;
    payTo?: string;
    maxAmountRequired?: string;
    priceUsdc?: number;
  }>;
  supportStates: CircleX402SupportState[];
  diagnostics: CircleX402Diagnostic[];
  attestationState: "externally_listed_unattested";
  trustNotes: string[];
};

export const CIRCLE_X402_SOURCE_PROFILE = {
  source: CIRCLE_X402_SOURCE_ID,
  roles: ["specialist", "consumer"] as SourceAdapterRole[],
  runtimes: ["http", "circle-gateway", "vanilla-x402"],
  defaultPaymentPolicy: "x402_required" as const,
  defaultAttestationState: "externally_listed_unattested" as const,
  capabilityHints: {
    specialist: ["x402", "paid-api", "external-service", "circle-discovery"],
    consumer: ["discover", "quote", "pay", "verify-receipt"],
  },
};

const CATEGORY_TASK_TYPES: Record<string, string[]> = {
  FINANCIAL_ANALYSIS: ["financial-analysis", "market-data"],
  SOCIAL_INTELLIGENCE: ["social-intelligence", "profile-analysis"],
  WEB_SEARCH_RESEARCH: ["research", "web-search"],
  PREDICTION_MARKETS: ["prediction-market-analysis", "forecasting"],
  CREATIVE: ["creative-generation"],
  INFRASTRUCTURE: ["infrastructure", "developer-tooling"],
};

const SUPPORTED_CIRCLE_X402_NETWORKS = new Set([
  "eip155:8453",
  "eip155:84532",
  "base",
  "base-sepolia",
]);

export function mapCircleX402CategoryToTaskTypes(category: CircleX402Category | undefined) {
  if (!category) return ["external-api"];
  return CATEGORY_TASK_TYPES[category] ?? ["external-api"];
}

function parseUsdcSubunits(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  return Number(value) / 1_000_000;
}

function hasNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function stableCandidateId(resource: string) {
  try {
    const url = new URL(resource);
    const pathSlug = url.pathname
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    return `${CIRCLE_X402_SOURCE_ID}:${url.hostname}:${pathSlug || "root"}`;
  } catch {
    const fallback = resource
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    return `${CIRCLE_X402_SOURCE_ID}:malformed:${fallback || "resource"}`;
  }
}

export function buildCircleX402SourceManifest(input: {
  role: Extract<SourceAdapterRole, "specialist" | "consumer">;
  runtime?: "http" | "circle-gateway" | "vanilla-x402";
  taskTypes: string[];
  inputModes?: string[];
  outputModes?: string[];
}): SourceAdapterManifest {
  return {
    version: SOURCE_ADAPTER_VERSION,
    source: CIRCLE_X402_SOURCE_ID,
    role: input.role,
    runtime: input.runtime ?? "http",
    capabilities: {
      taskTypes: input.taskTypes,
      inputModes: input.inputModes ?? ["json", "text"],
      outputModes: input.outputModes ?? ["json"],
    },
    paymentPolicy: CIRCLE_X402_SOURCE_PROFILE.defaultPaymentPolicy,
    failurePolicy: {
      maxRetries: 0,
      refundOnFailure: false,
    },
  };
}

export function getCircleX402SupportStates(): CircleX402SupportState[] {
  return [
    "discovery_visible",
    "externally_listed_unattested",
    "x402_required",
    "dry_run_quote_preview",
    "live_payment_disabled",
  ];
}

export function getCircleX402Diagnostics(resource: CircleX402DiscoveryResource): CircleX402Diagnostic[] {
  const diagnostics: CircleX402Diagnostic[] = [];
  const accepts = resource.accepts ?? [];

  try {
    const url = new URL(resource.resource);
    if (url.protocol !== "https:") {
      diagnostics.push({
        code: "malformed_resource",
        severity: "blocker",
        detail: "Circle x402 resource must be an HTTPS URL before route preview or invocation.",
      });
    }
  } catch {
    diagnostics.push({
      code: "malformed_resource",
      severity: "blocker",
      detail: "Circle x402 resource URL is malformed.",
    });
  }

  if (accepts.length === 0) {
    diagnostics.push({
      code: "no_payment_requirements",
      severity: "blocker",
      detail: "Circle x402 resource does not declare any payment requirements.",
    });
    return diagnostics;
  }

  if (accepts.some((accept) => parseUsdcSubunits(accept.maxAmountRequired) === undefined)) {
    diagnostics.push({
      code: "missing_price",
      severity: "blocker",
      detail: "Circle x402 payment requirement is missing a numeric maxAmountRequired value.",
    });
  }

  if (accepts.some((accept) => !hasNonEmptyString(accept.payTo))) {
    diagnostics.push({
      code: "missing_payee",
      severity: "blocker",
      detail: "Circle x402 payment requirement is missing a payTo address.",
    });
  }

  const unsupportedNetworks = accepts
    .map((accept) => accept.network?.trim())
    .filter((network): network is string => Boolean(network))
    .filter((network) => !SUPPORTED_CIRCLE_X402_NETWORKS.has(network.toLowerCase()));
  if (unsupportedNetworks.length > 0 || accepts.some((accept) => !hasNonEmptyString(accept.network))) {
    diagnostics.push({
      code: "unsupported_network",
      severity: "blocker",
      detail: `Circle x402 payment network is unsupported or missing: ${unsupportedNetworks.join(", ") || "missing"}.`,
    });
  }

  return diagnostics;
}

export function circleX402DiscoveryResourceToCandidate(resource: CircleX402DiscoveryResource): ReddiCircleX402Candidate {
  const category = resource.metadata?.provider?.category ?? "UNKNOWN";
  const taskTypes = mapCircleX402CategoryToTaskTypes(category);
  const supportsCircleGateway = resource.metadata?.supportsCircleGateway === true;
  const diagnostics = getCircleX402Diagnostics(resource);

  return {
    candidateId: stableCandidateId(resource.resource),
    source: CIRCLE_X402_SOURCE_ID,
    providerName: resource.metadata?.provider?.name ?? "Unknown Circle x402 provider",
    resource: resource.resource,
    category,
    taskTypes,
    sourceAdapter: buildCircleX402SourceManifest({
      role: "specialist",
      runtime: supportsCircleGateway ? "circle-gateway" : "vanilla-x402",
      taskTypes,
    }),
    payment: (resource.accepts ?? []).map((accept) => ({
      rail: supportsCircleGateway ? "circle_gateway" : "vanilla_x402",
      scheme: accept.scheme ?? "exact",
      network: accept.network ?? "unknown",
      asset: accept.asset,
      payTo: accept.payTo,
      maxAmountRequired: accept.maxAmountRequired,
      priceUsdc: parseUsdcSubunits(accept.maxAmountRequired),
    })),
    supportStates: getCircleX402SupportStates(),
    diagnostics,
    attestationState: CIRCLE_X402_SOURCE_PROFILE.defaultAttestationState,
    trustNotes: [
      "Imported from Circle x402 Discovery as external catalog metadata.",
      "Not RAP-attested until a RAP attestor verifies output, receipt, and evidence.",
      "Circle x402 support state remains discovery-visible/dry-run-quote-preview/live-payment-disabled until RAP evidence gates approve a narrower claim.",
      ...(diagnostics.length ? ["Circle x402 diagnostics do not upgrade trust, settlement, reputation, or publication readiness."] : []),
    ],
  };
}
