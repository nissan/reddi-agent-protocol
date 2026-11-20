import "server-only";

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import type { ContextRequirement, RuntimeCapability } from "@/lib/capabilities/taxonomy";
import { isValidContextRequirementType, isValidRuntimeCapability } from "@/lib/capabilities/taxonomy";

export type CapabilityInput = {
  taskTypes: string[];
  inputModes: string[];
  outputModes: string[];
  pricing: {
    baseUsd: number;
    perCallUsd?: number;
    inputPerMillionUsd?: number;
    outputPerMillionUsd?: number;
  };
  privacyModes: Array<"public" | "per" | "vanish">;
  tags?: string[];
  context_requirements?: ContextRequirement[];
  runtime_capabilities?: RuntimeCapability[];
  agent_composition?: {
    llm?: string;
    control_loop?: string;
    tools?: string[];
    skills?: string[];
    memory?: string[];
    goals?: string[];
    external_mcp_servers?: string[];
    marketplace_agent_calls?: string[];
    non_marketplace_agent_calls?: string[];
  };
  manifest?: {
    profileId?: string;
    displayName?: string;
    description?: string;
    roles?: string[];
    tools?: string[];
    skills?: string[];
    marketplace_agent_calls?: string[];
    external_mcp_servers?: string[];
    non_marketplace_agent_calls?: string[];
    preferred_attestors?: string[];
    disclosure_policy?: string;
  };
  quality_claims?: string[];
  attestor_checkpoints?: string[];
};

export type CapabilityRecord = {
  walletAddress: string;
  updatedAt: string;
  capabilities: CapabilityInput;
  /** SHA-256 of canonical profile JSON (sorted keys, no updatedAt) */
  capabilityHash?: string;
};

/**
 * Compute a stable SHA-256 hash of a capability profile.
 * Keys sorted alphabetically, updatedAt excluded, arrays sorted.
 */
export function computeCapabilityHash(walletAddress: string, caps: ReturnType<typeof validateCapabilities>): string {
  const canonical = {
    agent_composition: caps.agent_composition
      ? {
          llm: caps.agent_composition.llm,
          control_loop: caps.agent_composition.control_loop,
          tools: [...(caps.agent_composition.tools ?? [])].sort(),
          skills: [...(caps.agent_composition.skills ?? [])].sort(),
          memory: [...(caps.agent_composition.memory ?? [])].sort(),
          goals: [...(caps.agent_composition.goals ?? [])].sort(),
          external_mcp_servers: [...(caps.agent_composition.external_mcp_servers ?? [])].sort(),
          marketplace_agent_calls: [...(caps.agent_composition.marketplace_agent_calls ?? [])].sort(),
          non_marketplace_agent_calls: [...(caps.agent_composition.non_marketplace_agent_calls ?? [])].sort(),
        }
      : undefined,
    manifest: caps.manifest
      ? {
          profileId: caps.manifest.profileId,
          displayName: caps.manifest.displayName,
          description: caps.manifest.description,
          roles: [...(caps.manifest.roles ?? [])].sort(),
          tools: [...(caps.manifest.tools ?? [])].sort(),
          skills: [...(caps.manifest.skills ?? [])].sort(),
          marketplace_agent_calls: [...(caps.manifest.marketplace_agent_calls ?? [])].sort(),
          external_mcp_servers: [...(caps.manifest.external_mcp_servers ?? [])].sort(),
          non_marketplace_agent_calls: [...(caps.manifest.non_marketplace_agent_calls ?? [])].sort(),
          preferred_attestors: [...(caps.manifest.preferred_attestors ?? [])].sort(),
          disclosure_policy: caps.manifest.disclosure_policy,
        }
      : undefined,
    attestor_checkpoints: [...(caps.attestor_checkpoints ?? [])].sort(),
    context_requirements: normalizeContextRequirements(caps.context_requirements ?? []),
    inputModes: [...caps.inputModes].sort(),
    outputModes: [...caps.outputModes].sort(),
    // Per-token prices join the hash only when set, so a profile without them hashes as before.
    pricing: {
      baseUsd: caps.pricing.baseUsd,
      ...(caps.pricing.inputPerMillionUsd === undefined ? {} : { inputPerMillionUsd: caps.pricing.inputPerMillionUsd }),
      ...(caps.pricing.outputPerMillionUsd === undefined ? {} : { outputPerMillionUsd: caps.pricing.outputPerMillionUsd }),
      perCallUsd: caps.pricing.perCallUsd ?? 0,
    },
    privacyModes: [...caps.privacyModes].sort(),
    quality_claims: [...(caps.quality_claims ?? [])].sort(),
    runtime_capabilities: [...(caps.runtime_capabilities ?? [])].sort(),
    tags: [...(caps.tags ?? [])].sort(),
    taskTypes: [...caps.taskTypes].sort(),
    version: "1",
    walletAddress,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

const CAPABILITY_PATH = join(process.cwd(), "data", "onboarding", "specialist-capabilities.json");

function normalizeList(values: string[]) {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function normalizeOptionalList(values: string[] | undefined, maxItems: number) {
  return normalizeList(values ?? []).slice(0, maxItems);
}

function normalizeContextRequirements(values: ContextRequirement[]) {
  return values
    .map((req) => ({
      key: String(req.key || "").trim(),
      type: req.type,
      required: Boolean(req.required),
      description: req.description ? String(req.description).trim() : undefined,
      default: req.default,
    }))
    .filter((req) => req.key.length > 0)
    .sort((a, b) => a.key.localeCompare(b.key));
}

function readAll(): CapabilityRecord[] {
  try {
    return JSON.parse(readFileSync(CAPABILITY_PATH, "utf8")) as CapabilityRecord[];
  } catch {
    return [];
  }
}

function writeAll(records: CapabilityRecord[]) {
  mkdirSync(join(process.cwd(), "data", "onboarding"), { recursive: true });
  writeFileSync(CAPABILITY_PATH, JSON.stringify(records, null, 2));
}

export function validateCapabilities(input: CapabilityInput) {
  const taskTypes = normalizeList(input.taskTypes || []);
  const inputModes = normalizeList(input.inputModes || []);
  const outputModes = normalizeList(input.outputModes || []);
  const tags = normalizeList(input.tags || []);
  const privacyModes = Array.from(new Set((input.privacyModes || []).filter(Boolean)));
  const runtimeCapabilities = Array.from(new Set((input.runtime_capabilities || []).filter(Boolean)));
  const contextRequirements = Array.isArray(input.context_requirements) ? input.context_requirements : [];
  const qualityClaims = normalizeOptionalList(input.quality_claims, 12);
  const attestorCheckpoints = normalizeOptionalList(input.attestor_checkpoints, 12);
  const agentComposition = input.agent_composition
    ? {
        llm: typeof input.agent_composition.llm === "string" ? input.agent_composition.llm.trim() : undefined,
        control_loop:
          typeof input.agent_composition.control_loop === "string"
            ? input.agent_composition.control_loop.trim()
            : undefined,
        tools: normalizeOptionalList(input.agent_composition.tools, 16),
        skills: normalizeOptionalList(input.agent_composition.skills, 24),
        memory: normalizeOptionalList(input.agent_composition.memory, 12),
        goals: normalizeOptionalList(input.agent_composition.goals, 12),
        external_mcp_servers: normalizeOptionalList(input.agent_composition.external_mcp_servers, 12),
        marketplace_agent_calls: normalizeOptionalList(input.agent_composition.marketplace_agent_calls, 24),
        non_marketplace_agent_calls: normalizeOptionalList(input.agent_composition.non_marketplace_agent_calls, 24),
      }
    : undefined;
  const manifest = input.manifest
    ? {
        profileId: typeof input.manifest.profileId === "string" ? input.manifest.profileId.trim() : undefined,
        displayName: typeof input.manifest.displayName === "string" ? input.manifest.displayName.trim() : undefined,
        description: typeof input.manifest.description === "string" ? input.manifest.description.trim() : undefined,
        roles: normalizeOptionalList(input.manifest.roles, 8),
        tools: normalizeOptionalList(input.manifest.tools, 16),
        skills: normalizeOptionalList(input.manifest.skills, 24),
        marketplace_agent_calls: normalizeOptionalList(input.manifest.marketplace_agent_calls, 24),
        external_mcp_servers: normalizeOptionalList(input.manifest.external_mcp_servers, 12),
        non_marketplace_agent_calls: normalizeOptionalList(input.manifest.non_marketplace_agent_calls, 24),
        preferred_attestors: normalizeOptionalList(input.manifest.preferred_attestors, 12),
        disclosure_policy: typeof input.manifest.disclosure_policy === "string" ? input.manifest.disclosure_policy.trim() : undefined,
      }
    : undefined;

  if (taskTypes.length === 0) throw new Error("At least one task type is required.");
  if (inputModes.length === 0) throw new Error("At least one input mode is required.");
  if (outputModes.length === 0) throw new Error("At least one output mode is required.");
  if (privacyModes.length === 0) throw new Error("At least one privacy mode is required.");

  for (const mode of privacyModes) {
    if (!["public", "per", "vanish"].includes(mode)) {
      throw new Error(`Unsupported privacy mode: ${mode}`);
    }
  }

  for (const capability of runtimeCapabilities) {
    if (!isValidRuntimeCapability(capability)) {
      throw new Error(`Unsupported runtime capability: ${capability}`);
    }
  }

  if (contextRequirements.length > 5) {
    throw new Error("context_requirements may contain at most 5 entries.");
  }

  for (const requirement of contextRequirements) {
    if (!isValidContextRequirementType(requirement.type)) {
      throw new Error(`Unsupported context requirement type: ${requirement.type}`);
    }
    if (!String(requirement.key || "").trim()) {
      throw new Error("context_requirements[].key is required.");
    }
  }

  const baseUsd = Number(input.pricing?.baseUsd);
  const perCallUsd =
    input.pricing?.perCallUsd === undefined ? undefined : Number(input.pricing.perCallUsd);

  if (!Number.isFinite(baseUsd) || baseUsd < 0) {
    throw new Error("pricing.baseUsd must be a number >= 0.");
  }
  if (perCallUsd !== undefined && (!Number.isFinite(perCallUsd) || perCallUsd < 0)) {
    throw new Error("pricing.perCallUsd must be a number >= 0 when provided.");
  }
  const tokenPrice = (key: "inputPerMillionUsd" | "outputPerMillionUsd") => {
    const raw = input.pricing?.[key];
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error(`pricing.${key} must be a number >= 0 when provided.`);
    return value;
  };
  const inputPerMillionUsd = tokenPrice("inputPerMillionUsd");
  const outputPerMillionUsd = tokenPrice("outputPerMillionUsd");

  return {
    agent_composition: agentComposition,
    manifest,
    attestor_checkpoints: attestorCheckpoints,
    taskTypes,
    inputModes,
    outputModes,
    tags,
    privacyModes: privacyModes as Array<"public" | "per" | "vanish">,
    pricing: {
      baseUsd,
      perCallUsd,
      ...(inputPerMillionUsd === undefined ? {} : { inputPerMillionUsd }),
      ...(outputPerMillionUsd === undefined ? {} : { outputPerMillionUsd }),
    },
    quality_claims: qualityClaims,
    context_requirements: normalizeContextRequirements(contextRequirements),
    runtime_capabilities: runtimeCapabilities as RuntimeCapability[],
  };
}

export function upsertCapabilities(walletAddress: string, capabilities: CapabilityInput) {
  if (!walletAddress || walletAddress.length < 32) {
    throw new Error("Valid wallet address is required.");
  }

  const normalized = validateCapabilities(capabilities);
  const records = readAll();
  const now = new Date().toISOString();

  const capabilityHash = computeCapabilityHash(walletAddress, normalized);
  const nextRecord: CapabilityRecord = {
    walletAddress,
    updatedAt: now,
    capabilities: normalized,
    capabilityHash,
  };

  const idx = records.findIndex((r) => r.walletAddress === walletAddress);
  if (idx >= 0) {
    records[idx] = nextRecord;
  } else {
    records.push(nextRecord);
  }

  writeAll(records);

  return {
    ok: true,
    record: nextRecord,
    storagePath: CAPABILITY_PATH,
  };
}
