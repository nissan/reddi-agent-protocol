import devnetProfile from "@/config/networks/devnet.json";
import localSurfpoolProfile from "@/config/networks/local-surfpool.json";
import mainnetProfile from "@/config/networks/mainnet.json";
import quasarDeployments from "@/config/quasar/deployments.json";

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
    deploymentStatus: DeploymentStatus;
    activationGate?: string;
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

function pickEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function resolveNetworkProfileName(): NetworkProfileName {
  const raw = (
    pickEnv("NETWORK_PROFILE", "NEXT_PUBLIC_NETWORK_PROFILE") ?? "devnet"
  ).toLowerCase();

  if (raw === "local" || raw === "localnet" || raw === "surfpool") return "local-surfpool";
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

  if (requestedTarget === "quasar" && name === "local-surfpool") {
    throw new Error(
      `Quasar program target is only configured for devnet; ${name} has no registered Quasar deployment. ` +
        "Use NETWORK_PROFILE=devnet for Quasar evidence, or register audited per-program ids before enabling this profile.",
    );
  }

  const target: ProgramTarget = requestedTarget === "quasar" && name === "devnet" ? "quasar" : "legacy-anchor";

  const rpcOverride = pickEnv("NEXT_PUBLIC_RPC_ENDPOINT", "NEXT_PUBLIC_RPC_URL", "DEMO_DEVNET_RPC");
  const escrowOverride = pickEnv("NEXT_PUBLIC_ESCROW_PROGRAM_ID", "DEMO_ESCROW_PROGRAM_ID");
  const allowUnsafeDevnetOverride = pickEnv("ALLOW_UNSAFE_ESCROW_OVERRIDE") === "true";

  const quasarPrograms = quasarDevnet.programIds ?? { escrow: quasarDevnet.programId };
  const targetProgramId = target === "quasar" ? quasarPrograms.escrow : base.programs.escrowProgramId;
  const applyProgramIdOverride = (override: string | undefined, registered: string): string =>
    name === "devnet" && override && override !== registered && !allowUnsafeDevnetOverride
      ? registered
      : override ?? registered;

  const effectiveEscrowProgramId = applyProgramIdOverride(escrowOverride, targetProgramId);
  const effectiveRegistryProgramId = applyProgramIdOverride(
    pickEnv("NEXT_PUBLIC_REGISTRY_PROGRAM_ID", "DEMO_REGISTRY_PROGRAM_ID"),
    target === "quasar" ? quasarPrograms.registry : effectiveEscrowProgramId,
  );
  const effectiveReputationProgramId = applyProgramIdOverride(
    pickEnv("NEXT_PUBLIC_REPUTATION_PROGRAM_ID", "DEMO_REPUTATION_PROGRAM_ID"),
    target === "quasar" ? quasarPrograms.reputation : effectiveEscrowProgramId,
  );
  const effectiveAttestationProgramId = applyProgramIdOverride(
    pickEnv("NEXT_PUBLIC_ATTESTATION_PROGRAM_ID", "DEMO_ATTESTATION_PROGRAM_ID"),
    target === "quasar" ? quasarPrograms.attestation : effectiveEscrowProgramId,
  );

  const escrowIsConfiguredPlaceholder = effectiveEscrowProgramId === base.programs.escrowProgramId;
  const perProgramIdsAliasEscrow =
    effectiveRegistryProgramId === effectiveEscrowProgramId &&
    effectiveReputationProgramId === effectiveEscrowProgramId &&
    effectiveAttestationProgramId === effectiveEscrowProgramId;

  const mainnetKnownGaps = name === "mainnet"
    ? [
        escrowIsConfiguredPlaceholder
          ? `No audited mainnet program deployment is registered; the configured escrow id is still the placeholder devnet id${
              perProgramIdsAliasEscrow
                ? ", and registry, reputation, and attestation all alias to that single placeholder id on this profile"
                : ""
            }.`
          : "Mainnet program ids are supplied by environment overrides, but no audited mainnet deployment is registered for them in config/networks/mainnet.json.",
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
      submissionReady: name === "mainnet" ? false : target === "quasar" ? quasarDeployments.submissionReady : true,
      submissionReadyReason:
        name === "mainnet"
          ? "Mainnet activation is blocked: no audited deployment is registered and the Quasar four-program set cannot be resolved for mainnet."
          : target === "quasar"
            ? quasarDeployments.submissionReadyReason
            : undefined,
      knownGaps: [...(target === "quasar" ? quasarDevnet.knownGaps : []), ...mainnetKnownGaps],
      deploymentStatus:
        name === "mainnet" ? "mainnet-not-deployed" : name === "local-surfpool" ? "local-only" : "devnet-deployed",
      activationGate: name === "mainnet" ? "external_audit_and_mainnet_deployment_required" : undefined,
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
