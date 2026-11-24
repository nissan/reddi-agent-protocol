/**
 * Server only. The payer-side watcher for pooled Budgets the relay holds a
 * spender key for (audit round 4, S7-claude-03). Run it every few minutes
 * (`/api/cron/budget-watch`). For each Budget it reads the Budget and its
 * slices on chain and compares them with what it saw last time:
 *
 * - a new slice, or a raised one: the payer is told who, how much, and what
 *   is left;
 * - a post or a re-post: the payer is told the amount and how long they have
 *   to dispute, with a link that builds the dispute for their wallet;
 * - a dispute or a payout: the payer is told;
 * - a slice for a provider the payer did not name: the operator is told too.
 *
 * A Budget found closed stops its key reserving; a Budget whose account is
 * gone (closed and every slice settled) has its key erased.
 */

import { PublicKey } from "@solana/web3.js";
import {
  BUDGET_DISCRIMINATORS,
  RESERVATION_ACCOUNT_LEN,
  decodeBudget,
  decodeReservation,
  disputeEnds,
  type BudgetAccount,
  type ReservationAccount,
} from "@redditech/x402-solana/budget";
import { sendBudgetAlert, type AlertSender, type BudgetAlert } from "./alerts";
import type { BudgetCustodyStore, SeenSlice, SpenderRecord } from "./store";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Base58 of a few bytes (the 8-byte discriminator), for an RPC memcmp filter. */
export function base58(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let out = "";
  while (n > BigInt(0)) {
    out = ALPHABET[Number(n % BigInt(58))] + out;
    n /= BigInt(58);
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** Seconds per slot used for "about how long": the nominal 0.4 s. */
const SECONDS_PER_SLOT = 0.4;

export interface BudgetChainReader {
  readAccount(address: PublicKey): Promise<{ owner: PublicKey; data: Uint8Array } | null>;
  /** Every reservation account of `budget` (any opening). */
  reservations(budget: PublicKey): Promise<{ address: PublicKey; data: Uint8Array }[]>;
  slot(): Promise<bigint>;
}

type ConnectionLike = {
  getAccountInfo(address: PublicKey): Promise<{ owner: PublicKey; data: Buffer } | null>;
  getProgramAccounts(programId: PublicKey, config: { filters: unknown[] }): Promise<readonly { pubkey: PublicKey; account: { data: Buffer } }[]>;
  getSlot(): Promise<number>;
};

/** Reads through an RPC connection. Reservations are found by size, discriminator and budget address (offset 8). */
export function budgetChainReader(connection: ConnectionLike, programId: PublicKey): BudgetChainReader {
  return {
    async readAccount(address) {
      const info = await connection.getAccountInfo(address);
      return info ? { owner: info.owner, data: Uint8Array.from(info.data) } : null;
    },
    async reservations(budget) {
      const found = await connection.getProgramAccounts(programId, {
        filters: [
          { dataSize: RESERVATION_ACCOUNT_LEN },
          { memcmp: { offset: 0, bytes: base58(Uint8Array.from(BUDGET_DISCRIMINATORS["account:Reservation"])) } },
          { memcmp: { offset: 8, bytes: budget.toBase58() } },
        ],
      });
      return found.map((x) => ({ address: x.pubkey, data: Uint8Array.from(x.account.data) }));
    },
    async slot() {
      return BigInt(await connection.getSlot());
    },
  };
}

export type WatchDeps = {
  store: BudgetCustodyStore;
  chain: BudgetChainReader;
  programId: PublicKey;
  sender: AlertSender;
  /** The app's origin, for the dispute link. */
  origin: string;
  env?: Record<string, string | undefined>;
  nowMs?: number;
};

export type WatchReport = { budget: string; alerts: string[]; status: string; error?: string };

function units(record: SpenderRecord): string {
  return record.mint ? `base units of ${record.mint}` : "lamports";
}

function about(slots: bigint): string {
  const seconds = Number(slots) * SECONDS_PER_SLOT;
  if (seconds < 0) return "now";
  if (seconds < 90 * 60) return `about ${Math.max(1, Math.round(seconds / 60))} minutes`;
  return `about ${Math.round(seconds / 3600)} hours`;
}

/** A Solana Pay link the payer's wallet opens to dispute one slice. */
export function disputeLink(origin: string, budget: string, payee: string): string {
  const url = `${origin.replace(/\/$/, "")}/api/budget/v1/dispute?budget=${budget}&payee=${payee}`;
  return `solana:${encodeURIComponent(url)}`;
}

function seenOf(r: ReservationAccount): SeenSlice {
  return { payee: r.payee.toBase58(), reserved: r.reserved.toString(), state: r.state, finalAmount: r.finalAmount.toString(), postedSlot: r.postedSlot.toString() };
}

/** The alerts one slice's change calls for. Exported for tests. */
export function sliceAlerts(
  record: SpenderRecord,
  budget: BudgetAccount,
  reservation: ReservationAccount,
  before: SeenSlice | undefined,
  context: { slot: bigint; origin: string },
): BudgetAlert[] {
  const payee = reservation.payee.toBase58();
  const address = record.budget!;
  const u = units(record);
  const base = { budget: address, payee, reserved: reservation.reserved.toString(), state: reservation.state, unreserved: budget.unreserved.toString(), total: budget.total.toString() };
  const alerts: BudgetAlert[] = [];
  const unexpected = record.expectedPayees.length > 0 && !record.expectedPayees.includes(payee);
  const notNamed = unexpected ? " You did not name this provider for this Budget: if you did not expect it, dispute it once it posts, and close the Budget." : "";
  const payer = (kind: BudgetAlert["kind"], subject: string, text: string, extra: Record<string, unknown> = {}): BudgetAlert => ({
    audience: "payer",
    kind,
    subject,
    text,
    detail: { ...base, ...extra },
    spenderId: record.id,
  });

  if (!before) {
    alerts.push(payer("slice_reserved", `Your agent reserved ${reservation.reserved} ${u} for a provider`, `Provider ${payee} now has a slice of ${reservation.reserved} ${u} of your Budget ${address}. Left unreserved: ${budget.unreserved}.${notNamed}`));
    if (unexpected) {
      alerts.push({
        audience: "operator",
        kind: "unexpected_payee",
        subject: `Budget ${address}: slice for a provider the payer did not name`,
        text: `Provider ${payee} reserved ${reservation.reserved} ${u} of Budget ${address} (payer ${record.payer}). The relay signs no reserve for providers outside the payer's list, so this reserve was signed elsewhere: treat the spender key as stolen and run the incident close.`,
        detail: base,
        spenderId: record.id,
      });
    }
  } else if (BigInt(before.reserved) < reservation.reserved) {
    alerts.push(payer("slice_raised", `Your agent raised a slice to ${reservation.reserved} ${u}`, `Provider ${payee}'s slice of your Budget ${address} went from ${before.reserved} to ${reservation.reserved} ${u}. Left unreserved: ${budget.unreserved}.${notNamed}`));
  }

  const wasPosted = before !== undefined && before.state !== "open";
  if (reservation.state === "posted" && (!wasPosted || before?.finalAmount !== reservation.finalAmount.toString())) {
    const ends = disputeEnds(budget, reservation);
    const window = !budget.judge
      ? "This Budget has no judge, so it cannot be disputed; the amount is paid once the dispute window ends."
      : ends === null
        ? "You can dispute it now. The dispute window starts when the Budget closes."
        : ends > context.slot
          ? `You can dispute it until slot ${ends} (${about(ends - context.slot)} from now).`
          : "Its dispute window has ended.";
    const link = budget.judge && (ends === null || ends > context.slot) ? disputeLink(context.origin, address, payee) : undefined;
    alerts.push(
      payer(
        wasPosted ? "slice_reposted" : "slice_posted",
        `A provider says it is owed ${reservation.finalAmount} ${u} from your Budget`,
        `Provider ${payee} posted ${reservation.finalAmount} of its ${reservation.reserved} ${u} slice of Budget ${address}. ${window}${link ? `\nDispute: ${link}` : ""}${notNamed}`,
        { finalAmount: reservation.finalAmount.toString(), disputeEndsSlot: ends?.toString() ?? null, ...(link ? { disputeLink: link } : {}) },
      ),
    );
  }
  if (reservation.state === "disputed" && before?.state !== "disputed") {
    alerts.push(payer("slice_disputed", "A slice of your Budget is with the judge", `Provider ${payee}'s post of ${reservation.finalAmount} ${u} on Budget ${address} is disputed and waits for the judge.`));
  }
  if (reservation.state === "paid" && before?.state !== "paid") {
    alerts.push(payer("slice_paid", "A slice of your Budget was paid", `Provider ${payee}'s slice of Budget ${address} was paid out. What it did not earn went back to you.`));
  }
  return alerts;
}

async function save(store: BudgetCustodyStore, record: SpenderRecord, change: (r: SpenderRecord) => SpenderRecord): Promise<SpenderRecord | undefined> {
  let current: SpenderRecord | undefined = record;
  for (let attempt = 0; attempt < 5 && current; attempt += 1) {
    const next = { ...change(current), version: current.version + 1 };
    const written = await store.update(next);
    if (written.ok) return next;
    current = await store.byId(record.id);
  }
  return undefined;
}

/** One pass over every Budget the relay holds a key for. */
export async function watchBudgets(deps: WatchDeps): Promise<WatchReport[]> {
  const records = await deps.store.withStatus(["open", "frozen", "closing"]);
  const reports: WatchReport[] = [];
  let slot: bigint;
  try {
    slot = await deps.chain.slot();
  } catch {
    return records.map((r) => ({ budget: r.budget ?? r.id, alerts: [], status: r.status, error: "rpc_unavailable" }));
  }
  for (const record of records) {
    if (!record.budget || !record.createdSlot) continue;
    const report: WatchReport = { budget: record.budget, alerts: [], status: record.status };
    reports.push(report);
    try {
      const account = await deps.chain.readAccount(new PublicKey(record.budget));
      let budget: BudgetAccount | undefined;
      if (account && account.owner.equals(deps.programId)) {
        try {
          budget = decodeBudget(account.data);
        } catch {
          budget = undefined;
        }
      }
      if (!budget || budget.createdSlot.toString() !== record.createdSlot) {
        // Closed and fully settled (the account is gone, or reopened as a new Budget): erase the key.
        const done = await save(deps.store, record, (r) => {
          const { sealed: _erased, ...rest } = r;
          void _erased;
          return { ...rest, status: "closed" };
        });
        report.status = done ? "closed" : record.status;
        continue;
      }
      const slices = (await deps.chain.reservations(new PublicKey(record.budget)))
        .map((x) => ({ address: x.address.toBase58(), reservation: (() => { try { return decodeReservation(x.data); } catch { return undefined; } })() }))
        .filter((x): x is { address: string; reservation: ReservationAccount } => x.reservation !== undefined && x.reservation.budgetCreatedSlot === budget!.createdSlot);
      const seen: Record<string, SeenSlice> = { ...record.seen };
      for (const slice of slices) {
        for (const alert of sliceAlerts(record, budget, slice.reservation, record.seen[slice.address], { slot, origin: deps.origin })) {
          await sendBudgetAlert(alert, alert.audience === "payer" ? record.contact : undefined, deps);
          report.alerts.push(`${alert.audience}:${alert.kind}`);
        }
        seen[slice.address] = seenOf(slice.reservation);
      }
      const closing = budget.closed && record.status === "open";
      if (closing || JSON.stringify(seen) !== JSON.stringify(record.seen)) {
        const saved = await save(deps.store, record, (r) => ({ ...r, seen, ...(closing ? { status: "closing" as const } : {}) }));
        if (saved) report.status = saved.status;
        else report.error = "store_conflict";
      }
    } catch (error) {
      report.error = error instanceof Error ? error.message.slice(0, 200) : "unknown";
    }
  }
  return reports;
}
