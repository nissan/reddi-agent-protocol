/**
 * #384 — AI onboarding assistant intake flow (UI adapter).
 *
 * Thin, pure adapter between the guided intake UI (`/onboarding/intake`) and
 * the shipped #575 analyser-handoff contracts + #576 onboarding state machine.
 * It contains NO new validation logic: every acceptance/rejection decision is
 * made by `validateOnboardingIntakeDescriptor` / `runOnboardingAnalyserHandoff`
 * (`reddi.onboarding-*.v1`), and the resulting draft read model comes from
 * `createOnboardingAssistantReadModel` (`reddi.onboarding-state-machine.v1`).
 *
 * Boundary (per docs/DISCOVER-DECIDE-PROVE-BOUNDARIES.md):
 * - Analysis is static/fixture-backed. Nothing here fetches, probes, invokes,
 *   publishes, pays, or stores secrets. Live endpoint inspection is NOT yet
 *   enabled — issue #459 owns the future live source adapter.
 * - Operator-supplied URLs are recorded as untrusted source references only
 *   and are validated (public HTTPS, no private hosts, no credential-shaped
 *   material) by the #575 validators before any fixture-backed analysis runs.
 */

import {
  ONBOARDING_ANALYSER_GUARDRAILS,
  ONBOARDING_INTAKE_DESCRIPTOR_SCHEMA_VERSION,
  runOnboardingAnalyserHandoff,
  type OnboardingAnalyserHandoffSuccess,
  type OnboardingDeclaredCapability,
  type OnboardingDeclaredPaymentMetadata,
  type OnboardingIntakeValidationError,
  type OnboardingSourceKind,
} from "@reddi/agent-protocol/onboarding-analyser-handoff";
import {
  createOnboardingAssistantReadModel,
  listOnboardingStateTransitions,
  type OnboardingAssistantReadModel,
  type OnboardingAssistantState,
  type OnboardingBlockingGate,
  type OnboardingGateReasonCode,
} from "@reddi/agent-protocol/onboarding-state-machine";

export const INTAKE_FLOW_VIEW_SCHEMA_VERSION = "reddi.onboarding-intake-flow-view.v1" as const;
export const INTAKE_FLOW_ISSUE = 384 as const;
/** Issue that owns the future live endpoint/source adapter. Not built here. */
export const INTAKE_LIVE_ADAPTER_ISSUE = 459 as const;

/** Deterministic dry-run timestamp: the #575 fixture capture date. */
export const INTAKE_DRYRUN_TIMESTAMP = "2026-07-06T00:00:00Z" as const;

export { ONBOARDING_ANALYSER_GUARDRAILS };

// ---------------------------------------------------------------------------
// Source options (issue #384 acceptance criteria -> OnboardingSourceKind)
// ---------------------------------------------------------------------------

export type IntakeSourceOptionId =
  | "endpoint-url"
  | "ai-catalog-url"
  | "mcp-card-url"
  | "openapi-url"
  | "a2a-card-url"
  | "manual-seed";

export type IntakeSourceOption = {
  id: IntakeSourceOptionId;
  label: string;
  description: string;
  inputMode: "url" | "manual";
  sourceKind: OnboardingSourceKind;
  placeholder?: string;
};

/**
 * The six intake inputs required by #384, each mapped onto an
 * `OnboardingSourceKind` from the #575 contract. A bare endpoint URL has no
 * card/descriptor document to snapshot, so it maps onto `manual-descriptor`
 * with the URL recorded as the declared endpoint — live inspection of the
 * endpoint itself is deferred to the #459 adapter.
 */
export const INTAKE_SOURCE_OPTIONS: readonly IntakeSourceOption[] = Object.freeze([
  {
    id: "endpoint-url",
    label: "Endpoint URL",
    description:
      "A bare service endpoint. Recorded as a manual profile seed with a declared endpoint; the endpoint is never called during intake.",
    inputMode: "url",
    sourceKind: "manual-descriptor",
    placeholder: "https://api.example.com/agent",
  },
  {
    id: "ai-catalog-url",
    label: "AI Catalog URL",
    description: "A /.well-known/ai-catalog.json entry (ARD). Catalog relevance is never treated as trust.",
    inputMode: "url",
    sourceKind: "ard-ai-catalog",
    placeholder: "https://example.com/.well-known/ai-catalog.json",
  },
  {
    id: "mcp-card-url",
    label: "MCP card URL",
    description: "MCP server metadata (tools, prompts). Imported tool text is data, never instructions.",
    inputMode: "url",
    sourceKind: "mcp-metadata",
    placeholder: "https://example.com/mcp/server-card.json",
  },
  {
    id: "openapi-url",
    label: "OpenAPI URL",
    description: "An OpenAPI description for an HTTP service.",
    inputMode: "url",
    sourceKind: "openapi",
    placeholder: "https://example.com/openapi.json",
  },
  {
    id: "a2a-card-url",
    label: "A2A card URL",
    description: "An A2A agent card.",
    inputMode: "url",
    sourceKind: "a2a-card",
    placeholder: "https://example.com/.well-known/agent-card.json",
  },
  {
    id: "manual-seed",
    label: "Manual profile seed",
    description: "Type the profile yourself. Operator-provided fields are marked user_provided, never verified.",
    inputMode: "manual",
    sourceKind: "manual-descriptor",
  },
] as const);

export function getIntakeSourceOption(id: IntakeSourceOptionId): IntakeSourceOption {
  const option = INTAKE_SOURCE_OPTIONS.find((candidate) => candidate.id === id);
  if (!option) throw new Error(`unknown intake source option: ${id}`);
  return option;
}

// ---------------------------------------------------------------------------
// Dry-run fixture snapshots (static — nothing is ever fetched)
// ---------------------------------------------------------------------------

const FIXTURE_PAYMENT: OnboardingDeclaredPaymentMetadata = {
  settlementAddress: "FixtureSettlementAddress1111111111111111111",
  network: "solana-devnet",
  price: "2.50",
  currency: "AUDD",
};

type IntakeDryRunFixture = {
  displayName: string;
  description: string;
  capabilities: OnboardingDeclaredCapability[];
  includePayment: boolean;
  includeEndpoint: boolean;
};

/**
 * Static declared-metadata snapshots keyed by source kind, mirroring the #575
 * golden fixture matrix shapes. Because no live probe exists tonight, the
 * "analysis" of any URL renders THIS fixture-backed pathway; the operator's
 * URL is only recorded (and validated) as the untrusted source reference.
 */
const INTAKE_DRYRUN_FIXTURES: Record<OnboardingSourceKind, IntakeDryRunFixture> = {
  "mcp-metadata": {
    displayName: "Fixture MCP server",
    description: "Static MCP server metadata snapshot used by the #384 dry-run pathway.",
    capabilities: [
      {
        name: "list-issues",
        description: "Read and list issues from a public tracker.",
        inputShape: '{ "repo": "string" }',
        outputShape: '{ "issues": "array" }',
        sideEffectHint: "read",
      },
      {
        name: "summarize-thread",
        description: "Summarize a discussion thread.",
        inputShape: '{ "threadUrl": "string" }',
        outputShape: '{ "summary": "string" }',
        sideEffectHint: "none",
      },
    ],
    includePayment: true,
    includeEndpoint: true,
  },
  openapi: {
    displayName: "Fixture OpenAPI service",
    description: "Static OpenAPI description snapshot used by the #384 dry-run pathway.",
    capabilities: [
      {
        name: "summarize-document",
        description: "Summarize a provided document into key points.",
        inputShape: '{ "document": "string" }',
        outputShape: '{ "summary": "string" }',
        sideEffectHint: "none",
      },
    ],
    includePayment: true,
    includeEndpoint: true,
  },
  "a2a-card": {
    displayName: "Fixture A2A agent",
    description: "Static A2A agent card snapshot used by the #384 dry-run pathway.",
    capabilities: [
      {
        name: "translate-text",
        description: "Translate text between declared language pairs.",
        inputShape: '{ "text": "string", "target": "string" }',
        outputShape: '{ "translation": "string" }',
        sideEffectHint: "none",
      },
    ],
    includePayment: true,
    includeEndpoint: true,
  },
  "ard-ai-catalog": {
    displayName: "Fixture AI Catalog entry",
    description: "Static ARD/AI Catalog entry snapshot used by the #384 dry-run pathway.",
    capabilities: [
      {
        name: "classify-support-ticket",
        description: "Classify a support ticket into a routing category.",
        inputShape: '{ "ticket": "string" }',
        outputShape: '{ "category": "string" }',
        sideEffectHint: "none",
      },
    ],
    includePayment: true,
    includeEndpoint: true,
  },
  "manual-descriptor": {
    displayName: "Fixture manual seed",
    description: "Manual profile seed placeholder used by the #384 dry-run pathway.",
    capabilities: [],
    includePayment: false,
    includeEndpoint: false,
  },
  "static-agent-stack-snapshot": {
    displayName: "Fixture agent-stack snapshot",
    description: "Static agent-stack fixture snapshot (#402/#414 lane).",
    capabilities: [
      {
        name: "repo-skill:release-notes",
        description: "Draft release notes from repository metadata.",
        inputShape: '{ "tag": "string" }',
        outputShape: '{ "notes": "string" }',
        sideEffectHint: "read",
      },
    ],
    includePayment: false,
    includeEndpoint: false,
  },
};

/**
 * Dry-run fixture routing markers. Because intake never performs a live
 * probe, these URL markers deterministically select which static fixture
 * variant the analysis step renders. They are labelled in the UI and exist
 * so every #384 state is reachable without any network call.
 */
export const INTAKE_DRYRUN_URL_MARKERS = Object.freeze({
  /** Hostname or path containing this renders the empty/no-results fixture. */
  empty: "empty",
  /** Hostname or path containing this simulates a retryable analyser interruption. */
  unreachable: "unreachable",
} as const);

function urlHasMarker(rawUrl: string, marker: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.includes(marker) || parsed.pathname.includes(marker);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Form input -> intake descriptor (candidate; validated by #575, not by us)
// ---------------------------------------------------------------------------

export type IntakeManualSeedInput = {
  displayName: string;
  description: string;
  contactRef?: string;
  /** One capability per line: `name — description` or just `name`. */
  capabilityLines: string;
  endpointUrl?: string;
};

export type IntakeFormInput = {
  optionId: IntakeSourceOptionId;
  /** Required for url-mode options. */
  sourceUrl?: string;
  /** Required for the manual-seed option. */
  manualSeed?: IntakeManualSeedInput;
};

export function parseManualCapabilityLines(lines: string): OnboardingDeclaredCapability[] {
  return lines
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, ...rest] = line.split("—");
      const description = rest.join("—").trim();
      return {
        name: name.trim(),
        ...(description.length > 0 ? { description } : {}),
      };
    });
}

function slugForOption(optionId: IntakeSourceOptionId): string {
  return `ui-intake-${optionId}`;
}

/**
 * Build the candidate intake descriptor for the #575 validator. This function
 * deliberately performs no validation of its own — malformed URLs, private
 * hosts, credential-shaped material, and trust claims are all rejected by
 * `validateOnboardingIntakeDescriptor` inside the handoff.
 */
export function buildIntakeDescriptorCandidate(input: IntakeFormInput): unknown {
  const option = getIntakeSourceOption(input.optionId);
  const slug = slugForOption(input.optionId);
  const snapshotRef = `fixtures/onboarding/ui-intake/${slug}.json`;

  if (option.inputMode === "manual") {
    const seed = input.manualSeed;
    const capabilities = parseManualCapabilityLines(seed?.capabilityLines ?? "");
    return {
      schemaVersion: ONBOARDING_INTAKE_DESCRIPTOR_SCHEMA_VERSION,
      intakeId: slug,
      sourceKind: option.sourceKind,
      ingestionMode: "static-fixture",
      source: {
        snapshotRef,
        crawlTimestamp: INTAKE_DRYRUN_TIMESTAMP,
      },
      declaredMetadata: {
        capabilities,
        ...(seed?.endpointUrl && seed.endpointUrl.trim().length > 0
          ? { endpointUrls: [seed.endpointUrl.trim()] }
          : {}),
      },
      operatorProvided: {
        ...(seed?.displayName && seed.displayName.trim().length > 0 ? { displayName: seed.displayName.trim() } : {}),
        ...(seed?.description && seed.description.trim().length > 0 ? { description: seed.description.trim() } : {}),
        ...(seed?.contactRef && seed.contactRef.trim().length > 0 ? { contactRef: seed.contactRef.trim() } : {}),
      },
      staticOnly: true,
    };
  }

  const rawUrl = (input.sourceUrl ?? "").trim();
  const fixture = INTAKE_DRYRUN_FIXTURES[option.sourceKind];
  const emptyVariant = urlHasMarker(rawUrl, INTAKE_DRYRUN_URL_MARKERS.empty);
  const isBareEndpoint = input.optionId === "endpoint-url";

  const capabilities = emptyVariant ? [] : isBareEndpoint ? [] : fixture.capabilities;

  return {
    schemaVersion: ONBOARDING_INTAKE_DESCRIPTOR_SCHEMA_VERSION,
    intakeId: slug,
    sourceKind: option.sourceKind,
    ingestionMode: "static-fixture",
    source: {
      sourceUrl: rawUrl,
      snapshotRef,
      crawlTimestamp: INTAKE_DRYRUN_TIMESTAMP,
    },
    declaredMetadata: {
      ...(isBareEndpoint
        ? {}
        : {
            displayName: fixture.displayName,
            description: fixture.description,
          }),
      capabilities,
      ...((isBareEndpoint || fixture.includeEndpoint) && !emptyVariant ? { endpointUrls: [rawUrl] } : {}),
      ...(fixture.includePayment && !emptyVariant && !isBareEndpoint
        ? {
            paymentMetadata: FIXTURE_PAYMENT,
            authHints: ["api-key header (name only, no value)"],
            pricingHints: ["per-call flat rate"],
          }
        : {}),
    },
    ...(isBareEndpoint
      ? {
          operatorProvided: {
            displayName: "Endpoint-only seed",
            description: "Bare endpoint URL recorded as a manual profile seed; metadata pending operator input.",
          },
        }
      : {}),
    staticOnly: true,
  };
}

// ---------------------------------------------------------------------------
// Analysis outcome (classified from #575 validator errors — no new rules)
// ---------------------------------------------------------------------------

export type IntakeAnalysisOutcome =
  | {
      status: "analysed";
      handoff: OnboardingAnalyserHandoffSuccess;
      readModel: OnboardingAssistantReadModel;
      nextStates: readonly OnboardingAssistantState[];
    }
  | {
      status: "empty";
      handoff: OnboardingAnalyserHandoffSuccess;
      readModel: OnboardingAssistantReadModel | null;
      nextStates: readonly OnboardingAssistantState[];
    }
  | { status: "invalid_url"; errors: OnboardingIntakeValidationError[] }
  | { status: "blocked_secret"; errors: OnboardingIntakeValidationError[] }
  | { status: "blocked"; errors: OnboardingIntakeValidationError[] }
  | { status: "analyser_error"; retryable: true; message: string };

const URL_ERROR_PATH_PATTERN = /sourceUrl|endpointUrls|termsUrl/;

function classifyIntakeErrors(errors: OnboardingIntakeValidationError[]): IntakeAnalysisOutcome {
  if (errors.some((error) => error.code === "credential_leakage_rejected")) {
    return { status: "blocked_secret", errors };
  }
  const allUrlShaped = errors.every(
    (error) =>
      (error.code === "private_url_blocked" || error.code === "malformed_intake_descriptor") &&
      URL_ERROR_PATH_PATTERN.test(error.path),
  );
  if (errors.length > 0 && allUrlShaped) {
    return { status: "invalid_url", errors };
  }
  return { status: "blocked", errors };
}

function buildDraftReadModel(
  handoff: OnboardingAnalyserHandoffSuccess,
): { readModel: OnboardingAssistantReadModel | null; nextStates: readonly OnboardingAssistantState[] } {
  // Every #575 fail-closed reason is also a #576 gate reason code by design.
  const readinessGateReasons: OnboardingGateReasonCode[] = [...handoff.readiness.failClosedReasons];
  const blockingGates: OnboardingBlockingGate[] = [
    {
      gate: "operator_approval",
      reasonCodes: ["operator_approval_pending"],
      note: "Operator review is required before anything becomes public, payable, or trusted.",
    },
    ...(handoff.readiness.overall === "blocked"
      ? [
          {
            gate: "readiness" as const,
            reasonCodes:
              readinessGateReasons.length > 0
                ? readinessGateReasons
                : (["readiness_blocked"] as OnboardingGateReasonCode[]),
            note: "Readiness lanes fail closed until the missing inputs are supplied.",
          },
        ]
      : []),
  ];

  const init = createOnboardingAssistantReadModel({
    draftId: `draft:${handoff.intake.intakeId}`,
    sourceSnapshotRef: handoff.intake.source.snapshotRef,
    readinessResultRef: handoff.readiness.profileRef,
    readinessOverall: handoff.readiness.overall,
    createdAt: INTAKE_DRYRUN_TIMESTAMP,
    blockingGates,
  });
  if (!init.ok) {
    return { readModel: null, nextStates: [] };
  }
  return { readModel: init.readModel, nextStates: listOnboardingStateTransitions(init.readModel.state) };
}

/**
 * Run the fixture-backed dry-run analysis. Pure and deterministic: the same
 * input and attempt number always produce the same outcome. `attempt` exists
 * only for the simulated-interruption fixture (URL marker `unreachable`),
 * which fails retryably on the first attempt and succeeds on retry — a
 * clearly-labelled dry-run stand-in until the #459 live adapter exists.
 */
export function runIntakeDryRunAnalysis(input: IntakeFormInput, attempt = 1): IntakeAnalysisOutcome {
  const option = getIntakeSourceOption(input.optionId);

  if (
    option.inputMode === "url" &&
    urlHasMarker((input.sourceUrl ?? "").trim(), INTAKE_DRYRUN_URL_MARKERS.unreachable) &&
    attempt <= 1
  ) {
    return {
      status: "analyser_error",
      retryable: true,
      message:
        "Simulated analyser interruption (dry-run fixture). No live request was made — retry re-runs the same static analysis.",
    };
  }

  const candidate = buildIntakeDescriptorCandidate(input);
  const result = runOnboardingAnalyserHandoff(candidate);
  if (!result.ok) {
    return classifyIntakeErrors(result.errors);
  }

  const { readModel, nextStates } = buildDraftReadModel(result);
  if (result.capabilityInventory.entries.length === 0) {
    return { status: "empty", handoff: result, readModel, nextStates };
  }
  if (!readModel) {
    // Fail closed rather than rendering a success view without a draft state.
    return {
      status: "blocked",
      errors: [
        {
          code: "malformed_intake_descriptor",
          path: "$.readModel",
          message: "the onboarding state machine rejected the draft read model; intake fails closed",
        },
      ],
    };
  }
  return { status: "analysed", handoff: result, readModel, nextStates };
}
