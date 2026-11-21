import { isValidSolanaPublicKey } from "@redditech/x402-solana";
import type { SpecialistPrice, SpecialistProfile } from "./types.js";
import { getProfile, specialistProfiles } from "./profiles/index.js";

export interface MarketplaceCandidate {
  profileId: string;
  displayName: string;
  endpointPath: string;
  walletAddress?: string;
  capabilities: string[];
  roles: string[];
  price: SpecialistPrice;
  reputationScore: number;
  freshnessScore: number;
  preferredAttestors: string[];
  safetyMode: string;
}

export interface CandidateValidationResult {
  ok: boolean;
  reasons: string[];
}

export interface DiscoveryDiagnostics {
  includedProfileIds: string[];
  excluded: Array<{ profileId: string; reasons: string[] }>;
}

export interface MarketplaceDiscoveryQuery {
  requesterProfileId: string;
  requiredCapabilities: string[];
  maxCandidates?: number;
}

export interface RankedMarketplaceCandidate extends MarketplaceCandidate {
  matchedCapabilities: string[];
  missingCapabilities: string[];
  rankScore: number;
  rankRationale: string[];
}

export interface DelegationPlanRequest {
  task: string;
  requiredCapabilities: string[];
  requesterProfileId: string;
  maxCandidates?: number;
}

export interface DelegationPlan {
  mode: "dry_run";
  status: "planned" | "no_candidates";
  requesterProfileId: string;
  task: string;
  requiredCapabilities: string[];
  liveCallsEnabled: false;
  downstreamCallsExecuted: 0;
  candidates: RankedMarketplaceCandidate[];
  selectedCandidate?: RankedMarketplaceCandidate;
  estimatedCost?: SpecialistPrice;
  requiredAttestor?: string;
  guardrails: string[];
  discoveryDiagnostics?: DiscoveryDiagnostics;
}

export interface MarketplaceDiscoveryClient {
  discover(query: MarketplaceDiscoveryQuery): Promise<MarketplaceCandidate[]>;
  diagnostics?(): DiscoveryDiagnostics;
}

export interface WalletManifestProfile {
  profileId: string;
  displayName: string;
  publicKey: string;
}

export interface WalletManifest {
  schemaVersion: string;
  network: "solana-devnet";
  minimumBalanceLamports: number;
  generatedAt?: string;
  profiles: WalletManifestProfile[];
}

const STATIC_REPUTATION: Record<string, { reputationScore: number; freshnessScore: number }> = {
  "planning-agent": { reputationScore: 0.91, freshnessScore: 0.92 },
  "document-intelligence-agent": { reputationScore: 0.88, freshnessScore: 0.9 },
  "verification-validation-agent": { reputationScore: 0.93, freshnessScore: 0.91 },
  "code-generation-agent": { reputationScore: 0.9, freshnessScore: 0.89 },
  "conversational-agent": { reputationScore: 0.84, freshnessScore: 0.88 },
};

export class StaticMarketplaceDiscoveryClient implements MarketplaceDiscoveryClient {
  constructor(private readonly profiles: SpecialistProfile[] = specialistProfiles) {}

  async discover(query: MarketplaceDiscoveryQuery): Promise<MarketplaceCandidate[]> {
    const required = normalizeCapabilities(query.requiredCapabilities);
    return this.profiles
      .filter((profile) => profile.id !== query.requesterProfileId)
      .filter((profile) => profile.roles.includes("specialist"))
      .filter((profile) => required.length === 0 || normalizeCapabilities(profile.capabilities).some((capability) => required.includes(capability)))
      .map(toCandidate);
  }

  diagnostics(): DiscoveryDiagnostics {
    return {
      includedProfileIds: this.profiles.map((profile) => profile.id).sort(),
      excluded: [],
    };
  }
}

export class ManifestMarketplaceDiscoveryClient implements MarketplaceDiscoveryClient {
  private readonly candidates: MarketplaceCandidate[];
  private readonly excluded: Array<{ profileId: string; reasons: string[] }>;

  constructor(manifest: WalletManifest, private readonly profiles: SpecialistProfile[] = specialistProfiles) {
    const built = candidatesFromWalletManifest(manifest, profiles);
    this.candidates = built.candidates;
    this.excluded = built.excluded;
  }

  async discover(query: MarketplaceDiscoveryQuery): Promise<MarketplaceCandidate[]> {
    const required = normalizeCapabilities(query.requiredCapabilities);
    return this.candidates
      .filter((candidate) => candidate.profileId !== query.requesterProfileId)
      .filter((candidate) => candidate.roles.includes("specialist"))
      .filter((candidate) => required.length === 0 || normalizeCapabilities(candidate.capabilities).some((capability) => required.includes(capability)));
  }

  diagnostics(): DiscoveryDiagnostics {
    return {
      includedProfileIds: this.candidates.map((candidate) => candidate.profileId).sort(),
      excluded: [...this.excluded],
    };
  }
}

export function candidatesFromWalletManifest(
  manifest: WalletManifest,
  profiles: SpecialistProfile[] = specialistProfiles,
): { candidates: MarketplaceCandidate[]; excluded: Array<{ profileId: string; reasons: string[] }> } {
  const candidates: MarketplaceCandidate[] = [];
  const excluded: Array<{ profileId: string; reasons: string[] }> = [];
  const seenProfileIds = new Set<string>();
  const seenWallets = new Set<string>();

  if (manifest.network !== "solana-devnet") {
    return {
      candidates,
      excluded: manifest.profiles.map((entry) => ({ profileId: entry.profileId ?? "unknown", reasons: [`unsupported network ${manifest.network}`] })),
    };
  }

  for (const entry of manifest.profiles) {
    const reasons: string[] = [];
    const profile = getProfileFrom(entry.profileId, profiles);
    if (!profile) reasons.push("profile not found in specialist registry");
    if (seenProfileIds.has(entry.profileId)) reasons.push("duplicate profileId in wallet manifest");
    seenProfileIds.add(entry.profileId);
    if (!entry.publicKey || !isValidSolanaPublicKey(entry.publicKey)) reasons.push("invalid Solana public key");
    if (seenWallets.has(entry.publicKey)) reasons.push("duplicate public key in wallet manifest");
    seenWallets.add(entry.publicKey);
    if (profile && profile.walletAddress !== entry.publicKey) reasons.push("manifest public key does not match specialist profile wallet");

    if (!profile || reasons.length > 0) {
      excluded.push({ profileId: entry.profileId ?? "unknown", reasons });
      continue;
    }

    const candidate = toCandidate(profile);
    candidate.walletAddress = entry.publicKey;
    const validation = validateMarketplaceCandidate(candidate);
    if (!validation.ok) {
      excluded.push({ profileId: entry.profileId, reasons: validation.reasons });
      continue;
    }
    candidates.push(candidate);
  }

  return { candidates, excluded };
}

export function validateMarketplaceCandidate(candidate: MarketplaceCandidate): CandidateValidationResult {
  const reasons: string[] = [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.profileId)) reasons.push("invalid profileId");
  if (!candidate.displayName.trim()) reasons.push("missing displayName");
  if (!candidate.endpointPath.startsWith("/")) reasons.push("endpointPath must be relative path");
  if (!candidate.walletAddress || !isValidSolanaPublicKey(candidate.walletAddress)) reasons.push("missing or invalid walletAddress");
  if (!candidate.roles.includes("specialist")) reasons.push("candidate must include specialist role");
  if (candidate.capabilities.length === 0) reasons.push("missing capabilities");
  if (!candidate.price.amount || !candidate.price.currency || !candidate.price.unit) reasons.push("invalid price");
  if (!Number.isFinite(candidate.reputationScore) || candidate.reputationScore < 0 || candidate.reputationScore > 1) reasons.push("reputationScore must be 0..1");
  if (!Number.isFinite(candidate.freshnessScore) || candidate.freshnessScore < 0 || candidate.freshnessScore > 1) reasons.push("freshnessScore must be 0..1");
  return { ok: reasons.length === 0, reasons };
}

export function normalizeCapabilities(capabilities: string[]): string[] {
  return [...new Set(capabilities.map((capability) => capability.trim().toLowerCase()).filter(Boolean))].sort();
}

export function inferRequiredCapabilities(task: string): string[] {
  const normalized = task.toLowerCase();
  const inferred = new Set<string>();
  const addWhen = (pattern: RegExp, capability: string) => {
    if (pattern.test(normalized)) inferred.add(capability);
  };

  addWhen(/\b(document|pdf|evidence|extract|summari[sz]e|classif)/, "document-analysis");
  addWhen(/\b(code|bug|debug|test|typescript|api|implementation|build)\b/, "code-generation");
  addWhen(/\b(verify|validate|attest|quality|review|evidence)\b/, "verification");
  addWhen(/\b(plan|roadmap|sequence|milestone|orchestrat)/, "planning");
  addWhen(/\b(intake|clarify|conversation|support|handoff)\b/, "conversation");

  return [...inferred].sort();
}

export function rankMarketplaceCandidates(candidates: MarketplaceCandidate[], requiredCapabilities: string[]): RankedMarketplaceCandidate[] {
  const required = normalizeCapabilities(requiredCapabilities);
  return candidates
    .map((candidate) => rankCandidate(candidate, required))
    .sort((a, b) => b.rankScore - a.rankScore || priceAsNumber(a.price) - priceAsNumber(b.price) || b.reputationScore - a.reputationScore || a.profileId.localeCompare(b.profileId));
}

export async function buildDryRunDelegationPlan(input: {
  request: DelegationPlanRequest;
  discoveryClient?: MarketplaceDiscoveryClient;
}): Promise<DelegationPlan> {
  const requiredCapabilities = normalizeCapabilities(input.request.requiredCapabilities);
  const discoveryClient = input.discoveryClient ?? new StaticMarketplaceDiscoveryClient();
  const candidates = rankMarketplaceCandidates(
    await discoveryClient.discover({
      requesterProfileId: input.request.requesterProfileId,
      requiredCapabilities,
      maxCandidates: input.request.maxCandidates,
    }),
    requiredCapabilities,
  ).slice(0, input.request.maxCandidates ?? 3);
  const selectedCandidate = candidates[0];

  return {
    mode: "dry_run",
    status: selectedCandidate ? "planned" : "no_candidates",
    requesterProfileId: input.request.requesterProfileId,
    task: input.request.task,
    requiredCapabilities,
    liveCallsEnabled: false,
    downstreamCallsExecuted: 0,
    candidates,
    selectedCandidate,
    estimatedCost: selectedCandidate?.price,
    requiredAttestor: selectedCandidate?.preferredAttestors[0] ?? "verification-validation-agent",
    guardrails: [
      "dry-run only: no downstream x402 negotiation executed",
      "no devnet SOL spent",
      "no signer or private-key material used",
      "set ENABLE_AGENT_TO_AGENT_CALLS=true only in a later live-call iteration",
    ],
    discoveryDiagnostics: discoveryClient.diagnostics?.(),
  };
}

function toCandidate(profile: SpecialistProfile): MarketplaceCandidate {
  const scores = STATIC_REPUTATION[profile.id] ?? { reputationScore: 0.75, freshnessScore: 0.75 };
  return {
    profileId: profile.id,
    displayName: profile.displayName,
    endpointPath: profile.endpointPath,
    walletAddress: profile.walletAddress,
    capabilities: profile.capabilities,
    roles: profile.roles,
    price: profile.price,
    reputationScore: scores.reputationScore,
    freshnessScore: scores.freshnessScore,
    preferredAttestors: profile.preferredAttestors,
    safetyMode: profile.safetyMode,
  };
}

function getProfileFrom(id: string, profiles: SpecialistProfile[]): SpecialistProfile | undefined {
  return profiles.find((profile) => profile.id === id) ?? getProfile(id);
}

function rankCandidate(candidate: MarketplaceCandidate, requiredCapabilities: string[]): RankedMarketplaceCandidate {
  const candidateCapabilities = normalizeCapabilities(candidate.capabilities);
  const matchedCapabilities = requiredCapabilities.filter((capability) => candidateCapabilities.includes(capability));
  const missingCapabilities = requiredCapabilities.filter((capability) => !candidateCapabilities.includes(capability));
  const capabilityScore = requiredCapabilities.length === 0 ? 0.5 : matchedCapabilities.length / requiredCapabilities.length;
  const affordabilityScore = Math.max(0, 1 - priceAsNumber(candidate.price));
  const rankScore = Number((capabilityScore * 70 + candidate.reputationScore * 15 + candidate.freshnessScore * 10 + affordabilityScore * 5).toFixed(4));
  return {
    ...candidate,
    matchedCapabilities,
    missingCapabilities,
    rankScore,
    rankRationale: [
      `matched ${matchedCapabilities.length}/${requiredCapabilities.length} required capabilities`,
      `reputation=${candidate.reputationScore.toFixed(2)}`,
      `freshness=${candidate.freshnessScore.toFixed(2)}`,
      `price=${candidate.price.amount} ${candidate.price.currency}/${candidate.price.unit}`,
    ],
  };
}

function priceAsNumber(price: SpecialistPrice): number {
  const parsed = Number.parseFloat(price.amount);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
