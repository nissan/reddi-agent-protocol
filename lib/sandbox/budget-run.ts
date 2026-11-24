/**
 * The sandbox "Set a budget" scenario: a simulated pooled Budget.
 *
 * A person locks one Budget in one token and gives their agent a key. The
 * agent reserves a slice of the Budget with each provider that takes that
 * token, and pays for calls against its slices off-chain with a receipt for
 * each. When the job is done the person closes the Budget (an early close by
 * the agent would start the window at the end of the open period, flag 0x04).
 * Each provider posts its final
 * amount, the dispute window runs, and the payout pays each provider what it
 * posted less the protocol fee and returns the rest to the payer.
 *
 * Nothing here touches a chain. The account fields, defaults and checks mirror
 * the pooled Budget spec (rap-v1/pooled-budget-design.md, 24 Nov 2026) so the
 * simulation can be swapped for the program's instruction builders when they
 * land. Every figure the scenario shows is computed here, from the calls the
 * agent made. Isomorphic: the tests drive the same code the browser runs.
 */

import { findSandboxProviderById, type SandboxProvider } from "./catalog";
import { formatUnits, mediaCostMicroUsd, mediaDelivery, microUsdToAuddUnits, microUsdToLamports, sandboxFeeBps } from "./pricing";

export type BudgetToken = "USDC" | "AUDD" | "SOL";

/** The token a Budget holds: its decimals and how a dollar price converts into it at the demo rates. */
export const BUDGET_TOKENS: Record<BudgetToken, { decimals: number; fromMicroUsd: (microUsd: bigint) => bigint }> = {
  USDC: { decimals: 6, fromMicroUsd: (microUsd) => microUsd },
  AUDD: { decimals: 6, fromMicroUsd: microUsdToAuddUnits },
  SOL: { decimals: 9, fromMicroUsd: microUsdToLamports },
};

/** About 400 ms a slot, as the spec's slot counts assume. */
export const SLOT_MS = 400;
const HOUR_SLOTS = 9_000;

/** Defaults from the spec. */
export const BUDGET_DEFAULTS = {
  totalMicroUsd: BigInt(5_000_000),
  openSlots: 72 * HOUR_SLOTS,
  disputeSlots: 24 * HOUR_SLOTS,
  judgeSlots: 72 * HOUR_SLOTS,
  /** Per-provider cap, as a share of the total: half. */
  perProviderCapBps: BigInt(5_000),
  /** B3: a provider's post gets at least this long under review. */
  minReviewSlots: HOUR_SLOTS,
  maxReservations: 8,
  /** The agent reserves twice its estimate, as a buyer's maximum defaults to. */
  reserveMultiplier: BigInt(2),
} as const;

/** The SOL fee cap: 0.1 SOL. Stablecoins have none. */
const SOL_FEE_CAP_LAMPORTS = BigInt(100_000_000);

/** One paid call an agent plans with a provider: what it asks and how many seconds it gets back. */
export type BudgetCallPlan = { ask: string; units: number; file: string };

/**
 * The providers the agent asks to join, the tokens each takes, and the calls
 * it plans with each. A provider that does not take the Budget's token cannot
 * join: it would have to give a payout account in that token.
 */
export const BUDGET_PROVIDERS: readonly { providerId: string; accepts: readonly BudgetToken[]; calls: readonly BudgetCallPlan[] }[] = [
  {
    providerId: "frame-foundry",
    accepts: ["USDC", "SOL"],
    calls: [
      { ask: "Shot 1: a buyer agent asks, 10 seconds.", units: 10, file: "shots/shot-1.mp4" },
      { ask: "Shot 2: a provider answers, 10 seconds.", units: 10, file: "shots/shot-2.mp4" },
      { ask: "Shot 3: a receipt prints, 10 seconds.", units: 10, file: "shots/shot-3.mp4" },
    ],
  },
  {
    providerId: "tidepool-audio",
    accepts: ["USDC", "AUDD", "SOL"],
    calls: [{ ask: "A 30-second music bed with lifts at 10 and 20 seconds.", units: 30, file: "music/bed-30s.wav" }],
  },
  {
    providerId: "kettle-voice",
    accepts: ["USDC", "AUDD"],
    calls: [{ ask: "A 30-second guide read of the narration.", units: 30, file: "voice/guide-30s.wav" }],
  },
  {
    providerId: "splice-line",
    accepts: ["SOL"],
    calls: [{ ask: "Stitch shots, music and voice into one 30-second cut.", units: 30, file: "final/launch-30s.mp4" }],
  },
];

/** Budget account, as the spec lays it out (sandbox labels in place of addresses). */
export type BudgetAccount = {
  payer: string;
  spender: string;
  judge: string;
  mint: BudgetToken;
  createdSlot: number;
  openSlots: number;
  disputeSlots: number;
  judgeSlots: number;
  total: bigint;
  unreserved: bigint;
  perProviderCap: bigint;
  allowlist: readonly string[];
  closedSlot: number;
  /**
   * Flag 0x04: the spender closed a Budget with no allowlist, so the dispute
   * window runs from the end of the open period, not from the close.
   */
  reviewFromOpenEnd: boolean;
  /** Every reservation ever made, as the program counts them (at most 8, paid ones included). */
  reservations: number;
  closed: boolean;
};

export type ReservationState = "open" | "posted" | "disputed" | "paid";

/** Reservation account, as the spec lays it out. */
export type ReservationAccount = {
  payee: string;
  payoutAccount: string;
  reserved: bigint;
  finalAmount: bigint;
  state: ReservationState;
  waived: boolean;
  /** The first post's slot: a re-post may only lower the amount and keeps it. */
  postedSlot: number;
};

/** A provider's signed-receipt stand-in for one call paid from its reservation. */
export type BudgetCallReceipt = {
  kind: "rap-budget-call";
  simulated: true;
  budget: string;
  payee: string;
  sequence: number;
  ask: string;
  file: string;
  unit: "second";
  units: number;
  /** In the Budget token's base units. */
  amount: string;
  cumulative: string;
  reserved: string;
  previousReceiptHash: string | null;
  slot: number;
};

export type BudgetCallRow = {
  providerId: string;
  providerName: string;
  receipt: BudgetCallReceipt;
  hash: string;
  /** The agent's own count matched the receipt: amount, running total, sequence and chain. */
  checked: boolean;
};

export type BudgetPayoutRow = {
  providerId: string;
  providerName: string;
  reserved: bigint;
  used: bigint;
  finalAmount: bigint;
  fee: bigint;
  toProvider: bigint;
  returned: bigint;
  calls: number;
  disputeEndsSlot: number;
};

export type BudgetEvent = {
  phase: "open" | "key" | "reserve" | "call" | "close" | "post" | "window" | "payout";
  slot: number;
  text: string;
  /** Every step keeps unreserved + reserved + paid + refunded equal to the total. */
  invariantHolds: boolean;
};

export type BudgetRunResult = {
  token: BudgetToken;
  decimals: number;
  budgetId: string;
  agentKey: string;
  budget: BudgetAccount;
  joined: { providerId: string; providerName: string; reserved: bigint }[];
  refused: { providerId: string; providerName: string; accepts: readonly BudgetToken[] }[];
  calls: BudgetCallRow[];
  payouts: BudgetPayoutRow[];
  events: BudgetEvent[];
  feeBps: bigint;
  /** Unreserved money returned when the agent closed the Budget. */
  returnedAtClose: bigint;
  totals: { spent: bigint; fee: bigint; toProviders: bigint; returned: bigint };
  times: { openedAtMs: number; closedAtMs: number; disputeEndsAtMs: number; expiresAtMs: number };
  invariantHeldThroughout: boolean;
};

/** A new agent key in the `rap_pass_` format. Sandbox only: it opens nothing. */
export function newSandboxAgentKey(random: (bytes: Uint8Array) => Uint8Array = (bytes) => globalThis.crypto.getRandomValues(bytes)): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = random(new Uint8Array(24));
  return `rap_pass_${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
}

/** The key as shown on screen: the prefix and the last four characters. */
export function maskAgentKey(key: string): string {
  return `${key.slice(0, 13)}…${key.slice(-4)}`;
}

export function formatBudgetAmount(units: bigint, token: BudgetToken): string {
  return `${formatUnits(units, BUDGET_TOKENS[token].decimals)} ${token}`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(new TextEncoder().encode(text)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The protocol fee on an amount paid, as the program takes it: rounded down, capped for SOL only. */
export function budgetProtocolFee(paid: bigint, token: BudgetToken, bps: bigint): bigint {
  const fee = (paid * bps) / BigInt(10_000);
  return token === "SOL" && fee > SOL_FEE_CAP_LAMPORTS ? SOL_FEE_CAP_LAMPORTS : fee;
}

/** One call's price in the Budget token: seconds delivered at the listed rate plus hosting, rounded up once. */
export function budgetCallCost(provider: SandboxProvider, units: number, token: BudgetToken): bigint {
  return BUDGET_TOKENS[token].fromMicroUsd(mediaCostMicroUsd(provider, mediaDelivery(provider, units)));
}

/** Where the dispute window starts: the close, or the end of the open period when the spender closed early (flag 0x04). */
export function budgetReviewFrom(budget: Pick<BudgetAccount, "closedSlot" | "reviewFromOpenEnd" | "createdSlot" | "openSlots">): number {
  return budget.reviewFromOpenEnd ? Math.max(budget.closedSlot, budget.createdSlot + budget.openSlots) : budget.closedSlot;
}

/** B3: the end of one reservation's dispute window. */
export function budgetDisputeEnds(
  budget: Pick<BudgetAccount, "closedSlot" | "disputeSlots" | "reviewFromOpenEnd" | "createdSlot" | "openSlots">,
  reservation: Pick<ReservationAccount, "postedSlot">,
): number {
  return Math.max(budgetReviewFrom(budget) + budget.disputeSlots, reservation.postedSlot + BUDGET_DEFAULTS.minReviewSlots);
}

/** The program's close: a close by anyone but the payer, on a Budget with no allowlist, sets flag 0x04. */
export function closeSandboxBudget(budget: BudgetAccount, slot: number, byPayer: boolean): void {
  budget.closed = true;
  budget.closedSlot = slot;
  budget.reviewFromOpenEnd = !byPayer && budget.allowlist.length === 0;
}

type ReserveRefusal = "budget_closed" | "budget_expired" | "too_many_reservations" | "over_provider_cap" | "over_unreserved" | "below_minimum" | "token_not_accepted";

/** The spec's `reserve` checks, for a new reservation. */
export function checkReserve(budget: BudgetAccount, amount: bigint, slot: number, accepts: readonly BudgetToken[]): ReserveRefusal | null {
  if (budget.closed) return "budget_closed";
  if (slot >= budget.createdSlot + budget.openSlots) return "budget_expired";
  if (!accepts.includes(budget.mint)) return "token_not_accepted";
  if (budget.reservations >= BUDGET_DEFAULTS.maxReservations) return "too_many_reservations";
  const minimum = budget.total / BigInt(100) > BigInt(1) ? budget.total / BigInt(100) : BigInt(1);
  if (amount < minimum) return "below_minimum";
  if (amount > budget.perProviderCap) return "over_provider_cap";
  if (amount > budget.unreserved) return "over_unreserved";
  return null;
}

/**
 * Runs the whole Budget from open to payout. `startMs` is when the person
 * locks it; the agent's calls, the close and the dispute window are laid out
 * on a simulated clock from there, so the fee rate is read at the payout time.
 */
export async function runSandboxBudget(input: {
  token?: BudgetToken;
  totalMicroUsd?: bigint;
  agentKey?: string;
  startMs?: number;
  /** Minutes between the agent's calls on the simulated clock. */
  minutesPerCall?: number;
}): Promise<BudgetRunResult> {
  const token = input.token ?? "USDC";
  const decimals = BUDGET_TOKENS[token].decimals;
  const agentKey = input.agentKey ?? newSandboxAgentKey();
  const startMs = input.startMs ?? Date.now();
  const minutesPerCall = input.minutesPerCall ?? 4;
  const slotsPerCall = Math.round((minutesPerCall * 60_000) / SLOT_MS);
  const total = BUDGET_TOKENS[token].fromMicroUsd(input.totalMicroUsd ?? BUDGET_DEFAULTS.totalMicroUsd);
  const budgetId = (await sha256Hex(`rap-sandbox-budget:${agentKey}:${startMs}`)).slice(0, 16);

  const createdSlot = 0;
  let slot = createdSlot;
  const slotToMs = (s: number) => startMs + (s - createdSlot) * SLOT_MS;

  const budget: BudgetAccount = {
    payer: "Your wallet",
    spender: maskAgentKey(agentKey),
    judge: "RAP judge (default)",
    mint: token,
    createdSlot,
    openSlots: BUDGET_DEFAULTS.openSlots,
    disputeSlots: BUDGET_DEFAULTS.disputeSlots,
    judgeSlots: BUDGET_DEFAULTS.judgeSlots,
    total,
    unreserved: total,
    perProviderCap: (total * BUDGET_DEFAULTS.perProviderCapBps) / BigInt(10_000),
    allowlist: [],
    closedSlot: 0,
    reviewFromOpenEnd: false,
    reservations: 0,
    closed: false,
  };

  const reservations = new Map<string, ReservationAccount & { used: bigint; rows: BudgetCallRow[] }>();
  let paidOut = BigInt(0);
  let refunded = BigInt(0);
  const invariant = () => {
    let reserved = BigInt(0);
    for (const r of reservations.values()) if (r.state !== "paid") reserved += r.reserved;
    return budget.unreserved + reserved + paidOut + refunded === budget.total;
  };
  const events: BudgetEvent[] = [];
  const log = (phase: BudgetEvent["phase"], text: string) => events.push({ phase, slot, text, invariantHolds: invariant() });
  const fmt = (units: bigint) => formatBudgetAmount(units, token);

  log("open", `You lock ${fmt(total)} in one Budget for 72 hours. No provider can take more than ${fmt(budget.perProviderCap)} of it. The RAP judge settles any dispute.`);
  log("key", `Your agent gets the key ${maskAgentKey(agentKey)}. It can reserve and close. It cannot withdraw, and it cannot pay anyone who has not joined.`);

  // The agent asks each provider to join, reserving twice its estimate, capped.
  const joined: BudgetRunResult["joined"] = [];
  const refused: BudgetRunResult["refused"] = [];
  for (const entry of BUDGET_PROVIDERS) {
    const provider = findSandboxProviderById(entry.providerId);
    if (!provider) continue;
    slot += HOUR_SLOTS / 60; // a minute per reserve
    const estimate = entry.calls.reduce((sum, call) => sum + budgetCallCost(provider, call.units, token), BigInt(0));
    let amount = estimate * BUDGET_DEFAULTS.reserveMultiplier;
    if (amount > budget.perProviderCap) amount = budget.perProviderCap;
    if (amount > budget.unreserved) amount = budget.unreserved;
    const refusal = checkReserve(budget, amount, slot, entry.accepts);
    if (refusal === "token_not_accepted") {
      refused.push({ providerId: provider.id, providerName: provider.name, accepts: entry.accepts });
      log("reserve", `${provider.name} takes ${entry.accepts.join(" and ")} only, so it can't join a ${token} Budget. Nothing is reserved.`);
      continue;
    }
    if (refusal) {
      log("reserve", `${provider.name} could not join: ${refusal.replace(/_/g, " ")}.`);
      continue;
    }
    budget.unreserved -= amount;
    budget.reservations += 1;
    reservations.set(provider.id, { payee: provider.payTo, payoutAccount: `${provider.name} ${token} account`, reserved: amount, finalAmount: BigInt(0), state: "open", waived: false, postedSlot: 0, used: BigInt(0), rows: [] });
    joined.push({ providerId: provider.id, providerName: provider.name, reserved: amount });
    const capped = amount < estimate * BUDGET_DEFAULTS.reserveMultiplier ? " (twice the estimate would pass the cap, so the cap applies)" : "";
    log("reserve", `${provider.name} joins. Your agent reserves ${fmt(amount)} for it${capped}, against an estimate of ${fmt(estimate)}.`);
  }

  // Calls paid from each reservation, off-chain, one receipt each.
  const calls: BudgetCallRow[] = [];
  for (const entry of BUDGET_PROVIDERS) {
    const reservation = reservations.get(entry.providerId);
    const provider = findSandboxProviderById(entry.providerId);
    if (!reservation || !provider) continue;
    let previous: string | null = null;
    for (const [index, plan] of entry.calls.entries()) {
      slot += slotsPerCall;
      const cost = budgetCallCost(provider, plan.units, token);
      if (reservation.used + cost > reservation.reserved) {
        log("call", `${provider.name} stops: the next call would pass its reservation of ${fmt(reservation.reserved)}.`);
        break;
      }
      reservation.used += cost;
      const receipt: BudgetCallReceipt = {
        kind: "rap-budget-call",
        simulated: true,
        budget: budgetId,
        payee: provider.payTo,
        sequence: index + 1,
        ask: plan.ask,
        file: plan.file,
        unit: "second",
        units: plan.units,
        amount: cost.toString(),
        cumulative: reservation.used.toString(),
        reserved: reservation.reserved.toString(),
        previousReceiptHash: previous,
        slot,
      };
      const hash = await sha256Hex(JSON.stringify(receipt));
      // The agent's own count: its price for what came back, the running total, the order and the chain.
      const ownTotal = reservation.rows.reduce((sum, row) => sum + BigInt(row.receipt.amount), BigInt(0)) + budgetCallCost(provider, plan.units, token);
      const checked = receipt.amount === budgetCallCost(provider, plan.units, token).toString() && receipt.cumulative === ownTotal.toString() && receipt.sequence === reservation.rows.length + 1 && receipt.previousReceiptHash === (reservation.rows[reservation.rows.length - 1]?.hash ?? null);
      const row: BudgetCallRow = { providerId: provider.id, providerName: provider.name, receipt, hash, checked };
      reservation.rows.push(row);
      calls.push(row);
      previous = hash;
      log("call", `${provider.name} delivers ${plan.file} (${plan.units} s) for ${fmt(cost)}. Running total ${fmt(reservation.used)} of ${fmt(reservation.reserved)} reserved.`);
    }
  }

  // The job is done: you close the Budget and the unreserved money goes straight back.
  // A close by the payer starts the dispute window at once (no flag 0x04).
  slot += HOUR_SLOTS / 60;
  const returnedAtClose = budget.unreserved;
  refunded += budget.unreserved;
  budget.unreserved = BigInt(0);
  closeSandboxBudget(budget, slot, true);
  log("close", `The job is done, so you close the Budget. The ${fmt(returnedAtClose)} nobody reserved comes straight back to you. If your agent had closed it early instead, the 24 hours to check its work would start when the 72 hours end, unless you approve the work sooner.`);

  // Each provider posts its final amount: what its receipts add up to.
  for (const [providerId, reservation] of reservations) {
    slot += 75; // half a minute apart
    reservation.finalAmount = reservation.used;
    reservation.state = "posted";
    if (reservation.postedSlot === 0) reservation.postedSlot = slot;
    const name = findSandboxProviderById(providerId)?.name ?? providerId;
    log("post", `${name} posts its final amount: ${fmt(reservation.finalAmount)}, the sum of its receipts.`);
  }

  const disputeEnds = Math.max(...[...reservations.values()].map((r) => budgetDisputeEnds(budget, r)), budgetReviewFrom(budget) + budget.disputeSlots);
  slot = disputeEnds;
  log("window", "24 hours pass. You could dispute any posted amount in that time and the RAP judge would rule. Nobody disputes.");

  // Payout: anyone can run it once the window has ended. The fee rate is read now.
  const payoutMs = slotToMs(slot);
  const feeBps = sandboxFeeBps(payoutMs);
  const payouts: BudgetPayoutRow[] = [];
  for (const [providerId, reservation] of reservations) {
    const name = findSandboxProviderById(providerId)?.name ?? providerId;
    // A waived slice is paid at once; a posted one once its window has ended undisputed.
    const paid = reservation.state === "posted" ? reservation.finalAmount : BigInt(0);
    const fee = budgetProtocolFee(paid, token, feeBps);
    const back = reservation.reserved - paid;
    paidOut += paid;
    refunded += back;
    reservation.state = "paid";
    payouts.push({ providerId, providerName: name, reserved: reservation.reserved, used: reservation.used, finalAmount: reservation.finalAmount, fee, toProvider: paid - fee, returned: back, calls: reservation.rows.length, disputeEndsSlot: budgetDisputeEnds(budget, reservation) });
    log("payout", `${name} is paid ${fmt(paid - fee)}, the protocol fee is ${fmt(fee)}, and ${fmt(back)} of its reservation comes back to you.`);
  }

  const spent = payouts.reduce((sum, p) => sum + p.finalAmount, BigInt(0));
  const fee = payouts.reduce((sum, p) => sum + p.fee, BigInt(0));
  const toProviders = payouts.reduce((sum, p) => sum + p.toProvider, BigInt(0));
  const returned = returnedAtClose + payouts.reduce((sum, p) => sum + p.returned, BigInt(0));
  return {
    token,
    decimals,
    budgetId,
    agentKey,
    budget: { ...budget },
    joined,
    refused,
    calls,
    payouts,
    events,
    feeBps,
    returnedAtClose,
    totals: { spent, fee, toProviders, returned },
    times: { openedAtMs: startMs, closedAtMs: slotToMs(budget.closedSlot), disputeEndsAtMs: payoutMs, expiresAtMs: slotToMs(createdSlot + budget.openSlots) },
    invariantHeldThroughout: events.every((event) => event.invariantHolds) && spent + returned === total,
  };
}

/** The demo rate's dollar value of an amount in the Budget token, for a non-USDC Budget. */
export function budgetAmountInUsd(units: bigint, token: BudgetToken): string {
  if (token === "USDC") return formatUnits(units, 6);
  const unitsPerDollar = token === "SOL" ? BUDGET_TOKENS.SOL.fromMicroUsd(BigInt(1_000_000)) : BUDGET_TOKENS.AUDD.fromMicroUsd(BigInt(1_000_000));
  // units / (units per dollar), to the cent, rounded down.
  return (Number((units * BigInt(100)) / unitsPerDollar) / 100).toFixed(2);
}
