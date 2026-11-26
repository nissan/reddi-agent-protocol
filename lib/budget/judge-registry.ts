/**
 * Server only. Whether the RAP judge a new Budget would name has the registry
 * record `open_budget` demands (`["agent", judge]`, owned by the program, an
 * attestation agent, active). Without it every open fails on chain with
 * `AccountNotInitialized` (3012): that was the devnet outage of 26 November
 * 2026, when `BUDGET_DEFAULT_JUDGE` was set before the judge was registered
 * (#1210, RAP-MB8-S4). So the Budget routes ask here first, refuse to offer a
 * Budget while the record is missing, and tell the operator.
 *
 * A read that fails is not proof either way: it refuses this request (nothing
 * is signed for a Budget that might not open) but is not cached and does not
 * alert. A good answer is cached for a minute, a bad one for ten seconds, so
 * registering the judge takes effect at once without a redeploy.
 */

import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";
import type { BudgetAlert } from "./alerts";
import type { BudgetChainReader } from "./watch";

const AGENT_DISCRIMINATOR = createHash("sha256").update("account:AgentAccount").digest().subarray(0, 8);
/** `AgentHead`: discriminator, owner, agent_type, model length. */
const HEAD_LEN = 45;
/** `AgentTerms`: the fixed fields after the model name. */
const TERMS_LEN = 39;
/** `active` within `AgentTerms`: after rate (8), min reputation (1), score (2), jobs done (8), failed (8), created (8). */
const ACTIVE_OFFSET = 35;

export type JudgeRegistryState = "registered" | "missing" | "wrong_owner" | "malformed" | "not_a_judge" | "inactive";

export function judgeAgentAddress(judge: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("agent"), judge.toBuffer()], programId)[0];
}

/** Reads the record the way `open_budget` does (`BudgetTerms::check` in the program). */
export function judgeRegistryState(account: { owner: PublicKey; data: Uint8Array } | null, judge: PublicKey, programId: PublicKey): JudgeRegistryState {
  if (!account) return "missing";
  if (!account.owner.equals(programId)) return "wrong_owner";
  const data = Buffer.from(account.data);
  if (data.length < HEAD_LEN + TERMS_LEN || !data.subarray(0, 8).equals(AGENT_DISCRIMINATOR)) return "malformed";
  if (!data.subarray(8, 40).equals(judge.toBuffer())) return "malformed";
  const agentType = data.readUInt8(40);
  const modelLen = data.readUInt32LE(41);
  if (agentType > 2 || HEAD_LEN + modelLen + TERMS_LEN > data.length) return "malformed";
  if (agentType === 0) return "not_a_judge";
  return data.readUInt8(HEAD_LEN + modelLen + ACTIVE_OFFSET) === 1 ? "registered" : "inactive";
}

const WHY: Record<Exclude<JudgeRegistryState, "registered">, string> = {
  missing: "has no registry record",
  wrong_owner: "has a registry address the escrow program does not own",
  malformed: "has a registry record that does not read as its own agent record",
  not_a_judge: "is registered as a primary agent, not as an attestation agent",
  inactive: "is registered but not active",
};

export type JudgeRegistryCheck = { ok: true } | { ok: false; state: Exclude<JudgeRegistryState, "registered"> | "unreadable"; problem: string };

export const JUDGE_REGISTERED_TTL_MS = 60_000;
export const JUDGE_UNREGISTERED_TTL_MS = 10_000;
/** The operator hears about an unregistered judge at most this often per server instance. */
export const JUDGE_ALERT_EVERY_MS = 60 * 60_000;

type Cached = { at: number; check: JudgeRegistryCheck };
const cache = new Map<string, Cached>();
const alerted = new Map<string, number>();

/** For tests. */
export function resetJudgeRegistryCache(): void {
  cache.clear();
  alerted.clear();
}

export type JudgeRegistryDeps = {
  chain: Pick<BudgetChainReader, "readAccount">;
  programId: PublicKey;
  nowMs?: number;
  /** Tells the operator; called at most once an hour per judge. */
  alert?: (alert: BudgetAlert) => Promise<unknown>;
};

/**
 * `{ ok: true }` when no judge is named or the judge's record lets a Budget
 * open; otherwise why not. Never throws.
 */
export async function checkJudgeRegistry(judge: PublicKey | null, deps: JudgeRegistryDeps): Promise<JudgeRegistryCheck> {
  if (!judge) return { ok: true };
  const now = deps.nowMs ?? Date.now();
  const key = `${deps.programId.toBase58()}:${judge.toBase58()}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < (hit.check.ok ? JUDGE_REGISTERED_TTL_MS : JUDGE_UNREGISTERED_TTL_MS)) return hit.check;
  const address = judgeAgentAddress(judge, deps.programId);
  let state: JudgeRegistryState;
  try {
    state = judgeRegistryState(await deps.chain.readAccount(address), judge, deps.programId);
  } catch {
    return { ok: false, state: "unreadable", problem: `The registry record of the RAP judge ${judge.toBase58()} could not be read.` };
  }
  const check: JudgeRegistryCheck = state === "registered" ? { ok: true } : { ok: false, state, problem: `The RAP judge ${judge.toBase58()} ${WHY[state]} (${address.toBase58()}), so no Budget that names it can open.` };
  cache.set(key, { at: now, check });
  if (!check.ok) {
    console.error(JSON.stringify({ source: "budget-page", event: "judge_not_registered", judge: judge.toBase58(), record: address.toBase58(), state }));
    const last = alerted.get(key);
    if (deps.alert && (last === undefined || now - last >= JUDGE_ALERT_EVERY_MS)) {
      alerted.set(key, now);
      await deps
        .alert({
          audience: "operator",
          kind: "judge_not_registered",
          subject: "New Budgets are refused: the RAP judge is not registered",
          text: `${check.problem}\nNew Budgets are refused until this is fixed. Register the judge as an attestation agent (docs/BUDGET-JUDGE.md, "Register the judge before any Budget names it"), or unset BUDGET_DEFAULT_JUDGE on a network that may run without a judge. Open Budgets are not affected.`,
          detail: { judge: judge.toBase58(), record: address.toBase58(), state, programId: deps.programId.toBase58() },
        })
        .catch(() => false);
    }
  }
  return check;
}

/** What a payer is told while the judge cannot be named. */
export const JUDGE_NOT_READY_MESSAGE = "New Budgets are paused while the RAP judge is set up. Nothing was signed; try again later.";
