import devnetProfile from "@/config/networks/devnet.json" with { type: "json" };
import localSurfpoolProfile from "@/config/networks/local-surfpool.json" with { type: "json" };
import mainnetProfile from "@/config/networks/mainnet.json" with { type: "json" };
import quasarDeployments from "@/config/quasar/deployments.json" with { type: "json" };

import { isLoopbackRpcUrl } from "@/lib/config/loopback-endpoint";

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
     * Set when the requested target cannot be used to touch chain state. `cause` says which refusal
     * applies, because the remedies differ: a `recorded-deployment` block is about binaries this
     * client no longer matches, an `unregistered-deployment` block is about a profile with no Quasar
     * deployment at all, and a `local-configuration` block is about the operator's own local run —
     * the four program ids and the loopback endpoints it is pointed at.
     * Resolution stays non-throwing so disclosure surfaces can render the reason; every exported
     * Quasar instruction builder calls assertQuasarProgramTargetUsable() — which consults this block
     * first — to refuse before building instructions, signing, or reaching RPC.
     */
    blocked?: {
      target: ProgramTarget;
      cause: "recorded-deployment" | "unregistered-deployment" | "local-configuration";
      reason: string;
      knownGaps: string[];
    };
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

function pickEnvEntry(...keys: string[]): { key: string; value: string } | undefined {
  const env = readEnv();
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return { key, value };
  }
  return undefined;
}

function pickEnv(...keys: string[]): string | undefined {
  return pickEnvEntry(...keys)?.value;
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

  const rpcOverride = pickEnvEntry("NEXT_PUBLIC_RPC_ENDPOINT", "NEXT_PUBLIC_RPC_URL", "DEMO_DEVNET_RPC");
  const rpcWsOverride = pickEnvEntry("NEXT_PUBLIC_RPC_WS_ENDPOINT");
  const escrowOverride = pickEnv("NEXT_PUBLIC_ESCROW_PROGRAM_ID", "DEMO_ESCROW_PROGRAM_ID");
  const registryOverride = pickEnv("NEXT_PUBLIC_REGISTRY_PROGRAM_ID", "DEMO_REGISTRY_PROGRAM_ID");
  const reputationOverride = pickEnv("NEXT_PUBLIC_REPUTATION_PROGRAM_ID", "DEMO_REPUTATION_PROGRAM_ID");
  const attestationOverride = pickEnv("NEXT_PUBLIC_ATTESTATION_PROGRAM_ID", "DEMO_ATTESTATION_PROGRAM_ID");
  const buildUnsafeOverride = pickEnv("NEXT_PUBLIC_BUILD_ALLOW_UNSAFE_ESCROW_OVERRIDE");
  const allowUnsafeDevnetOverride = (buildUnsafeOverride ?? pickEnv("ALLOW_UNSAFE_ESCROW_OVERRIDE")) === "true";

  const localQuasarProgramEntries = [
    ["escrow", escrowOverride],
    ["registry", registryOverride],
    ["reputation", reputationOverride],
    ["attestation", attestationOverride],
  ] as const;
  const missingLocalQuasarPrograms = localQuasarProgramEntries.filter(([, id]) => !id).map(([label]) => label);
  const malformedLocalQuasarPrograms = localQuasarProgramEntries
    .filter(([, id]) => id !== undefined && !isValidProgramId(id))
    .map(([label]) => label);
  const duplicateLocalQuasarPrograms: string[] = [];
  const localQuasarProgramOwners = new Map<string, string>();
  for (const [label, id] of localQuasarProgramEntries) {
    if (!id || !isValidProgramId(id)) continue;
    const owner = localQuasarProgramOwners.get(id);
    if (owner) duplicateLocalQuasarPrograms.push(`${label} duplicates ${owner}`);
    else localQuasarProgramOwners.set(id, label);
  }
  const resolvedRpcHttp = rpcOverride?.value ?? base.solana.rpcHttp;
  const resolvedRpcWs = rpcWsOverride?.value ?? base.solana.rpcWs;
  const nonLoopbackLocalQuasarEndpoints = [
    ...(isLoopbackRpcUrl(resolvedRpcHttp)
      ? []
      : [rpcOverride ? rpcOverride.key : `${name} profile RPC endpoint`]),
    ...(!resolvedRpcWs || isLoopbackRpcUrl(resolvedRpcWs)
      ? []
      : [rpcWsOverride ? rpcWsOverride.key : `${name} profile websocket endpoint`]),
  ];

  const localQuasarConfigReady =
    name === "local-surfpool" &&
    requestedTarget === "quasar" &&
    missingLocalQuasarPrograms.length === 0 &&
    malformedLocalQuasarPrograms.length === 0 &&
    duplicateLocalQuasarPrograms.length === 0 &&
    nonLoopbackLocalQuasarEndpoints.length === 0;

  const quasarRequestRefused =
    requestedTarget === "quasar" &&
    (name === "mainnet" || (name === "local-surfpool" && !localQuasarConfigReady));
  const target: ProgramTarget = requestedTarget === "quasar" && !quasarRequestRefused ? "quasar" : "legacy-anchor";
  const quasarDeploymentBlocked = target === "quasar" && name === "devnet" && quasarDeployments.submissionReady !== true;

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
    registryOverride,
    target === "quasar" ? quasarPrograms.registry : effectiveEscrowProgramId,
  );
  const effectiveReputationProgramId = applyProgramIdOverride(
    "reputation",
    reputationOverride,
    target === "quasar" ? quasarPrograms.reputation : effectiveEscrowProgramId,
  );
  const effectiveAttestationProgramId = applyProgramIdOverride(
    "attestation",
    attestationOverride,
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

  const localQuasarProgramProblems = [
    ...(missingLocalQuasarPrograms.length ? [`missing ${missingLocalQuasarPrograms.join(", ")} program id${missingLocalQuasarPrograms.length === 1 ? "" : "s"}`] : []),
    ...(malformedLocalQuasarPrograms.length ? [`malformed ${malformedLocalQuasarPrograms.join(", ")} program id${malformedLocalQuasarPrograms.length === 1 ? "" : "s"}`] : []),
    ...(duplicateLocalQuasarPrograms.length ? [`duplicate program ids: ${duplicateLocalQuasarPrograms.join(", ")}`] : []),
    ...(nonLoopbackLocalQuasarEndpoints.length
      ? [`non-loopback ${nonLoopbackLocalQuasarEndpoints.join(", ")}`]
      : []),
  ];
  const localQuasarRefusalReason =
    "A Quasar program target was requested for local-surfpool, but the profile must provide four distinct valid local program IDs (escrow, registry, reputation, and attestation) and loopback-only http/ws endpoints; the request is refused rather than silently using a legacy Anchor layout or sending Quasar-encoded instructions to a live cluster.";
  const localSurfpoolKnownGaps = name === "local-surfpool" && quasarRequestRefused
    ? [
        localQuasarProgramProblems.length
          ? `${localQuasarRefusalReason} Problems: ${localQuasarProgramProblems.join("; ")}.`
          : localQuasarRefusalReason,
      ]
    : [];

  return {
    ...base,
    solana: {
      ...base.solana,
      rpcHttp: resolvedRpcHttp,
      rpcWs: resolvedRpcWs,
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
          : target === "quasar" && name === "devnet"
            ? quasarDeployments.submissionReady
            : true,
      submissionReadyReason:
        name === "mainnet"
          ? "Mainnet activation is blocked: no audited mainnet deployment is registered and the Quasar four-program set cannot be resolved for mainnet."
          : quasarRequestRefused
            ? name === "local-surfpool"
              ? localQuasarRefusalReason
              : `A Quasar program target was requested for ${name}, which has no registered Quasar deployment; the request is refused.`
            : malformedOverrides.length > 0
              ? `A malformed program id override was supplied for ${malformedOverrides.join(", ")}; it was ignored and the registered program id is used instead, so the configured override is not in effect.`
              : ignoredOverrides.length > 0
                ? `A program id override was supplied for ${ignoredOverrides.join(", ")}, but it does not match the registered devnet program set and the build-time unsafe-override flag was not set; the registered program id is used instead.`
                : quasarDeploymentBlocked
                  ? quasarDeployments.submissionReadyReason
                  : target === "quasar" && name === "devnet"
                    ? quasarDeployments.submissionReadyReason
                    : undefined,
      knownGaps: [
        ...(target === "quasar" && name === "devnet" ? quasarDevnet.knownGaps : []),
        ...malformedOverrideKnownGaps,
        ...ignoredOverrideKnownGaps,
        ...mainnetKnownGaps,
        ...localSurfpoolKnownGaps,
      ],
      knownLimitations: target === "quasar" ? quasarDevnet.knownLimitations ?? [] : [],
      deploymentStatus:
        name === "mainnet" ? "mainnet-not-deployed" : name === "local-surfpool" ? "local-only" : "devnet-deployed",
      activationGate: name === "mainnet" ? "external_audit_and_mainnet_deployment_required" : undefined,
      blocked: quasarRequestRefused
        ? {
            target: "quasar",
            cause: name === "local-surfpool" ? "local-configuration" : "unregistered-deployment",
            reason: name === "local-surfpool"
              ? localQuasarRefusalReason
              : `A Quasar program target was requested for ${name}, which has no registered Quasar deployment; the request is refused.`,
            knownGaps: name === "local-surfpool" ? localSurfpoolKnownGaps : mainnetKnownGaps,
          }
        : quasarDeploymentBlocked
          ? {
              target,
              cause: "recorded-deployment",
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
  const cause =
    blocked.cause === "local-configuration"
      ? "the local configuration supplied for this run is incomplete or inconsistent"
      : blocked.cause === "unregistered-deployment"
        ? "no Quasar deployment is registered for this profile"
        : "the recorded deployment is not usable";
  const remedy =
    blocked.cause === "local-configuration"
      ? "Supply four distinct valid local program IDs (NEXT_PUBLIC_ESCROW_PROGRAM_ID, NEXT_PUBLIC_REGISTRY_PROGRAM_ID, NEXT_PUBLIC_REPUTATION_PROGRAM_ID, NEXT_PUBLIC_ATTESTATION_PROGRAM_ID) for the locally built current-source programs, keep NEXT_PUBLIC_RPC_ENDPOINT and NEXT_PUBLIC_RPC_WS_ENDPOINT on loopback, then re-run."
      : "Use the local Surfpool Quasar lane (npm run test:surfpool:quasar-critical) against locally built current-source programs instead.";
  return [
    `The "${blocked.target}" program target is refused against the ${profile.name} profile because ${cause}.`,
    blocked.reason,
    blocked.knownGaps.length ? `Known gaps: ${blocked.knownGaps.join(" | ")}` : "",
    remedy,
  ].filter(Boolean).join(" ");
}

function profileHasExplicitLocalQuasarProgramSet(profile: NetworkProfile): boolean {
  const ids = [
    profile.programs.escrowProgramId,
    profile.programs.registryProgramId,
    profile.programs.reputationProgramId,
    profile.programs.attestationProgramId,
  ];
  return ids.every((id): id is string => typeof id === "string" && isValidProgramId(id)) && new Set(ids).size === ids.length;
}

export function describeQuasarProgramTargetRefusal(profile: NetworkProfile = getNetworkProfile()): string | undefined {
  const blocked = describeBlockedProgramTarget(profile);
  if (blocked) return blocked;

  const hasLoopbackEndpoints = isLoopbackRpcUrl(profile.solana.rpcHttp) && (!profile.solana.rpcWs || isLoopbackRpcUrl(profile.solana.rpcWs));
  if (
    profile.name === "local-surfpool" &&
    profile.programs.target === "quasar" &&
    profile.programs.framework === "quasar" &&
    profile.programs.submissionReady === true &&
    profileHasExplicitLocalQuasarProgramSet(profile) &&
    hasLoopbackEndpoints
  ) {
    return undefined;
  }

  return [
    "Quasar instruction builders require an explicit local-surfpool Quasar target before constructing instructions.",
    `Resolved profile=${profile.name}, target=${profile.programs.target}, framework=${profile.programs.framework}, submissionReady=${profile.programs.submissionReady}.`,
    "Set NETWORK_PROFILE=local-surfpool, NEXT_PUBLIC_DEMO_PROGRAM_TARGET=quasar, loopback-only RPC/WS endpoints, and four distinct valid current-source local Quasar program IDs.",
  ].join(" ");
}

export function assertQuasarProgramTargetUsable(profile: NetworkProfile = getNetworkProfile()): void {
  const refusal = describeQuasarProgramTargetRefusal(profile);
  if (refusal) throw new Error(refusal);
}
