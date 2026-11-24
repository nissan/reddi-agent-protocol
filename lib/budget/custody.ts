/**
 * Server only. Spender-key custody for pooled Budgets (audit round 4, R4-M3 /
 * S7-claude-03). A Budget's spender key is the agent's authority to reserve
 * slices of the payer's money, so the relay holds it like one:
 *
 * - one random key per Budget, sealed at rest (`./keys`), erased at close;
 * - it signs only the compiled message it inspected: one instruction to the
 *   escrow program, a `reserve`, `waive` or close of *its own* Budget (named
 *   by address and `created_slot`), plus at most ComputeBudget instructions
 *   (and, for a close, the idempotent creation of the payer's token account);
 *   no durable nonce, and a fee payer that is set and is not the spender, so
 *   a signature expires with its blockhash (about a minute) and a pause or
 *   freeze stops everything after it;
 * - a reserve, or a waive, only for a provider the payer expects, when they
 *   named any;
 * - every use is logged before the key is opened, in one database step that
 *   also checks the pause, the record's status and the overuse limit, so
 *   concurrent requests cannot slip past them; a use that cannot be logged is
 *   not signed;
 * - a key used more than `BUDGET_SPENDER_MAX_USES_PER_10_MIN` times in ten
 *   minutes is frozen and the operator alerted;
 * - nothing is signed while Budgets are paused (`BUDGET_SPENDING_PAUSED` set
 *   to anything but `false`/`0`/`no`/`off`, or the pause switch in the
 *   database), except the close;
 * - the key is opened to a seed in a buffer the relay owns, used once and
 *   wiped.
 */

import { createHash, createPrivateKey, randomBytes, sign as edSign } from "crypto";
import { ComputeBudgetProgram, Keypair, Message, PublicKey, type Transaction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { BUDGET_DISCRIMINATORS, decodeBudget, reservationAddress } from "@redditech/x402-solana/budget";
import { openSpenderSeed, sealSpenderKey, type Kek } from "./keys";
import { alertConfigProblem, contactProblem, sendBudgetAlert, type AlertSender } from "./alerts";
import type { BudgetContact, BudgetCustodyStore, BudgetNetwork, SpenderRecord } from "./store";

export const DEFAULT_MAX_USES_PER_10_MIN = 30;
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
  const unreachable = alertConfigProblem(input.contact, deps.env ?? process.env);
  if (unreachable) return refuse("alerts_not_configured", unreachable);
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
    contact: { ...(input.contact.email ? { email: input.contact.email } : {}), ...(input.contact.webhook ? { webhook: input.contact.webhook, webhookSecret: randomBytes(32).toString("base64url") } : {}) },
    expectedPayees: expected,
    seen: {},
    version: 1,
    createdAt: new Date(deps.nowMs ?? Date.now()).toISOString(),
  };
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
  // Only a pending key activates: a frozen one (an incident froze it before the payer opened) stays frozen.
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

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function fromBase58(value: string): Buffer {
  let n = BigInt(0);
  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char);
    if (digit < 0) throw new Error("bad base58");
    n = n * BigInt(58) + BigInt(digit);
  }
  const bytes: number[] = [];
  while (n > BigInt(0)) {
    bytes.unshift(Number(n & BigInt(255)));
    n >>= BigInt(8);
  }
  for (const char of value) {
    if (char !== "1") break;
    bytes.unshift(0);
  }
  return Buffer.from(bytes);
}

export type Inspected = { ok: true; purpose: Purpose; payee?: string; reservation?: string; message: Buffer };

/**
 * What a transaction asks the spender to sign, or why it may not. It reads the
 * compiled message (what the signature covers), not the `Transaction`
 * object's fields. Exported for tests.
 */
export function inspectSpenderTransaction(
  tx: Transaction,
  record: Pick<SpenderRecord, "spender" | "budget" | "createdSlot">,
  programId: PublicKey,
): Inspected | CustodyFailure {
  if (!record.budget || !record.createdSlot) return refuse("budget_not_open", "This Budget key has no open Budget.");
  const spender = new PublicKey(record.spender);
  if (tx.nonceInfo) return refuse("durable_nonce", "The spender key does not sign durable-nonce transactions.");
  if (!tx.feePayer) return refuse("fee_payer_required", "Set the transaction's fee payer: the spender key does not pay fees.");
  if (tx.feePayer.equals(spender)) return refuse("spender_pays_fee", "The spender key does not pay transaction fees.");
  if (!tx.recentBlockhash) return refuse("blockhash_required", "Set a recent blockhash.");
  let bytes: Buffer;
  let message: Message;
  try {
    bytes = tx.serializeMessage();
    message = Message.from(bytes);
  } catch {
    return refuse("malformed_transaction", "The transaction could not be compiled.");
  }
  if (message.accountKeys[0]?.equals(spender)) return refuse("spender_pays_fee", "The spender key does not pay transaction fees.");
  const compiled = message.instructions.map((ix) => ({
    programId: message.accountKeys[ix.programIdIndex],
    accounts: ix.accounts.map((i) => ({ pubkey: message.accountKeys[i], isSigner: message.isAccountSigner(i) })),
    data: fromBase58(ix.data),
  }));
  const ours = compiled.filter((ix) => ix.programId.equals(programId));
  if (ours.length !== 1) return refuse("not_one_budget_instruction", "Send exactly one instruction to the escrow program.");
  const ix = ours[0];
  const selector = SELECTORS.find((s) => ix.data.subarray(0, 8).equals(Buffer.from(BUDGET_DISCRIMINATORS[s.name])));
  if (!selector) return refuse("instruction_not_allowed", "The spender key signs only reserve, waive and close.");
  for (const other of compiled) {
    if (other === ix) continue;
    const named = other.accounts.some((a) => a.pubkey.equals(spender));
    if (other.programId.equals(ComputeBudgetProgram.programId) && !named) continue;
    // A close of a token Budget may create the payer's refund account first (`CreateIdempotent`, data [1]).
    if (selector.purpose === "close" && other.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) && other.data.length === 1 && other.data[0] === 1 && !named) continue;
    return refuse("instruction_not_allowed", "Only ComputeBudget instructions may go with the Budget instruction.");
  }
  if (ix.data.length < 16 || ix.data.readBigUInt64LE(8).toString() !== record.createdSlot) return refuse("budget_instance_mismatch", "The instruction names another opening of this Budget.");
  if (!ix.accounts[0]?.pubkey.equals(new PublicKey(record.budget))) return refuse("budget_mismatch", "The instruction names another Budget.");
  const signer = ix.accounts[selector.spenderIndex];
  if (!signer?.pubkey.equals(spender) || !signer.isSigner) return refuse("spender_not_signer", "The spender key is not the instruction's signer.");
  const payee = selector.purpose === "reserve" ? ix.accounts[3]?.pubkey.toBase58() : undefined;
  const reservation = selector.purpose === "waive" ? ix.accounts[1]?.pubkey.toBase58() : undefined;
  return { ok: true, purpose: selector.purpose, ...(payee ? { payee } : {}), ...(reservation ? { reservation } : {}), message: bytes };
}

function maxUses(env: Record<string, string | undefined>): number {
  const n = Number(env.BUDGET_SPENDER_MAX_USES_PER_10_MIN);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_USES_PER_10_MIN;
}

/** `BUDGET_SPENDING_PAUSED`: any value but empty, `false`, `0`, `no` or `off` pauses. */
export function pausedByEnv(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return Boolean(v) && !["false", "0", "no", "off"].includes(v!);
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

const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

/**
 * Signs `tx` as the spender of Budget key `id`, after every check above.
 * The transaction comes back partly signed; the other signers (the provider
 * for a reserve, a fee payer for a close) sign it themselves. Pausing or
 * freezing does not revoke a signature already given, but with no durable
 * nonce allowed it expires with its blockhash.
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
    if (pausedByEnv(env.BUDGET_SPENDING_PAUSED)) return refuse("budgets_paused", "Budget spending is paused by the operator.");
    if (record.status !== "open") return refuse("budget_not_open", `This Budget is ${record.status}: its key signs only the close.`);
    if (record.expectedPayees.length > 0) {
      const named =
        purpose === "reserve"
          ? record.expectedPayees.includes(inspected.payee ?? "")
          : record.expectedPayees.some((p) => reservationAddress(new PublicKey(record.budget!), new PublicKey(p), input.programId).toBase58() === inspected.reservation);
      if (!named) {
        await operator(`Refused a ${purpose} for a provider the payer did not name`, { code: "unexpected_payee", payee: inspected.payee ?? null, reservation: inspected.reservation ?? null });
        return refuse("unexpected_payee", "The payer did not name this provider for this Budget.");
      }
    }
  } else if (record.status === "closed") {
    return refuse("budget_closed", "This Budget is closed.");
  }

  const claim = await deps.store.claimUse(
    {
      spenderId: record.id,
      purpose,
      ...(inspected.payee ? { payee: inspected.payee } : {}),
      messageSha256: createHash("sha256").update(inspected.message).digest("hex"),
      at: new Date(nowMs).toISOString(),
    },
    maxUses(env),
  );
  if (claim === "overuse") {
    await freezeSpender(record, `key used more than ${maxUses(env)} times in ten minutes`, deps);
    return refuse("key_overuse", "This Budget key was used too often and is frozen. The operator was alerted.");
  }
  if (claim === "paused") return refuse("budgets_paused", "Budget spending is paused by the operator.");
  if (claim === "not_open") return refuse("budget_not_open", "This Budget is no longer open: its key signs only the close.");
  if (claim === "closed") return refuse("budget_closed", "This Budget is closed.");
  if (claim === "unknown") return refuse("unknown_budget_key", "No usable Budget key with that id.");
  if (claim !== "ok") return refuse("store_unavailable", "The use could not be logged, so nothing was signed.");

  let seed: Buffer;
  try {
    seed = openSpenderSeed(record.sealed, record.id, record.spender, deps.keks);
  } catch {
    await freezeSpender(record, "its sealed key did not open", deps);
    return refuse("key_unavailable", "The Budget key could not be opened. The operator was alerted.");
  }
  const der = Buffer.concat([PKCS8_ED25519, seed]);
  seed.fill(0);
  try {
    const signature = edSign(null, inspected.message, createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
    input.transaction.addSignature(new PublicKey(record.spender), signature);
  } finally {
    der.fill(0);
  }
  return { ok: true, transaction: input.transaction, purpose };
}
