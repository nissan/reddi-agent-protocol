import path from "path";
import dotenv from "dotenv";

import { describeQuasarTargetRefusal } from "./quasar-target-gate";

// Load devnet env — resolve relative to package root (not transpiled __dirname).
// DEMO_DISABLE_DOTENV lets a caller that already pins every variable (the local Surfpool lane, and
// hermetic tests) guarantee a gitignored .env.devnet cannot reintroduce remote endpoints or mints.
export const DOTENV_DISABLED = process.env.DEMO_DISABLE_DOTENV?.trim() === "true";
if (!DOTENV_DISABLED) {
  const envPath = path.resolve(__dirname, "../.env.devnet");
  dotenv.config({ path: envPath });
}

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

if (requestedProgramTarget === "quasar") {
  const refusal = describeQuasarTargetRefusal(activeNetworkProfileName, pickEnv);
  if (refusal) throw new Error(refusal);
}

export const DEMO_NETWORK_PROFILE = activeNetworkProfileName;
export const PROGRAM_TARGET: DemoProgramTarget = requestedProgramTarget;
export const PROGRAM_FRAMEWORK = PROGRAM_TARGET === "quasar" ? "quasar" : "anchor";
export const PROGRAM_COMPATIBILITY = PROGRAM_TARGET === "quasar" ? "quasar-layout-unverified" : "anchor-layout";

/** Deployed escrow program ID (overrideable for local Surfpool/test lanes) */
export const ESCROW_PROGRAM_ID =
  pickEnv("DEMO_ESCROW_PROGRAM_ID", "NEXT_PUBLIC_ESCROW_PROGRAM_ID") ?? activeProfile.defaultEscrowProgramId;

/** Registry program ID. Quasar requires all four IDs explicitly; there is no Quasar default. */
export const REGISTRY_PROGRAM_ID =
  pickEnv("DEMO_REGISTRY_PROGRAM_ID", "NEXT_PUBLIC_REGISTRY_PROGRAM_ID") ?? ESCROW_PROGRAM_ID;

/** Reputation program ID. Quasar cutover uses a separate reputation program. */
export const REPUTATION_PROGRAM_ID =
  pickEnv("DEMO_REPUTATION_PROGRAM_ID", "NEXT_PUBLIC_REPUTATION_PROGRAM_ID") ?? ESCROW_PROGRAM_ID;

/** Attestation program ID. Quasar cutover uses a separate attestation program. */
export const ATTESTATION_PROGRAM_ID =
  pickEnv("DEMO_ATTESTATION_PROGRAM_ID", "NEXT_PUBLIC_ATTESTATION_PROGRAM_ID") ?? ESCROW_PROGRAM_ID;

/** Solana RPC (overrideable for local Surfpool/test lanes) */
export const DEVNET_RPC = pickEnv("DEMO_DEVNET_RPC", "NEXT_PUBLIC_RPC_ENDPOINT") ?? activeProfile.rpcHttp;

/** Solana WebSocket RPC (required when the HTTP/WS ports are independently dynamic, as with the Surfpool SDK). */
export const DEVNET_RPC_WS = pickEnv("DEMO_DEVNET_RPC_WS", "NEXT_PUBLIC_RPC_WS_ENDPOINT");

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
