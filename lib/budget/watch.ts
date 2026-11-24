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
 * - a slice for a provider the payer did not name: the operator is told too;
 * - a slice whose account is gone (paid out, or returned at close): the payer
 *   is told it was settled.
 *
 * What it saw is saved per slice only once the payer's alert was delivered on
 * at least one channel, so an alert that failed is sent again next pass; after
 * three passes the operator is told too. Budgets are watched in bounded
 * parallel batches, least recently watched first, within a deadline, so one
 * slow payer cannot hold up the rest; a pass that could not finish every
 * Budget reports an error (the cron route then answers 503).
 *
 * A Budget found closed stops its key reserving. Its key is erased only on
 * positive evidence the Budget is over: it was reopened under a new
 * `created_slot`, or its account was missing at the finalized commitment on
 * two passes at least four minutes apart. One missing or unreadable read only
 * tells the operator.
 *
 * A frozen key whose Budget the relay never saw open (an incident froze it
 * before the payer opened) is looked up by its spender address, so a Budget
 * the payer opened anyway is still watched and can be closed.
 */

import { PublicKey } from "@solana/web3.js";
import {
  BUDGET_ACCOUNT_LEN,
  BUDGET_DISCRIMINATORS,
  RESERVATION_ACCOUNT_LEN,
  decodeBudget,
  decodeReservation,
  disputeEnds,
  type BudgetAccount,
  type ReservationAccount,
} from "@redditech/x402-solana/budget";
import { sendBudgetAlert, type AlertSender, type BudgetAlert } from "./alerts";
import { readKeks, sealedKid } from "./keys";
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
  readAccount(address: PublicKey, commitment?: "confirmed" | "finalized"): Promise<{ owner: PublicKey; data: Uint8Array } | null>;
  /** Every reservation account of `budget` (any opening). */
  reservations(budget: PublicKey): Promise<{ address: PublicKey; data: Uint8Array }[]>;
  /** Every Budget account that names `spender` as its spender. */
  budgetsBySpender(spender: PublicKey): Promise<{ address: PublicKey; data: Uint8Array }[]>;
  slot(): Promise<bigint>;
}

type ConnectionLike = {
  getAccountInfo(address: PublicKey, commitment?: "confirmed" | "finalized"): Promise<{ owner: PublicKey; data: Buffer } | null>;
  getProgramAccounts(programId: PublicKey, config: { filters: unknown[] }): Promise<readonly { pubkey: PublicKey; account: { data: Buffer } }[]>;
  getSlot(): Promise<number>;
};

/** Reads through an RPC connection. Reservations are found by size, discriminator and budget address (offset 8). */
export function budgetChainReader(connection: ConnectionLike, programId: PublicKey): BudgetChainReader {
  return {
    async readAccount(address, commitment = "confirmed") {
      const info = await connection.getAccountInfo(address, commitment);
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
    async budgetsBySpender(spender) {
      const found = await connection.getProgramAccounts(programId, {
        filters: [
          { dataSize: BUDGET_ACCOUNT_LEN },
          { memcmp: { offset: 0, bytes: base58(Uint8Array.from(BUDGET_DISCRIMINATORS["account:Budget"])) } },
          { memcmp: { offset: 40, bytes: spender.toBase58() } },
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
  /** The app's origin, for the dispute link: configured, never taken from a request. */
  origin: string;
  env?: Record<string, string | undefined>;
  nowMs?: number;
  /** Budgets watched at once. */
  concurrency?: number;
  /** No Budget is started after this time (ms since epoch); the rest are reported unwatched. */
  deadlineMs?: number;
  alertTimeoutMs?: number;
};

export type WatchReport = { budget: string; alerts: string[]; status: string; error?: string };

/** The canonical origin for dispute links: `BUDGET_LINK_ORIGIN` when it is an https origin, else the production app. */
export function budgetLinkOrigin(env: Record<string, string | undefined> = process.env): string {
  const raw = env.BUDGET_LINK_ORIGIN?.trim();
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === "https:") return url.origin;
    } catch {
      // fall through to the default
    }
  }
  return "https://app.agent-protocol.reddi.tech";
}

/** Passes without a delivered payer alert before the operator is told. */
export const UNDELIVERED_PASSES_BEFORE_OPERATOR = 3;
/** Two finalized reads of a missing account at least this far apart erase the key. */
export const GONE_CONFIRM_MS = 4 * 60 * 1000;
/** A watcher pass older than this means the watcher stalled. */
export const WATCH_STALE_MS = 15 * 60 * 1000;

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

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
    const host = new URL(context.origin).host;
    alerts.push(
      payer(
        wasPosted ? "slice_reposted" : "slice_posted",
        `A provider says it is owed ${reservation.finalAmount} ${u} from your Budget`,
        `Provider ${payee} posted ${reservation.finalAmount} of its ${reservation.reserved} ${u} slice of Budget ${address}. ${window}${link ? `\nDispute: ${link}\n(The genuine dispute link always opens ${host}.)` : ""}${notNamed}`,
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

/** The payer alert for a slice whose account is gone: it was paid out, or returned at close. */
export function settledAlert(record: SpenderRecord, address: string, before: SeenSlice): BudgetAlert {
  return {
    audience: "payer",
    kind: "slice_settled",
    subject: "A slice of your Budget was settled",
    text: `Provider ${before.payee}'s slice of Budget ${record.budget} is settled and its account closed: what it earned was paid and the rest went back to you.`,
    detail: { budget: record.budget, payee: before.payee, reservation: address, lastState: before.state },
    spenderId: record.id,
  };
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

function erase(r: SpenderRecord): SpenderRecord {
  const { sealed: _erased, goneSince: _gone, ...rest } = r;
  void _erased;
  void _gone;
  return { ...rest, status: "closed" };
}

type Decoded = { kind: "budget"; budget: BudgetAccount } | { kind: "missing" } | { kind: "unreadable"; why: string };

async function readBudget(deps: WatchDeps, address: PublicKey, commitment: "confirmed" | "finalized"): Promise<Decoded> {
  const account = await deps.chain.readAccount(address, commitment);
  if (!account) return { kind: "missing" };
  if (!account.owner.equals(deps.programId)) return { kind: "unreadable", why: `owned by ${account.owner.toBase58()}` };
  try {
    return { kind: "budget", budget: decodeBudget(account.data) };
  } catch {
    return { kind: "unreadable", why: "does not decode as a Budget" };
  }
}

/** A frozen key the relay never saw open: finds a Budget the payer opened with it anyway. */
async function findOpenedBudget(record: SpenderRecord, deps: WatchDeps, report: WatchReport): Promise<SpenderRecord | undefined> {
  const found = (await deps.chain.budgetsBySpender(new PublicKey(record.spender)))
    .map((x) => {
      try {
        return { address: x.address.toBase58(), budget: decodeBudget(x.data) };
      } catch {
        return undefined;
      }
    })
    .filter((x): x is { address: string; budget: BudgetAccount } => x !== undefined && x.budget.payer.toBase58() === record.payer);
  if (found.length === 0) return undefined;
  const { address, budget } = found[0];
  const saved = await save(deps.store, record, (r) => ({ ...r, budget: address, createdSlot: budget.createdSlot.toString(), ...(budget.mint ? { mint: budget.mint.toBase58() } : {}) }));
  const text = `Budget ${address} of payer ${record.payer} was opened with a spender key the relay had frozen (${record.frozenReason ?? "frozen"}). The relay now watches it; close it with the incident step.`;
  await sendBudgetAlert({ audience: "operator", kind: "budget_found", subject: `Frozen Budget key ${record.id} was opened on chain`, text, detail: { budget: address, payer: record.payer }, spenderId: record.id }, undefined, deps);
  report.alerts.push("operator:budget_found");
  return saved;
}

async function watchOne(input: SpenderRecord, slot: bigint, deps: WatchDeps): Promise<WatchReport> {
  let record = input;
  const report: WatchReport = { budget: record.budget ?? record.id, alerts: [], status: record.status };
  const nowMs = deps.nowMs ?? Date.now();
  const now = new Date(nowMs).toISOString();
  const keks = readKeks(deps.env ?? process.env);
  const operator = async (kind: BudgetAlert["kind"], subject: string, text: string, detail: Record<string, unknown> = {}) => {
    await sendBudgetAlert({ audience: "operator", kind, subject, text, detail: { budget: record.budget ?? null, payer: record.payer, ...detail }, spenderId: record.id }, undefined, deps);
    report.alerts.push(`operator:${kind}`);
  };
  try {
    // A key sealed under a KEK the server no longer has cannot sign even the incident close.
    const kid = record.sealed ? sealedKid(record.sealed) : undefined;
    if (record.sealed && (!kid || !keks?.some((k) => k.id === kid))) {
      await operator("kek_missing", `Budget key ${record.id} is sealed under KEK ${kid ?? "?"}, which is not configured`, `Put KEK ${kid ?? "?"} back in BUDGET_SPENDER_KEKS (after the current one) and reseal: without it this Budget cannot be closed by the relay.`, { kid: kid ?? null });
      report.error = "kek_missing";
    }
    if (!record.budget || !record.createdSlot) {
      if (record.status === "frozen") {
        const found = await findOpenedBudget(record, deps, report);
        if (!found) return report;
        record = found;
        report.budget = record.budget!;
      } else {
        return report;
      }
    }
    const address = new PublicKey(record.budget!);
    let read = await readBudget(deps, address, "confirmed");
    if (read.kind === "missing") read = await readBudget(deps, address, "finalized");

    if (read.kind === "unreadable") {
      await operator("budget_unreadable", `Budget ${record.budget} could not be read`, `The account ${read.why}. The key is kept and the Budget stays watched.`, { why: read.why });
      report.error = "budget_unreadable";
      return report;
    }
    if (read.kind === "budget" && read.budget.createdSlot.toString() !== record.createdSlot) {
      if (read.budget.createdSlot > BigInt(record.createdSlot!)) {
        // Reopened under a new created_slot: this opening is over for good.
        const done = await save(deps.store, record, erase);
        report.status = done ? "closed" : record.status;
        if (!done) report.error = "store_conflict";
      } else {
        await operator("budget_unreadable", `Budget ${record.budget} names an earlier opening`, `On chain created_slot ${read.budget.createdSlot}, recorded ${record.createdSlot}. The key is kept.`);
        report.error = "budget_unreadable";
      }
      return report;
    }
    if (read.kind === "missing") {
      if (record.goneSince && nowMs - Date.parse(record.goneSince) >= GONE_CONFIRM_MS) {
        // Missing at finalized on two passes: closed with every slice settled.
        const unsettled = Object.entries(record.seen).filter(([, s]) => s.state !== "paid");
        if (unsettled.length > 0) {
          await sendBudgetAlert({ audience: "payer", kind: "budget_settled", subject: "Your Budget is closed and settled", text: `Budget ${record.budget} is closed and every slice is settled: providers were paid what they earned and the rest went back to you.`, detail: { budget: record.budget }, spenderId: record.id }, record.contact, deps);
          report.alerts.push("payer:budget_settled");
        }
        const done = await save(deps.store, record, erase);
        report.status = done ? "closed" : record.status;
        if (!done) report.error = "store_conflict";
        return report;
      }
      if (!record.goneSince) {
        if (record.status === "open") {
          await operator("budget_unreadable", `Budget ${record.budget} was not found on chain`, "Its account is missing at the finalized commitment, though the relay never saw it closed. If it is still missing next pass the key is erased; until then it is watched and can be closed.");
        }
        const saved = await save(deps.store, record, (r) => ({ ...r, goneSince: now }));
        if (!saved) report.error = "store_conflict";
      }
      return report;
    }

    const budget = read.budget;
    const slices = (await deps.chain.reservations(address))
      .map((x) => ({ address: x.address.toBase58(), reservation: (() => { try { return decodeReservation(x.data); } catch { return undefined; } })() }))
      .filter((x): x is { address: string; reservation: ReservationAccount } => x.reservation !== undefined && x.reservation.budgetCreatedSlot === budget.createdSlot);
    const seen: Record<string, SeenSlice> = { ...record.seen };
    let undelivered = 0;
    const deliver = async (alert: BudgetAlert): Promise<boolean> => {
      const ok = await sendBudgetAlert(alert, alert.audience === "payer" ? record.contact : undefined, deps);
      report.alerts.push(`${alert.audience}:${alert.kind}`);
      return ok || alert.audience === "operator";
    };
    for (const slice of slices) {
      const alerts = sliceAlerts(record, budget, slice.reservation, record.seen[slice.address], { slot, origin: deps.origin });
      const results = await Promise.all(alerts.map(deliver));
      if (results.every(Boolean)) seen[slice.address] = seenOf(slice.reservation);
      else undelivered += 1;
    }
    const live = new Set(slices.map((s) => s.address));
    for (const [address, before] of Object.entries(record.seen)) {
      if (live.has(address)) continue;
      if (before.state === "paid" || (await deliver(settledAlert(record, address, before)))) delete seen[address];
      else undelivered += 1;
    }

    let pending = record.undelivered;
    if (undelivered > 0) {
      pending = { since: pending?.since ?? now, passes: (pending?.passes ?? 0) + 1, ...(pending?.operatorTold ? { operatorTold: true } : {}) };
      if (pending.passes >= UNDELIVERED_PASSES_BEFORE_OPERATOR && !pending.operatorTold) {
        await operator("alerts_undelivered", `Payer alerts for Budget ${record.budget} are not getting through`, `No payer channel has taken this Budget's alerts since ${pending.since} (${pending.passes} passes). The payer may be missing posts they could dispute. Check the payer's contact and the alert email setup.`, { since: pending.since, passes: pending.passes });
        pending = { ...pending, operatorTold: true };
      }
      report.error = "alerts_undelivered";
    } else {
      pending = undefined;
    }
    const closing = budget.closed && record.status === "open";
    const saved = await save(deps.store, record, (r) => {
      const { undelivered: _u, goneSince: _g, ...rest } = r;
      void _u;
      void _g;
      return { ...rest, seen, watchedAt: now, ...(pending ? { undelivered: pending } : {}), ...(closing ? { status: "closing" as const } : {}) };
    });
    if (saved) report.status = saved.status;
    else report.error = "store_conflict";
  } catch (error) {
    report.error = error instanceof Error ? error.message.slice(0, 200) : "unknown";
  }
  return report;
}

/**
 * One pass over every Budget the relay holds a key for. Returns a report per
 * Budget; `complete` is false when the deadline stopped the pass early. A
 * pass that watched every Budget without an error is recorded as the last
 * good pass, and the operator is told when the one before it is stale.
 */
export async function watchBudgets(deps: WatchDeps): Promise<WatchReport[] & { complete?: boolean }> {
  const nowMs = deps.nowMs ?? Date.now();
  const records = (await deps.store.withStatus(["open", "frozen", "closing"])).sort((a, b) => (a.watchedAt ?? "").localeCompare(b.watchedAt ?? ""));
  let slot: bigint;
  try {
    slot = await deps.chain.slot();
  } catch {
    return Object.assign(records.map((r) => ({ budget: r.budget ?? r.id, alerts: [], status: r.status, error: "rpc_unavailable" })), { complete: false });
  }
  const last = await deps.store.watchedAt().catch(() => undefined);
  if (last && nowMs - Date.parse(last) > WATCH_STALE_MS) {
    await sendBudgetAlert({ audience: "operator", kind: "watcher_stalled", subject: "The Budget watcher had stalled", text: `The last complete watcher pass before this one was at ${last}. Payers got no alerts in between: check posts made in that time.`, detail: { last } }, undefined, deps);
  }
  const deadline = deps.deadlineMs ?? nowMs + 240_000;
  let complete = true;
  const reports = await mapLimit(records, deps.concurrency ?? 8, async (record) => {
    if (Date.now() > deadline) {
      complete = false;
      return { budget: record.budget ?? record.id, alerts: [], status: record.status, error: "not_reached" };
    }
    return watchOne(record, slot, deps);
  });
  if (complete && reports.every((r) => !r.error)) await deps.store.markWatched(new Date(nowMs).toISOString());
  return Object.assign(reports, { complete });
}
