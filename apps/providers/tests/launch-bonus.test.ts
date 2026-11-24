/**
 * Launch Budget bonus: the settings, the earn and split rules, and the
 * Postgres ledger. The ledger tests need a real database with the migrations
 * applied (supabase/migrations); set RAP_TEST_DATABASE_URL to run them, as CI
 * does. Each test uses its own offer id, so tests never see each other's rows.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import type { PgPool } from "@redditech/provider-kit";
import {
  applyLaunchBonus,
  bonusForBudget,
  launchBonusHooks,
  launchBonusSettings,
  LAUNCH_BONUS_OFFER,
  PostgresLaunchBonusStore,
  PROTOCOL_TREASURY,
  splitCall,
  USDC_MINT,
  type BudgetFacts,
  type LaunchBonusConfig,
  type LaunchBonusSettings,
} from "../lib/launch-bonus.ts";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function address(): string {
  let n = BigInt(`0x${randomBytes(32).toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out.padStart(43, "1");
}

const START = "2026-12-05T00:00:00Z";
const START_MS = Date.parse(START);
const DAY = 86_400_000;
const USDC = 1_000_000n;

function settings(env: Record<string, string> = {}): LaunchBonusConfig {
  const result = launchBonusSettings({ PROVIDERS_NETWORK: "mainnet", LAUNCH_BONUS_STARTS_AT: START, ...env });
  if (!result.ok) assert.fail(`settings refused: ${JSON.stringify(result)}`);
  return (result as Extract<LaunchBonusSettings, { ok: true }>).config;
}

function budget(overrides: Partial<BudgetFacts> = {}): BudgetFacts {
  return { budget: address(), createdSlot: 525_720_300n, payer: address(), mint: USDC_MINT.mainnet, total: 5n * USDC, openedAtMs: START_MS + DAY, ...overrides };
}

test("the offer is off until a start time is set, and refuses malformed settings", () => {
  assert.deepEqual(launchBonusSettings({}), { ok: false, off: true });
  const config = settings();
  assert.equal(config.matchBps, 5000n);
  assert.equal(config.endsAtMs, START_MS + 30 * DAY);
  assert.equal(config.walletCap, 10n * USDC);
  assert.equal(config.poolCap, 1000n * USDC);
  assert.equal(config.minBudget, USDC);
  assert.ok(config.excludedPayers.has(PROTOCOL_TREASURY));
  for (const env of [
    { LAUNCH_BONUS_STARTS_AT: "5 Dec 2026" },
    { LAUNCH_BONUS_MATCH_BPS: "0" },
    { LAUNCH_BONUS_MATCH_BPS: "10001" },
    { LAUNCH_BONUS_MATCH_BPS: "50%" },
    { LAUNCH_BONUS_DAYS: "0" },
    { LAUNCH_BONUS_DAYS: "2.5" },
    { LAUNCH_BONUS_WALLET_CAP_USDC: "-1" },
    { LAUNCH_BONUS_WALLET_CAP_USDC: "2000" },
    { LAUNCH_BONUS_POOL_CAP_USDC: "1.0000001" },
    { LAUNCH_BONUS_EXCLUDED_PAYERS: "not an address" },
    { PROVIDERS_NETWORK: "testnet" },
  ]) {
    const result = launchBonusSettings({ PROVIDERS_NETWORK: "mainnet", LAUNCH_BONUS_STARTS_AT: START, ...env });
    assert.equal(result.ok, false, JSON.stringify(env));
    assert.equal((result as { off: boolean }).off, false);
  }
  // RAP's own provider wallets never earn.
  const wallet = address();
  assert.ok(settings({ HUMANISER_WALLET: wallet }).excludedPayers.has(wallet));
});

test("a USDC Budget opened in the window earns 50% of what it locks", () => {
  const config = settings();
  assert.deepEqual(bonusForBudget(config, budget()), { eligible: true, amount: 2_500_000n });
  assert.deepEqual(bonusForBudget(settings({ LAUNCH_BONUS_MATCH_BPS: "10000" }), budget()), { eligible: true, amount: 5n * USDC });
  assert.deepEqual(bonusForBudget(config, budget({ openedAtMs: START_MS - 1 })), { eligible: false, reason: "outside_window" });
  assert.deepEqual(bonusForBudget(config, budget({ openedAtMs: START_MS })).eligible, true);
  assert.deepEqual(bonusForBudget(config, budget({ openedAtMs: START_MS + 30 * DAY })), { eligible: false, reason: "outside_window" });
  assert.deepEqual(bonusForBudget(config, budget({ mint: null })), { eligible: false, reason: "not_usdc" });
  assert.deepEqual(bonusForBudget(config, budget({ mint: USDC_MINT.devnet })), { eligible: false, reason: "not_usdc" });
  assert.deepEqual(bonusForBudget(config, budget({ total: USDC - 1n })), { eligible: false, reason: "below_minimum" });
  assert.deepEqual(bonusForBudget(config, budget({ payer: PROTOCOL_TREASURY })), { eligible: false, reason: "excluded_payer" });
});

test("each call is split so the bonus covers one third and the Budget always pays more", () => {
  assert.deepEqual(splitCall(30_000n, 2_500_000n, 5000n), { bonus: 10_000n, paid: 20_000n });
  assert.deepEqual(splitCall(1n, 2_500_000n, 5000n), { bonus: 0n, paid: 1n });
  assert.deepEqual(splitCall(30_000n, 4_000n, 5000n), { bonus: 4_000n, paid: 26_000n });
  assert.deepEqual(splitCall(30_000n, 0n, 5000n), { bonus: 0n, paid: 30_000n });
  assert.deepEqual(splitCall(10_000n, 1_000_000n, 10_000n), { bonus: 5_000n, paid: 5_000n });
  // Spending a whole $5 Budget with RAP providers uses the whole $2.50 bonus.
  let remaining = 2_500_000n;
  let paid = 0n;
  while (paid < 5n * USDC) {
    const split = splitCall(30_000n, remaining, 5000n);
    remaining -= split.bonus;
    paid += split.paid;
  }
  assert.ok(remaining <= 10_000n, `left ${remaining}`);
  for (let cost = 1n; cost < 2000n; cost += 7n) {
    const split = splitCall(cost, 10n ** 9n, 5000n);
    assert.equal(split.bonus + split.paid, cost);
    assert.ok(split.paid > 0n && split.bonus * 2n <= split.paid);
  }
});

test("with the offer off, or a Budget that does not qualify, the Budget pays the whole cost and the ledger is not touched", async () => {
  const store = {
    grant: async () => assert.fail("no grant"),
    apply: async () => assert.fail("no apply"),
    void: async () => assert.fail("no void"),
    release: async () => assert.fail("no release"),
  };
  const call = { id: "call-1", provider: "humaniser", cost: 30_000n };
  assert.deepEqual(await applyLaunchBonus({ ok: false, off: true }, store, budget(), call), { paid: 30_000n });
  assert.deepEqual(await applyLaunchBonus({ ok: false, off: false, message: "bad" }, store, budget(), call), { paid: 30_000n });
  assert.deepEqual(await applyLaunchBonus({ ok: true, config: settings() }, store, budget({ mint: null }), call), { paid: 30_000n });
});

const url = process.env.RAP_TEST_DATABASE_URL;
if (!url && process.env.CI) throw new Error("RAP_TEST_DATABASE_URL is not set: the launch bonus ledger tests must run in CI");
const skip = !url ? "set RAP_TEST_DATABASE_URL to run the launch bonus ledger tests" : false;
const pool = url ? new pg.Pool({ connectionString: url, max: 20 }) : undefined;
const db = () => pool as unknown as PgPool;
const offer = () => `test-${randomUUID()}`;

test.after(async () => {
  await pool?.end();
});

test("a Budget is granted once, and the receipt states each call's bonus", { skip }, async () => {
  const store = new PostgresLaunchBonusStore(db(), offer());
  const live: LaunchBonusSettings = { ok: true, config: settings() };
  const facts = budget();
  const first = await applyLaunchBonus(live, store, facts, { id: "call-1", provider: "humaniser", cost: 30_000n });
  assert.deepEqual(first, { paid: 20_000n, bonus: { offer: LAUNCH_BONUS_OFFER, amount: "10000" } });
  // A retry of the same call spends nothing more and returns the same split.
  assert.deepEqual(await applyLaunchBonus(live, store, facts, { id: "call-1", provider: "humaniser", cost: 30_000n }), first);
  const grant = await store.grant(live.config, facts, 999n * USDC);
  assert.equal(grant.amount, 2_500_000n);
  assert.equal(grant.remaining, 2_490_000n);
});

test("twenty instances granting one Budget at once grant it once", { skip }, async () => {
  const id = offer();
  const config = settings();
  const facts = budget();
  const grants = await Promise.all(Array.from({ length: 20 }, () => new PostgresLaunchBonusStore(db(), id).grant(config, facts, 2_500_000n)));
  assert.ok(grants.every((g) => g.amount === 2_500_000n));
  const rows = await pool!.query("select count(*)::int as n from provider_kit.launch_bonus_grants where offer = $1", [id]);
  assert.equal(rows.rows[0].n, 1);
  const total = await pool!.query("select granted from provider_kit.launch_bonus_pool where offer = $1", [id]);
  assert.equal(BigInt(total.rows[0].granted), 2_500_000n);
});

test("the wallet cap holds across a payer's Budgets, even opened at once", { skip }, async () => {
  const id = offer();
  const config = settings();
  const payer = address();
  // Six $5 Budgets at once: $2.50 each, $10 cap, so four earn in full and two earn nothing.
  const grants = await Promise.all(Array.from({ length: 6 }, () => new PostgresLaunchBonusStore(db(), id).grant(config, budget({ payer }), 2_500_000n)));
  assert.equal(grants.reduce((sum, g) => sum + g.amount, 0n), 10n * USDC);
  // Another payer is not affected.
  assert.equal((await new PostgresLaunchBonusStore(db(), id).grant(config, budget(), 2_500_000n)).amount, 2_500_000n);
});

test("the pool cap ends the offer, and lapsed bonus from a closed Budget goes back to the pool", { skip }, async () => {
  const id = offer();
  const config = settings({ LAUNCH_BONUS_POOL_CAP_USDC: "10", LAUNCH_BONUS_WALLET_CAP_USDC: "10" });
  const store = new PostgresLaunchBonusStore(db(), id);
  const grants = await Promise.all(Array.from({ length: 6 }, () => store.grant(config, budget(), 2_500_000n)));
  assert.equal(grants.reduce((sum, g) => sum + g.amount, 0n), 10n * USDC);
  const earner = grants.find((g) => g.amount > 0n)!;
  await store.apply(config, earner, "call-1", "writing-style", 300_000n);
  // The Budget closed with 2.40 unspent: it lapses and frees room in the pool.
  assert.equal(await store.release(earner), 2_400_000n);
  assert.equal(await store.release(earner), 0n);
  assert.deepEqual(await store.apply(config, earner, "call-2", "writing-style", 300_000n), { bonus: 0n, paid: 300_000n });
  assert.equal((await store.grant(config, budget(), 2_500_000n)).amount, 2_400_000n);
});

test("racing calls on one Budget never spend more bonus than it was granted", { skip }, async () => {
  const id = offer();
  const config = settings();
  const facts = budget({ total: USDC }); // $0.50 of bonus
  await new PostgresLaunchBonusStore(db(), id).grant(config, facts, 500_000n);
  const splits = await Promise.all(Array.from({ length: 40 }, (_, i) => new PostgresLaunchBonusStore(db(), id).apply(config, facts, `call-${i}`, "script-writer", 60_000n)));
  const spent = splits.reduce((sum, s) => sum + s.bonus, 0n);
  assert.equal(spent, 500_000n);
  const row = await pool!.query("select remaining from provider_kit.launch_bonus_grants where offer = $1 and budget = $2", [id, facts.budget]);
  assert.equal(BigInt(row.rows[0].remaining), 0n);
});

test("a call refused after pricing gives its bonus back, once, and lapses with a closed Budget", { skip }, async () => {
  const store = new PostgresLaunchBonusStore(db(), offer());
  const config = settings();
  const facts = budget();
  await store.grant(config, facts, 2_500_000n);
  assert.deepEqual(await store.apply(config, facts, "req-1", "humaniser", 30_000n), { bonus: 10_000n, paid: 20_000n });
  assert.equal(await store.void(facts, "req-1"), 10_000n);
  assert.equal(await store.void(facts, "req-1"), 0n);
  assert.equal((await store.grant(config, facts, 2_500_000n)).remaining, 2_500_000n);
  await assert.rejects(store.apply(config, facts, "req-1", "humaniser", 30_000n), /voided/);
  // After close, a late void lapses to the pool instead of the closed Budget.
  await store.apply(config, facts, "req-2", "humaniser", 30_000n);
  assert.equal(await store.release(facts), 2_490_000n);
  assert.equal(await store.void(facts, "req-2"), 10_000n);
  assert.equal((await store.grant(config, facts, 2_500_000n)).remaining, 0n);
});

test("a new Budget at a reused address gets its own grant", { skip }, async () => {
  const store = new PostgresLaunchBonusStore(db(), offer());
  const config = settings();
  const first = budget();
  await store.grant(config, first, 2_500_000n);
  await store.release(first);
  const again = { ...first, createdSlot: first.createdSlot + 1000n };
  assert.equal((await store.grant(config, again, 2_500_000n)).amount, 2_500_000n);
});

test("the kit hooks read the open time from the Budget's slot and refuse when it has none", { skip }, async () => {
  const store = new PostgresLaunchBonusStore(db(), offer());
  const facts = budget();
  const input = { budget: facts.budget, payer: facts.payer, mint: facts.mint, total: facts.total, createdSlot: facts.createdSlot, provider: "humaniser", requestId: "req-1", cost: 30_000n };
  const live = () => launchBonusSettings({ PROVIDERS_NETWORK: "mainnet", LAUNCH_BONUS_STARTS_AT: START });
  const hooks = launchBonusHooks({ settings: live, store, blockTimeMs: async () => START_MS + DAY });
  assert.deepEqual(await hooks.budgetCallPricing(input), { paid: 20_000n, bonus: { offer: LAUNCH_BONUS_OFFER, amount: "10000" } });
  const early = launchBonusHooks({ settings: live, store, blockTimeMs: async () => START_MS - DAY });
  assert.deepEqual(await early.budgetCallPricing({ ...input, budget: address(), requestId: "req-2" }), { paid: 30_000n });
  const none = launchBonusHooks({ settings: live, store, blockTimeMs: async () => { throw new Error("slot has no block time"); } });
  await assert.rejects(none.budgetCallPricing({ ...input, requestId: "req-3" }), /block time/);
  await hooks.budgetCallPricingVoided({ budget: facts.budget, createdSlot: facts.createdSlot, requestId: "req-1" });
  await hooks.onBudgetDone({ budget: facts.budget, createdSlot: facts.createdSlot });
  assert.equal((await store.grant(settings(), facts, 0n)).remaining, 0n);
});

test("the providers' role cannot delete ledger rows", { skip }, async () => {
  await assert.rejects(pool!.query("delete from provider_kit.launch_bonus_grants where offer = 'none'"), /permission denied/);
});
