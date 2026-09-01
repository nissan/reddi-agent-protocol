import path from "path";
import dotenv from "dotenv";

// Load devnet env — resolve relative to package root (not transpiled __dirname)
const envPath = path.resolve(__dirname, "../.env.devnet");
dotenv.config({ path: envPath });

function pickEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

type DemoNetworkProfileName = "local-surfpool" | "devnet";

type DemoNetworkProfile = {
  rpcHttp: string;
  explorerClusterParam: "custom" | "devnet";
  defaultEscrowProgramId: string;
  defaultPerRpc: string;
};

const QUASAR_DEVNET_ESCROW_PROGRAM_ID = "VYCbMszux9seLK2aXFZMECMBFURvfuJLXsXPmJS5igW";
const QUASAR_DEVNET_REGISTRY_PROGRAM_ID = "Xk7jczJZ1HHJZuE1ZUWDqFmowxYhnom7mWzrNSGf9FU";
const QUASAR_DEVNET_REPUTATION_PROGRAM_ID = "nb9rLVjoHMibsgfRGgKuPqm6M8GVcH9r6bYNfg7Yiy6";
const QUASAR_DEVNET_ATTESTATION_PROGRAM_ID = "CRGsWWkptdxsH6N6aWAyahLbuMsT58yM624EopEsv1Ex";

export type DemoProgramTarget = "legacy-anchor" | "quasar";

function resolveProgramTarget(): DemoProgramTarget {
  const raw = (pickEnv("NEXT_PUBLIC_DEMO_PROGRAM_TARGET", "HACKATHON_DEMO_TARGET", "DEMO_PROGRAM_TARGET") ?? "legacy-anchor").toLowerCase();
  return raw === "quasar" ? "quasar" : "legacy-anchor";
}

const DEMO_NETWORK_PROFILES: Record<DemoNetworkProfileName, DemoNetworkProfile> = {
  "local-surfpool": {
    rpcHttp: "http://127.0.0.1:18999",
    explorerClusterParam: "custom",
    defaultEscrowProgramId: "794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD",
    defaultPerRpc: "http://127.0.0.1:18999",
  },
  devnet: {
    rpcHttp: "https://api.devnet.solana.com",
    explorerClusterParam: "devnet",
    defaultEscrowProgramId: "794nTFNyJknzDrR13ApSfVyNCRvcvnCN3BVDfic8dcZD",
    defaultPerRpc: "https://devnet-tee.magicblock.app",
  },
};

function resolveNetworkProfileName(): DemoNetworkProfileName {
  const raw = (pickEnv("NETWORK_PROFILE", "NEXT_PUBLIC_NETWORK_PROFILE") ?? "devnet").toLowerCase();
  if (raw === "local-surfpool" || raw === "local" || raw === "localnet" || raw === "surfpool") return "local-surfpool";
  if (raw === "mainnet" || raw === "mainnet-beta") {
    throw new Error(
      "packages/demo-agents is a devnet/local evidence runner only; mainnet execution requires a separate audited deployment, custody plan, and explicit approval.",
    );
  }
  return "devnet";
}

const activeNetworkProfileName = resolveNetworkProfileName();
const activeProfile = DEMO_NETWORK_PROFILES[activeNetworkProfileName];
const requestedProgramTarget = resolveProgramTarget();

const suppliedProgramIds = {
  escrow: pickEnv("DEMO_ESCROW_PROGRAM_ID", "NEXT_PUBLIC_ESCROW_PROGRAM_ID"),
  registry: pickEnv("DEMO_REGISTRY_PROGRAM_ID", "NEXT_PUBLIC_REGISTRY_PROGRAM_ID"),
  reputation: pickEnv("DEMO_REPUTATION_PROGRAM_ID", "NEXT_PUBLIC_REPUTATION_PROGRAM_ID"),
  attestation: pickEnv("DEMO_ATTESTATION_PROGRAM_ID", "NEXT_PUBLIC_ATTESTATION_PROGRAM_ID"),
};

const missingProgramIds = Object.entries(suppliedProgramIds)
  .filter(([, programId]) => !programId)
  .map(([label]) => label);

if (requestedProgramTarget === "quasar" && activeNetworkProfileName !== "devnet" && missingProgramIds.length > 0) {
  throw new Error(
    `Quasar demo target has no registered program inventory for ${activeNetworkProfileName} in packages/demo-agents; supply the deployed ids via DEMO_ESCROW_PROGRAM_ID, DEMO_REGISTRY_PROGRAM_ID, DEMO_REPUTATION_PROGRAM_ID, and DEMO_ATTESTATION_PROGRAM_ID (missing: ${missingProgramIds.join(", ")}).`,
  );
}

export const PROGRAM_TARGET: DemoProgramTarget = requestedProgramTarget === "quasar" ? "quasar" : "legacy-anchor";
export const PROGRAM_FRAMEWORK = PROGRAM_TARGET === "quasar" ? "quasar" : "anchor";
export const PROGRAM_COMPATIBILITY = PROGRAM_TARGET === "quasar" ? "quasar-layout-unverified" : "anchor-layout";

/** Deployed escrow program ID (overrideable for local Surfpool/test lanes) */
export const ESCROW_PROGRAM_ID =
  suppliedProgramIds.escrow ??
  (PROGRAM_TARGET === "quasar" ? QUASAR_DEVNET_ESCROW_PROGRAM_ID : activeProfile.defaultEscrowProgramId);

/** Registry program ID. Quasar cutover uses a separate registry program, not the escrow program. */
export const REGISTRY_PROGRAM_ID =
  suppliedProgramIds.registry ??
  (PROGRAM_TARGET === "quasar" ? QUASAR_DEVNET_REGISTRY_PROGRAM_ID : ESCROW_PROGRAM_ID);

/** Reputation program ID. Quasar cutover uses a separate reputation program. */
export const REPUTATION_PROGRAM_ID =
  suppliedProgramIds.reputation ??
  (PROGRAM_TARGET === "quasar" ? QUASAR_DEVNET_REPUTATION_PROGRAM_ID : ESCROW_PROGRAM_ID);

/** Attestation program ID. Quasar cutover uses a separate attestation program. */
export const ATTESTATION_PROGRAM_ID =
  suppliedProgramIds.attestation ??
  (PROGRAM_TARGET === "quasar" ? QUASAR_DEVNET_ATTESTATION_PROGRAM_ID : ESCROW_PROGRAM_ID);

/** Solana RPC (overrideable for local Surfpool/test lanes) */
export const DEVNET_RPC = pickEnv("DEMO_DEVNET_RPC", "NEXT_PUBLIC_RPC_ENDPOINT") ?? activeProfile.rpcHttp;

/** MagicBlock PER endpoint (overrideable for local Surfpool/test lanes) */
export const PER_DEVNET_RPC = pickEnv("DEMO_PER_RPC", "NEXT_PUBLIC_PER_RPC") ?? activeProfile.defaultPerRpc;

export function explorerTxUrl(signature: string): string {
  if (activeProfile.explorerClusterParam === "devnet") {
    return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  }
  return `https://explorer.solana.com/tx/${signature}?cluster=custom&customUrl=${encodeURIComponent(DEVNET_RPC)}`;
}

/** MagicBlock critical addresses */
export const PERMISSION_PROGRAM_ID = "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1";
export const DELEGATION_PROGRAM_ID = "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh";
export const PER_VALIDATOR_PUBKEY = "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo";

/** PDA seeds — must match the on-chain program */
export const ESCROW_SEED = Buffer.from("escrow");
export const AGENT_SEED = Buffer.from("agent");
export const RATING_SEED = Buffer.from("rating");
export const ATTESTATION_SEED = Buffer.from("attestation");
