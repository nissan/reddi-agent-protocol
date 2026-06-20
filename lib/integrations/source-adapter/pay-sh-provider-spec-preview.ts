import { type PayShCatalogDiagnostic, type ReddiPayShCandidate } from "@/lib/integrations/source-adapter/profiles/pay-sh";

export type PayShProviderSpecPreviewBlockerCode =
  | "catalog_diagnostic_blocker"
  | "missing_pricing"
  | "invalid_endpoint"
  | "unsupported_category"
  | "unsafe_metadata"
  | "operator_approval_missing"
  | "publication_ineligible";

export type PayShProviderSpecPreviewBlocker = {
  code: PayShProviderSpecPreviewBlockerCode;
  detail: string;
  diagnosticCode?: PayShCatalogDiagnostic["code"];
};

export type PayShProviderSpecPreviewInput = {
  candidate: ReddiPayShCandidate;
  listing: {
    name: string;
    subdomain: string;
    version: string;
    title?: string;
    description?: string;
    operatorNotes?: string[];
  };
  operatorApproval?: {
    approved: boolean;
    evidenceRef: string;
  };
  publication: {
    status: "eligible" | "blocked";
    evidenceRef?: string;
  };
};

export type PayShProviderSpecPreview = {
  status: "preview_ready" | "blocked";
  providerFqn: string;
  boundaries: {
    submittedToPaySh: false;
    listedOnPaySh: false;
    sandboxTested: false;
    livePaymentEnabled: false;
  };
  blockers: PayShProviderSpecPreviewBlocker[];
  payMd?: string;
  providerYaml?: string;
  spec?: {
    name: string;
    subdomain: string;
    fqn: string;
    title: string;
    description: string;
    category: string;
    version: string;
    routing: {
      serviceUrl: string;
    };
    endpoints: {
      count: number;
      source: "pay-sh-catalog-preview";
    };
    pricing: {
      currency: "USDC";
      network: "solana";
      minUsd: number;
      maxUsd: number;
      hasFreeTier: boolean;
      hasMetering: boolean;
    };
    operatorNotes: string[];
    evidence: {
      operatorApprovalRef: string;
      publicationEvidenceRef?: string;
      sourceHash?: string;
    };
    previewState: {
      submittedToPaySh: false;
      listedOnPaySh: false;
      sandboxTested: false;
      livePaymentEnabled: false;
    };
  };
};

const SUPPORTED_PAY_SH_PREVIEW_CATEGORIES = new Set([
  "ai_ml",
  "compute",
  "data",
  "finance",
  "messaging",
  "media",
  "shopping",
  "solana_infrastructure",
]);

const PREVIEW_BOUNDARIES = {
  submittedToPaySh: false,
  listedOnPaySh: false,
  sandboxTested: false,
  livePaymentEnabled: false,
} as const;

function yamlString(value: string) {
  return JSON.stringify(value);
}

function yamlList(items: string[], indent: string) {
  if (items.length === 0) return `${indent}[]`;
  return items.map((item) => `${indent}- ${yamlString(item)}`).join("\n");
}

function buildProviderYaml(spec: NonNullable<PayShProviderSpecPreview["spec"]>) {
  return [
    `name: ${yamlString(spec.name)}`,
    `subdomain: ${yamlString(spec.subdomain)}`,
    `fqn: ${yamlString(spec.fqn)}`,
    `title: ${yamlString(spec.title)}`,
    `description: ${yamlString(spec.description)}`,
    `category: ${yamlString(spec.category)}`,
    `version: ${yamlString(spec.version)}`,
    "routing:",
    `  service_url: ${yamlString(spec.routing.serviceUrl)}`,
    "endpoints:",
    `  count: ${spec.endpoints.count}`,
    `  source: ${yamlString(spec.endpoints.source)}`,
    "pricing:",
    `  currency: ${yamlString(spec.pricing.currency)}`,
    `  network: ${yamlString(spec.pricing.network)}`,
    `  min_usd: ${spec.pricing.minUsd}`,
    `  max_usd: ${spec.pricing.maxUsd}`,
    `  has_free_tier: ${spec.pricing.hasFreeTier}`,
    `  has_metering: ${spec.pricing.hasMetering}`,
    "operator_notes:",
    yamlList(spec.operatorNotes, "  "),
    "evidence:",
    `  operator_approval_ref: ${yamlString(spec.evidence.operatorApprovalRef)}`,
    spec.evidence.publicationEvidenceRef ? `  publication_evidence_ref: ${yamlString(spec.evidence.publicationEvidenceRef)}` : undefined,
    spec.evidence.sourceHash ? `  source_hash: ${yamlString(spec.evidence.sourceHash)}` : undefined,
    "preview_state:",
    "  submitted_to_pay_sh: false",
    "  listed_on_pay_sh: false",
    "  sandbox_tested: false",
    "  live_payment_enabled: false",
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");
}

function buildPayMd(spec: NonNullable<PayShProviderSpecPreview["spec"]>) {
  return [
    `# ${spec.title}`,
    "",
    spec.description,
    "",
    "## Pay.sh Preview Boundary",
    "",
    "- Not submitted to Pay.sh.",
    "- Not listed on Pay.sh.",
    "- Not sandbox-tested by RAP.",
    "- Live payment is disabled.",
    "",
    "## Provider",
    "",
    `- FQN: ${spec.fqn}`,
    `- Category: ${spec.category}`,
    `- Version: ${spec.version}`,
    `- Service URL: ${spec.routing.serviceUrl}`,
    `- Endpoints: ${spec.endpoints.count}`,
    `- Pricing: ${spec.pricing.currency} ${spec.pricing.minUsd}-${spec.pricing.maxUsd} on ${spec.pricing.network}`,
  ].join("\n");
}

function collectBlockers(input: PayShProviderSpecPreviewInput): PayShProviderSpecPreviewBlocker[] {
  const { candidate } = input;
  const blockers: PayShProviderSpecPreviewBlocker[] = [];

  for (const diagnostic of candidate.diagnostics) {
    if (diagnostic.severity !== "blocker") continue;
    blockers.push({
      code: diagnostic.code === "unsafe_category_use_case" ? "unsafe_metadata" : "catalog_diagnostic_blocker",
      diagnosticCode: diagnostic.code,
      detail: diagnostic.detail,
    });
  }

  if (!SUPPORTED_PAY_SH_PREVIEW_CATEGORIES.has(candidate.category)) {
    blockers.push({
      code: "unsupported_category",
      detail: `Pay.sh preview category '${candidate.category}' is not in RAP's supported provider spec export set.`,
    });
  }

  if (!candidate.serviceUrl || candidate.endpointCount <= 0) {
    blockers.push({
      code: "invalid_endpoint",
      detail: "Pay.sh provider spec preview requires a normalized HTTPS service URL and at least one endpoint.",
    });
  }

  if (!candidate.pricing.hasFreeTier && candidate.pricing.minUsd <= 0 && candidate.pricing.maxUsd <= 0) {
    blockers.push({
      code: "missing_pricing",
      detail: "Pay.sh provider spec preview requires explicit pricing metadata or a declared free tier.",
    });
  }

  if (input.operatorApproval?.approved !== true || input.operatorApproval.evidenceRef.trim().length === 0) {
    blockers.push({
      code: "operator_approval_missing",
      detail: "Pay.sh provider spec preview requires explicit operator approval evidence.",
    });
  }

  if (input.publication.status !== "eligible") {
    blockers.push({
      code: "publication_ineligible",
      detail: "Pay.sh provider spec preview requires a publication-eligible RAP listing.",
    });
  }

  return blockers;
}

export function buildPayShProviderSpecPreview(input: PayShProviderSpecPreviewInput): PayShProviderSpecPreview {
  const blockers = collectBlockers(input);

  if (blockers.length > 0) {
    return {
      status: "blocked",
      providerFqn: input.candidate.providerFqn,
      boundaries: PREVIEW_BOUNDARIES,
      blockers,
    };
  }

  const operatorApprovalRef = input.operatorApproval?.evidenceRef ?? "";
  const serviceUrl = input.candidate.serviceUrl ?? "";

  const spec: NonNullable<PayShProviderSpecPreview["spec"]> = {
    name: input.listing.name,
    subdomain: input.listing.subdomain,
    fqn: input.candidate.providerFqn,
    title: input.listing.title ?? input.candidate.providerName,
    description: input.listing.description ?? `${input.candidate.providerName} Pay.sh-compatible provider preview.`,
    category: input.candidate.category,
    version: input.listing.version,
    routing: {
      serviceUrl,
    },
    endpoints: {
      count: input.candidate.endpointCount,
      source: "pay-sh-catalog-preview",
    },
    pricing: input.candidate.pricing,
    operatorNotes: [
      ...(input.listing.operatorNotes ?? []),
      "Preview only: RAP has not submitted this provider to Pay.sh.",
      "Preview only: RAP has not run Pay.sh sandbox testing or enabled live payment.",
    ],
    evidence: {
      operatorApprovalRef,
      publicationEvidenceRef: input.publication.evidenceRef,
      sourceHash: input.candidate.sourceMetadata.sourceHash,
    },
    previewState: PREVIEW_BOUNDARIES,
  };

  return {
    status: "preview_ready",
    providerFqn: input.candidate.providerFqn,
    boundaries: PREVIEW_BOUNDARIES,
    blockers: [],
    spec,
    payMd: buildPayMd(spec),
    providerYaml: buildProviderYaml(spec),
  };
}
