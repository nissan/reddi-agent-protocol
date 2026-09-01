import devnetProfile from "@/config/networks/devnet.json" with { type: "json" };
import localSurfpoolProfile from "@/config/networks/local-surfpool.json" with { type: "json" };
import mainnetProfile from "@/config/networks/mainnet.json" with { type: "json" };
import quasarDeployments from "@/config/quasar/deployments.json" with { type: "json" };

export type NetworkProfileName = "local-surfpool" | "devnet" | "mainnet";
export type ProgramTarget = "legacy-anchor" | "quasar";
export type DeploymentStatus = "local-only" | "devnet-deployed" | "mainnet-not-deployed";

export type NetworkProfile = {
  name: NetworkProfileName;
  solana: {
    cluster: "localnet" | "devnet" | "mainnet-beta";
    rpcHttp: string;
    rpcWs?: string;
    explorerClusterParam: "custom" | "devnet" | "mainnet";
  };
  programs: {
    escrowProgramId: string;
    registryProgramId?: string;
    reputationProgramId?: string;
    attestationProgramId?: string;
    target: ProgramTarget;
    framework: "anchor" | "quasar";
    compatibility: "anchor-layout" | "quasar-layout-unverified";
    submissionReady: boolean;
    submissionReadyReason?: string;
    knownGaps: string[];
    knownLimitations?: string[];
    deploymentStatus: DeploymentStatus;
    activationGate?: string;
    /**
     * Set when the requested target resolves to a deployment the canonical record marks non-ready.
     * Resolution stays non-throwing so disclosure surfaces can render the reason; effect sites call
     * assertProgramTargetUsable() to refuse before building instructions, signing, or reaching RPC.
     */
    blocked?: { target: ProgramTarget; reason: string; knownGaps: string[] };
  };
  payments: {
    jupiterApiBase: string;
    perRpc: string;
    paymentsApiBase: string;
  };
  features: {
    allowPerFallback: boolean;
    requireMintReadiness: boolean;
  };
};

const PROFILES: Record<NetworkProfileName, NetworkProfile> = {
  "local-surfpool": localSurfpoolProfile as NetworkProfile,
  devnet: devnetProfile as NetworkProfile,
  // mainnet.json carries an escrowProgramIdNote annotation key (placeholder
  // program id, gated on external audit) that is not part of NetworkProfile,
  // so the direct cast is not assignable in either direction.
  mainnet: mainnetProfile as unknown as NetworkProfile,
};

function readEnv(): Record<string, string | undefined> {
  return {
    NETWORK_PROFILE: process.env.NETWORK_PROFILE,
    NEXT_PUBLIC_NETWORK_PROFILE: process.env.NEXT_PUBLIC_NETWORK_PROFILE,
    NEXT_PUBLIC_BUILD_NETWORK_PROFILE: process.env.NEXT_PUBLIC_BUILD_NETWORK_PROFILE,
    NEXT_PUBLIC_DEMO_PROGRAM_TARGET: process.env.NEXT_PUBLIC_DEMO_PROGRAM_TARGET,
    HACKATHON_DEMO_TARGET: process.env.HACKATHON_DEMO_TARGET,
    DEMO_PROGRAM_TARGET: process.env.DEMO_PROGRAM_TARGET,
    NEXT_PUBLIC_RPC_ENDPOINT: process.env.NEXT_PUBLIC_RPC_ENDPOINT,
    NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
    NEXT_PUBLIC_RPC_WS_ENDPOINT: process.env.NEXT_PUBLIC_RPC_WS_ENDPOINT,
    DEMO_DEVNET_RPC: process.env.DEMO_DEVNET_RPC,
    NEXT_PUBLIC_ESCROW_PROGRAM_ID: process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID,
    DEMO_ESCROW_PROGRAM_ID: process.env.DEMO_ESCROW_PROGRAM_ID,
    NEXT_PUBLIC_REGISTRY_PROGRAM_ID: process.env.NEXT_PUBLIC_REGISTRY_PROGRAM_ID,
    DEMO_REGISTRY_PROGRAM_ID: process.env.DEMO_REGISTRY_PROGRAM_ID,
    NEXT_PUBLIC_REPUTATION_PROGRAM_ID: process.env.NEXT_PUBLIC_REPUTATION_PROGRAM_ID,
    DEMO_REPUTATION_PROGRAM_ID: process.env.DEMO_REPUTATION_PROGRAM_ID,
    NEXT_PUBLIC_ATTESTATION_PROGRAM_ID: process.env.NEXT_PUBLIC_ATTESTATION_PROGRAM_ID,
    DEMO_ATTESTATION_PROGRAM_ID: process.env.DEMO_ATTESTATION_PROGRAM_ID,
    ALLOW_UNSAFE_ESCROW_OVERRIDE: process.env.ALLOW_UNSAFE_ESCROW_OVERRIDE,
    NEXT_PUBLIC_BUILD_ALLOW_UNSAFE_ESCROW_OVERRIDE: process.env.NEXT_PUBLIC_BUILD_ALLOW_UNSAFE_ESCROW_OVERRIDE,
    JUPITER_API_BASE: process.env.JUPITER_API_BASE,
    NEXT_PUBLIC_PER_RPC: process.env.NEXT_PUBLIC_PER_RPC,
    DEMO_PER_RPC: process.env.DEMO_PER_RPC,
    DEMO_PAYMENTS_API_BASE_URL: process.env.DEMO_PAYMENTS_API_BASE_URL,
    DEMO_ALLOW_FALLBACK: process.env.DEMO_ALLOW_FALLBACK,
    DEMO_REQUIRE_MINT_READY: process.env.DEMO_REQUIRE_MINT_READY,
  };
}

function pickEnv(...keys: string[]): string | undefined {
  const env = readEnv();
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** True when `value` base58-decodes to exactly 32 bytes, i.e. `new PublicKey(value)` will accept it. */
export function isValidProgramId(value: string): boolean {
  if (!value) return false;

  let leadingZeroBytes = 0;
  while (leadingZeroBytes < value.length && value[leadingZeroBytes] === "1") leadingZeroBytes += 1;

  let decoded = 0n;
  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) return false;
    decoded = decoded * 58n + BigInt(digit);
  }

  let significantBytes = 0;
  for (let remaining = decoded; remaining > 0n; remaining >>= 8n) significantBytes += 1;

  return leadingZeroBytes + significantBytes === 32;
}

export function resolveNetworkProfileName(): NetworkProfileName {
  const raw = (
    pickEnv("NETWORK_PROFILE", "NEXT_PUBLIC_BUILD_NETWORK_PROFILE", "NEXT_PUBLIC_NETWORK_PROFILE") ?? "devnet"
  ).toLowerCase();

  if (raw === "local-surfpool" || raw === "local" || raw === "localnet" || raw === "surfpool") return "local-surfpool";
  if (raw === "mainnet" || raw === "mainnet-beta") return "mainnet";
  return "devnet";
}

export function resolveProgramTarget(): ProgramTarget {
  const raw = (
    pickEnv("NEXT_PUBLIC_DEMO_PROGRAM_TARGET", "HACKATHON_DEMO_TARGET", "DEMO_PROGRAM_TARGET") ?? "legacy-anchor"
  ).toLowerCase();

  if (raw === "quasar") return "quasar";
  return "legacy-anchor";
}

export function getNetworkProfile(): NetworkProfile {
  const name = resolveNetworkProfileName();
  const base = PROFILES[name];
  const requestedTarget = resolveProgramTarget();
  const quasarDevnet = quasarDeployments.quasarDeployments.devnet;

  const quasarRequestRefused = requestedTarget === "quasar" && name !== "devnet";
  const target: ProgramTarget = requestedTarget === "quasar" && name === "devnet" ? "quasar" : "legacy-anchor";
  const quasarDeploymentBlocked = target === "quasar" && quasarDeployments.submissionReady !== true;

  const rpcOverride = pickEnv("NEXT_PUBLIC_RPC_ENDPOINT", "NEXT_PUBLIC_RPC_URL", "DEMO_DEVNET_RPC");
  const escrowOverride = pickEnv("NEXT_PUBLIC_ESCROW_PROGRAM_ID", "DEMO_ESCROW_PROGRAM_ID");
  const buildUnsafeOverride = pickEnv("NEXT_PUBLIC_BUILD_ALLOW_UNSAFE_ESCROW_OVERRIDE");
  const allowUnsafeDevnetOverride = (buildUnsafeOverride ?? pickEnv("ALLOW_UNSAFE_ESCROW_OVERRIDE")) === "true";

  const quasarPrograms = quasarDevnet.programIds ?? { escrow: quasarDevnet.programId };
  const targetProgramId = target === "quasar" ? quasarPrograms.escrow : base.programs.escrowProgramId;
  const malformedOverrides: string[] = [];
  const ignoredOverrides: string[] = [];
  const applyProgramIdOverride = (label: string, override: string | undefined, registered: string): string => {
    if (!override) return registered;
    if (!isValidProgramId(override)) {
      malformedOverrides.push(label);
      return registered;
    }
    if (name === "devnet" && override !== registered && !allowUnsafeDevnetOverride) {
      ignoredOverrides.push(label);
      return registered;
    }
    return override;
  };

  const effectiveEscrowProgramId = applyProgramIdOverride("escrow", escrowOverride, targetProgramId);
  const effectiveRegistryProgramId = applyProgramIdOverride(
    "registry",
    pickEnv("NEXT_PUBLIC_REGISTRY_PROGRAM_ID", "DEMO_REGISTRY_PROGRAM_ID"),
    target === "quasar" ? quasarPrograms.registry : effectiveEscrowProgramId,
  );
  const effectiveReputationProgramId = applyProgramIdOverride(
    "reputation",
    pickEnv("NEXT_PUBLIC_REPUTATION_PROGRAM_ID", "DEMO_REPUTATION_PROGRAM_ID"),
    target === "quasar" ? quasarPrograms.reputation : effectiveEscrowProgramId,
  );
  const effectiveAttestationProgramId = applyProgramIdOverride(
    "attestation",
    pickEnv("NEXT_PUBLIC_ATTESTATION_PROGRAM_ID", "DEMO_ATTESTATION_PROGRAM_ID"),
    target === "quasar" ? quasarPrograms.attestation : effectiveEscrowProgramId,
  );

  const malformedOverrideKnownGaps = malformedOverrides.length
    ? [
        `The ${malformedOverrides.join(", ")} program id override${
          malformedOverrides.length === 1 ? " is" : "s are"
        } not a valid 32-byte base58 Solana address; ${
          malformedOverrides.length === 1 ? "it was" : "they were"
        } ignored and the registered program id is used instead.`,
      ]
    : [];

  const ignoredOverrideKnownGaps = ignoredOverrides.length
    ? [
        `The ${ignoredOverrides.join(", ")} program id override${
          ignoredOverrides.length === 1 ? " does" : "s do"
        } not match the registered devnet program set and the build-time unsafe-override flag was not set; ${
          ignoredOverrides.length === 1 ? "it was" : "they were"
        } ignored and the registered program id is used instead.`,
      ]
    : [];

  const escrowIsConfiguredPlaceholder = effectiveEscrowProgramId === base.programs.escrowProgramId;
  const aliasedProgramLabels = (
    [
      ["registry", effectiveRegistryProgramId],
      ["reputation", effectiveReputationProgramId],
      ["attestation", effectiveAttestationProgramId],
    ] as const
  )
    .filter(([, programId]) => programId === effectiveEscrowProgramId)
    .map(([label]) => label);

  const aliasDisclosure = aliasedProgramLabels.length
    ? ` No distinct mainnet id is configured for ${
        aliasedProgramLabels.length === 1
          ? aliasedProgramLabels[0]
          : `${aliasedProgramLabels.slice(0, -1).join(", ")} and ${aliasedProgramLabels[aliasedProgramLabels.length - 1]}`
      }, so ${aliasedProgramLabels.length === 1 ? "it aliases" : "they alias"} to the escrow program id on this profile.`
    : "";

  const mainnetKnownGaps = name === "mainnet"
    ? [
        (escrowIsConfiguredPlaceholder
          ? "No audited mainnet program deployment is registered; the configured escrow id is still the placeholder devnet id."
          : "The mainnet escrow id is supplied by an environment override, but no audited mainnet deployment is registered for it in config/networks/mainnet.json.") + aliasDisclosure,
        "External audit, upgrade-authority custody, paid RPC, monitoring, and incident-response gates remain unresolved before mainnet activation.",
        ...(requestedTarget === "quasar"
          ? [
              `A Quasar program target was requested for mainnet, but no mainnet Quasar deployment is registered; the request is refused and the profile stays blocked${
                escrowIsConfiguredPlaceholder ? " on the legacy placeholder id" : ""
              }.`,
            ]
          : []),
      ]
    : [];

  const localSurfpoolKnownGaps = name === "local-surfpool" && quasarRequestRefused
    ? [
        "A Quasar program target was requested for local-surfpool, but no Quasar deployment is registered for that profile; the request is refused and the profile stays on the legacy Anchor program id.",
      ]
    : [];

  return {
    ...base,
    solana: {
      ...base.solana,
      rpcHttp: rpcOverride ?? base.solana.rpcHttp,
      rpcWs: pickEnv("NEXT_PUBLIC_RPC_WS_ENDPOINT") ?? base.solana.rpcWs,
    },
    programs: {
      ...base.programs,
      escrowProgramId: effectiveEscrowProgramId,
      registryProgramId: effectiveRegistryProgramId,
      reputationProgramId: effectiveReputationProgramId,
      attestationProgramId: effectiveAttestationProgramId,
      target,
      framework: target === "quasar" ? "quasar" : "anchor",
      compatibility: target === "quasar" ? "quasar-layout-unverified" : "anchor-layout",
      submissionReady:
        name === "mainnet" || quasarRequestRefused || malformedOverrides.length > 0 || ignoredOverrides.length > 0 || quasarDeploymentBlocked
          ? false
          : target === "quasar"
            ? quasarDeployments.submissionReady
            : true,
      submissionReadyReason:
        name === "mainnet"
          ? "Mainnet activation is blocked: no audited mainnet deployment is registered and the Quasar four-program set cannot be resolved for mainnet."
          : quasarRequestRefused
            ? `A Quasar program target was requested for ${name}, which has no registered Quasar deployment; the request is refused.`
            : malformedOverrides.length > 0
              ? `A malformed program id override was supplied for ${malformedOverrides.join(", ")}; it was ignored and the registered program id is used instead, so the configured override is not in effect.`
              : ignoredOverrides.length > 0
                ? `A program id override was supplied for ${ignoredOverrides.join(", ")}, but it does not match the registered devnet program set and the build-time unsafe-override flag was not set; the registered program id is used instead.`
                : quasarDeploymentBlocked
                  ? quasarDeployments.submissionReadyReason
                  : target === "quasar"
                    ? quasarDeployments.submissionReadyReason
                    : undefined,
      knownGaps: [
        ...(target === "quasar" ? quasarDevnet.knownGaps : []),
        ...malformedOverrideKnownGaps,
        ...ignoredOverrideKnownGaps,
        ...mainnetKnownGaps,
        ...localSurfpoolKnownGaps,
      ],
      knownLimitations: target === "quasar" ? quasarDevnet.knownLimitations ?? [] : [],
      deploymentStatus:
        name === "mainnet" ? "mainnet-not-deployed" : name === "local-surfpool" ? "local-only" : "devnet-deployed",
      activationGate: name === "mainnet" ? "external_audit_and_mainnet_deployment_required" : undefined,
      blocked: quasarDeploymentBlocked
        ? {
            target,
            reason:
              quasarDeployments.submissionReadyReason ??
              "the recorded Quasar deployment is not submission-ready",
            knownGaps: quasarDevnet.knownGaps,
          }
        : undefined,
    },
    payments: {
      ...base.payments,
      jupiterApiBase: pickEnv("JUPITER_API_BASE") ?? base.payments.jupiterApiBase,
      perRpc: pickEnv("NEXT_PUBLIC_PER_RPC", "DEMO_PER_RPC") ?? base.payments.perRpc,
      paymentsApiBase: pickEnv("DEMO_PAYMENTS_API_BASE_URL") ?? base.payments.paymentsApiBase,
    },
    features: {
      ...base.features,
      allowPerFallback:
        pickEnv("DEMO_ALLOW_FALLBACK") === undefined
          ? base.features.allowPerFallback
          : pickEnv("DEMO_ALLOW_FALLBACK") === "true",
      requireMintReadiness:
        pickEnv("DEMO_REQUIRE_MINT_READY") === undefined
          ? base.features.requireMintReadiness
          : pickEnv("DEMO_REQUIRE_MINT_READY") === "true",
    },
  };
}

/**
 * Describes why the active program target must not be used to touch chain state, or undefined when
 * it is usable. Effect sites (instruction builders, signers, RPC submitters) call this before doing
 * any work; read-only disclosure surfaces render `programs.blocked` instead.
 */
export function describeBlockedProgramTarget(profile: NetworkProfile = getNetworkProfile()): string | undefined {
  const blocked = profile.programs.blocked;
  if (!blocked) return undefined;
  return [
    `The "${blocked.target}" program target is refused against the ${profile.name} profile because the recorded deployment is not usable.`,
    blocked.reason,
    blocked.knownGaps.length ? `Known gaps: ${blocked.knownGaps.join(" | ")}` : "",
    "Use the local Surfpool Quasar lane (npm run test:surfpool:quasar-critical) against locally built current-source programs instead.",
  ].filter(Boolean).join(" ");
}

export function assertProgramTargetUsable(profile: NetworkProfile = getNetworkProfile()): void {
  const refusal = describeBlockedProgramTarget(profile);
  if (refusal) throw new Error(refusal);
}
