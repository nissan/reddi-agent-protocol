import "server-only";

/**
 * Registry Bridge
 *
 * Merges on-chain AgentAccount data (from Solana devnet) with the
 * off-chain capability index (specialist-index.json) to produce a
 * unified SpecialistListing that powers /agents, the planner router,
 * and the specialist dashboard.
 *
 * Data sources:
 * 1. On-chain: AgentAccount PDAs via getProgramAccounts
 * 2. Off-chain capability index: data/onboarding/specialist-index.json
 * 3. Off-chain attestation records: data/onboarding/attestations.json
 * 4. Off-chain healthcheck history: data/onboarding/specialist-profile.json (per-wallet)
 */

import { Connection } from "@solana/web3.js";
import { readFileSync } from "fs";
import { join } from "path";
import {
  DEVNET_RPC,
  REGISTRY_PROGRAM_ID,
  ACTIVE_AGENT_ACCOUNT_DATA_SIZE,
  ACTIVE_AGENT_ACCOUNT_DISC,
  decodeActiveAgentAccount,
  type OnchainAgent,
} from "@/lib/program";
import {
  computeSpecialistRankingScore,
  type SpecialistIndexEntry,
} from "@/lib/onboarding/specialist-index";
import { loadListingIndex } from "@/lib/listings/listing-index";
import { enrichCapabilityIndexWithOpenRouterProfiles } from "@/lib/registry/openrouter-enrichment";
import type { TaskTypeId, InputModeId, OutputModeId, PrivacyModeId, RuntimeCapability, ContextRequirement } from "@/lib/capabilities/taxonomy";

// ── Types ──────────────────────────────────────────────────────────────────────

export type SpecialistListing = {
  /** Source of truth: on-chain PDA address */
  pda: string;
  /** Owner wallet (base58) */
  walletAddress: string;
  /** On-chain fields */
  onchain: OnchainAgent;
  /** Off-chain capability profile (null if not registered off-chain yet) */
  capabilities: {
    taskTypes: TaskTypeId[];
    inputModes: InputModeId[];
    outputModes: OutputModeId[];
    privacyModes: PrivacyModeId[];
    tags: string[];
    baseUsd: number;
    perCallUsd: number;
    /** Per-token prices in US dollars per million tokens, when the listing is priced per token. */
    inputPerMillionUsd?: number;
    outputPerMillionUsd?: number;
    context_requirements: ContextRequirement[];
    runtime_capabilities: RuntimeCapability[];
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
  } | null;
  /** Live health state */
  health: {
    status: "pass" | "fail" | "unknown";
    freshnessState: "fresh" | "warm" | "stale" | "unknown";
    endpointUrl: string | null;
    lastCheckedAt: string | null;
  };
  /** Attestation state */
  attestation: {
    attested: boolean;
    lastAttestedAt: string | null;
  };
  /** SHA-256 of canonical capability profile — use to verify off-chain data integrity */
  capabilityHash: string | null;
  /** Routing / reputation signals */
  signals: {
    feedbackCount: number;
    avgFeedbackScore: number;
    attestationAgreements: number;
    attestationDisagreements: number;
  };
  /** Composite ranking signal for route sorting */
  ranking_score: number;
  /** Index semantics/version metadata */
  indexSemantics: {
    schemaVersion: number;
    rankingFormulaVersion: number;
  };
};

// ── Base58 encode (no dep) ────────────────────────────────────────────────────

const BASE58_ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function toBase58(bytes: Buffer): string {
  let x = BigInt("0x" + bytes.toString("hex") || "0");
  let out = "";
  while (x > 0n) { out = BASE58_ALPHA[Number(x % 58n)] + out; x /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}

// ── Off-chain loaders ─────────────────────────────────────────────────────────

function loadCapabilityIndex(): SpecialistIndexEntry[] {
  try {
    const entries = JSON.parse(
      readFileSync(join(process.cwd(), "data", "onboarding", "specialist-index.json"), "utf8")
    ) as SpecialistIndexEntry[];
    return enrichCapabilityIndexWithOpenRouterProfiles(entries);
  } catch { return enrichCapabilityIndexWithOpenRouterProfiles([]); }
}

type AttestationRecord = {
  walletAddress?: string;
  wallet?: string;
  createdAt?: string;
  recordedAt?: string;
  txSignature?: string;
  localOnly?: boolean;
  status?: string;
};

function loadAttestations(): AttestationRecord[] {
  try {
    return JSON.parse(
      readFileSync(join(process.cwd(), "data", "onboarding", "attestations.json"), "utf8")
    ) as AttestationRecord[];
  } catch { return []; }
}

type SpecialistProfile = {
  walletAddress?: string;
  endpointUrl?: string;
  endpointStatus?: "pending" | "online" | "offline";
  lastHealthcheck?: string;
};

function loadProfiles(): SpecialistProfile[] {
  try {
    const raw = readFileSync(
      join(process.cwd(), "data", "onboarding", "specialist-profile.json"), "utf8"
    );
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch { return []; }
}

// ── Core bridge function ──────────────────────────────────────────────────────

/**
 * Fetch all on-chain AgentAccount PDAs and merge with off-chain capability
 * index, attestation records, and health profiles.
 *
 * Returns listings sorted by: attested first, then health=pass, then
 * descending avgFeedbackScore.
 */
export async function fetchSpecialistListings(): Promise<{
  ok: boolean;
  listings: SpecialistListing[];
  onchainCount: number;
  indexedCount: number;
  error?: string;
}> {
  // With a database configured it is the only source of listings; files are the local development path.
  const stored = await loadListingIndex();
  const capIndex = stored.source === "database" ? stored.entries : loadCapabilityIndex();
  // Files on disk say nothing about database listings, so they cannot mark one healthy or attested.
  const attestations = stored.source === "database" ? [] : loadAttestations();
  const profiles = stored.source === "database" ? [] : loadProfiles();

  let onchainAgents: { pda: string; agent: OnchainAgent }[] = [];

  try {
    const conn = new Connection(DEVNET_RPC, "confirmed");
    const accounts = await conn.getProgramAccounts(REGISTRY_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [
        { memcmp: { offset: 0, bytes: toBase58(ACTIVE_AGENT_ACCOUNT_DISC) } },
        { dataSize: ACTIVE_AGENT_ACCOUNT_DATA_SIZE },
      ],
    });

    onchainAgents = accounts
      .map(({ pubkey, account }) => {
        const agent = decodeActiveAgentAccount(Buffer.from(account.data));
        if (!agent) return null;
        return { pda: pubkey.toBase58(), agent };
      })
      .filter((a): a is { pda: string; agent: OnchainAgent } => a !== null);
  } catch (err) {
    // RPC failure — return off-chain index only
    const listings = capIndex.map((entry) => buildFromIndexOnly(entry));
    return {
      ok: false,
      listings,
      onchainCount: 0,
      indexedCount: capIndex.length,
      error: err instanceof Error ? err.message : "RPC fetch failed",
    };
  }

  // Merge on-chain with off-chain
  const listings: SpecialistListing[] = onchainAgents.map(({ pda, agent }) => {
    const wallet = agent.owner;
    const indexEntry = capIndex.find((e) => e.walletAddress === wallet);
    const attestRecord = attestations.find((a) => (a.walletAddress ?? a.wallet) === wallet);
    const profile = profiles.find((p) => p.walletAddress === wallet);

    const rankingScore = computeSpecialistRankingScore({
      reputationScore: agent.reputationScore,
      healthStreak: indexEntry?.health_streak ?? 0,
      attested: attestRecord != null || indexEntry?.attested === true || agent.attestationAccuracy > 0,
      feedbackAvg: indexEntry?.routingSignals?.avgFeedbackScore ?? 0,
    });

    const capabilities = normalizeCapabilities(indexEntry?.capabilities);

    const signals = indexEntry?.routingSignals ?? {
      feedbackCount: 0,
      avgFeedbackScore: 0,
      attestationAgreements: 0,
      attestationDisagreements: 0,
    };

    return {
      pda,
      walletAddress: wallet,
      onchain: agent,
      capabilities,
      capabilityHash: indexEntry?.capabilityHash ?? null,
      health: {
        status: profile?.endpointStatus === "online" ? "pass"
              : profile?.endpointStatus === "offline" ? "fail"
              : indexEntry?.healthcheckStatus === "pass" ? "pass"
              : indexEntry?.healthcheckStatus === "fail" ? "fail"
              : "unknown",
        freshnessState: indexEntry?.freshness_state ?? "unknown",
        endpointUrl: profile?.endpointUrl ?? indexEntry?.endpointUrl ?? null,
        lastCheckedAt: profile?.lastHealthcheck ?? indexEntry?.last_seen_at ?? indexEntry?.updatedAt ?? null,
      },
      attestation: {
        attested: attestRecord != null || indexEntry?.attested === true || agent.attestationAccuracy > 0,
        lastAttestedAt: attestRecord?.createdAt ?? attestRecord?.recordedAt ?? null,
      },
      signals,
      ranking_score: rankingScore,
      indexSemantics: {
        schemaVersion: indexEntry?.schema_version ?? 1,
        rankingFormulaVersion: indexEntry?.ranking_formula_version ?? 1,
      },
    };
  });

  // Also include off-chain-only entries (registered in index but not yet on-chain RPC)
  const onchainWallets = new Set(onchainAgents.map((a) => a.agent.owner));
  for (const entry of capIndex) {
    if (!onchainWallets.has(entry.walletAddress)) {
      listings.push(buildFromIndexOnly(entry));
    }
  }

  // Sort: attested first, then health pass, then avg feedback score desc
  listings.sort((a, b) => {
    if (a.attestation.attested !== b.attestation.attested)
      return a.attestation.attested ? -1 : 1;
    if (a.health.status !== b.health.status) {
      const healthScore = (s: string) => s === "pass" ? 2 : s === "unknown" ? 1 : 0;
      return healthScore(b.health.status) - healthScore(a.health.status);
    }
    return b.signals.avgFeedbackScore - a.signals.avgFeedbackScore;
  });

  return {
    ok: true,
    listings,
    onchainCount: onchainAgents.length,
    indexedCount: capIndex.length,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalise a value that may be a string[] or comma-separated string. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeArray<T extends string>(raw: any): T[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return (raw as string[]).filter(Boolean) as T[];
  if (typeof raw === "string") return raw.split(",").map((s: string) => s.trim()).filter(Boolean) as T[];
  return [];
}

function buildFromIndexOnly(entry: SpecialistIndexEntry): SpecialistListing {
  const cap = entry.capabilities;
  const rankingScore = computeSpecialistRankingScore({
    reputationScore: entry.reputation_score ?? 0,
    healthStreak: entry.health_streak ?? 0,
    attested: entry.attested === true,
    feedbackAvg: entry.routingSignals?.avgFeedbackScore ?? 0,
  });
  return {
    pda: "",
    walletAddress: entry.walletAddress,
    capabilityHash: entry.capabilityHash ?? null,
    onchain: {
      owner: entry.walletAddress,
      agentType: "Primary",
      model: "",
      rateLamports: 0n,
      minReputation: 0,
      reputationScore: 0,
      jobsCompleted: 0n,
      jobsFailed: 0n,
      createdAt: 0n,
      active: true,
      attestationAccuracy: 0,
    },
    capabilities: normalizeCapabilities(cap),
    health: {
      status: entry.healthcheckStatus === "pass" ? "pass"
            : entry.healthcheckStatus === "fail" ? "fail"
            : "unknown",
      freshnessState: entry.freshness_state ?? "unknown",
      endpointUrl: entry.endpointUrl ?? null,
      lastCheckedAt: entry.last_seen_at ?? entry.updatedAt ?? null,
    },
    attestation: {
      attested: entry.attested === true,
      lastAttestedAt: null,
    },
    signals: entry.routingSignals ?? {
      feedbackCount: 0,
      avgFeedbackScore: 0,
      attestationAgreements: 0,
      attestationDisagreements: 0,
    },
    ranking_score: rankingScore,
    indexSemantics: {
      schemaVersion: entry.schema_version ?? 1,
      rankingFormulaVersion: entry.ranking_formula_version ?? 1,
    },
  };
}

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizeCapabilities(cap: SpecialistIndexEntry["capabilities"] | undefined): SpecialistListing["capabilities"] {
  if (!cap) return null;
  return {
    taskTypes: normalizeArray<TaskTypeId>(cap.taskTypes),
    inputModes: normalizeArray<InputModeId>(cap.inputModes),
    outputModes: normalizeArray<OutputModeId>(cap.outputModes),
    privacyModes: normalizeArray<PrivacyModeId>(cap.privacyModes),
    tags: normalizeArray<string>(cap.tags ?? []),
    baseUsd: typeof cap.pricing === "object" ? (cap.pricing?.baseUsd ?? 0) : 0,
    perCallUsd: typeof cap.pricing === "object" ? (cap.pricing?.perCallUsd ?? 0) : 0,
    ...(typeof cap.pricing === "object" && positiveNumber(cap.pricing?.inputPerMillionUsd) ? { inputPerMillionUsd: cap.pricing!.inputPerMillionUsd } : {}),
    ...(typeof cap.pricing === "object" && positiveNumber(cap.pricing?.outputPerMillionUsd) ? { outputPerMillionUsd: cap.pricing!.outputPerMillionUsd } : {}),
    context_requirements: Array.isArray(cap.context_requirements) ? cap.context_requirements : [],
    runtime_capabilities: Array.isArray(cap.runtime_capabilities) ? normalizeArray<RuntimeCapability>(cap.runtime_capabilities) : [],
    agent_composition: cap.agent_composition
      ? {
          llm: typeof cap.agent_composition.llm === "string" ? cap.agent_composition.llm : undefined,
          control_loop:
            typeof cap.agent_composition.control_loop === "string"
              ? cap.agent_composition.control_loop
              : undefined,
          tools: normalizeArray<string>(cap.agent_composition.tools ?? []),
          skills: normalizeArray<string>(cap.agent_composition.skills ?? []),
          memory: normalizeArray<string>(cap.agent_composition.memory ?? []),
          goals: normalizeArray<string>(cap.agent_composition.goals ?? []),
          external_mcp_servers: normalizeArray<string>(cap.agent_composition.external_mcp_servers ?? []),
          marketplace_agent_calls: normalizeArray<string>(cap.agent_composition.marketplace_agent_calls ?? []),
          non_marketplace_agent_calls: normalizeArray<string>(cap.agent_composition.non_marketplace_agent_calls ?? []),
        }
      : undefined,
    manifest: cap.manifest
      ? {
          profileId: typeof cap.manifest.profileId === "string" ? cap.manifest.profileId : undefined,
          displayName: typeof cap.manifest.displayName === "string" ? cap.manifest.displayName : undefined,
          description: typeof cap.manifest.description === "string" ? cap.manifest.description : undefined,
          roles: normalizeArray<string>(cap.manifest.roles ?? []),
          tools: normalizeArray<string>(cap.manifest.tools ?? []),
          skills: normalizeArray<string>(cap.manifest.skills ?? []),
          marketplace_agent_calls: normalizeArray<string>(cap.manifest.marketplace_agent_calls ?? []),
          external_mcp_servers: normalizeArray<string>(cap.manifest.external_mcp_servers ?? []),
          non_marketplace_agent_calls: normalizeArray<string>(cap.manifest.non_marketplace_agent_calls ?? []),
          preferred_attestors: normalizeArray<string>(cap.manifest.preferred_attestors ?? []),
          disclosure_policy: typeof cap.manifest.disclosure_policy === "string" ? cap.manifest.disclosure_policy : undefined,
        }
      : undefined,
    quality_claims: normalizeArray<string>(cap.quality_claims ?? []),
    attestor_checkpoints: normalizeArray<string>(cap.attestor_checkpoints ?? []),
  };
}
