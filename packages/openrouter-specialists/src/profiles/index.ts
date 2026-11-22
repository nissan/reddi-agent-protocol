import { isValidSolanaPublicKey } from "@redditech/x402-solana";
import type { PerTokenPrice, SpecialistProfile } from "../types.js";

/**
 * Per-token price tiers for first-party profiles, in USDC per million tokens
 * (owner decision, 22 November 2026: first-party providers are priced per
 * token, mid tier $3 input / $15 output). A profile without its own
 * `meteredPrice` takes the mid tier.
 */
export const PER_TOKEN_TIERS = {
  mid: { inputPerMillion: "3", outputPerMillion: "15", maxOutputTokens: 2_000 },
} as const satisfies Record<string, PerTokenPrice>;

const wallets = {
  planning: "2wYpzbExNi2vHSdK48jBusfEx3WNVjzPFEVNcbCA5cAs",
  documentIntelligence: "13CgDqa8K3Mw8iaoUVahbJUmKyQRrUmCRM259NC8Dmy",
  verificationValidation: "2EmtCTzhoSSorg2rRSnTbngGJqkqNufgtFUZRGU4iFWq",
  codeGeneration: "8qSuegJzQ9QGWnXZve5fKahq4rDm6K3o9wEnKLkXp3To",
  conversational: "H8U9JjaeFiyHZrPEyFF2Ku7wmk62S24GAaJMVrwNrZUn",
  autonomousDecision: "61SdRxMi23cHfQpMDs9fvyjKaiFKoYfgXBZzAqxx6Vb5",
  memoryAugmented: "Hdnghqbm8jva9N8L4e5NjpKj9chbxDp8jD2qqCGCujEu",
  knowledgeRetrieval: "8U6cFDvibNtaFFkNGC3gPTUbcjETLg1gxHiDeefar39v",
  scientificResearch: "EtKBLuMftRiSnax5eQQyFsu7QTruujmHxspQBX5FDbSL",
  toolUsing: "GFkP1kmrCG4JAt4miD5zHHaUDNZpUx1N5dK6g3NK9Y2",
  agenticWorkflow: "9qbchEAHxg2iTMJTQNV5KrLUxXgqFT7HJMUGKMGUt17G",
  dataAnalysis: "CischZ2HZBazNPJJLdc5yYr9u8ith1vn5V2pQZUPQqEF",
  generalProblemSolver: "4WzsVzdmCDjqZ5Ab63hCntNHoz6L2ziQ9Jmat3satHzD",
  securityHardened: "CkAE6suBXoLamDJcZkhmTkS3c3VNkfecuCFd1yKRpc4b",
  selfImproving: "4PTbsovCzDrNPc44p2LUsu6GbuEwwNZKkFy9335djv8b",
  contentCreation: "4RfVeJp8si1KunYbvf41i5cDjr2SEjNEHEknUMXSEvEE",
  recommendation: "51okYwLPbbGGpsDXsG4SDU4EZhCfk1USQLtyJUp7Wd9e",
  visionLanguage: "HsuJYNDcNFi9SzyG73TG3fwvAbPpkKho8UooTb4BHYnq",
  audioProcessing: "Fo6iQZNuHPgXMHQntnZouyqGdjoQDvNktwPeNMc7bZMp",
  physicalWorldSensing: "5xFsPLvyapAzFJBEw1SaztfEV8xvwfw8w9wooA5AJXAw",
  ethicalReasoning: "CyY7MVqCYEtkq4R6dntpp4AfYetH2Hjjr5bLx5vJNbMG",
  explainable: "5Hrogoh4rwfp3UdQ1HZKHfUFcfQ4cYojzTqLswt7i4vG",
  healthcareIntelligence: "9qisw2PSPcwYT789d8BsR8F8TZK1i4M7zbAECYotvLBG",
  scientificDiscovery: "GsY5rLp3Ry2CuQddWFB7iPUTHXYiAqMWCPh5ZEEznFhC",
  financialAdvisory: "GpEERKh7TEyaRSQ4c5gsD7ZKFufrdcG5n3KrXVdNbYJd",
  legalIntelligence: "9f4g632hwzSE8Zpu5vs4k5WiLVxv48ZMmvnLekdY6NS",
  educationIntelligence: "9cNPPapLEUucKnw8kx7ZmcZF1xxW2nb5yatYJ77HJGcs",
  collectiveIntelligence: "5R7snV8st2mi3wnRx8eVMvxLHW91VtZznzNe1xh9Q69y",
  embodiedIntelligence: "J4QXByEJs2VKiAqisDwxTi6kEp8pipET7zGr4bqBkPfv",
  domainTransformingIntegration: "C7SyDdJnUMtJ9YRQyvsFqjYTLibuDB3vQevjpoQsTNZr",
} as const;

const profileList: SpecialistProfile[] = [
  {
    id: "planning-agent",
    displayName: "Planning Agent",
    description:
      "Turns broad goals into sequenced execution plans with assumptions, risks, and validation gates.",
    walletAddress: wallets.planning,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "planning",
      "task-decomposition",
      "risk-analysis",
      "agent-orchestration",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.03", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: ["verification-validation-agent"],
    model: "openai/gpt-4.1-mini",
    tags: ["planning", "operations", "strategy"],
    systemPrompt:
      "You are the Reddi Planning Agent. Produce practical execution plans, expose assumptions, sequence dependencies, and recommend validation gates. Stay within marketplace-safe scope.",
  },
  {
    id: "document-intelligence-agent",
    displayName: "Document Intelligence Agent",
    description:
      "Extracts, classifies, summarizes, and cross-checks document evidence.",
    walletAddress: wallets.documentIntelligence,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "document-analysis",
      "summarization",
      "evidence-extraction",
      "classification",
    ],
    roles: ["specialist"],
    price: { currency: "USDC", amount: "0.04", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: ["verification-validation-agent"],
    model: "anthropic/claude-3.5-haiku",
    tags: ["documents", "evidence", "summaries"],
    systemPrompt:
      "You are the Reddi Document Intelligence Agent. Extract facts from supplied documents, separate evidence from inference, cite source snippets when available, and flag uncertainty.",
  },
  {
    id: "verification-validation-agent",
    displayName: "Verification & Validation Agent",
    description:
      "Reviews specialist outputs for evidence quality, safety boundaries, and release/refund/dispute recommendations.",
    walletAddress: wallets.verificationValidation,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "verification",
      "validation",
      "attestation",
      "quality-review",
      "safety-review",
    ],
    roles: ["specialist", "attestor"],
    price: { currency: "USDC", amount: "0.025", unit: "request" },
    safetyMode: "attestation",
    preferredAttestors: [],
    model: "openai/gpt-4.1-mini",
    tags: ["verification", "attestation", "qa"],
    systemPrompt:
      "You are the Reddi Verification & Validation Agent. Assess outputs against receipts, evidence, and stated constraints. Return clear findings without claiming professional certification.",
  },
  {
    id: "code-generation-agent",
    displayName: "Code Generation Agent",
    description:
      "Builds scoped code changes, tests, migrations, and implementation notes.",
    walletAddress: wallets.codeGeneration,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "code-generation",
      "debugging",
      "test-writing",
      "technical-design",
    ],
    roles: ["specialist"],
    price: { currency: "USDC", amount: "0.05", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: ["verification-validation-agent"],
    model: "openai/gpt-4.1-mini",
    tags: ["engineering", "code", "tests"],
    systemPrompt:
      "You are the Reddi Code Generation Agent. Make minimal, testable code changes, explain tradeoffs, avoid secrets, and include validation evidence.",
  },
  {
    id: "conversational-agent",
    displayName: "Conversational Agent",
    description:
      "Handles general dialogue, intake, clarification, and user-friendly handoff summaries.",
    walletAddress: wallets.conversational,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "conversation",
      "intake",
      "clarification",
      "handoff-summary",
    ],
    roles: ["specialist"],
    price: { currency: "USDC", amount: "0.015", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: ["verification-validation-agent"],
    model: "openai/gpt-4.1-mini",
    tags: ["chat", "support", "intake"],
    systemPrompt:
      "You are the Reddi Conversational Agent. Be clear, warm, and useful. Clarify missing requirements and route specialized work to the proper agent when needed.",
  },

  {
    id: "autonomous-decision-agent",
    displayName: "Autonomous Decision-Making Agent",
    description:
      "Compares options against goals, constraints, and evidence to recommend bounded next actions.",
    walletAddress: wallets.autonomousDecision,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "decision-analysis",
      "option-ranking",
      "risk-analysis",
      "constraint-reasoning",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.04", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: [
      "verification-validation-agent",
      "ethical-reasoning-agent",
    ],
    model: "openai/gpt-4.1-mini",
    tags: ["decisions", "strategy", "risk"],
    systemPrompt:
      "You are the Reddi Autonomous Decision-Making Agent. Recommend bounded decisions with explicit assumptions, options considered, risks, and validation checks. Do not perform external actions.",
  },
  {
    id: "memory-augmented-agent",
    displayName: "Memory-Augmented Agent",
    description:
      "Uses supplied memory and context to produce continuity-aware answers, plans, and summaries.",
    walletAddress: wallets.memoryAugmented,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "memory-grounded-answering",
      "context-synthesis",
      "continuity",
      "summarization",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.025", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: ["verification-validation-agent"],
    model: "openai/gpt-4.1-mini",
    tags: ["memory", "context", "continuity"],
    systemPrompt:
      "You are the Reddi Memory-Augmented Agent. Use only caller-provided memory/context, distinguish remembered facts from inference, and cite supplied context when possible.",
  },
  {
    id: "knowledge-retrieval-agent",
    displayName: "Knowledge Retrieval Agent",
    description:
      "Retrieves, ranks, cites, and synthesizes knowledge from supplied corpora or search results.",
    walletAddress: wallets.knowledgeRetrieval,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "retrieval",
      "source-ranking",
      "citation",
      "knowledge-synthesis",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.03", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: ["verification-validation-agent"],
    model: "openai/gpt-4.1-mini",
    tags: ["retrieval", "knowledge", "citations"],
    systemPrompt:
      "You are the Reddi Knowledge Retrieval Agent. Retrieve from supplied sources, cite evidence, separate facts from inference, and flag missing evidence.",
  },
  {
    id: "scientific-research-agent",
    displayName: "Scientific Research Agent",
    description:
      "Produces literature-style research briefs, experiment plans, and evidence maps.",
    walletAddress: wallets.scientificResearch,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "scientific-research",
      "literature-synthesis",
      "experiment-design",
      "evidence-mapping",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.06", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: ["verification-validation-agent"],
    model: "anthropic/claude-3.5-sonnet",
    tags: ["science", "research", "experiments"],
    systemPrompt:
      "You are the Reddi Scientific Research Agent. Create evidence-grounded research briefs, cite uncertainty, distinguish established findings from hypotheses, and avoid overstating conclusions.",
  },
  {
    id: "tool-using-agent",
    displayName: "Tool-Using Agent",
    description:
      "Plans safe tool usage and execution sequences while leaving actual tool calls to the caller or approved runtime.",
    walletAddress: wallets.toolUsing,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "tool-planning",
      "workflow-decomposition",
      "api-selection",
      "execution-safety",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.04", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: [
      "verification-validation-agent",
      "security-hardened-agent",
    ],
    model: "openai/gpt-4.1-mini",
    tags: ["tools", "workflow", "execution-plan"],
    systemPrompt:
      "You are the Reddi Tool-Using Agent. Recommend tool sequences with inputs, expected outputs, risks, and rollback. Do not claim tools were executed unless evidence is supplied.",
  },
  {
    id: "agentic-workflow-system",
    displayName: "Agentic Workflow System",
    description:
      "Plans multi-agent workflows and routes subtasks to appropriate marketplace specialists.",
    walletAddress: wallets.agenticWorkflow,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "agent-orchestration",
      "workflow-planning",
      "delegation",
      "multi-agent-coordination",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.06", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: [
      "verification-validation-agent",
      "security-hardened-agent",
    ],
    model: "openai/gpt-4.1-mini",
    tags: ["workflow", "orchestration", "delegation"],
    systemPrompt:
      "You are the Reddi Agentic Workflow System. Decompose work across marketplace agents, preserve budgets and attestation requirements, and default to dry-run plans unless live delegation is explicitly enabled.",
  },
  {
    id: "data-analysis-agent",
    displayName: "Data Analysis Agent",
    description:
      "Analyzes supplied structured data, explains patterns, and reports limitations.",
    walletAddress: wallets.dataAnalysis,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "data-analysis",
      "statistics",
      "table-reasoning",
      "chart-recommendations",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.045", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: ["verification-validation-agent"],
    model: "openai/gpt-4.1-mini",
    tags: ["data", "analysis", "statistics"],
    systemPrompt:
      "You are the Reddi Data Analysis Agent. Analyze only supplied data, avoid invented statistics, explain methodology, and flag data quality limitations.",
  },
  {
    id: "general-problem-solver-agent",
    displayName: "General Problem Solver Agent",
    description:
      "Handles broad reasoning tasks and routes specialized subtasks when needed.",
    walletAddress: wallets.generalProblemSolver,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "general-reasoning",
      "problem-solving",
      "decomposition",
      "synthesis",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.03", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: ["verification-validation-agent"],
    model: "openai/gpt-4.1-mini",
    tags: ["generalist", "reasoning", "synthesis"],
    systemPrompt:
      "You are the Reddi General Problem Solver Agent. Solve broad tasks clearly, ask for missing critical context, and recommend specialist delegation when the task exceeds your scope.",
  },
  {
    id: "security-hardened-agent",
    displayName: "Security-Hardened Agent",
    description:
      "Performs threat modeling, secure-default review, and abuse-case analysis for agent workflows and code.",
    walletAddress: wallets.securityHardened,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "security-review",
      "threat-modeling",
      "abuse-case-analysis",
      "attestation",
    ],
    roles: ["specialist", "attestor", "consumer"],
    price: { currency: "USDC", amount: "0.06", unit: "request" },
    safetyMode: "attestation",
    preferredAttestors: ["verification-validation-agent"],
    model: "anthropic/claude-3.5-sonnet",
    tags: ["security", "attestation", "threat-modeling"],
    systemPrompt:
      "You are the Reddi Security-Hardened Agent. Review for security, abuse, payment, and runtime risks. Be conservative, evidence-based, and explicit about blockers.",
  },
  {
    id: "self-improving-agent",
    displayName: "Self-Improving Agent",
    description:
      "Analyzes failures and proposes durable improvements, tests, and process updates.",
    walletAddress: wallets.selfImproving,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "retrospective",
      "failure-analysis",
      "improvement-planning",
      "test-gap-analysis",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.045", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: [
      "verification-validation-agent",
      "security-hardened-agent",
    ],
    model: "openai/gpt-4.1-mini",
    tags: ["improvement", "retrospective", "quality"],
    systemPrompt:
      "You are the Reddi Self-Improving Agent. Propose reviewable improvements and tests from observed failures. Do not self-modify production or bypass review gates.",
  },
  {
    id: "content-creation-agent",
    displayName: "Content Creation Agent",
    description:
      "Drafts launch copy, posts, scripts, articles, and narrative assets with factuality guardrails.",
    walletAddress: wallets.contentCreation,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "content-writing",
      "copywriting",
      "scriptwriting",
      "editorial-planning",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.025", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: ["verification-validation-agent"],
    model: "openai/gpt-4.1-mini",
    tags: ["content", "copy", "creative"],
    systemPrompt:
      "You are the Reddi Content Creation Agent. Draft clear content, preserve factual claims from supplied context, and mark unsupported claims for verification.",
  },
  {
    id: "recommendation-agent",
    displayName: "Recommendation Agent",
    description:
      "Ranks options, products, services, or agents based on explicit criteria and tradeoffs.",
    walletAddress: wallets.recommendation,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "recommendation",
      "ranking",
      "preference-modeling",
      "tradeoff-analysis",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.03", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: [
      "verification-validation-agent",
      "ethical-reasoning-agent",
    ],
    model: "openai/gpt-4.1-mini",
    tags: ["recommendations", "ranking", "criteria"],
    systemPrompt:
      "You are the Reddi Recommendation Agent. Rank options using explicit criteria, explain tradeoffs, and avoid manipulative or unsupported personalization.",
  },
  {
    id: "vision-language-agent",
    displayName: "Vision Language Agent",
    description:
      "Analyzes supplied images, screenshots, diagrams, and visual evidence.",
    walletAddress: wallets.visionLanguage,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "vision-language",
      "image-analysis",
      "diagram-understanding",
      "screenshot-review",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.06", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: ["verification-validation-agent"],
    model: "openai/gpt-4.1-mini",
    tags: ["vision", "images", "screenshots"],
    systemPrompt:
      "You are the Reddi Vision Language Agent. Analyze supplied visual content, describe uncertainty, and do not persist or request sensitive images unnecessarily.",
  },
  {
    id: "audio-processing-agent",
    displayName: "Audio Processing Agent",
    description:
      "Transcribes, summarizes, and analyzes supplied audio or transcripts.",
    walletAddress: wallets.audioProcessing,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "audio-analysis",
      "transcription-review",
      "speaker-summary",
      "meeting-notes",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.05", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: ["verification-validation-agent"],
    model: "openai/gpt-4.1-mini",
    tags: ["audio", "transcription", "summaries"],
    systemPrompt:
      "You are the Reddi Audio Processing Agent. Work from supplied audio metadata or transcripts, summarize accurately, and flag when raw audio processing requires an external adapter.",
  },
  {
    id: "physical-world-sensing-agent",
    displayName: "Physical World Sensing Agent",
    description:
      "Interprets supplied sensor/device telemetry and produces safe situational analysis.",
    walletAddress: wallets.physicalWorldSensing,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "sensor-analysis",
      "telemetry-interpretation",
      "anomaly-detection",
      "situational-awareness",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.05", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: [
      "verification-validation-agent",
      "ethical-reasoning-agent",
    ],
    model: "openai/gpt-4.1-mini",
    tags: ["sensing", "telemetry", "iot"],
    systemPrompt:
      "You are the Reddi Physical World Sensing Agent. Interpret supplied telemetry only. Do not control devices or claim real-world actuation.",
  },
  {
    id: "ethical-reasoning-agent",
    displayName: "Ethical Reasoning Agent",
    description:
      "Analyzes stakeholder impact, moral tradeoffs, policy tensions, and high-impact decision risks.",
    walletAddress: wallets.ethicalReasoning,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "ethical-reasoning",
      "stakeholder-analysis",
      "policy-tradeoffs",
      "attestation",
    ],
    roles: ["specialist", "attestor", "consumer"],
    price: { currency: "USDC", amount: "0.04", unit: "request" },
    safetyMode: "attestation",
    preferredAttestors: ["verification-validation-agent"],
    model: "openai/gpt-4.1-mini",
    tags: ["ethics", "policy", "attestation"],
    systemPrompt:
      "You are the Reddi Ethical Reasoning Agent. Analyze stakeholder impact and ethical tradeoffs. Be advisory, transparent about frameworks, and avoid coercive recommendations.",
  },
  {
    id: "explainable-agent",
    displayName: "Explainable Agent",
    description:
      "Explains decisions, model outputs, tradeoffs, and evidence in accessible language.",
    walletAddress: wallets.explainable,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "explanation",
      "traceability",
      "decision-rationale",
      "attestation",
    ],
    roles: ["specialist", "attestor", "consumer"],
    price: { currency: "USDC", amount: "0.03", unit: "request" },
    safetyMode: "attestation",
    preferredAttestors: ["verification-validation-agent"],
    model: "openai/gpt-4.1-mini",
    tags: ["explainability", "rationale", "attestation"],
    systemPrompt:
      "You are the Reddi Explainable Agent. Explain outputs, decisions, and tradeoffs clearly, preserving uncertainty and evidence lineage.",
  },
  {
    id: "healthcare-intelligence-agent",
    displayName: "Healthcare Intelligence Agent",
    description:
      "Summarizes medical literature and healthcare context for informational support only.",
    walletAddress: wallets.healthcareIntelligence,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "healthcare-information",
      "medical-literature-summary",
      "care-navigation",
      "risk-caveats",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.07", unit: "request" },
    safetyMode: "regulated-informational",
    preferredAttestors: [
      "verification-validation-agent",
      "ethical-reasoning-agent",
    ],
    model: "anthropic/claude-3.5-sonnet",
    tags: ["healthcare", "regulated", "literature"],
    systemPrompt:
      "You are the Reddi Healthcare Intelligence Agent. Provide informational healthcare context only, not diagnosis or treatment. Encourage qualified professional care for medical decisions and emergencies.",
  },
  {
    id: "scientific-discovery-agent",
    displayName: "Scientific Discovery Agent",
    description:
      "Generates hypotheses, research directions, and experiment ideas while separating speculation from evidence.",
    walletAddress: wallets.scientificDiscovery,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "hypothesis-generation",
      "scientific-discovery",
      "research-roadmapping",
      "experiment-ideation",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.06", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: [
      "verification-validation-agent",
      "ethical-reasoning-agent",
    ],
    model: "anthropic/claude-3.5-sonnet",
    tags: ["science", "hypotheses", "discovery"],
    systemPrompt:
      "You are the Reddi Scientific Discovery Agent. Generate plausible hypotheses and experiments, clearly marking speculation, assumptions, and validation requirements.",
  },
  {
    id: "financial-advisory-agent",
    displayName: "Financial Advisory Agent",
    description:
      "Provides financial education, scenario analysis, and risk summaries without personalized advice or trade execution.",
    walletAddress: wallets.financialAdvisory,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "financial-education",
      "scenario-analysis",
      "risk-summary",
      "budget-analysis",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.06", unit: "request" },
    safetyMode: "regulated-informational",
    preferredAttestors: [
      "verification-validation-agent",
      "ethical-reasoning-agent",
    ],
    model: "anthropic/claude-3.5-sonnet",
    tags: ["finance", "regulated", "risk"],
    systemPrompt:
      "You are the Reddi Financial Advisory Agent. Provide financial education and scenario analysis only. Do not provide personalized financial advice or execute trades.",
  },
  {
    id: "legal-intelligence-agent",
    displayName: "Legal Intelligence Agent",
    description:
      "Provides legal information, issue spotting, and document context without legal advice.",
    walletAddress: wallets.legalIntelligence,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "legal-information",
      "issue-spotting",
      "contract-context",
      "jurisdiction-caveats",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.07", unit: "request" },
    safetyMode: "regulated-informational",
    preferredAttestors: [
      "verification-validation-agent",
      "ethical-reasoning-agent",
    ],
    model: "anthropic/claude-3.5-sonnet",
    tags: ["legal", "regulated", "documents"],
    systemPrompt:
      "You are the Reddi Legal Intelligence Agent. Provide legal information and issue spotting only, not legal advice. Recommend qualified counsel for legal decisions.",
  },
  {
    id: "education-intelligence-agent",
    displayName: "Education Intelligence Agent",
    description:
      "Creates tutoring explanations, curricula, and learning paths adapted to supplied learner context.",
    walletAddress: wallets.educationIntelligence,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "tutoring",
      "curriculum-design",
      "learning-paths",
      "assessment-design",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.03", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: ["verification-validation-agent"],
    model: "openai/gpt-4.1-mini",
    tags: ["education", "tutoring", "curriculum"],
    systemPrompt:
      "You are the Reddi Education Intelligence Agent. Teach clearly, adapt to learner context, and avoid claiming credentials or guaranteed outcomes.",
  },
  {
    id: "collective-intelligence-agent",
    displayName: "Collective Intelligence Agent",
    description:
      "Aggregates multiple viewpoints, agent outputs, or votes into consensus with disagreement tracking.",
    walletAddress: wallets.collectiveIntelligence,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "collective-intelligence",
      "consensus-building",
      "viewpoint-synthesis",
      "disagreement-analysis",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.05", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: ["verification-validation-agent"],
    model: "openai/gpt-4.1-mini",
    tags: ["consensus", "synthesis", "collective"],
    systemPrompt:
      "You are the Reddi Collective Intelligence Agent. Aggregate viewpoints with provenance, expose disagreements, and avoid false consensus.",
  },
  {
    id: "embodied-intelligence-agent",
    displayName: "Embodied Intelligence Agent",
    description:
      "Plans embodied or robotic actions in simulation/planning mode without real-world actuation.",
    walletAddress: wallets.embodiedIntelligence,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "embodied-planning",
      "robotics-planning",
      "simulation-reasoning",
      "safety-boundaries",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.06", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: [
      "verification-validation-agent",
      "ethical-reasoning-agent",
    ],
    model: "openai/gpt-4.1-mini",
    tags: ["embodied", "robotics", "planning"],
    systemPrompt:
      "You are the Reddi Embodied Intelligence Agent. Produce simulation/planning guidance only. Do not issue real-world actuator commands or imply physical execution.",
  },
  {
    id: "domain-transforming-integration-agent",
    displayName: "Domain-Transforming Integration Agent",
    description:
      "Maps workflows, data, and practices across domains, tools, and systems with integration risk notes.",
    walletAddress: wallets.domainTransformingIntegration,
    endpointPath: "/v1/chat/completions",
    capabilities: [
      "domain-translation",
      "systems-integration",
      "workflow-mapping",
      "interoperability-planning",
    ],
    roles: ["specialist", "consumer"],
    price: { currency: "USDC", amount: "0.055", unit: "request" },
    safetyMode: "standard",
    preferredAttestors: [
      "verification-validation-agent",
      "security-hardened-agent",
    ],
    model: "anthropic/claude-3.5-sonnet",
    tags: ["integration", "systems", "domain-translation"],
    systemPrompt:
      "You are the Reddi Domain-Transforming Integration Agent. Translate workflows across domains and systems, identify compatibility risks, and avoid silent external writes.",
  },
];

export const specialistProfiles: SpecialistProfile[] = profileList.map((profile) => ({
  ...profile,
  meteredPrice: profile.meteredPrice ?? { ...PER_TOKEN_TIERS.mid },
}));

export function getProfile(id: string): SpecialistProfile | undefined {
  return specialistProfiles.find((profile) => profile.id === id);
}

export function validateProfile(profile: SpecialistProfile): string[] {
  const errors: string[] = [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profile.id))
    errors.push(`invalid id: ${profile.id}`);
  if (!profile.displayName.trim())
    errors.push(`${profile.id}: missing displayName`);
  if (!profile.walletAddress.trim())
    errors.push(`${profile.id}: missing walletAddress`);
  else if (!isValidSolanaPublicKey(profile.walletAddress))
    errors.push(`${profile.id}: invalid Solana walletAddress`);
  if (profile.endpointPath !== "/v1/chat/completions")
    errors.push(`${profile.id}: unsupported endpointPath`);
  if (profile.capabilities.length === 0)
    errors.push(`${profile.id}: missing capabilities`);
  if (profile.roles.length === 0 || !profile.roles.includes("specialist"))
    errors.push(`${profile.id}: must include specialist role`);
  if (!profile.price.amount || !profile.price.currency || !profile.price.unit)
    errors.push(`${profile.id}: invalid price`);
  if (profile.meteredPrice) {
    const { inputPerMillion, outputPerMillion, maxOutputTokens } = profile.meteredPrice;
    const decimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
    if (!decimal.test(inputPerMillion) || !decimal.test(outputPerMillion) || Number(inputPerMillion) + Number(outputPerMillion) <= 0)
      errors.push(`${profile.id}: invalid meteredPrice`);
    if (maxOutputTokens !== undefined && !(Number.isSafeInteger(maxOutputTokens) && maxOutputTokens > 0))
      errors.push(`${profile.id}: invalid meteredPrice.maxOutputTokens`);
  }
  if (!profile.model.trim()) errors.push(`${profile.id}: missing model`);
  if (!profile.systemPrompt.trim())
    errors.push(`${profile.id}: missing systemPrompt`);
  return errors;
}

export function validateProfileRegistry(
  profiles = specialistProfiles,
): string[] {
  const ids = new Set<string>();
  const wallets = new Set<string>();
  const errors = profiles.flatMap(validateProfile);
  for (const profile of profiles) {
    if (ids.has(profile.id)) errors.push(`duplicate id: ${profile.id}`);
    ids.add(profile.id);
    if (wallets.has(profile.walletAddress))
      errors.push(`duplicate wallet: ${profile.walletAddress}`);
    wallets.add(profile.walletAddress);
  }
  return errors;
}
