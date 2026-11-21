/**
 * MCP Tool Interface for Reddi Agent Protocol
 *
 * Core tools that any agent framework (ElizaOS, OpenAI Agents SDK,
 * LangChain, CrewAI, custom) can call to access the specialist marketplace:
 *
 * 1. register_consumer      — register consumer wallet + preferred integration mode
 * 2. resolve_specialist     — find the best specialist for a task
 * 3. resolve_attestor       — pick a judge/attestor candidate
 * 4. invoke_specialist      — execute a paid call against a specialist
 * 5. submit_quality_signal  — rate a completed run (triggers rep commit)
 * 6. decide_settlement      — release/dispute after output evaluation
 *
 * Transport: HTTP POST endpoints at /api/planner/tools/*
 * Auth: optional x-reddi-agent-key header (env: REDDI_AGENT_API_KEY)
 *
 * Compatible with:
 * - OpenAI Agents SDK (function_call / tool_call)
 * - ElizaOS action plugins
 * - Any framework that supports HTTP tool endpoints
 * - Direct REST calls from orchestrator agents
 */

export type ResolveInput = {
  /** Plain-language description of what's needed */
  task: string;
  /** Optional taxonomy ID hint (e.g. "summarize", "code") */
  taskTypeHint?: string;
  /** Explicit runtime capabilities required to fulfill the request */
  required_capabilities?: string[];
  /** Optional attestor-verifiable checkpoints required from specialist disclosure metadata */
  required_attestor_checkpoints?: string[];
  /** Optional quality-claim markers required from specialist disclosure metadata */
  required_quality_claims?: string[];
  /** Optional sort preference for the final candidate ordering */
  sortBy?: "ranking" | "reputation" | "cost" | "feedback";
  /** Optional discovery filters (parity with /api/registry) */
  taskType?: string;
  inputMode?: string;
  privacyMode?: string;
  runtimeCap?: string;
  attested?: boolean;
  health?: "pass" | "fail" | "pending";
  tag?: string;
  tags?: string[];
  /** Policy overrides — merged with saved orchestrator policy */
  policy?: {
    maxPerCallUsd?: number;
    requireAttestation?: boolean;
    preferredPrivacyMode?: "public" | "per" | "vanish";
    minReputation?: number;
    preferredSource?: "openclaw" | "hermes" | "pi" | "circle-x402" | "pay-sh";
    strictSourceMatch?: boolean;
  };
};

export type ResolveOutput = {
  ok: boolean;
  candidate: {
    walletAddress: string;
    endpointUrl: string;
    taskTypes: string[];
    privacyModes: string[];
    perCallUsd: number;
    attested: boolean;
    healthStatus: string;
    reputationScore: number;
    avgFeedbackScore: number;
    selectionReasons: string[];
    sourceRouting?: {
      requestedSource: "openclaw" | "hermes" | "pi" | "circle-x402" | "pay-sh" | null;
      candidateSource: "openclaw" | "hermes" | "pi" | "circle-x402" | "pay-sh" | null;
      strictSourceMatch: boolean;
      scoreDelta: number;
      decisionTrace: string[];
    };
  } | null;
  alternativeCount: number;
  alternatives?: Array<{
    walletAddress: string;
    endpointUrl: string;
    score: number;
    selectionReasons: string[];
    sourceRouting?: {
      requestedSource: "openclaw" | "hermes" | "pi" | "circle-x402" | "pay-sh" | null;
      candidateSource: "openclaw" | "hermes" | "pi" | "circle-x402" | "pay-sh" | null;
      strictSourceMatch: boolean;
      scoreDelta: number;
      decisionTrace: string[];
    };
  }>;
  appliedFilters?: {
    sortBy: "ranking" | "reputation" | "cost" | "feedback";
    taskType?: string;
    inputMode?: string;
    privacyMode?: string;
    runtimeCap?: string;
    attested?: boolean;
    health?: "pass" | "fail" | "pending";
    tag?: string;
    tags?: string[];
  };
  resolveDiagnostics?: {
    totalListings: number;
    acceptedCount: number;
    rejectedBy: {
      sourcePolicy: number;
      health: number;
      attestation: number;
      reputation: number;
      cost: number;
      capabilities: number;
      endpoint: number;
      disclosure: number;
    };
    rejectedWalletSamples: {
      sourcePolicy: string[];
      health: string[];
      attestation: string[];
      reputation: string[];
      cost: string[];
      capabilities: string[];
      endpoint: string[];
      disclosure: string[];
    };
  };
  error?: string;
};

export type InvokeInput = {
  /** The prompt / task content to send to the specialist */
  prompt: string;
  /** Optional: target a specific specialist wallet */
  targetWallet?: string;
  /** Consumer wallet address — used for Torque event attribution */
  consumerWallet?: string;
  /** Optional integration hint for consumer orchestration mode */
  integrationMode?: "default" | "openonion";
  /** Optional retry budget for OpenOnion consumer failover */
  retryBudget?: number;
  /** Policy overrides */
  policy?: {
    maxPerCallUsd?: number;
    requireAttestation?: boolean;
    preferredPrivacyMode?: "public" | "per" | "vanish";
  };
};

export type InvokeOutput = {
  ok: boolean;
  runId?: string;
  response?: string;
  specialistWallet?: string;
  x402TxSignature?: string;
  paymentSatisfied?: boolean;
  durationMs?: number;
  error?: string;
};

export type RegisterConsumerInput = {
  walletAddress: string;
  preferredIntegration?: "mcp" | "tools" | "skills";
  metadata?: {
    agentName?: string;
    framework?: string;
  };
};

export type ResolveAttestorInput = {
  taskTypeHint?: string;
  minAttestationAccuracy?: number;
  maxPerCallUsd?: number;
};

export type SettlementDecisionInput = {
  runId: string;
  decision: "release" | "dispute";
  notes?: string;
  consumerWallet?: string;
};

export type QualitySignalInput = {
  /** Run ID from invoke_specialist */
  runId: string;
  /** Score 1–10 */
  score: number;
  /** Optional consumer wallet used to update consumer reputation profile */
  consumerWallet?: string;
  /** Optional text notes */
  notes?: string;
  /** Whether outcome matched attestation expectations */
  agreesWithAttestation?: boolean;
  /** Optional OpenOnion attestor payload for schema-gated validation */
  attestorPayload?: unknown;
};

export type QualitySignalOutput = {
  ok: boolean;
  reputationCommitted: boolean;
  reputationTxSignature?: string;
  error?: string;
};

// ── OpenAI function-call schema definitions ──────────────────────────────────

export const MCP_TOOL_SCHEMAS = [
  {
    name: "register_consumer",
    description:
      "Register a consumer wallet and integration preference (MCP, tools, or skills) before planner execution.",
    parameters: {
      type: "object",
      properties: {
        walletAddress: {
          type: "string",
          description: "Consumer wallet address used for identity and attribution.",
        },
        preferredIntegration: {
          type: "string",
          enum: ["mcp", "tools", "skills"],
          description: "Preferred integration mode for the orchestrator.",
        },
        metadata: {
          type: "object",
          properties: {
            agentName: { type: "string" },
            framework: { type: "string" },
          },
        },
      },
      required: ["walletAddress"],
    },
  },
  {
    name: "resolve_specialist",
    description:
      "Find the best available specialist agent for a given task. Returns the top candidate with capability details, pricing, and selection reasons. Call this before invoke_specialist to select who to hire.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Plain-language description of the task you need performed.",
        },
        taskTypeHint: {
          type: "string",
          enum: ["summarize","classify","extract","generate","analyze","code","translate","qa","plan","review","search","embed","transcribe","vision","custom"],
          description: "Optional task category hint to improve candidate matching.",
        },
        required_capabilities: {
          type: "array",
          items: { type: "string" },
          description: "Runtime capabilities required from the specialist.",
        },
        required_attestor_checkpoints: {
          type: "array",
          items: { type: "string" },
          description: "Optional attestor-verifiable checkpoints that must be disclosed by the specialist.",
        },
        required_quality_claims: {
          type: "array",
          items: { type: "string" },
          description: "Optional quality claim markers that must be present in specialist disclosure metadata.",
        },
        sortBy: {
          type: "string",
          enum: ["ranking", "reputation", "cost", "feedback"],
          description: "Optional ordering preference for candidate ranking.",
        },
        taskType: { type: "string", description: "Filter by task type taxonomy id." },
        inputMode: { type: "string", description: "Filter by input mode taxonomy id." },
        privacyMode: { type: "string", description: "Filter by required privacy mode." },
        runtimeCap: { type: "string", description: "Filter by runtime capability id." },
        attested: { type: "boolean", description: "Require attested specialists." },
        health: { type: "string", enum: ["pass", "fail", "pending"] },
        tag: { type: "string", description: "Filter by single capability tag." },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Filter by any matching capability tags.",
        },
        policy: {
          type: "object",
          properties: {
            maxPerCallUsd: { type: "number", description: "Maximum price per call in USD." },
            requireAttestation: { type: "boolean", description: "Only use attested specialists." },
            preferredPrivacyMode: { type: "string", enum: ["public","per","vanish"] },
            minReputation: { type: "number", description: "Minimum on-chain reputation score." },
            preferredSource: {
              type: "string",
              enum: ["openclaw", "hermes", "pi", "circle-x402", "pay-sh"],
              description: "Optional source-ecosystem preference for candidate routing.",
            },
            strictSourceMatch: {
              type: "boolean",
              description: "When true, only candidates tagged to preferredSource are eligible.",
            },
          },
        },
      },
      required: ["task"],
    },
  },
  {
    name: "resolve_attestor",
    description:
      "Find an attested specialist suitable to act as an attestor/judge for post-execution verification.",
    parameters: {
      type: "object",
      properties: {
        taskTypeHint: { type: "string" },
        minAttestationAccuracy: { type: "number" },
        maxPerCallUsd: { type: "number" },
      },
    },
  },
  {
    name: "invoke_specialist",
    description:
      "Execute a task against a specialist agent. Handles x402 payment negotiation automatically. Returns the specialist's response and a run receipt. Optionally targets a specific specialist by wallet address.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The task prompt to send to the specialist.",
        },
        targetWallet: {
          type: "string",
          description: "Optional: target a specific specialist by wallet address. If omitted, the best candidate is selected automatically.",
        },
        policy: {
          type: "object",
          properties: {
            maxPerCallUsd: { type: "number" },
            requireAttestation: { type: "boolean" },
            preferredPrivacyMode: { type: "string", enum: ["public","per","vanish"] },
          },
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "submit_quality_signal",
    description:
      "Rate a completed specialist call (1–10). Scores ≥3 trigger an on-chain blind reputation commit. Call this after invoke_specialist to contribute to specialist reputation.",
    parameters: {
      type: "object",
      properties: {
        runId: {
          type: "string",
          description: "The run ID returned by invoke_specialist.",
        },
        score: {
          type: "number",
          description: "Quality score from 1 (worst) to 10 (best).",
          minimum: 1,
          maximum: 10,
        },
        consumerWallet: {
          type: "string",
          description: "Optional consumer wallet used to update consumer reputation (baseline 3/5, rolling thereafter).",
        },
        notes: {
          type: "string",
          description: "Optional notes about the result quality.",
        },
        agreesWithAttestation: {
          type: "boolean",
          description: "Whether the result matched your expectations given the specialist's attestation.",
        },
      },
      required: ["runId", "score"],
    },
  },
  {
    name: "decide_settlement",
    description:
      "After evaluating specialist output, record release or dispute decision for a paid run.",
    parameters: {
      type: "object",
      properties: {
        runId: { type: "string", description: "Run ID returned by invoke_specialist." },
        decision: { type: "string", enum: ["release", "dispute"] },
        notes: { type: "string" },
        consumerWallet: { type: "string" },
      },
      required: ["runId", "decision"],
    },
  },
];

// ── ElizaOS action manifest ───────────────────────────────────────────────────

export const ELIZA_ACTION_MANIFEST = {
  plugin: "@redditech/eliza-specialist-marketplace",
  version: "1.0.0",
  actions: [
    {
      name: "REGISTER_CONSUMER",
      description: "Register consumer wallet and integration preference.",
      endpoint: "/api/planner/tools/register-consumer",
      method: "POST",
    },
    {
      name: "RESOLVE_SPECIALIST",
      description: "Find the best specialist agent for a capability need.",
      endpoint: "/api/planner/tools/resolve",
      method: "POST",
    },
    {
      name: "RESOLVE_ATTESTOR",
      description: "Find an attestor/judge specialist candidate.",
      endpoint: "/api/planner/tools/resolve-attestor",
      method: "POST",
    },
    {
      name: "INVOKE_SPECIALIST",
      description: "Hire and execute a specialist agent call with automatic x402 payment.",
      endpoint: "/api/planner/tools/invoke",
      method: "POST",
    },
    {
      name: "SUBMIT_QUALITY_SIGNAL",
      description: "Submit quality feedback for a completed specialist call.",
      endpoint: "/api/planner/tools/signal",
      method: "POST",
    },
    {
      name: "DECIDE_SETTLEMENT",
      description: "Record release/dispute decision after output evaluation.",
      endpoint: "/api/planner/tools/release",
      method: "POST",
    },
  ],
};
