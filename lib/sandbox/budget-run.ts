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

/**
 * One paid call an agent plans with a provider: what it asks and what comes
 * back. A call priced per second bills `units` seconds; a call with a flat
 * price (one render) bills that price once.
 */
export type BudgetCallPlan = { ask: string; units: number; file: string; flatMicroUsd?: bigint };

/**
 * A real product the scenario features, priced from what its makers publish.
 * It is not a RAP provider: it appears to show what joining a Budget would
 * look like for it, and its payee is a label, never an address.
 */
export type BudgetFeaturedListing = {
  url: string;
  /** Where its prices come from, and when they were read. */
  pricingSource: { url: string; readOn: string; summary: string };
};

const CREDIT_MICRO_USD = BigInt(10_000); // 100 credits = $1 on Splice's Starter pack

/**
 * Splice by film.fun: an AI filmmaking studio that already sells to agents
 * (credits topped up with USDC, SOL or AUDD through Solana Pay). Prices from
 * its published agent skills, read on 24 Nov 2026: 6 credits a second for
 * 768p video on its default video model, a flat 5 credits a motion-graphics
 * render, 100 credits = $1. Its live prices are dynamic.
 */
export const SPLICE_FILM_FUN: SandboxProvider & { featured: BudgetFeaturedListing } = {
  id: "splice-film-fun",
  model: "sandbox/splice-film-fun",
  name: "Splice by film.fun",
  tagline: "AI filmmaking studio: generate shots, edit them on a timeline, render motion graphics.",
  pricing: { inputPerMillionUsd: "0", outputPerMillionUsd: "0", maxOutputTokens: 1000 },
  payTo: "Splice payout account (set when it joins)",
  behaviour: "honest",
  reputation: { score: 0, receipts: 0 },
  simulatedOnly: true,
  media: { unit: "second", unitLabel: "second of 768p video", perUnitUsd: "0.06", maxUnits: 15, bytesPerUnit: 0, mediaType: "video/mp4", hostingDays: 0, hostingPerGbUsd: "0", delivered: { name: "shots/shot.mp4", units: 10 } },
  featured: {
    url: "https://www.film.fun/splice",
    pricingSource: {
      url: "https://github.com/Rogues-Lab/splice-agent-skills",
      readOn: "24 November 2026",
      summary: "6 credits a second for 768p video on its default model, 5 credits a motion-graphics render, 100 credits = $1",
    },
  },
};

/** Tolca's published price for one payment-check: one US cent. */
export const TOLCA_CHECK_MICRO_USD = BigInt(10_000);

/**
 * Tolca payment-check: a pay-per-call check an agent runs before it pays a
 * seller. Given the seller's payment details it answers allow, review or
 * block, and says it screens the payout wallet against the US Treasury SDN
 * list, Circle's USDC freeze list and a scam address list. Price from its
 * README, read on 25 Nov 2026: $0.01 a check, paid over x402 in USDC. The
 * sandbox never calls it: each check here is a simulated "allow".
 */
export const TOLCA_PAYMENT_CHECK: SandboxProvider & { featured: BudgetFeaturedListing } = {
  id: "tolca-payment-check",
  model: "sandbox/tolca-payment-check",
  name: "Tolca payment-check",
  tagline: "Checks who you're paying before you pay: payout wallet screening for agents.",
  pricing: { inputPerMillionUsd: "0", outputPerMillionUsd: "0", maxOutputTokens: 1000 },
  payTo: "Tolca payout account (set when it joins)",
  behaviour: "honest",
  reputation: { score: 0, receipts: 0 },
  simulatedOnly: true,
  featured: {
    url: "https://github.com/yayabough/tolca",
    pricingSource: {
      url: "https://github.com/yayabough/tolca",
      readOn: "25 November 2026",
      summary: "$0.01 a payment-check, paid over x402 in USDC",
    },
  },
};

/** Aristotle's published price: one US dollar a credit, pay as you go. */
export const ARISTOTLE_CREDIT_MICRO_USD = BigInt(1_000_000);

/**
 * Aristotle by Harmonic: AI formal verification. Given unmodified Rust, C or
 * Verilog and properties stated in English, it returns a machine-checked proof
 * or a counterexample for each one, and it supports Solana programs. Price
 * read on 26 Nov 2026 from its billing page: $1 a credit, pay as you go. It
 * does not publish how many credits a run takes, so the credit counts in this
 * scenario are illustrative. The sandbox never calls it.
 */
export const ARISTOTLE_HARMONIC: SandboxProvider & { featured: BudgetFeaturedListing } = {
  id: "aristotle-harmonic",
  model: "sandbox/aristotle-harmonic",
  name: "Aristotle by Harmonic",
  tagline: "Formal verification for Rust, C and Verilog: a machine-checked proof or a counterexample for each property.",
  pricing: { inputPerMillionUsd: "0", outputPerMillionUsd: "0", maxOutputTokens: 1000 },
  payTo: "Harmonic payout account (set when it joins)",
  behaviour: "honest",
  reputation: { score: 0, receipts: 0 },
  simulatedOnly: true,
  featured: {
    url: "https://aristotle.harmonic.fun/docs/software/rust",
    pricingSource: {
      url: "https://aristotle.harmonic.fun",
      readOn: "26 November 2026",
      summary: "$1 a credit, pay as you go; credits per run aren't published, so the counts here are illustrative",
    },
  },
};

const FEATURED: readonly (SandboxProvider & { featured: BudgetFeaturedListing })[] = [SPLICE_FILM_FUN, TOLCA_PAYMENT_CHECK, ARISTOTLE_HARMONIC];

/** A provider in the Budget scenario: a featured listing, or a sandbox studio. */
export function budgetProvider(id: string): (SandboxProvider & { featured?: BudgetFeaturedListing }) | undefined {
  return FEATURED.find((provider) => provider.id === id) ?? findSandboxProviderById(id);
}

/**
 * The providers the agent asks to join, the tokens each takes, and the calls
 * it plans with each. A provider that does not take the Budget's token cannot
 * join: it would have to give a payout account in that token.
 */
export type BudgetProviderPlan = { providerId: string; accepts: readonly BudgetToken[]; calls: readonly BudgetCallPlan[]; checksOthers?: true };

export const BUDGET_PROVIDERS: readonly BudgetProviderPlan[] = [
  {
    // Joins first, then checks each provider's payout wallet before the agent reserves for it.
    // Its calls are made per provider as the agent goes, so none are planned here.
    providerId: TOLCA_PAYMENT_CHECK.id,
    accepts: ["USDC"],
    calls: [],
    checksOthers: true,
  },
  {
    providerId: SPLICE_FILM_FUN.id,
    accepts: ["USDC", "SOL", "AUDD"],
    calls: [
      { ask: "Shot 1: a buyer agent asks, 10 seconds, 768p.", units: 10, file: "shots/shot-1.mp4" },
      { ask: "Shot 2: a provider answers, 10 seconds, 768p.", units: 10, file: "shots/shot-2.mp4" },
      { ask: "Shot 3: a receipt prints, 10 seconds, 768p.", units: 10, file: "shots/shot-3.mp4" },
      { ask: "An end card with the title, as a motion-graphics render.", units: 0, file: "motion/end-card.mp4", flatMicroUsd: BigInt(5) * CREDIT_MICRO_USD },
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
    providerId: "booth-match",
    accepts: ["SOL"],
    calls: [{ ask: "Align the narration take to the guide and clean it up.", units: 30, file: "voice/narration-aligned.wav" }],
  },
];

/** One verification run on Aristotle, billed by the credits it used. */
function aristotleRun(ask: string, credits: number, file: string): BudgetCallPlan {
  return { ask, units: credits, file, flatMicroUsd: BigInt(credits) * ARISTOTLE_CREDIT_MICRO_USD };
}

/**
 * The second job: your agent is about to ship a Solana program and has it
 * formally verified first. Tolca checks Harmonic's payout wallet, then
 * Aristotle runs twice: the money properties, then a follow-up in the same
 * project (which Harmonic says usually costs less than a new one).
 */
export const VERIFY_PROVIDERS: readonly BudgetProviderPlan[] = [
  { providerId: TOLCA_PAYMENT_CHECK.id, accepts: ["USDC"], calls: [], checksOthers: true },
  {
    providerId: ARISTOTLE_HARMONIC.id,
    accepts: ["USDC"],
    calls: [
      aristotleRun("Prove the program never pays a provider more than its reservation, and that every unit of the Budget stays accounted for.", 40, "aristotle/run-1-summary.md"),
      aristotleRun("Follow-up in the same project: prove only the payer or the judge can move funds after close, and no instruction panics.", 25, "aristotle/run-2-summary.md"),
    ],
  },
];

export type BudgetJobId = "video" | "verify";

/** The jobs the scenario can run: what the agent is doing, how much the Budget holds, and who it asks to join. */
export const BUDGET_JOBS: Record<BudgetJobId, { totalMicroUsd: bigint; minutesPerCall: number; providers: readonly BudgetProviderPlan[]; unit: (plan: BudgetCallPlan) => BudgetCallReceipt["unit"] }> = {
  video: { totalMicroUsd: BUDGET_DEFAULTS.totalMicroUsd, minutesPerCall: 4, providers: BUDGET_PROVIDERS, unit: (plan) => (plan.flatMicroUsd !== undefined ? "render" : "second") },
  verify: { totalMicroUsd: BigInt(200_000_000), minutesPerCall: 45, providers: VERIFY_PROVIDERS, unit: () => "run" },
};

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
  /** A "run" is one verification run; its `units` are the credits it used. */
  unit: "second" | "render" | "check" | "run";
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

/** A planned call's price in the Budget token: its flat price if it has one, else per second. */
export function budgetPlanCost(provider: SandboxProvider, plan: BudgetCallPlan, token: BudgetToken): bigint {
  return plan.flatMicroUsd !== undefined ? BUDGET_TOKENS[token].fromMicroUsd(plan.flatMicroUsd) : budgetCallCost(provider, plan.units, token);
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
  /** Which job the agent is doing: the launch video (default) or verifying a Solana program. */
  job?: BudgetJobId;
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
  const job = BUDGET_JOBS[input.job ?? "video"];
  const providers = job.providers;
  const minutesPerCall = input.minutesPerCall ?? job.minutesPerCall;
  const slotsPerCall = Math.round((minutesPerCall * 60_000) / SLOT_MS);
  const total = BUDGET_TOKENS[token].fromMicroUsd(input.totalMicroUsd ?? job.totalMicroUsd);
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

  const calls: BudgetCallRow[] = [];
  /** One call paid from a reservation, off-chain, with a receipt chained to the provider's last. */
  const payCall = async (provider: SandboxProvider, plan: BudgetCallPlan, unit: BudgetCallReceipt["unit"], done: string): Promise<boolean> => {
    const reservation = reservations.get(provider.id)!;
    const cost = budgetPlanCost(provider, plan, token);
    if (reservation.used + cost > reservation.reserved) {
      log("call", `${provider.name} stops: the next call would pass its reservation of ${fmt(reservation.reserved)}.`);
      return false;
    }
    reservation.used += cost;
    const previous = reservation.rows[reservation.rows.length - 1]?.hash ?? null;
    const receipt: BudgetCallReceipt = {
      kind: "rap-budget-call",
      simulated: true,
      budget: budgetId,
      payee: provider.payTo,
      sequence: reservation.rows.length + 1,
      ask: plan.ask,
      file: plan.file,
      unit,
      units: plan.units,
      amount: cost.toString(),
      cumulative: reservation.used.toString(),
      reserved: reservation.reserved.toString(),
      previousReceiptHash: previous,
      slot,
    };
    const hash = await sha256Hex(JSON.stringify(receipt));
    // The agent's own count: its price for what came back, the running total, the order and the chain.
    const ownTotal = reservation.rows.reduce((sum, row) => sum + BigInt(row.receipt.amount), BigInt(0)) + budgetPlanCost(provider, plan, token);
    const checked = receipt.amount === budgetPlanCost(provider, plan, token).toString() && receipt.cumulative === ownTotal.toString() && receipt.sequence === reservation.rows.length + 1 && receipt.previousReceiptHash === previous;
    const row: BudgetCallRow = { providerId: provider.id, providerName: provider.name, receipt, hash, checked };
    reservation.rows.push(row);
    calls.push(row);
    log("call", `${provider.name} ${done} for ${fmt(cost)}. Running total ${fmt(reservation.used)} of ${fmt(reservation.reserved)} reserved.`);
    return true;
  };

  // The agent asks each provider to join, reserving twice its estimate, capped.
  // A provider that checks the others is estimated at one check per later provider that takes the token.
  const joined: BudgetRunResult["joined"] = [];
  const refused: BudgetRunResult["refused"] = [];
  let checker: SandboxProvider | null = null;
  for (const [position, entry] of providers.entries()) {
    const provider = budgetProvider(entry.providerId);
    if (!provider) continue;
    slot += HOUR_SLOTS / 60; // a minute per reserve
    if (checker && entry.accepts.includes(token)) {
      // Before reserving, the agent pays the checker to screen this provider's payout wallet.
      slot += 25; // ten seconds
      const plan: BudgetCallPlan = { ask: `Check ${provider.name}'s payout wallet before reserving for it.`, units: 0, file: `checks/${provider.id}.json`, flatMicroUsd: TOLCA_CHECK_MICRO_USD };
      await payCall(checker, plan, "check", `checks ${provider.name}'s payout wallet: allow, no sanctions, freeze or scam-list hit (simulated)`);
    }
    const checks = entry.checksOthers ? providers.slice(position + 1).filter((other) => other.accepts.includes(token)).length : 0;
    const estimate = entry.calls.reduce((sum, call) => sum + budgetPlanCost(provider, call, token), BigInt(0)) + BUDGET_TOKENS[token].fromMicroUsd(TOLCA_CHECK_MICRO_USD) * BigInt(checks);
    let amount = estimate * BUDGET_DEFAULTS.reserveMultiplier;
    // The program's smallest reservation is 1% of the Budget: a cheap provider gets that much, and the rest comes back at payout.
    const minimum = budget.total / BigInt(100) > BigInt(1) ? budget.total / BigInt(100) : BigInt(1);
    const raised = amount < minimum;
    if (raised) amount = minimum;
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
    const capped = raised ? " (the smallest reservation a Budget allows, 1% of it)" : amount < estimate * BUDGET_DEFAULTS.reserveMultiplier ? " (twice the estimate would pass the cap, so the cap applies)" : "";
    const role = entry.checksOthers ? ` It will check each provider's payout wallet before your agent reserves for it, ${checks} check${checks === 1 ? "" : "s"} in all.` : "";
    log("reserve", `${provider.name} joins. Your agent reserves ${fmt(amount)} for it${capped}, against an estimate of ${fmt(estimate)}.${role}`);
    if (entry.checksOthers) checker = provider;
  }

  // Calls paid from each reservation, off-chain, one receipt each.
  for (const entry of providers) {
    const provider = budgetProvider(entry.providerId);
    if (!reservations.has(entry.providerId) || !provider) continue;
    for (const plan of entry.calls) {
      slot += slotsPerCall;
      const unit = job.unit(plan);
      const detail = unit === "run" ? ` (one verification run, ${plan.units} credits, illustrative)` : unit === "render" ? " (one render)" : ` (${plan.units} s)`;
      if (!(await payCall(provider, plan, unit, `delivers ${plan.file}${detail}`))) break;
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
    const name = budgetProvider(providerId)?.name ?? providerId;
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
    const name = budgetProvider(providerId)?.name ?? providerId;
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
