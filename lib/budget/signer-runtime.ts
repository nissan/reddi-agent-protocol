/**
 * Server only. The Budget signer project's wiring (`apps/budget-signer`): the
 * KMS key, the custody store, alerts, and its own RPC and program id, all
 * from its own environment, never from a request.
 *
 * One signer serves one network, with its own KMS issuer (R5-M2). The devnet
 * signer and the mainnet signer are two Vercel projects built from this same
 * code (#1205): each has its own KMS issuer and key, signer token, incident
 * secret, RPC and database credentials, and `BUDGET_SIGNER_NETWORK` says which
 * one a deployment is. A mainnet signer that was handed anything of the
 * devnet signer's refuses to start signing (`signerProblems`).
 */

import { Connection, PublicKey } from "@solana/web3.js";
import devnetProfile from "@/config/networks/devnet.json";
import mainnetRelease from "@/config/releases/v1-mainnet-339ac70.json";
import { defaultAlertSender } from "./alerts";
import { budgetChainFor } from "./chain";
import { readKmsSigner } from "./kms";
import type { SignerContext } from "./signer-service";
import { budgetCustodyStore, custodyStoreConfig, GENESIS_HASH, tokenRole, type BudgetNetwork } from "./store";

const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";

/**
 * What the devnet signer uses (public values: a KMS issuer id and a P-256
 * public key). The mainnet signer must not be given either.
 */
export const DEVNET_SIGNER = {
  kmsIssuerId: "7d08fe7f-891f-4b1d-8cb5-0822bb7afa73",
  spenderKey: "0256594b0fcbddbf1fd773bb96ceb9e74d14d5539919906211a1dd695e65345916",
} as const;

let context: SignerContext | undefined;

/** `BUDGET_SIGNER_NETWORK`: `solana-devnet` (the default) or `solana-mainnet-beta`. Anything else: no network, and nothing is signed. */
export function signerNetwork(env: Record<string, string | undefined>): BudgetNetwork | undefined {
  const value = env.BUDGET_SIGNER_NETWORK?.trim() || "solana-devnet";
  return value === "solana-devnet" || value === "solana-mainnet-beta" ? value : undefined;
}

/** The program a signer approves for: the devnet profile's, or the mainnet release record's. */
export function signerProgramId(network: BudgetNetwork): PublicKey {
  return new PublicKey(network === "solana-mainnet-beta" ? mainnetRelease.programId : devnetProfile.programs.escrowProgramId);
}

function httpsUrl(value: string | undefined): string | undefined {
  try {
    const url = new URL(value?.trim() ?? "");
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Why this deployment must not sign, by setting name (never a value). Empty
 * when it may. The mainnet rules (#1205): its own RPC (no public default),
 * its own KMS issuer and key, the mainnet schema as the signer's own database
 * role, and its own token and incident secret set.
 */
export function signerProblems(env: Record<string, string | undefined>): string[] {
  const network = signerNetwork(env);
  if (!network) return ["BUDGET_SIGNER_NETWORK is not solana-devnet or solana-mainnet-beta"];
  const problems: string[] = [];
  const store = custodyStoreConfig(env, network);
  if (!store.ok) problems.push(store.problem);
  const signer = readKmsSigner(env);
  if (!signer) problems.push("BUDGET_SPENDER_KMS_ISSUER_ID or BUDGET_SPENDER_P256_PUBLIC_KEY is missing or malformed");
  if (network === "solana-mainnet-beta") {
    if (!httpsUrl(env.BUDGET_SIGNER_RPC_URL)) problems.push("BUDGET_SIGNER_RPC_URL must be this signer's own https mainnet RPC");
    if (env.BUDGET_SPENDER_KMS_ISSUER_ID?.trim().toLowerCase() === DEVNET_SIGNER.kmsIssuerId) problems.push("BUDGET_SPENDER_KMS_ISSUER_ID is the devnet signer's issuer");
    if (signer && Buffer.from(signer.publicKey).toString("hex") === DEVNET_SIGNER.spenderKey) problems.push("BUDGET_SPENDER_P256_PUBLIC_KEY is the devnet signer's key");
    if (store.ok && "schema" in store.config && tokenRole(store.config.roleToken) !== "budget_mainnet_signer") problems.push("BUDGET_CUSTODY_ROLE_TOKEN must be the budget_mainnet_signer token");
  }
  return problems;
}

/** Builds the context from an environment, without caching it. */
export function buildSignerContext(env: Record<string, string | undefined>): SignerContext {
  const network = signerNetwork(env);
  const problems = signerProblems(env);
  const programId = signerProgramId(network ?? "solana-devnet");
  // A mainnet signer without its own RPC has no custody (above), so this fallback is never read for it.
  const rpc = httpsUrl(env.BUDGET_SIGNER_RPC_URL) ?? DEFAULT_DEVNET_RPC;
  const chain = budgetChainFor(new Connection(rpc, "confirmed"), programId);
  const store = network && problems.length === 0 ? budgetCustodyStore(env, network) : undefined;
  const signer = readKmsSigner(env);
  const custody = network && store && signer && GENESIS_HASH[network] ? { store, signer, sender: defaultAlertSender(env), network, env } : undefined;
  return { custody, chain, programId, env, network: network ?? null, problems };
}

export function signerContext(env: Record<string, string | undefined> = process.env): SignerContext {
  context ??= buildSignerContext(env);
  return context;
}
