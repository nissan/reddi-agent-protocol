/**
 * Server only. The Budget signer project's wiring (`apps/budget-signer`): the
 * KMS key, the custody store, alerts, and its own RPC and program id, all
 * from its own environment, never from a request.
 *
 * One signer serves one network, with its own KMS issuer (R5-M2). For now
 * that is devnet only, as for the rest of the relay: a mainnet signer is a
 * second deployment with its own issuer, once mainnet Budgets open.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import devnetProfile from "@/config/networks/devnet.json";
import { defaultAlertSender } from "./alerts";
import { budgetChainFor } from "./chain";
import { readKmsSigner } from "./kms";
import type { SignerContext } from "./signer-service";
import { budgetCustodyStore, GENESIS_HASH } from "./store";

const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";

let context: SignerContext | undefined;

/** `BUDGET_SIGNER_NETWORK`: `solana-devnet` (the default) is the only one served yet. */
export function signerNetwork(env: Record<string, string | undefined>): "solana-devnet" | undefined {
  const value = env.BUDGET_SIGNER_NETWORK?.trim() || "solana-devnet";
  return value === "solana-devnet" ? value : undefined;
}

export function signerContext(env: Record<string, string | undefined> = process.env): SignerContext {
  if (context) return context;
  const programId = new PublicKey(devnetProfile.programs.escrowProgramId);
  const rpc = env.BUDGET_SIGNER_RPC_URL?.trim() || DEFAULT_DEVNET_RPC;
  const chain = budgetChainFor(new Connection(rpc, "confirmed"), programId);
  const network = signerNetwork(env);
  const store = budgetCustodyStore(env);
  const signer = readKmsSigner(env);
  const custody = network && store && signer && GENESIS_HASH[network] ? { store, signer, sender: defaultAlertSender(env), network, env } : undefined;
  context = { custody, chain, programId, env };
  return context;
}
