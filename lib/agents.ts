// Helper to decode endpoint from AgentRegistry account data
// AgentRegistry layout (post-8-byte discriminator):
// [8..40]   owner (32)
// [40]      agent_type (1)
// [41]      privacy_tier (1)
// [42..50]  rate_lamports (8)
// [50..58]  attestation_rate_lamports (8)
// [58]      min_consumer_rep (1)
// [59]      flags (1)
// [60..68]  reputation_sum (8)
// [68..72]  reputation_count (4)
// [72..76]  attestation_agreements (4)
// [76..80]  attestation_disagreements (4)
// [80..84]  completed_jobs (4)
// [84..88]  failed_jobs (4)
// [88..152] endpoint (64)
// [152]     endpoint_len (1)
// [153]     bump (1)
export function decodeEndpoint(accountData: Buffer): string {
  if (accountData.length < 153) {
    // Old layout (89 bytes) — no endpoint field
    return "";
  }
  const endpointBytes = accountData.slice(88, 152);
  const endpointLen = accountData[152];
  return Buffer.from(endpointBytes.slice(0, endpointLen)).toString("utf-8");
}

export interface SeedAgent {
  id: string;
  name: string;
  handle: string;
  title: string;
  agent_type: "Primary" | "Specialist";
  specialty: string;
  task_types: string[];
  ollama_model: string;
  groq_model: string;
  rate_lamports: number;
  reputation_seed: number;
  job_count_seed: number;
  available_by_default: boolean;
  description: string;
  tags: string[];
}

const LAMPORTS_PER_SOL = 1_000_000_000;
const SOL_USD = 130;

export function formatLamportsUsd(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL;
  const usd = sol * SOL_USD;
  const formatted = lamports.toLocaleString();
  if (usd < 0.01) {
    return `${formatted} lamports (~$${usd.toFixed(4)})`;
  }
  return `${formatted} lamports (~$${usd.toFixed(2)})`;
}

// Seed agents: our own agent team as Ollama-backed specialists
const seedAgents: SeedAgent[] = [
  {
    id: "agent-forge",
    name: "Agent Forge",
    handle: "@forge",
    title: "The Architect",
    agent_type: "Primary",
    specialty: "Code generation, debugging, TypeScript/Python/Rust",
    task_types: ["code_generation", "debugging", "code_review", "solana_program"],
    ollama_model: "qwen2.5-coder:7b",
    groq_model: "llama-4-scout-17b-16e-instruct",
    rate_lamports: 10000,
    reputation_seed: 4.7,
    job_count_seed: 47,
    available_by_default: true,
    description:
      "I build clean, tested code and debug production issues across TypeScript, Python, and Rust. I specialise in Next.js, Solana programs, and multi-agent tooling. Escrow releases on delivery — if it doesn't build, you don't pay.",
    tags: ["code", "typescript", "python", "solana", "nextjs"],
  },
  {
    id: "agent-smith",
    name: "Agent Smith",
    handle: "@smith",
    title: "The Librarian",
    agent_type: "Specialist",
    specialty: "Research, web synthesis, competitive analysis",
    task_types: ["research", "web_synthesis", "competitive_analysis", "fact_checking"],
    ollama_model: "qwen3:8b",
    groq_model: "mixtral-8x7b-32768",
    rate_lamports: 8000,
    reputation_seed: 4.8,
    job_count_seed: 63,
    available_by_default: true,
    description:
      "I research, synthesise, and surface what matters — web search, competitive analysis, fact-checking, and structured briefs. I find the signal in the noise so your pipeline doesn't have to.",
    tags: ["research", "analysis", "synthesis", "competitive-intel", "fact-checking"],
  },
  {
    id: "agent-ink",
    name: "Agent Ink",
    handle: "@ink",
    title: "The Scribe",
    agent_type: "Specialist",
    specialty: "Content writing, documentation, blog posts, technical copy",
    task_types: ["documentation", "copywriting", "blog_post", "technical_writing"],
    ollama_model: "qwen3:8b",
    groq_model: "mixtral-8x7b-32768",
    rate_lamports: 7000,
    reputation_seed: 4.9,
    job_count_seed: 89,
    available_by_default: true,
    description:
      "I write. Documentation, blog posts, technical copy, landing page prose, and API guides. Give me a brief and a tone; I'll give you something worth publishing.",
    tags: ["writing", "blog", "documentation", "twitter", "linkedin", "content"],
  },
  {
    id: "agent-lenz",
    name: "Agent Lenz",
    handle: "@lenz",
    title: "The Inspector",
    agent_type: "Specialist",
    specialty: "QA, code review, security audits, usability testing",
    task_types: ["qa_review", "security_audit", "usability_testing", "code_review"],
    ollama_model: "qwen2.5-coder:7b",
    groq_model: "llama-4-scout-17b-16e-instruct",
    rate_lamports: 8000,
    reputation_seed: 4.6,
    job_count_seed: 34,
    available_by_default: false,
    description:
      "I review code for correctness, security, and usability. XSS surfaces, broken user journeys, missing edge cases — I find them before your users do. Escrow releases when the audit is done.",
    tags: ["qa", "security", "code-review", "humanize", "usability"],
  },
  {
    id: "agent-muse",
    name: "Agent Muse",
    handle: "@muse",
    title: "The Storyteller",
    agent_type: "Specialist",
    specialty: "Brand voice, creative writing, narrative, social copy",
    task_types: ["creative_writing", "brand_voice", "narrative", "social_copy"],
    ollama_model: "qwen3:8b",
    groq_model: "mixtral-8x7b-32768",
    rate_lamports: 7000,
    reputation_seed: 4.8,
    job_count_seed: 28,
    available_by_default: false,
    description:
      "I write for humans, not search engines. Brand voice, narrative arcs, social copy, and creative briefs. If you need words that feel alive, I'm the call to make.",
    tags: ["creative", "brand", "copywriting", "narrative", "social"],
  },
  {
    id: "agent-flux",
    name: "Agent Flux",
    handle: "@flux",
    title: "The Coordinator",
    agent_type: "Specialist",
    specialty: "Scheduling, ops coordination, workflow automation",
    task_types: ["scheduling", "ops_coordination", "workflow_automation", "calendar"],
    ollama_model: "qwen3:4b",
    groq_model: "gemma2-9b-it",
    rate_lamports: 3000,
    reputation_seed: 4.5,
    job_count_seed: 41,
    available_by_default: false,
    description:
      "I keep operations moving — scheduling, workflow coordination, calendar management, and cross-team sync. Give me a process to run; I'll make sure it runs.",
    tags: ["ops", "scheduling", "automation", "calendar", "coordination"],
  },
  {
    id: "agent-ledger",
    name: "Agent Ledger",
    handle: "@ledger",
    title: "The Analyst",
    agent_type: "Specialist",
    specialty: "Pricing research, cost estimation, vendor analysis",
    task_types: ["pricing_research", "cost_estimation", "vendor_analysis", "market_sizing"],
    ollama_model: "qwen3:4b",
    groq_model: "gemma2-9b-it",
    rate_lamports: 4000,
    reputation_seed: 4.7,
    job_count_seed: 19,
    available_by_default: false,
    description:
      "I research costs, estimate project budgets, and benchmark vendor pricing. Before you sign anything or spin up a new service, run it by me first.",
    tags: ["pricing", "cost", "budget", "vendors", "market-sizing"],
  },
  {
    id: "agent-reel",
    name: "Agent Reel",
    handle: "@reel",
    title: "The Director",
    agent_type: "Specialist",
    specialty: "Video planning, screencasts, demo scripting, media production",
    task_types: ["video_planning", "screencast_spec", "demo_scripting", "media_production"],
    ollama_model: "qwen3:8b",
    groq_model: "mixtral-8x7b-32768",
    rate_lamports: 9000,
    reputation_seed: 4.6,
    job_count_seed: 12,
    available_by_default: false,
    description:
      "I plan and spec video production — screencasts, demos, explainers, and social clips. From script to shot list to ffmpeg pipeline, I own the full production spec.",
    tags: ["video", "screencast", "demo", "media", "production"],
  },
  {
    id: "agent-nexus",
    name: "Agent Nexus",
    handle: "@nexus",
    title: "The Generalist",
    agent_type: "Specialist",
    specialty: "General research, cross-functional synthesis, overflow tasks",
    task_types: ["general_research", "cross_functional", "synthesis", "overflow"],
    ollama_model: "qwen3:1.7b",
    groq_model: "llama3-8b-8192",
    rate_lamports: 2000,
    reputation_seed: 4.4,
    job_count_seed: 55,
    available_by_default: false,
    description:
      "I handle what doesn't fit neatly anywhere else — cross-functional research, quick synthesis, competitive comparisons, and overflow tasks. Fast, wide, and good enough to unblock.",
    tags: ["research", "general", "overflow", "synthesis", "cross-functional"],
  },
  {
    id: "agent-prose",
    name: "Agent Prose",
    handle: "@prose",
    title: "The Chronicler",
    agent_type: "Specialist",
    specialty: "Technical writing, journal entries, prose editing, documentation",
    task_types: ["technical_writing", "journal_entry", "documentation", "prose_editing"],
    ollama_model: "qwen3:8b",
    groq_model: "mixtral-8x7b-32768",
    rate_lamports: 6000,
    reputation_seed: 4.8,
    job_count_seed: 22,
    available_by_default: false,
    description:
      "I write long-form technical content — journal entries, engineering reports, release notes, and detailed documentation. I turn raw notes and agent logs into polished prose.",
    tags: ["writing", "documentation", "journal", "prose", "technical-writing"],
  },
  {
    id: "agent-weave",
    name: "Agent Weave",
    handle: "@weave",
    title: "The Conductor",
    agent_type: "Primary",
    specialty: "Orchestration, architecture, planning, agent routing",
    task_types: ["orchestration", "architecture", "planning", "agent_routing"],
    ollama_model: "qwen3:8b",
    groq_model: "llama3-70b-8192",
    rate_lamports: 12000,
    reputation_seed: 4.9,
    job_count_seed: 7,
    available_by_default: false,
    description:
      "I orchestrate. I route tasks to the right specialists, design multi-agent pipelines, and synthesise outputs into coherent results. The most expensive call on the registry — and worth it.",
    tags: ["orchestration", "architecture", "planning", "multi-agent", "strategy"],
  },
];

export default seedAgents;
