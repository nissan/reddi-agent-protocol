/**
 * Launch Budget bonus (Nissan, 24 Nov 2026): for the first 30 days after
 * mainnet launch, a Budget opened in USDC earns a bonus of 50% of what it
 * locks, to spend with RAP's own providers only (this project's humaniser,
 * writing style and script writer).
 *
 * The bonus is not money. It is a discount these providers give on their own
 * price, recorded in the provider_kit schema. No funds move for it, nothing
 * comes out of the treasury or the operating vault, and the escrow program is
 * untouched: the provider simply posts the paid part of a call as its final
 * amount on the Budget reservation and states the rest as `bonus` on the
 * signed receipt.
 *
 * Matched, not bonus-first: on each call the bonus covers matchBps / (10000 +
 * matchBps) of the cost (one third at 50%) and the Budget pays the rest, so a
 * Budget fully spent with RAP providers uses its whole bonus, and nobody can
 * open a Budget, spend only bonus and close it for a full refund.
 *
 * Settings come from the environment, so the offer can be tuned or switched
 * off without a release. With LAUNCH_BONUS_STARTS_AT unset the offer is off.
 *
 * Budget facts passed in here must come from the Budget account as read and
 * checked on chain by the caller (the kit's Budget verification), never from
 * the request: the payer, the mint, the total and the open time decide the
 * grant.
 */
import type { PgClient, PgPool } from "@redditech/provider-kit";

export const LAUNCH_BONUS_OFFER = "rap-launch-2026";
const DAY_MS = 86_400_000;
const USDC_DECIMALS = 6n;
const BPS = 10_000n;

/** USDC mints, as in packages/x402-solana. Bonus Budgets must be in USDC: RAP's providers price in it. */
export const USDC_MINT = {
  mainnet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
} as const;

/** The treasury Squads vault. Never earns a bonus. */
export const PROTOCOL_TREASURY = "5CsBuTBFKu12JSs4CUbmv5MR218RYtNmAoQmLf5x3Hxe";

export type LaunchBonusConfig = {
  network: "devnet" | "mainnet";
  startsAtMs: number;
  endsAtMs: number;
  /** Bonus per Budget, as basis points of its total. 5000 = 50%. */
  matchBps: bigint;
  /** In USDC base units (6 decimals). */
  walletCap: bigint;
  poolCap: bigint;
  minBudget: bigint;
  /** Payers that never earn: the treasury, RAP's provider wallets, and any listed. */
  excludedPayers: ReadonlySet<string>;
};

export type LaunchBonusSettings =
  | { ok: true; config: LaunchBonusConfig }
  | { ok: false; off: true }
  | { ok: false; off: false; message: string };

type Env = Record<string, string | undefined>;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DECIMAL = /^(0|[1-9]\d{0,9})(\.\d{1,6})?$/;

/** "10" or "10.5" USDC to base units. */
export function usdc(text: string): bigint | undefined {
  if (!DECIMAL.test(text)) return undefined;
  const [whole, frac = ""] = text.split(".");
  return BigInt(whole!) * 10n ** USDC_DECIMALS + BigInt(frac.padEnd(6, "0"));
}

/**
 * The offer's settings. Off when LAUNCH_BONUS_STARTS_AT is unset; an error
 * (and so no bonus) when any setting is malformed, never a guessed default.
 */
export function launchBonusSettings(env: Env): LaunchBonusSettings {
  const start = env.LAUNCH_BONUS_STARTS_AT?.trim();
  if (!start) return { ok: false, off: true };
  const fail = (message: string): LaunchBonusSettings => ({ ok: false, off: false, message });
  const network = env.PROVIDERS_NETWORK?.trim() || "devnet";
  if (network !== "devnet" && network !== "mainnet") return fail('PROVIDERS_NETWORK must be "devnet" or "mainnet"');
  const startsAtMs = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/.test(start) ? Date.parse(start) : Number.NaN;
  if (!Number.isFinite(startsAtMs)) return fail("LAUNCH_BONUS_STARTS_AT must be an ISO 8601 UTC time, such as 2026-12-05T00:00:00Z");
  const days = Number(env.LAUNCH_BONUS_DAYS?.trim() || "30");
  if (!Number.isInteger(days) || days < 1 || days > 90) return fail("LAUNCH_BONUS_DAYS must be a whole number of days from 1 to 90");
  const bpsText = env.LAUNCH_BONUS_MATCH_BPS?.trim() || "5000";
  if (!/^[1-9]\d{0,4}$/.test(bpsText) || Number(bpsText) > 10_000) return fail("LAUNCH_BONUS_MATCH_BPS must be 1 to 10000 (5000 = 50%)");
  const amounts: Record<string, bigint> = {};
  for (const [key, fallback] of [["WALLET_CAP", "10"], ["POOL_CAP", "1000"], ["MIN_BUDGET", "1"]] as const) {
    const value = usdc(env[`LAUNCH_BONUS_${key}_USDC`]?.trim() || fallback);
    if (value === undefined) return fail(`LAUNCH_BONUS_${key}_USDC must be a USDC amount, such as ${fallback}`);
    amounts[key] = value;
  }
  if (amounts.WALLET_CAP! <= 0n || amounts.POOL_CAP! < amounts.WALLET_CAP!) return fail("the wallet cap must be above zero and at most the pool cap");
  const excluded = new Set<string>([PROTOCOL_TREASURY]);
  for (const name of ["HUMANISER_WALLET", "WRITING_STYLE_WALLET", "SCRIPT_WRITER_WALLET"]) {
    const wallet = env[name]?.trim();
    if (wallet) excluded.add(wallet);
  }
  for (const entry of (env.LAUNCH_BONUS_EXCLUDED_PAYERS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!ADDRESS.test(entry)) return fail("LAUNCH_BONUS_EXCLUDED_PAYERS must be base58 addresses separated by commas");
    excluded.add(entry);
  }
  return {
    ok: true,
    config: {
      network,
      startsAtMs,
      endsAtMs: startsAtMs + days * DAY_MS,
      matchBps: BigInt(bpsText),
      walletCap: amounts.WALLET_CAP!,
      poolCap: amounts.POOL_CAP!,
      minBudget: amounts.MIN_BUDGET!,
      excludedPayers: excluded,
    },
  };
}

/** What the caller read from the Budget account on chain. */
export type BudgetFacts = {
  budget: string;
  payer: string;
  /** null for a SOL Budget. */
  mint: string | null;
  /** What the payer locked, in base units. */
  total: bigint;
  /** Block time of the Budget's created_slot. */
  openedAtMs: number;
};

export type Eligibility = { eligible: true; amount: bigint } | { eligible: false; reason: "outside_window" | "not_usdc" | "below_minimum" | "excluded_payer" };

/** The bonus a Budget earns before the wallet and pool caps. */
export function bonusForBudget(config: LaunchBonusConfig, facts: BudgetFacts): Eligibility {
  if (facts.openedAtMs < config.startsAtMs || facts.openedAtMs >= config.endsAtMs) return { eligible: false, reason: "outside_window" };
  if (facts.mint !== USDC_MINT[config.network]) return { eligible: false, reason: "not_usdc" };
  if (config.excludedPayers.has(facts.payer)) return { eligible: false, reason: "excluded_payer" };
  if (facts.total < config.minBudget) return { eligible: false, reason: "below_minimum" };
  return { eligible: true, amount: (facts.total * config.matchBps) / BPS };
}

/**
 * Splits one call's cost between the bonus and the Budget: the bonus covers
 * matchBps / (10000 + matchBps) of it, rounded down, and never more than is
 * left. The Budget always pays the larger part, so a paid amount is never 0
 * when the cost is above 0.
 */
export function splitCall(cost: bigint, remaining: bigint, matchBps: bigint): { bonus: bigint; paid: bigint } {
  if (cost < 0n || remaining < 0n) throw new Error("cost and remaining must not be negative");
  const share = (cost * matchBps) / (BPS + matchBps);
  const bonus = share < remaining ? share : remaining;
  return { bonus, paid: cost - bonus };
}

export type GrantRow = { budget: string; payer: string; amount: bigint; remaining: bigint };
export type CallSplit = { bonus: bigint; paid: bigint };

/** The ledger. Every method is one transaction; every failure throws. */
export interface LaunchBonusStore {
  /** The Budget's grant, created once within the wallet and pool caps. A Budget that earns nothing gets a zero grant. */
  grant(config: LaunchBonusConfig, facts: BudgetFacts, amount: bigint): Promise<GrantRow>;
  /** Spends bonus on one call, once per (budget, call): a retry returns the first split. */
  apply(config: LaunchBonusConfig, budget: string, call: string, provider: string, cost: bigint): Promise<CallSplit>;
  /** When the Budget has closed: unspent bonus lapses and goes back to the pool and the wallet. */
  release(budget: string): Promise<bigint>;
}

const CALL_ID = /^[\x21-\x7e]{1,200}$/;

async function inTransaction<T>(pool: PgPool, work: (client: PgClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    try {
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
}

const big = (value: unknown): bigint => BigInt(String(value ?? "0"));

/**
 * Postgres ledger (supabase/migrations/20261124200000_provider_kit_launch_bonus.sql). The
 * offer's pool row is locked for every grant and release, so racing calls
 * from several instances cannot grant one Budget twice or pass a cap.
 */
export class PostgresLaunchBonusStore implements LaunchBonusStore {
  private readonly pool: PgPool;
  private readonly offer: string;
  constructor(pool: PgPool, offer: string = LAUNCH_BONUS_OFFER) {
    this.pool = pool;
    this.offer = offer;
  }

  async grant(config: LaunchBonusConfig, facts: BudgetFacts, amount: bigint): Promise<GrantRow> {
    return inTransaction(this.pool, async (client) => {
      await client.query("insert into provider_kit.launch_bonus_pool (offer, granted) values ($1, 0) on conflict do nothing", [this.offer]);
      const pool = await client.query("select granted from provider_kit.launch_bonus_pool where offer = $1 for update", [this.offer]);
      const existing = await client.query("select payer, amount, remaining from provider_kit.launch_bonus_grants where offer = $1 and budget = $2", [this.offer, facts.budget]);
      if (existing.rows[0]) {
        const row = existing.rows[0];
        return { budget: facts.budget, payer: String(row.payer), amount: big(row.amount), remaining: big(row.remaining) };
      }
      const wallet = await client.query(
        "select coalesce(sum(amount - released), 0) as held from provider_kit.launch_bonus_grants where offer = $1 and payer = $2",
        [this.offer, facts.payer],
      );
      const walletRoom = config.walletCap - big(wallet.rows[0]?.held);
      const poolRoom = config.poolCap - big(pool.rows[0]?.granted);
      let granted = amount;
      if (walletRoom < granted) granted = walletRoom;
      if (poolRoom < granted) granted = poolRoom;
      if (granted < 0n) granted = 0n;
      await client.query(
        "insert into provider_kit.launch_bonus_grants (offer, budget, payer, amount, remaining, released) values ($1, $2, $3, $4, $4, 0)",
        [this.offer, facts.budget, facts.payer, granted.toString()],
      );
      if (granted > 0n) await client.query("update provider_kit.launch_bonus_pool set granted = granted + $2 where offer = $1", [this.offer, granted.toString()]);
      return { budget: facts.budget, payer: facts.payer, amount: granted, remaining: granted };
    });
  }

  async apply(config: LaunchBonusConfig, budget: string, call: string, provider: string, cost: bigint): Promise<CallSplit> {
    if (!CALL_ID.test(call)) throw new Error("call id must be 1-200 printable characters without spaces");
    return inTransaction(this.pool, async (client) => {
      const grant = await client.query("select remaining from provider_kit.launch_bonus_grants where offer = $1 and budget = $2 for update", [this.offer, budget]);
      const used = await client.query("select bonus, paid from provider_kit.launch_bonus_uses where offer = $1 and budget = $2 and call = $3", [this.offer, budget, call]);
      if (used.rows[0]) return { bonus: big(used.rows[0].bonus), paid: big(used.rows[0].paid) };
      const remaining = grant.rows[0] ? big(grant.rows[0].remaining) : 0n;
      const split = splitCall(cost, remaining, config.matchBps);
      if (split.bonus > 0n) {
        await client.query("update provider_kit.launch_bonus_grants set remaining = remaining - $3 where offer = $1 and budget = $2", [this.offer, budget, split.bonus.toString()]);
        await client.query(
          "insert into provider_kit.launch_bonus_uses (offer, budget, call, provider, cost, bonus, paid) values ($1, $2, $3, $4, $5, $6, $7)",
          [this.offer, budget, call, provider, cost.toString(), split.bonus.toString(), split.paid.toString()],
        );
      }
      return split;
    });
  }

  async release(budget: string): Promise<bigint> {
    return inTransaction(this.pool, async (client) => {
      await client.query("select granted from provider_kit.launch_bonus_pool where offer = $1 for update", [this.offer]);
      const row = await client.query("select remaining from provider_kit.launch_bonus_grants where offer = $1 and budget = $2 for update", [this.offer, budget]);
      const left = row.rows[0] ? big(row.rows[0].remaining) : 0n;
      if (left === 0n) return 0n;
      await client.query("update provider_kit.launch_bonus_grants set remaining = 0, released = released + $3 where offer = $1 and budget = $2", [this.offer, budget, left.toString()]);
      await client.query("update provider_kit.launch_bonus_pool set granted = granted - $2 where offer = $1", [this.offer, left.toString()]);
      return left;
    });
  }
}

/** What the provider posts and signs for one call. `bonus` goes on the receipt only when above zero. */
export type BonusOutcome = { paid: bigint; bonus?: { offer: string; amount: string } };

/**
 * The one entry point for a call paid from a Budget: grants the Budget its
 * bonus on first sight, then splits this call's cost. With the offer off, or
 * a Budget that does not qualify, the Budget pays the whole cost. A store
 * failure throws: the caller refuses the call rather than charge a price it
 * did not state.
 */
export async function applyLaunchBonus(
  settings: LaunchBonusSettings,
  store: LaunchBonusStore,
  facts: BudgetFacts,
  call: { id: string; provider: string; cost: bigint },
): Promise<BonusOutcome> {
  if (!settings.ok) return { paid: call.cost };
  const config = settings.config;
  const earned = bonusForBudget(config, facts);
  if (!earned.eligible) return { paid: call.cost };
  const grant = await store.grant(config, facts, earned.amount);
  if (grant.amount === 0n) return { paid: call.cost };
  const split = await store.apply(config, facts.budget, call.id, call.provider, call.cost);
  return split.bonus > 0n ? { paid: split.paid, bonus: { offer: LAUNCH_BONUS_OFFER, amount: split.bonus.toString() } } : { paid: split.paid };
}
