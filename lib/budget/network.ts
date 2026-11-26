/**
 * Client safe. The one place a Budget's cluster is chosen (#1204, audit 1079ce8
 * S2-claude-15 item 1): the network, the escrow program, the USDC mint, the
 * launch caps and the tokens a Budget may hold, per network, picked by the
 * build's network profile (`lib/config/network`). Nothing here reads a
 * runtime override: a mainnet build cannot be pointed at devnet constants, or
 * the other way round.
 *
 * The program id is the same on both clusters, so the RPC's genesis hash is
 * what tells them apart; the server checks it before serving a Budget route
 * (`./cluster-gate`).
 */

import { PublicKey } from "@solana/web3.js";
import devnetProfile from "@/config/networks/devnet.json";
import mainnetProfile from "@/config/networks/mainnet.json";
import { resolveNetworkProfileName } from "@/lib/config/network";
import { resolveNetworkProfileNameFromEnv } from "@/lib/config/network-profile-name";

export type BudgetNetwork = "solana-devnet" | "solana-mainnet-beta";
export type BudgetTokenName = "SOL" | "USDC";

/** The cluster this build serves Budgets on. Local profiles resolve to devnet, and the genesis check then refuses them. */
export function budgetNetwork(env?: Record<string, string | undefined>): BudgetNetwork {
  const profile = env ? resolveNetworkProfileNameFromEnv(env) : resolveNetworkProfileName();
  return profile === "mainnet" ? "solana-mainnet-beta" : "solana-devnet";
}

/** The escrow program from the committed network profile of that cluster. */
export function budgetProgramIdFor(network: BudgetNetwork): PublicKey {
  return new PublicKey(network === "solana-mainnet-beta" ? mainnetProfile.programs.escrowProgramId : devnetProfile.programs.escrowProgramId);
}

/** True once the committed mainnet profile records a deployment (runbook section 6). */
export function mainnetDeploymentRecorded(): boolean {
  return (mainnetProfile.programs as { mainnetDeploymentStatusNote?: string }).mainnetDeploymentStatusNote === "deployed";
}

/** Circle's USDC on each cluster: the one the program allowlists (`USDC_DEVNET_MINT` and the mainnet mint in the program's consts). */
export const BUDGET_USDC_MINT: Record<BudgetNetwork, PublicKey> = {
  "solana-devnet": new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
  "solana-mainnet-beta": new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
};

/**
 * The launch caps on mainnet (task list line 16): at most 0.5 SOL and 100 USDC
 * per Budget, and at least 1 USDC (or 0.01 SOL), so Budget churn is not free.
 * Each provider's share is at most half a Budget everywhere (`./page`). Devnet
 * keeps the program's own ceilings.
 */
export const MAINNET_BUDGET_CAPS: Record<BudgetTokenName, { min: bigint; max: bigint }> = {
  SOL: { min: BigInt(10_000_000), max: BigInt(500_000_000) },
  USDC: { min: BigInt(1_000_000), max: BigInt(100_000_000) },
};

/**
 * The tokens a Budget may hold on each network. Mainnet holds USDC only: the
 * provider kit takes token payments only and the sandbox desks never run on
 * mainnet (#1203), so no provider could be paid from a mainnet SOL Budget.
 */
export const BUDGET_NETWORK_TOKENS: Record<BudgetNetwork, readonly BudgetTokenName[]> = {
  "solana-devnet": ["SOL", "USDC"],
  "solana-mainnet-beta": ["USDC"],
};

/** How the page names the cluster. */
export const BUDGET_NETWORK_LABEL: Record<BudgetNetwork, string> = {
  "solana-devnet": "Solana devnet",
  "solana-mainnet-beta": "Solana mainnet",
};
