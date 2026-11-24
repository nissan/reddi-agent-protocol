/**
 * Server only. Spender-key custody for pooled Budgets (audit round 4, R4-M3 /
 * S7-claude-03). A Budget's spender key is the agent's authority to reserve
 * slices of the payer's money, so the relay holds it like one:
 *
 * - one random key per Budget, sealed at rest (`./keys`), erased at close;
 * - it signs only a transaction whose one instruction to the escrow program
 *   is a `reserve`, `waive` or close of *its own* Budget (named by address and
 *   `created_slot`), and whose other instructions do not name it at all;
 * - a reserve only for a provider the payer expects, when they named any;
 * - every use is logged before the key is opened, and a use that cannot be
 *   logged is not signed;
 * - a key used more than `BUDGET_SPENDER_MAX_USES_PER_10_MIN` times in ten
 *   minutes is frozen and the operator alerted;
 * - nothing is signed while Budgets are paused (`BUDGET_SPENDING_PAUSED=true`
 *   or the pause switch in the database), except the close.
 */

import { createHash, randomBytes } from "crypto";
import { ComputeBudgetProgram, Keypair, PublicKey, type Transaction } from "@solana/web3.js";
import { BUDGET_DISCRIMINATORS, decodeBudget } from "@redditech/x402-solana/budget";
import { openSpenderKey, sealSpenderKey, type Kek } from "./keys";
import { contactProblem, sendBudgetAlert, type AlertSender } from "./alerts";
import type { BudgetContact, BudgetCustodyStore, BudgetNetwork, SpenderRecord } from "./store";

export const DEFAULT_MAX_USES_PER_10_MIN = 30;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type CustodyDeps = {
  store: BudgetCustodyStore;
  keks: Kek[] | undefined;
  sender: AlertSender;
  env?: Record<string, string | undefined>;
  nowMs?: number;
};

export type CustodyFailure = { ok: false; code: string; message: string };
const refuse = (code: string, message: string): CustodyFailure => ({ ok: false, code, message });

/** Makes the key for a Budget the payer is about to open. The payer's open transaction names `spender`. */
export async function createSpender(
  input: { payer: string; network: BudgetNetwork; contact: BudgetContact; expectedPayees?: string[] },
  deps: CustodyDeps,
): Promise<{ ok: true; record: SpenderRecord } | CustodyFailure> {
  if (!deps.keks) return refuse("custody_not_configured", "Budget keys cannot be made: BUDGET_SPENDER_KEKS is not set.");
  if (!BASE58.test(input.payer)) return refuse("invalid_payer", "The payer is not a Solana address.");
  const problem = contactProblem(input.contact);
  if (problem) return refuse("contact_required", problem);
  const expected = [...new Set(input.expectedPayees ?? [])];
  if (expected.some((p) => !BASE58.test(p))) return refuse("invalid_payee", "An expected provider is not a Solana address.");
  const id = randomBytes(16).toString("hex");
  const keypair = Keypair.generate();
  const record: SpenderRecord = {
    id,
    spender: keypair.publicKey.toBase58(),
    payer: input.payer,
    network: input.network,
    status: "pending",
    sealed: sealSpenderKey(keypair, id, deps.keks),
    contact: { ...input.contact },
    expectedPayees: expected,
    seen: {},
    version: 1,
    createdAt: new Date(deps.nowMs ?? Date.now()).toISOString(),
  };
  keypair.secretKey.fill(0);
  const created = await deps.store.create(record);
  if (!created.ok) return refuse("store_unavailable", "The Budget key could not be stored. Nothing was made; try again.");
  return { ok: true, record };
}

/**
 * Once the payer's open landed: checks the Budget on chain names this
 * record's payer and spender, then marks it open. Only an open record's key
 * reserves.
 */
export async function activateSpender(
  input: { id: string; budget: string; programId: PublicKey; readAccount: (address: PublicKey) => Promise<{ owner: PublicKey; data: Uint8Array } | null> },
  deps: CustodyDeps,
): Promise<{ ok: true; record: SpenderRecord } | CustodyFailure> {
  const record = await deps.store.byId(input.id);
  if (!record) return refuse("unknown_budget_key", "No Budget key with that id.");
  if (record.status !== "pending") return refuse("not_pending", `This Budget key is ${record.status}.`);
  if (!BASE58.test(input.budget)) return refuse("invalid_budget", "The Budget is not a Solana address.");
  const account = await input.readAccount(new PublicKey(input.budget));
  if (!account || !account.owner.equals(input.programId)) return refuse("budget_not_found", "The Budget is not open on chain yet.");
  let budget;
  try {
    budget = decodeBudget(account.data);
  } catch {
    return refuse("budget_not_found", "That account is not a Budget.");
  }
  if (budget.payer.toBase58() !== record.payer || budget.spender.toBase58() !== record.spender) {
    return refuse("budget_mismatch", "That Budget does not name this payer and spender.");
  }
  if (budget.closed) return refuse("budget_closed", "That Budget is already closed.");
  const next: SpenderRecord = {
    ...record,
    status: "open",
    budget: input.budget,
    createdSlot: budget.createdSlot.toString(),
    ...(budget.mint ? { mint: budget.mint.toBase58() } : {}),
    version: record.version + 1,
  };
  const written = await deps.store.update(next);
  return written.ok ? { ok: true, record: next } : refuse("store_unavailable", "The Budget could not be marked open; try again.");
}

type Purpose = "reserve" | "waive" | "close";

const SELECTORS: { purpose: Purpose; name: string; spenderIndex: number }[] = [
  { purpose: "reserve", name: "global:reserve", spenderIndex: 2 },
  { purpose: "waive", name: "global:waive", spenderIndex: 2 },
  { purpose: "close", name: "global:close_budget", spenderIndex: 1 },
  { purpose: "close", name: "global:close_token_budget", spenderIndex: 2 },
];

/** What a transaction asks the spender to sign, or why it may not. Exported for tests. */
export function inspectSpenderTransaction(
  tx: Transaction,
  record: Pick<SpenderRecord, "spender" | "budget" | "createdSlot">,
  programId: PublicKey,
): { ok: true; purpose: Purpose; payee?: string } | CustodyFailure {
  if (!record.budget || !record.createdSlot) return refuse("budget_not_open", "This Budget key has no open Budget.");
  const spender = new PublicKey(record.spender);
  if (tx.feePayer?.equals(spender)) return refuse("spender_pays_fee", "The spender key does not pay transaction fees.");
  const ours = tx.instructions.filter((ix) => ix.programId.equals(programId));
  if (ours.length !== 1) return refuse("not_one_budget_instruction", "Send exactly one instruction to the escrow program.");
  for (const ix of tx.instructions) {
    if (ix === ours[0]) continue;
    if (ix.programId.equals(ComputeBudgetProgram.programId)) continue;
    if (ix.keys.some((k) => k.pubkey.equals(spender))) return refuse("spender_in_other_instruction", "Only the Budget instruction may name the spender key.");
  }
  const ix = ours[0];
  const data = Buffer.from(ix.data);
  const selector = SELECTORS.find((s) => data.subarray(0, 8).equals(Buffer.from(BUDGET_DISCRIMINATORS[s.name])));
  if (!selector) return refuse("instruction_not_allowed", "The spender key signs only reserve, waive and close.");
  if (data.length < 16 || data.readBigUInt64LE(8).toString() !== record.createdSlot) return refuse("budget_instance_mismatch", "The instruction names another opening of this Budget.");
  if (!ix.keys[0]?.pubkey.equals(new PublicKey(record.budget))) return refuse("budget_mismatch", "The instruction names another Budget.");
  const signer = ix.keys[selector.spenderIndex];
  if (!signer?.pubkey.equals(spender) || !signer.isSigner) return refuse("spender_not_signer", "The spender key is not the instruction's signer.");
  const payee = selector.purpose === "reserve" ? ix.keys[3]?.pubkey.toBase58() : undefined;
  return { ok: true, purpose: selector.purpose, ...(payee ? { payee } : {}) };
}

function maxUses(env: Record<string, string | undefined>): number {
  const n = Number(env.BUDGET_SPENDER_MAX_USES_PER_10_MIN);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_USES_PER_10_MIN;
}

/** Freezes a record: its key then signs only the close. Alerts the operator. */
export async function freezeSpender(record: SpenderRecord, reason: string, deps: CustodyDeps): Promise<SpenderRecord | undefined> {
  let current: SpenderRecord | undefined = record;
  for (let attempt = 0; attempt < 5 && current; attempt += 1) {
    if (current.status === "closed" || current.status === "closing" || current.status === "frozen") return current;
    const next: SpenderRecord = { ...current, status: "frozen", frozenReason: reason, version: current.version + 1 };
    const written = await deps.store.update(next);
    if (written.ok) {
      await sendBudgetAlert(
        {
          audience: "operator",
          kind: "budget_frozen",
          subject: `Budget ${next.budget ?? next.id} frozen: ${reason}`,
          text: `The relay froze Budget ${next.budget ?? "(not open yet)"} of payer ${next.payer}. Its key now signs only the close.\nReason: ${reason}\nNext: run the incident close for it, or check and unfreeze by hand.`,
          detail: { budget: next.budget ?? null, payer: next.payer, reason },
          spenderId: next.id,
        },
        undefined,
        deps,
      );
      return next;
    }
    current = await deps.store.byId(record.id);
  }
  return undefined;
}

/**
 * Signs `tx` as the spender of Budget key `id`, after every check above.
 * The transaction comes back partly signed; the other signers (the provider
 * for a reserve, a fee payer for a close) sign it themselves.
 */
export async function signAsSpender(
  input: { id: string; transaction: Transaction; programId: PublicKey },
  deps: CustodyDeps,
): Promise<{ ok: true; transaction: Transaction; purpose: Purpose } | CustodyFailure> {
  const env = deps.env ?? process.env;
  const nowMs = deps.nowMs ?? Date.now();
  if (!deps.keks) return refuse("custody_not_configured", "Budget keys cannot be used: BUDGET_SPENDER_KEKS is not set.");
  const record = await deps.store.byId(input.id);
  if (!record || !record.sealed) return refuse("unknown_budget_key", "No usable Budget key with that id.");
  const inspected = inspectSpenderTransaction(input.transaction, record, input.programId);
  const operator = async (subject: string, detail: Record<string, unknown>) =>
    sendBudgetAlert({ audience: "operator", kind: "sign_refused", subject, text: `${subject}\nBudget ${record.budget ?? record.id}, payer ${record.payer}.`, detail: { budget: record.budget ?? null, ...detail }, spenderId: record.id }, undefined, deps);
  if (!inspected.ok) {
    await operator(`Refused to sign for a Budget: ${inspected.code}`, { code: inspected.code });
    return inspected;
  }
  const { purpose } = inspected;

  if (purpose !== "close") {
    if (env.BUDGET_SPENDING_PAUSED === "true") return refuse("budgets_paused", "Budget spending is paused by the operator.");
    let control;
    try {
      control = await deps.store.paused();
    } catch {
      return refuse("store_unavailable", "The pause switch could not be read, so nothing was signed.");
    }
    if (control.paused) return refuse("budgets_paused", `Budget spending is paused by the operator${control.reason ? `: ${control.reason}` : ""}.`);
    if (record.status !== "open") return refuse("budget_not_open", `This Budget is ${record.status}: its key signs only the close.`);
    if (purpose === "reserve" && record.expectedPayees.length > 0 && !record.expectedPayees.includes(inspected.payee ?? "")) {
      await operator(`Refused a reserve for an unexpected provider ${inspected.payee}`, { code: "unexpected_payee", payee: inspected.payee });
      return refuse("unexpected_payee", "The payer did not name this provider for this Budget.");
    }
    let recent: number;
    try {
      recent = await deps.store.usesSince(record.id, new Date(nowMs - TEN_MINUTES_MS).toISOString());
    } catch {
      return refuse("store_unavailable", "The key's use log could not be read, so nothing was signed.");
    }
    if (recent >= maxUses(env)) {
      await freezeSpender(record, `key used ${recent} times in ten minutes`, deps);
      return refuse("key_overuse", "This Budget key was used too often and is frozen. The operator was alerted.");
    }
  } else if (record.status === "closed") {
    return refuse("budget_closed", "This Budget is closed.");
  }

  const message = input.transaction.serializeMessage();
  const logged = await deps.store.logUse({
    spenderId: record.id,
    purpose,
    ...(inspected.payee ? { payee: inspected.payee } : {}),
    messageSha256: createHash("sha256").update(message).digest("hex"),
    at: new Date(nowMs).toISOString(),
  });
  if (!logged) return refuse("store_unavailable", "The use could not be logged, so nothing was signed.");

  let keypair: Keypair;
  try {
    keypair = openSpenderKey(record.sealed, record.id, record.spender, deps.keks);
  } catch {
    await freezeSpender(record, "its sealed key did not open", deps);
    return refuse("key_unavailable", "The Budget key could not be opened. The operator was alerted.");
  }
  try {
    input.transaction.partialSign(keypair);
  } finally {
    keypair.secretKey.fill(0);
  }
  return { ok: true, transaction: input.transaction, purpose };
}
