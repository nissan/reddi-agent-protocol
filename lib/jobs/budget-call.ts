import "server-only";

/**
 * The app server's check of work paid from a pooled Budget slice, before it
 * writes a job record (audit round 4, S7-claude-06).
 *
 * A Budget pays a provider only when its slice is paid out: `payout_budget`
 * or `resolve_budget` (or their token forms) landing for that Budget's
 * opening, which emits `BudgetPaid`. So the recorder counts only that, never
 * a reserve or a post, which are promises and not payments. It checks:
 *
 * - the transaction succeeded and has exactly one top-level payout or
 *   resolve of the escrow program for this Budget, this provider's
 *   reservation and this payer, naming this opening (`created_slot`);
 * - the program itself (not another program in the transaction) logged
 *   exactly one `BudgetPaid` for this Budget and provider; its amounts are
 *   what was paid, since a SOL refund to an emptied payer wallet can be held
 *   in the Budget until it closes (so the payer's balance change is not the
 *   refund);
 * - the provider's signed receipt for the slice (receipt v2 with a `budget`
 *   block) verifies, names the same Budget, opening, reservation and payer,
 *   and states at least what was charged.
 *
 * A payout that paid the provider nothing (an unposted slice, a ruling of 0,
 * a judge who did not rule in time) records no job.
 */

import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";
import { verifyReddiReceiptV2, type ReddiReceiptV2 } from "@redditech/agent-protocol/receipt-v2";
import { BUDGET_DISCRIMINATORS, reservationAddress } from "@redditech/x402-solana/budget";
import { recordVerifiedJob, type JobStoreDeps } from "@/lib/jobs/job-store";
import type { ListingNetwork } from "@/lib/listings/listing-store";

export const BUDGET_PAID_EVENT = createHash("sha256").update("event:BudgetPaid").digest().subarray(0, 8);
export const BUDGET_OUTCOMES = ["waived", "window_ended", "resolved", "judge_timed_out"] as const;
export type BudgetOutcome = (typeof BUDGET_OUTCOMES)[number];

/** BudgetPaid: discriminator, budget, payee, paid, fee, refunded (u64 LE each), outcome (u8), slot (u64 LE). */
export type BudgetPaidEvent = { budget: string; payee: string; paid: bigint; fee: bigint; refunded: bigint; outcome: BudgetOutcome; slot: bigint };

export function decodeBudgetPaid(bytes: Uint8Array): BudgetPaidEvent | undefined {
  const data = Buffer.from(bytes);
  if (data.length !== 8 + 32 + 32 + 8 * 3 + 1 + 8 || !data.subarray(0, 8).equals(BUDGET_PAID_EVENT)) return undefined;
  const outcome = BUDGET_OUTCOMES[data[96]];
  if (outcome === undefined) return undefined;
  return {
    budget: new PublicKey(data.subarray(8, 40)).toBase58(),
    payee: new PublicKey(data.subarray(40, 72)).toBase58(),
    paid: data.readBigUInt64LE(72),
    fee: data.readBigUInt64LE(80),
    refunded: data.readBigUInt64LE(88),
    outcome,
    slot: data.readBigUInt64LE(97),
  };
}

const INVOKE = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[\d+\]$/;
const EXIT = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) (success|failed)/;

/** The `Program data:` payloads logged while `programId` itself was executing (not a program it called, nor one that called it). */
export function programDataLogs(logs: readonly string[], programId: string): Uint8Array[] {
  const stack: string[] = [];
  const out: Uint8Array[] = [];
  for (const line of logs) {
    const invoke = INVOKE.exec(line);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    if (EXIT.test(line)) {
      stack.pop();
      continue;
    }
    if (line.startsWith("Program data: ") && stack[stack.length - 1] === programId) {
      const payload = line.slice("Program data: ".length).trim();
      // `sol_log_data` with one slice logs one base64 string.
      if (/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) out.push(Uint8Array.from(Buffer.from(payload, "base64")));
    }
  }
  return out;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function decodeBase58(value: string): Uint8Array | undefined {
  let n = BigInt(0);
  for (const char of value) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return undefined;
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
  return Uint8Array.from(bytes);
}

function key(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as { pubkey?: unknown; toBase58?: () => string };
    if (record.pubkey !== undefined) return key(record.pubkey);
    if (typeof record.toBase58 === "function") return record.toBase58();
  }
  return "";
}

/** The exits that pay a slice, and where their accounts sit: budget, reservation, payee, payer. */
const EXITS: { name: string; token: boolean }[] = [
  { name: "global:payout_budget", token: false },
  { name: "global:resolve_budget", token: false },
  { name: "global:payout_token_budget", token: true },
  { name: "global:resolve_token_budget", token: true },
];

export type ParsedBudgetTransaction = {
  meta: { err: unknown; logMessages?: string[] | null } | null;
  transaction: { message: { instructions?: unknown[] } };
} | null;

export interface BudgetCallInput {
  /** The payout or resolve transaction. Only read; checked on chain. */
  payoutSignature: unknown;
  budget: string;
  createdSlot: string;
  payer: string;
  /** The provider's wallet: the payee of the slice. */
  provider: string;
  /** The Budget's mint, absent for SOL. */
  mint?: string;
  network: ListingNetwork;
  /** The provider's signed receipt for the slice's last call (receipt v2 with a budget block). */
  receipt: unknown;
}

export interface BudgetCallDeps extends JobStoreDeps {
  programId: PublicKey;
  getParsedTransaction(signature: string): Promise<ParsedBudgetTransaction>;
}

export type BudgetCallOutcome =
  | { recorded: true; jobId: string; paid: BudgetPaidEvent; receipt: ReddiReceiptV2 }
  | { recorded: false; reason: string };

const refuse = (reason: string): BudgetCallOutcome => ({ recorded: false, reason });
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

/** Checks one landed slice payout (see the top of this file) and, if it holds, records the job. */
export async function verifyAndRecordBudgetCall(input: BudgetCallInput, deps: BudgetCallDeps): Promise<BudgetCallOutcome> {
  if (typeof input.payoutSignature !== "string" || !SIGNATURE.test(input.payoutSignature)) return refuse("invalid_signature");
  let budget: PublicKey, payee: PublicKey;
  try {
    budget = new PublicKey(input.budget);
    payee = new PublicKey(input.provider);
    new PublicKey(input.payer);
  } catch {
    return refuse("invalid_address");
  }
  if (!/^[1-9][0-9]*$/.test(input.createdSlot)) return refuse("invalid_created_slot");
  const reservation = reservationAddress(budget, payee, deps.programId).toBase58();

  // The provider's own signed statement of the slice, for this Budget's opening.
  const verified = verifyReddiReceiptV2(input.receipt, {
    providerId: input.provider,
    budget: { address: input.budget, createdSlot: input.createdSlot, reservation },
    session: { escrow: reservation, payer: input.payer, network: input.network === "solana-mainnet" ? "solana-mainnet-beta" : "solana-devnet" },
  });
  if (!verified.ok) return refuse(`receipt_${verified.errors[0]?.code ?? "invalid"}`);

  let parsed: ParsedBudgetTransaction;
  try {
    parsed = await deps.getParsedTransaction(input.payoutSignature);
  } catch {
    return refuse("chain_unavailable");
  }
  if (!parsed || !parsed.meta) return refuse("payout_not_found");
  if (parsed.meta.err !== null && parsed.meta.err !== undefined) return refuse("payout_failed");
  const programId = deps.programId.toBase58();

  const exits = (parsed.transaction.message.instructions ?? []).filter((ix) => {
    const instruction = ix as { programId?: unknown; accounts?: unknown[]; data?: unknown };
    if (key(instruction.programId) !== programId || !Array.isArray(instruction.accounts) || typeof instruction.data !== "string") return false;
    const data = decodeBase58(instruction.data);
    if (!data || data.length < 16) return false;
    const exit = EXITS.find((e) => Buffer.from(data.subarray(0, 8)).equals(Buffer.from(BUDGET_DISCRIMINATORS[e.name])));
    if (!exit) return false;
    const accounts = instruction.accounts.map(key);
    const at = exit.token ? { reservation: 2, payee: 3, payer: 4 } : { reservation: 1, payee: 2, payer: 3 };
    return (
      Buffer.from(data).readBigUInt64LE(8).toString() === input.createdSlot &&
      accounts[0] === input.budget &&
      accounts[at.reservation] === reservation &&
      accounts[at.payee] === input.provider &&
      accounts[at.payer] === input.payer &&
      (exit.token ? accounts[5] === input.mint : input.mint === undefined)
    );
  });
  if (exits.length !== 1) return refuse("payout_not_for_this_slice");

  const events = programDataLogs(parsed.meta.logMessages ?? [], programId)
    .map(decodeBudgetPaid)
    .filter((e): e is BudgetPaidEvent => e !== undefined && e.budget === input.budget && e.payee === input.provider);
  if (events.length !== 1) return refuse("budget_paid_not_found");
  const paid = events[0];
  const charged = paid.paid + paid.fee;
  if (charged === BigInt(0)) return refuse("nothing_paid");
  if (charged > BigInt(verified.receipt.session!.cumulativeCost)) return refuse("paid_above_receipts");

  const written = await recordVerifiedJob(
    {
      buyerWallet: input.payer,
      providerWallet: input.provider,
      network: input.network,
      declaredModel: verified.receipt.declaredModel,
      requestHash: verified.receipt.requestHash,
      responseHash: verified.receipt.responseHash,
      amountBaseUnits: charged.toString(),
      mint: input.mint ?? "SOL",
      txSignature: input.payoutSignature,
      status: "delivered",
      budget: { address: input.budget, createdSlot: input.createdSlot },
    },
    deps,
  );
  if (!written.ok) return refuse(written.code);
  return { recorded: true, jobId: written.id, paid, receipt: verified.receipt };
}
