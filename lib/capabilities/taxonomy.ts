/**
 * Capability Taxonomy
 *
 * Single source of truth for all vocabulary used in capability profiles,
 * discovery filtering, planner routing, and UI pickers.
 *
 * Rules:
 * - IDs are stable machine-readable keys (never change without migration)
 * - Labels are human-readable UI strings
 * - modelHints maps task type IDs to suggested Ollama models
 * - privacyModes maps to on-chain settlement path
 */

// ── Task Types ─────────────────────────────────────────────────────────────────

export const TASK_TYPES = [
  { id: "summarize",      label: "Summarize",          description: "Condense long content to key points" },
  { id: "classify",       label: "Classify",           description: "Label or categorize input" },
  { id: "extract",        label: "Extract",            description: "Pull structured data from unstructured text" },
  { id: "generate",       label: "Generate",           description: "Create original content from a prompt" },
  { id: "analyze",        label: "Analyze",            description: "Reason over data and surface insights" },
  { id: "code",           label: "Code",               description: "Write, review, or debug code" },
  { id: "translate",      label: "Translate",          description: "Convert between languages" },
  { id: "qa",             label: "Q&A",                description: "Answer questions from context or knowledge" },
  { id: "plan",           label: "Plan",               description: "Break goals into ordered steps" },
  { id: "review",         label: "Review",             description: "Evaluate and critique content or code" },
  { id: "search",         label: "Search",             description: "Retrieve relevant information" },
  { id: "embed",          label: "Embed",              description: "Generate vector embeddings" },
  { id: "transcribe",     label: "Transcribe",         description: "Convert audio/video to text" },
  { id: "vision",         label: "Vision",             description: "Analyse images or visual content" },
  { id: "custom",         label: "Custom",             description: "Specialist task not covered above" },
] as const;

export type TaskTypeId = typeof TASK_TYPES[number]["id"];
export const TASK_TYPE_IDS = TASK_TYPES.map((t) => t.id);

// ── Input Modes ───────────────────────────────────────────────────────────────

export const INPUT_MODES = [
  { id: "text",     label: "Text",     description: "Plain text prompt" },
  { id: "json",     label: "JSON",     description: "Structured JSON payload" },
  { id: "markdown", label: "Markdown", description: "Formatted markdown document" },
  { id: "image",    label: "Image",    description: "Base64 or URL image reference" },
  { id: "audio",    label: "Audio",    description: "Audio file or stream" },
  { id: "file",     label: "File",     description: "Arbitrary file reference" },
] as const;

export type InputModeId = typeof INPUT_MODES[number]["id"];
export const INPUT_MODE_IDS = INPUT_MODES.map((m) => m.id);

// ── Output Modes ──────────────────────────────────────────────────────────────

export const OUTPUT_MODES = [
  { id: "text",     label: "Text",     description: "Plain text response" },
  { id: "json",     label: "JSON",     description: "Structured JSON" },
  { id: "markdown", label: "Markdown", description: "Formatted markdown" },
  { id: "stream",   label: "Stream",   description: "Streamed token output" },
  { id: "embedding",label: "Embedding",description: "Float vector array" },
  { id: "image",    label: "Image",    description: "Generated image URL or base64" },
] as const;

export type OutputModeId = typeof OUTPUT_MODES[number]["id"];
export const OUTPUT_MODE_IDS = OUTPUT_MODES.map((m) => m.id);

// ── Context Requirements ─────────────────────────────────────────────────────

/**
 * A declared input contract entry, what the caller must provide to invoke this specialist.
 * Mirrors OpenAI's Manifest concept for our x402 protocol.
 */
export interface ContextRequirement {
  key: string;
  type: 'text' | 'url' | 'file_ref' | 'number' | 'boolean' | 'json';
  required: boolean;
  description?: string;
  default?: string | number | boolean;
}

export const CONTEXT_REQUIREMENT_TYPES = [
  'text',
  'url',
  'file_ref',
  'number',
  'boolean',
  'json',
] as const;

export type ContextRequirementType = typeof CONTEXT_REQUIREMENT_TYPES[number];

// ── Runtime Capabilities ──────────────────────────────────────────────────────

/**
 * Typed runtime capabilities, what the specialist execution environment can do.
 */
export const RUNTIME_CAPABILITIES = [
  'code_execution',
  'file_read',
  'file_write',
  'web_search',
  'stateful',
  'long_running',
  'multimodal',
  'streaming',
] as const;

export type RuntimeCapability = typeof RUNTIME_CAPABILITIES[number];

export function isValidContextRequirementType(v: string): v is ContextRequirementType {
  return CONTEXT_REQUIREMENT_TYPES.includes(v as ContextRequirementType);
}

export function isValidRuntimeCapability(v: string): v is RuntimeCapability {
  return RUNTIME_CAPABILITIES.includes(v as RuntimeCapability);
}

// ── Capability Profiles ───────────────────────────────────────────────────────

export type CapabilityProfile = {
  taskTypes: TaskTypeId[];
  inputModes: InputModeId[];
  outputModes: OutputModeId[];
  privacyModes: PrivacyModeId[];
  tags?: string[];
  /** Inference is priced per million input and output tokens; perCallUsd is a fixed-price job. */
  pricing: { baseUsd: number; perCallUsd?: number; inputPerMillionUsd?: number; outputPerMillionUsd?: number };
  context_requirements?: ContextRequirement[];
  runtime_capabilities?: RuntimeCapability[];
};

// ── Privacy Modes ─────────────────────────────────────────────────────────────

export const PRIVACY_MODES = [
  {
    id: "public",
    label: "Public",
    description: "Standard on-chain Solana settlement. Transparent and auditable.",
    settlementPath: "solana_mainnet",
  },
  {
    id: "per",
    label: "MagicBlock PER",
    description: "Private Ephemeral Rollup via Intel TDX TEE. Sub-50ms, zero fees, confidential execution.",
    settlementPath: "magicblock_per",
  },
  {
    id: "vanish",
    label: "Vanish Core",
    description: "One-time wallet + Jito bundle. Originator wallet not shown as signer.",
    settlementPath: "vanish_core",
  },
] as const;

export type PrivacyModeId = typeof PRIVACY_MODES[number]["id"];
export const PRIVACY_MODE_IDS = PRIVACY_MODES.map((m) => m.id);

// ── Model → Task Hints ────────────────────────────────────────────────────────
// Suggested Ollama model for each task type. Used in onboarding wizard guidance.

export const MODEL_TASK_HINTS: Record<TaskTypeId, { model: string; why: string }[]> = {
  summarize:  [{ model: "qwen3:8b",             why: "Strong compression + coherence" },
               { model: "mistral:7b",            why: "Good long-form coherence" }],
  classify:   [{ model: "qwen3:1.7b",           why: "Fast, cheap, sufficient for classification" },
               { model: "qwen3:8b",              why: "Better accuracy on complex taxonomies" }],
  extract:    [{ model: "qwen3:8b",             why: "Reliable structured extraction" },
               { model: "qwen2.5-coder:7b",      why: "Good at JSON output discipline" }],
  generate:   [{ model: "mistral:7b",           why: "Strong creative coherence" },
               { model: "qwen3:8b",              why: "Good instruction following" }],
  analyze:    [{ model: "qwen3:8b",             why: "Reasoning + insight generation" },
               { model: "deepseek-r1:8b",        why: "Chain-of-thought, reliable" }],
  code:       [{ model: "qwen2.5-coder:7b",     why: "Specialist training, fewer errors" },
               { model: "qwen2.5-coder:latest",  why: "Latest coder checkpoint" }],
  translate:  [{ model: "qwen3:8b",             why: "Multilingual capability" },
               { model: "mistral:7b",            why: "Solid translation quality" }],
  qa:         [{ model: "qwen3:1.7b",           why: "Fast for simple Q&A" },
               { model: "qwen3:8b",              why: "Better for context-heavy Q&A" }],
  plan:       [{ model: "qwen3:8b",             why: "Step decomposition + reasoning" },
               { model: "deepseek-r1:8b",        why: "Structured planning, chain-of-thought" }],
  review:     [{ model: "qwen3:8b",             why: "Critical evaluation capability" },
               { model: "qwen2.5-coder:7b",      why: "Best for code review" }],
  search:     [{ model: "qwen3:1.7b",           why: "Fast retrieval-assist" }],
  embed:      [{ model: "nomic-embed-text",     why: "Purpose-built embedding model" },
               { model: "mxbai-embed-large",     why: "High quality embeddings" }],
  transcribe: [{ model: "whisper",              why: "OpenAI Whisper via Ollama" }],
  vision:     [{ model: "llava:7b",             why: "Vision-language multimodal" },
               { model: "llava:13b",             why: "Higher quality vision analysis" }],
  custom:     [{ model: "qwen3:8b",             why: "General purpose baseline" }],
};

// ── Validation helpers ────────────────────────────────────────────────────────

export function isValidTaskTypeId(v: string): v is TaskTypeId {
  return TASK_TYPE_IDS.includes(v as TaskTypeId);
}

export function isValidInputModeId(v: string): v is InputModeId {
  return INPUT_MODE_IDS.includes(v as InputModeId);
}

export function isValidOutputModeId(v: string): v is OutputModeId {
  return OUTPUT_MODE_IDS.includes(v as OutputModeId);
}

export function isValidPrivacyModeId(v: string): v is PrivacyModeId {
  return PRIVACY_MODE_IDS.includes(v as PrivacyModeId);
}

export function validateCapabilityTaxonomy(input: {
  taskTypes: string[];
  inputModes: string[];
  outputModes: string[];
  privacyModes: string[];
}): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!input.taskTypes.length) errors.push("At least one task type is required.");
  const badTasks = input.taskTypes.filter((t) => !isValidTaskTypeId(t));
  if (badTasks.length) errors.push(`Unknown task types: ${badTasks.join(", ")}`);

  if (!input.inputModes.length) errors.push("At least one input mode is required.");
  const badInputs = input.inputModes.filter((m) => !isValidInputModeId(m));
  if (badInputs.length) errors.push(`Unknown input modes: ${badInputs.join(", ")}`);

  if (!input.outputModes.length) errors.push("At least one output mode is required.");
  const badOutputs = input.outputModes.filter((m) => !isValidOutputModeId(m));
  if (badOutputs.length) errors.push(`Unknown output modes: ${badOutputs.join(", ")}`);

  const badPrivacy = input.privacyModes.filter((m) => !isValidPrivacyModeId(m));
  if (badPrivacy.length) errors.push(`Unknown privacy modes: ${badPrivacy.join(", ")}`);

  return { ok: errors.length === 0, errors };
}
