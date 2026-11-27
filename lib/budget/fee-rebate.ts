/**
 * Judge-free Budget fee rebate (owner decision, 28 November 2026).
 *
 * Until 1 April 2027 00:00 UTC a Budget opened with no judge carries no
 * protocol fee. The program still takes the fee on every Budget payout (it
 * is a constant in the deployed program, and changing it would mean a new
 * program build and audit round), so RAP refunds it off chain: this module
 * reads the program's own events and works out, per provider and token, the
 * fee each judge-free payout paid to the treasury. The owner then pays that
 * back from the Squads vault, the same route as the Founding Provider rebate.
 *
 * The module only reads. It holds no keys and moves no money. It fails
 * closed: a payout it cannot tie to a judge-free opening, or whose time it
 * cannot read, gets no rebate and is listed with the reason.
 *
 * Kept free of path aliases and server-only imports so the read-only report
 * script (`scripts/budget-fee-rebate.ts`) can import it directly.
 */

import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";

/** 2027-04-01 00:00:00 UTC, the same instant as `LAUNCH_RATE_ENDS_UNIX` in the program. */
export const JUDGE_FREE_REBATE_ENDS_UNIX = 1_806_537_600;
/** An all-zero address: no judge, or the SOL "mint". */
export const ZERO_ADDRESS = "11111111111111111111111111111111";

export const BUDGET_OPENED_EVENT = createHash("sha256").update("event:BudgetOpened").digest().subarray(0, 8);
export const BUDGET_PAID_EVENT = createHash("sha256").update("event:BudgetPaid").digest().subarray(0, 8);

const OUTCOMES = ["waived", "window_ended", "resolved", "judge_timed_out"] as const;

export type BudgetOpenedEvent = {
  budget: string;
  payer: string;
  judge: string;
  /** "SOL" for a SOL Budget, else the mint address. */
  mint: string;
  total: bigint;
  createdSlot: bigint;
};

export type BudgetPaidEvent = {
  budget: string;
  payee: string;
  /** What reached the provider, after the fee. */
  paid: bigint;
  fee: bigint;
  refunded: bigint;
  outcome: (typeof OUTCOMES)[number];
  slot: bigint;
};

/** BudgetOpened: discriminator, budget, payer, spender, judge, mint (32 bytes each), total, created_slot (u64 LE). */
export function decodeBudgetOpened(bytes: Uint8Array): BudgetOpenedEvent | undefined {
  const data = Buffer.from(bytes);
  if (data.length !== 8 + 32 * 5 + 8 + 8 || !data.subarray(0, 8).equals(BUDGET_OPENED_EVENT)) return undefined;
  const key = (at: number) => new PublicKey(data.subarray(at, at + 32)).toBase58();
  const mint = key(136);
  return {
    budget: key(8),
    payer: key(40),
    judge: key(104),
    mint: mint === ZERO_ADDRESS ? "SOL" : mint,
    total: data.readBigUInt64LE(168),
    createdSlot: data.readBigUInt64LE(176),
  };
}

/** BudgetPaid: discriminator, budget, payee, paid, fee, refunded (u64 LE each), outcome (u8), slot (u64 LE). */
export function decodeBudgetPaid(bytes: Uint8Array): BudgetPaidEvent | undefined {
  const data = Buffer.from(bytes);
  if (data.length !== 8 + 32 + 32 + 8 * 3 + 1 + 8 || !data.subarray(0, 8).equals(BUDGET_PAID_EVENT)) return undefined;
  const outcome = OUTCOMES[data[96]];
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

/** The `Program data:` payloads logged while `programId` itself was running (not a program it called, nor one that called it). */
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
      if (/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) out.push(Uint8Array.from(Buffer.from(payload, "base64")));
    }
  }
  return out;
}

/** One landed transaction of the program, as an RPC returns it. */
export type ProgramTx = {
  signature: string;
  slot: number;
  /** Cluster time of the block, in Unix seconds. Null when the RPC does not know it. */
  blockTime: number | null;
  /** The transaction error, if it failed. */
  err: unknown;
  logs: readonly string[];
};

export type RebateLine = {
  signature: string;
  budget: string;
  payee: string;
  mint: string;
  /** Fee the payout sent to the treasury, in the token's base units: the amount to refund. */
  fee: bigint;
  /** What the provider received after the fee. */
  paid: bigint;
  blockTime: number;
};

export type RebateSkip = { signature: string; budget: string; payee: string; fee: bigint; reason: string };

export type RebateOwed = { payee: string; mint: string; fee: bigint; payouts: number };

export type RebateReport = { lines: RebateLine[]; skipped: RebateSkip[]; owed: RebateOwed[] };

export type RebateOptions = {
  programId: string;
  /** Payouts at or after this Unix time get no rebate. Defaults to 1 April 2027 00:00 UTC. */
  endsUnix?: number;
  /** Payout signatures already rebated in an earlier run. */
  alreadyPaid?: ReadonlySet<string>;
  /** Payee wallets that get no rebate (for example RAP's own treasury). */
  excludePayees?: ReadonlySet<string>;
};

/**
 * The fee to refund for every judge-free Budget payout that landed before
 * `endsUnix`, totalled per provider wallet and token.
 *
 * A payout counts when: its transaction succeeded; the program itself logged
 * its `BudgetPaid`; it paid a fee above zero; the latest `BudgetOpened` for
 * the same Budget address at or before the payout's slot named no judge; and
 * its block time is known and before `endsUnix`. Anything else is skipped
 * with a reason, never guessed.
 */
export function judgeFreeRebates(txs: readonly ProgramTx[], options: RebateOptions): RebateReport {
  const endsUnix = options.endsUnix ?? JUDGE_FREE_REBATE_ENDS_UNIX;
  const ordered = [...txs].sort((a, b) => a.slot - b.slot);
  const seen = new Set<string>();
  const openings = new Map<string, BudgetOpenedEvent[]>();
  const pending: { tx: ProgramTx; event: BudgetPaidEvent }[] = [];

  for (const tx of ordered) {
    if (seen.has(tx.signature)) continue;
    seen.add(tx.signature);
    if (tx.err) continue;
    for (const bytes of programDataLogs(tx.logs, options.programId)) {
      const opened = decodeBudgetOpened(bytes);
      if (opened) {
        const list = openings.get(opened.budget) ?? [];
        list.push(opened);
        openings.set(opened.budget, list);
        continue;
      }
      const paid = decodeBudgetPaid(bytes);
      if (paid) pending.push({ tx, event: paid });
    }
  }

  const lines: RebateLine[] = [];
  const skipped: RebateSkip[] = [];
  for (const { tx, event } of pending) {
    const skip = (reason: string) =>
      skipped.push({ signature: tx.signature, budget: event.budget, payee: event.payee, fee: event.fee, reason });
    if (event.fee === BigInt(0)) continue;
    if (options.alreadyPaid?.has(tx.signature)) {
      skip("already rebated");
      continue;
    }
    if (options.excludePayees?.has(event.payee)) {
      skip("payee excluded");
      continue;
    }
    const opening = (openings.get(event.budget) ?? [])
      .filter((o) => o.createdSlot <= event.slot)
      .reduce<BudgetOpenedEvent | undefined>((latest, o) => (!latest || o.createdSlot > latest.createdSlot ? o : latest), undefined);
    if (!opening) {
      skip("opening not found in the scanned history");
      continue;
    }
    if (opening.judge !== ZERO_ADDRESS) continue;
    if (tx.blockTime === null) {
      skip("block time unknown");
      continue;
    }
    if (tx.blockTime >= endsUnix) {
      skip("paid out on or after the end of the offer");
      continue;
    }
    lines.push({
      signature: tx.signature,
      budget: event.budget,
      payee: event.payee,
      mint: opening.mint,
      fee: event.fee,
      paid: event.paid,
      blockTime: tx.blockTime,
    });
  }

  const totals = new Map<string, RebateOwed>();
  for (const line of lines) {
    const key = `${line.payee}:${line.mint}`;
    const row = totals.get(key) ?? { payee: line.payee, mint: line.mint, fee: BigInt(0), payouts: 0 };
    row.fee += line.fee;
    row.payouts += 1;
    totals.set(key, row);
  }
  const owed = [...totals.values()].sort((a, b) => (a.payee === b.payee ? a.mint.localeCompare(b.mint) : a.payee.localeCompare(b.payee)));
  return { lines, skipped, owed };
}
