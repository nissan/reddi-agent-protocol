/**
 * Server only. The RAP judge project's wiring (`apps/budget-judge`): its
 * network, program, RPC, store, KMS key and operator email, all from its own
 * environment, never from a request.
 *
 * One judge serves one network, with its own KMS issuer and Vercel project:
 * `BUDGET_JUDGE_NETWORK` is `solana-devnet` (the default) or
 * `solana-mainnet-beta`. Mainnet needs `BUDGET_JUDGE_PROGRAM_ID` and
 * `BUDGET_JUDGE_RPC_URL`, since the repository has no mainnet program id yet.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import devnetProfile from "@/config/networks/devnet.json";
import { defaultAlertSender } from "@/lib/budget/alerts";
import { judgeChainFor } from "./chain";
import { readJudgeAddress, readJudgeSigner } from "./kms";
import type { JudgeNetwork } from "./receipts";
import type { JudgeContext } from "./service";
import { judgeStore } from "./store";

const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";

export function judgeNetwork(env: Record<string, string | undefined>): JudgeNetwork | undefined {
  const value = env.BUDGET_JUDGE_NETWORK?.trim() || "solana-devnet";
  return value === "solana-devnet" || value === "solana-mainnet-beta" ? value : undefined;
}

function programFor(network: JudgeNetwork | undefined, env: Record<string, string | undefined>): PublicKey | undefined {
  if (!network) return undefined;
  const configured = env.BUDGET_JUDGE_PROGRAM_ID?.trim();
  try {
    if (network === "solana-devnet") return new PublicKey(configured || devnetProfile.programs.escrowProgramId);
    return configured ? new PublicKey(configured) : undefined;
  } catch {
    return undefined;
  }
}

let context: JudgeContext | undefined;

export function judgeContext(env: Record<string, string | undefined> = process.env): JudgeContext {
  if (context) return context;
  const network = judgeNetwork(env);
  const programId = programFor(network, env);
  const rpc = env.BUDGET_JUDGE_RPC_URL?.trim() || (network === "solana-devnet" ? DEFAULT_DEVNET_RPC : undefined);
  const chain = programId && rpc ? judgeChainFor(new Connection(rpc, "confirmed"), programId) : undefined;
  const sender = defaultAlertSender(env);
  const opsEmail = env.BUDGET_OPS_EMAIL?.trim();
  context = {
    network,
    programId,
    chain,
    store: judgeStore(env),
    signer: readJudgeSigner(env),
    address: readJudgeAddress(env),
    env,
    async notify(subject, text) {
      if (!opsEmail) return false;
      return (await sender.email(opsEmail, `[RAP judge] ${subject}`, text)) === "sent";
    },
  };
  return context;
}
