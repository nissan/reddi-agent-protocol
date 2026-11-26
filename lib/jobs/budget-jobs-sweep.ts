import "server-only";

/**
 * Records a job for each Budget slice that has been paid out (#1145).
 *
 * The recorder (`verifyAndRecordBudgetCall`) checks one payout against the chain and the
 * provider's signed receipt. This pass finds what to give it: for each Budget the custody store
 * knows, and each provider the payer named, a slice whose reservation account is gone (paid out
 * or returned at close). The payout is among the reservation's latest transactions; the receipt
 * is the newest one saved for the slice (`budget_call_receipts`). The recorder keeps its own
 * refusals: no job for a reserve, a post, or a payout of 0, and none for a receipt that names
 * another Budget.
 *
 * Runs with the Budget watcher (`/api/cron/budget-jobs`). Read-only on chain; writes only job
 * rows and the provider's stats.
 */

import { PublicKey } from "@solana/web3.js";
import { reservationAddress } from "@redditech/x402-solana/budget";
import { verifyAndRecordBudgetCall, type BudgetCallDeps, type ParsedBudgetTransaction } from "@/lib/jobs/budget-call";
import { recordedSignatures, type JobStoreDeps } from "@/lib/jobs/job-store";
import type { ListingNetwork } from "@/lib/listings/listing-store";
import type { SpenderRecord, SpenderStatus } from "@/lib/budget/store";
import { parseReceipt } from "@/lib/budget/judge/receipts";

/** How long after a Budget was opened its slices are still looked at: open period, dispute window and judge time, with room. */
export const BUDGET_JOBS_LOOKBACK_MS = 45 * 24 * 60 * 60 * 1000;
/** The reservation's newest transactions read for its payout. A payout is its last or nearly so. */
export const SIGNATURES_PER_SLICE = 8;
/** The newest receipts read for a slice; the one with the most calls served is the provider's latest statement. */
export const RECEIPTS_PER_SLICE = 20;
/** The most slices looked at in one pass, so a pass fits the cron's time. */
export const MAX_SLICES_PER_PASS = 200;

const STATUSES: SpenderStatus[] = ["open", "frozen", "closing", "closed"];

export interface BudgetJobsDeps extends JobStoreDeps {
  programId: PublicKey;
  records(statuses: SpenderStatus[]): Promise<SpenderRecord[]>;
  /** The newest receipts saved for a slice, newest first. Throws when unreadable. */
  receipts(slice: { budget: string; createdSlot: string; payee: string }, limit: number): Promise<string[]>;
  accountExists(address: PublicKey): Promise<boolean>;
  /** Newest first. */
  signaturesFor(address: PublicKey, limit: number): Promise<{ signature: string; err: unknown }[]>;
  getParsedTransaction(signature: string): Promise<ParsedBudgetTransaction>;
  refreshProviderStats?(provider: string): Promise<unknown>;
  /** Defaults to Date.now(). */
  now?: () => number;
}

export type SliceOutcome =
  | { budget: string; payee: string; status: "recorded"; jobId: string; signature: string }
  | { budget: string; payee: string; status: "already_recorded"; signature: string }
  | { budget: string; payee: string; status: "not_paid_out" | "no_receipt" | "no_payout_found" }
  | { budget: string; payee: string; status: "refused"; reason: string }
  | { budget: string; payee: string; status: "unreadable"; why: string };

function listingNetwork(network: SpenderRecord["network"]): ListingNetwork {
  return network === "solana-mainnet-beta" ? "solana-mainnet" : "solana-devnet";
}

/** One pass. Never throws: every slice gets an outcome, and `unreadable` ones are retried next pass. */
export async function recordBudgetJobs(deps: BudgetJobsDeps): Promise<SliceOutcome[]> {
  const now = (deps.now ?? Date.now)();
  let records: SpenderRecord[];
  try {
    records = await deps.records(STATUSES);
  } catch (error) {
    return [{ budget: "*", payee: "*", status: "unreadable", why: `custody store: ${error instanceof Error ? error.message : String(error)}` }];
  }
  const slices = records
    .filter((r) => r.budget && r.createdSlot && now - Date.parse(r.createdAt) <= BUDGET_JOBS_LOOKBACK_MS)
    .flatMap((r) => [...new Set(r.expectedPayees)].map((payee) => ({ record: r, payee })))
    .slice(0, MAX_SLICES_PER_PASS);

  const out: SliceOutcome[] = [];
  for (const { record, payee } of slices) {
    out.push(await recordSlice(record, payee, deps));
  }
  return out;
}

async function recordSlice(record: SpenderRecord, payee: string, deps: BudgetJobsDeps): Promise<SliceOutcome> {
  const budget = record.budget!;
  const createdSlot = record.createdSlot!;
  const base = { budget, payee };
  const network = listingNetwork(record.network);
  try {
    const reservation = reservationAddress(new PublicKey(budget), new PublicKey(payee), deps.programId);
    // A slice is paid only once its reservation account is closed.
    if (await deps.accountExists(reservation)) return { ...base, status: "not_paid_out" };
    const signatures = (await deps.signaturesFor(reservation, SIGNATURES_PER_SLICE)).filter((s) => s.err === null || s.err === undefined).map((s) => s.signature);
    if (signatures.length === 0) return { ...base, status: "no_payout_found" };
    const done = await recordedSignatures(network, signatures, deps);
    const already = signatures.find((s) => done.has(s));
    if (already) return { ...base, status: "already_recorded", signature: already };
    const receiptJson = latestV2Receipt(await deps.receipts({ budget, createdSlot, payee }, RECEIPTS_PER_SLICE));
    if (!receiptJson) return { ...base, status: "no_receipt" };
    const recorderDeps: BudgetCallDeps = { ...deps, programId: deps.programId, getParsedTransaction: deps.getParsedTransaction };
    for (const signature of signatures) {
      const result = await verifyAndRecordBudgetCall(
        { payoutSignature: signature, budget, createdSlot, payer: record.payer, provider: payee, mint: record.mint, network, receipt: receiptJson },
        recorderDeps,
      );
      if (result.recorded) {
        // The provider's track record counts the new job. Best effort: the job stands either way.
        if (deps.refreshProviderStats) await deps.refreshProviderStats(payee).catch(() => undefined);
        return { ...base, status: "recorded", jobId: result.jobId, signature };
      }
      if (result.reason === "already_recorded") return { ...base, status: "already_recorded", signature };
      // Another transaction on this reservation (a reserve, raise or post, or an earlier opening): try the next one.
      if (result.reason === "payout_not_for_this_slice" || result.reason === "budget_paid_not_found") continue;
      if (result.reason === "chain_unavailable" || result.reason === "store_unavailable") return { ...base, status: "unreadable", why: result.reason };
      return { ...base, status: "refused", reason: result.reason };
    }
    return { ...base, status: "no_payout_found" };
  } catch (error) {
    return { ...base, status: "unreadable", why: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The provider's latest receipt v2 among the saved ones (header values, base64url JSON): the one
 * with the most calls served. Only a shape check here; the recorder verifies the signature and
 * that it names this Budget. Sandbox receipts are not v2 and are left out.
 */
export function latestV2Receipt(saved: readonly string[]): unknown {
  let best: { value: unknown; served: bigint } | undefined;
  for (const raw of saved) {
    const value = parseReceipt(raw) as { receipt?: { schemaVersion?: unknown; session?: { sequence?: unknown } } } | undefined;
    if (value?.receipt?.schemaVersion !== "reddi.receipt.v2") continue;
    const sequence = value.receipt.session?.sequence;
    if (typeof sequence !== "string" || !/^[1-9][0-9]{0,18}$/.test(sequence)) continue;
    const served = BigInt(sequence);
    if (!best || served > best.served) best = { value, served };
  }
  return best?.value;
}
