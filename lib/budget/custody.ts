/**
 * Server only. Spender approvals for pooled Budgets the relay spends from
 * (audit round 4, R4-M3 / S7-claude-03; Vercel KMS since 24 November 2026).
 * A Budget's spender is the agent's authority to reserve slices of the
 * payer's money, so the relay uses it like one:
 *
 * - the spender is a P-256 key in Vercel KMS (`./kms`): the Budget is opened
 *   with flag 0x08 and names the key's SHA-256; the private key never leaves
 *   KMS, and the relay holds no key material at all;
 * - the relay builds every approval itself, for one `reserve`, `waive` or
 *   close of *its own* Budget (named by address and `created_slot`), with a
 *   short expiry (`APPROVAL_SLOTS`, about a minute), so a pause or freeze
 *   stops everything after it;
 * - a reserve, or a waive, only for a provider the payer expects, when they
 *   named any;
 * - every approval is logged before KMS is asked, in one database step that
 *   also checks the pause, the record's status and the overuse limit, so
 *   concurrent requests cannot slip past them; an approval that cannot be
 *   logged is not signed;
 * - a Budget approved more than `BUDGET_SPENDER_MAX_USES_PER_10_MIN` times in
 *   ten minutes is frozen and the operator alerted;
 * - nothing is approved while Budgets are paused (`BUDGET_SPENDING_PAUSED` set
 *   to anything but `false`/`0`/`no`/`off`, or the pause switch in the
 *   database), except the close;
 * - every signature KMS returns is checked against the key the Budget names
 *   before it is handed out.
 */

import { createHash, randomBytes } from "crypto";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import {
  budgetApprovalMessage,
  closeBudgetInstruction,
  decodeBudget,
  p256SpenderAddress,
  reserveInstruction,
  secp256r1ApprovalInstruction,
  waiveInstruction,
  type BudgetTokenClose,
} from "@redditech/x402-solana/budget";
import { signApproval, type SpenderSigner } from "./kms";
import { alertConfigProblem, contactProblem, sendBudgetAlert, type AlertSender } from "./alerts";
import type { BudgetContact, BudgetCustodyStore, BudgetNetwork, SpenderRecord } from "./store";

export const DEFAULT_MAX_USES_PER_10_MIN = 30;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type CustodyDeps = {
  store: BudgetCustodyStore;
  /** The KMS key new Budgets name and that approves (`./kms`). Undefined: nothing is made or approved. */
  signer: SpenderSigner | undefined;
  sender: AlertSender;
  env?: Record<string, string | undefined>;
  nowMs?: number;
};

export type CustodyFailure = { ok: false; code: string; message: string };
const refuse = (code: string, message: string): CustodyFailure => ({ ok: false, code, message });

/**
 * How long an approval stays usable: 150 slots, about a minute. There is no
 * nonce; replay is stopped by the Budget's own state (a reserve must raise the
 * slice, a waive or close happens once) and by this expiry.
 */
export const APPROVAL_SLOTS = BigInt(150);

/**
 * Records a Budget the payer is about to open. The payer opens it with flag
 * 0x08 and `spender` (the SHA-256 of the relay's KMS public key) as its
 * spender. Every Budget the relay spends from names the same key; a record
 * becomes one Budget's at `activateSpender`.
 */
export async function createSpender(
  input: { payer: string; network: BudgetNetwork; contact: BudgetContact; expectedPayees?: string[] },
  deps: CustodyDeps,
): Promise<{ ok: true; record: SpenderRecord } | CustodyFailure> {
  if (!deps.signer) return refuse("custody_not_configured", "Budget spending is not set up: BUDGET_SPENDER_KMS_ISSUER_ID or BUDGET_SPENDER_P256_PUBLIC_KEY is missing.");
  if (!BASE58.test(input.payer)) return refuse("invalid_payer", "The payer is not a Solana address.");
  const problem = contactProblem(input.contact);
  if (problem) return refuse("contact_required", problem);
  const unreachable = alertConfigProblem(input.contact, deps.env ?? process.env);
  if (unreachable) return refuse("alerts_not_configured", unreachable);
  const expected = [...new Set(input.expectedPayees ?? [])];
  if (expected.some((p) => !BASE58.test(p))) return refuse("invalid_payee", "An expected provider is not a Solana address.");
  const record: SpenderRecord = {
    id: randomBytes(16).toString("hex"),
    spender: (await p256SpenderAddress(deps.signer.publicKey)).toBase58(),
    spenderKey: Buffer.from(deps.signer.publicKey).toString("hex"),
    payer: input.payer,
    network: input.network,
    status: "pending",
    contact: { ...(input.contact.email ? { email: input.contact.email } : {}), ...(input.contact.webhook ? { webhook: input.contact.webhook, webhookSecret: randomBytes(32).toString("base64url") } : {}) },
    expectedPayees: expected,
    seen: {},
    version: 1,
    createdAt: new Date(deps.nowMs ?? Date.now()).toISOString(),
  };
  const created = await deps.store.create(record);
  if (!created.ok) return refuse("store_unavailable", "The Budget record could not be stored. Nothing was made; try again.");
  return { ok: true, record };
}

/**
 * Once the payer's open landed: checks the Budget on chain is a P-256-spender
 * Budget that names this record's payer and spender and is not already
 * another record's, then marks it open. Only an open record approves a
 * reserve.
 */
export async function activateSpender(
  input: { id: string; budget: string; programId: PublicKey; readAccount: (address: PublicKey) => Promise<{ owner: PublicKey; data: Uint8Array } | null> },
  deps: CustodyDeps,
): Promise<{ ok: true; record: SpenderRecord } | CustodyFailure> {
  const record = await deps.store.byId(input.id);
  if (!record) return refuse("unknown_budget_key", "No Budget record with that id.");
  // Only a pending record activates: a frozen one (an incident froze it before the payer opened) stays frozen.
  if (record.status !== "pending") return refuse("not_pending", `This Budget record is ${record.status}.`);
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
  if (!budget.p256Spender) return refuse("budget_not_p256", "That Budget was not opened with a P-256 spender (flag 0x08).");
  if (budget.closed) return refuse("budget_closed", "That Budget is already closed.");
  // Every relay Budget names the same spender, so a Budget may be claimed by one record only.
  const holder = await deps.store.byBudget(input.budget);
  if (holder && holder.id !== record.id) return refuse("budget_taken", "That Budget belongs to another record.");
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

/** What the caller wants approved. The relay builds the approval and the call from it. */
export type ApprovalRequest =
  | { purpose: "reserve"; payee: string; amount: bigint; payoutAccount?: string }
  | { purpose: "waive"; payee: string }
  | { purpose: "close"; token?: BudgetTokenClose };

export type Approved = {
  ok: true;
  purpose: Purpose;
  expiresSlot: bigint;
  /** The secp256r1 approval, then the Budget call. Send them in this order, next to each other. */
  instructions: [TransactionInstruction, TransactionInstruction];
};

function maxUses(env: Record<string, string | undefined>): number {
  const n = Number(env.BUDGET_SPENDER_MAX_USES_PER_10_MIN);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_USES_PER_10_MIN;
}

/** `BUDGET_SPENDING_PAUSED`: any value but empty, `false`, `0`, `no` or `off` pauses. */
export function pausedByEnv(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return Boolean(v) && !["false", "0", "no", "off"].includes(v!);
}

/** Freezes a record: it then approves only the close. Alerts the operator. */
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
          text: `The relay froze Budget ${next.budget ?? "(not open yet)"} of payer ${next.payer}. It now approves only the close.\nReason: ${reason}\nNext: run the incident close for it, or check and unfreeze by hand.`,
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
 * Approves one call as the spender of Budget record `id`, after every check
 * above. The caller sends both instructions, in order, in a transaction it
 * pays for; the provider signs a reserve as the payee. Pausing or freezing
 * does not revoke an approval already given, but it expires after
 * `APPROVAL_SLOTS`. `currentSlot` sets that expiry: pass the slot the relay
 * read from the chain, never one a request supplied.
 */
export async function approveAsSpender(
  input: { id: string; request: ApprovalRequest; programId: PublicKey; currentSlot: bigint },
  deps: CustodyDeps,
): Promise<Approved | CustodyFailure> {
  const env = deps.env ?? process.env;
  const nowMs = deps.nowMs ?? Date.now();
  const signer = deps.signer;
  if (!signer) return refuse("custody_not_configured", "Budget spending is not set up: BUDGET_SPENDER_KMS_ISSUER_ID or BUDGET_SPENDER_P256_PUBLIC_KEY is missing.");
  const record = await deps.store.byId(input.id);
  if (!record || !record.spenderKey) return refuse("unknown_budget_key", "No usable Budget record with that id.");
  if (!record.budget || !record.createdSlot) return refuse("budget_not_open", "This Budget record has no open Budget.");
  const operator = async (subject: string, detail: Record<string, unknown>) =>
    sendBudgetAlert({ audience: "operator", kind: "sign_refused", subject, text: `${subject}\nBudget ${record.budget ?? record.id}, payer ${record.payer}.`, detail: { budget: record.budget ?? null, ...detail }, spenderId: record.id }, undefined, deps);
  const request = input.request;
  const { purpose } = request;
  const payee = request.purpose === "close" ? undefined : request.payee;
  if (payee !== undefined && !BASE58.test(payee)) return refuse("invalid_payee", "The provider is not a Solana address.");
  if (request.purpose === "reserve") {
    if (typeof request.amount !== "bigint" || request.amount <= BigInt(0) || request.amount > BigInt("18446744073709551615")) return refuse("invalid_amount", "The amount is not a positive u64.");
    if (request.payoutAccount !== undefined && !BASE58.test(request.payoutAccount)) return refuse("invalid_payout_account", "The payout account is not a Solana address.");
  }

  if (purpose !== "close") {
    if (pausedByEnv(env.BUDGET_SPENDING_PAUSED)) return refuse("budgets_paused", "Budget spending is paused by the operator.");
    if (record.status !== "open") return refuse("budget_not_open", `This Budget is ${record.status}: it approves only the close.`);
    if (record.expectedPayees.length > 0 && !record.expectedPayees.includes(payee!)) {
      await operator(`Refused a ${purpose} for a provider the payer did not name`, { code: "unexpected_payee", payee: payee ?? null });
      return refuse("unexpected_payee", "The payer did not name this provider for this Budget.");
    }
  } else if (record.status === "closed") {
    return refuse("budget_closed", "This Budget is closed.");
  }

  const budget = new PublicKey(record.budget);
  const createdSlot = BigInt(record.createdSlot);
  const expiresSlot = input.currentSlot + APPROVAL_SLOTS;
  const approved = { p256ExpiresSlot: expiresSlot };
  const message = budgetApprovalMessage({
    programId: input.programId,
    budget,
    createdSlot,
    action: purpose,
    ...(payee ? { payee: new PublicKey(payee) } : {}),
    ...(request.purpose === "reserve" ? { amount: request.amount, ...(request.payoutAccount ? { payoutAccount: new PublicKey(request.payoutAccount) } : {}) } : {}),
    expiresSlot,
    cluster: record.network === "solana-mainnet-beta" ? "mainnet" : "devnet",
  });

  const claim = await deps.store.claimUse(
    { spenderId: record.id, purpose, ...(payee ? { payee } : {}), messageSha256: createHash("sha256").update(message).digest("hex"), at: new Date(nowMs).toISOString() },
    maxUses(env),
  );
  if (claim === "overuse") {
    await freezeSpender(record, `approved more than ${maxUses(env)} times in ten minutes`, deps);
    return refuse("key_overuse", "This Budget was approved too often and is frozen. The operator was alerted.");
  }
  if (claim === "paused") return refuse("budgets_paused", "Budget spending is paused by the operator.");
  if (claim === "not_open") return refuse("budget_not_open", "This Budget is no longer open: it approves only the close.");
  if (claim === "closed") return refuse("budget_closed", "This Budget is closed.");
  if (claim === "unknown") return refuse("unknown_budget_key", "No usable Budget record with that id.");
  if (claim !== "ok") return refuse("store_unavailable", "The use could not be logged, so nothing was signed.");

  const publicKey = Uint8Array.from(Buffer.from(record.spenderKey, "hex"));
  const signed = await signApproval(signer, publicKey, message);
  if (!signed.ok) {
    await operator(`KMS approval failed for a Budget: ${signed.code}`, { code: signed.code });
    return refuse(signed.code, signed.message);
  }
  const precompile = secp256r1ApprovalInstruction({ publicKey, signature: signed.signature, message });
  let call: TransactionInstruction;
  if (request.purpose === "reserve") {
    call = reserveInstruction({ programId: input.programId, budget, createdSlot, spender: approved, payee: new PublicKey(request.payee), amount: request.amount, ...(request.payoutAccount ? { payoutAccount: new PublicKey(request.payoutAccount) } : {}) });
  } else if (request.purpose === "waive") {
    call = waiveInstruction({ programId: input.programId, budget, createdSlot, payee: new PublicKey(request.payee), signer: approved });
  } else {
    call = closeBudgetInstruction({ programId: input.programId, budget, createdSlot, signer: approved, payer: new PublicKey(record.payer), ...(request.token ? { token: request.token } : {}) });
  }
  return { ok: true, purpose, expiresSlot, instructions: [precompile, call] };
}
