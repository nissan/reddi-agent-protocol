import { pinLaunchRateClock } from "./launch-clock.js";
import assert from "node:assert/strict";
import { createHash, createPrivateKey, sign as edSign } from "node:crypto";
import test from "node:test";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { MemoryNonceReplayStore, SOLANA_GENESIS_HASHES } from "@redditech/x402-solana";
import { reservationAddress, MIN_REVIEW_SLOTS } from "@redditech/x402-solana/budget";
import { budgetRequestHeaders, spenderSignedReserve, BUDGET_RESERVE_HEADER, type PooledBudgetOffer } from "@redditech/x402-solana/budget-provider";
import { createProviderHandler, PROVIDER_RECEIPT_HEADER, type BudgetCallPricingInput, type ProviderDeps } from "../src/handler.js";
import { MemoryBudgetSliceStore } from "../src/budgets.js";
import type { Upstream } from "../src/upstream.js";
import { ata, config, CURRENT_SLOT, fakeChain, PROGRAM, provider, USDC, type FakeChain } from "./helpers.js";

pinLaunchRateClock();

const pkcs8 = (k: Keypair) => createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(k.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
const signer = (k: Keypair) => (message: Uint8Array) => new Uint8Array(edSign(null, Buffer.from(message), pkcs8(k)));
const disc = (name: string) => createHash("sha256").update(name).digest().subarray(0, 8);

const payer = Keypair.generate().publicKey;
const spender = Keypair.generate();
const judge = Keypair.generate().publicKey;
const budgetKey = Keypair.generate().publicKey;
const CREATED = CURRENT_SLOT - 1_000n;
const GENESIS = SOLANA_GENESIS_HASHES["solana-devnet"];
const BODY = JSON.stringify({ messages: [{ role: "user", content: "x".repeat(400) }] });

interface BudgetFields { mint?: PublicKey; judge?: PublicKey | null; total?: bigint; unreserved?: bigint; closed?: boolean; closedSlot?: bigint; createdSlot?: bigint; openSlots?: bigint; disputeSlots?: bigint; reservations?: number }
function budgetBytes(f: BudgetFields = {}): Uint8Array {
  const data = Buffer.alloc(349);
  disc("account:Budget").copy(data, 0);
  payer.toBuffer().copy(data, 8);
  spender.publicKey.toBuffer().copy(data, 40);
  if (f.judge !== null) (f.judge ?? judge).toBuffer().copy(data, 72);
  (f.mint ?? USDC).toBuffer().copy(data, 104);
  data.writeBigUInt64LE(f.createdSlot ?? CREATED, 152);
  data.writeBigUInt64LE(f.openSlots ?? 648_000n, 160);
  data.writeBigUInt64LE(f.disputeSlots ?? 216_000n, 168);
  data.writeBigUInt64LE(648_000n, 176);
  data.writeBigUInt64LE(f.total ?? 50_000_000n, 184);
  data.writeBigUInt64LE(f.unreserved ?? 50_000_000n, 192);
  data.writeBigUInt64LE(f.closedSlot ?? 0n, 336);
  data[344] = f.reservations ?? 0;
  data[346] = f.closed ? 0x02 : 0;
  return data;
}

interface ReservationFields { reserved: bigint; state?: number; waived?: boolean; postedSlot?: bigint; finalAmount?: bigint; budgetCreatedSlot?: bigint }
function reservationBytes(f: ReservationFields): Uint8Array {
  const data = Buffer.alloc(147);
  disc("account:Reservation").copy(data, 0);
  budgetKey.toBuffer().copy(data, 8);
  data.writeBigUInt64LE(f.budgetCreatedSlot ?? CREATED, 40);
  provider.publicKey.toBuffer().copy(data, 48);
  ata(provider.publicKey).toBuffer().copy(data, 80);
  data.writeBigUInt64LE(f.reserved, 112);
  data.writeBigUInt64LE(f.finalAmount ?? 0n, 120);
  data.writeBigUInt64LE(f.postedSlot ?? 0n, 128);
  data[144] = f.state ?? 0;
  data[145] = f.waived ? 1 : 0;
  return data;
}

const reservationKey = reservationAddress(budgetKey, provider.publicKey, PROGRAM);
const setBudget = (chain: FakeChain, f: BudgetFields = {}) => chain.accounts.set(budgetKey.toBase58(), { owner: PROGRAM, data: budgetBytes(f), lamports: 3_000_000n, executable: false });
const setReservation = (chain: FakeChain, f: ReservationFields) => chain.accounts.set(reservationKey.toBase58(), { owner: PROGRAM, data: reservationBytes(f), lamports: 1_500_000n, executable: false });

type Chain = FakeChain & { cosigned: Transaction[]; failCosign?: boolean };
function setup(options: { budgets?: Record<string, unknown>; upstream?: Upstream; budgetCallPricing?: ProviderDeps["budgetCallPricing"]; extra?: Partial<ProviderDeps>; store?: MemoryBudgetSliceStore } = {}) {
  const chain = fakeChain(null) as Chain;
  chain.cosigned = [];
  chain.cosignAndSend = async (tx) => {
    if (chain.failCosign) throw new Error("did not land");
    tx.partialSign(provider);
    assert.equal(tx.verifySignatures(), true);
    chain.cosigned.push(tx);
    const reserveData = tx.instructions[tx.instructions.length - 1].data;
    setReservation(chain, { reserved: reserveData.readBigUInt64LE(16), budgetCreatedSlot: reserveData.readBigUInt64LE(8) });
    return "reserve-sig";
  };
  const upstreamCalls = { n: 0 };
  const upstream: Upstream = options.upstream ?? { async createChatCompletion() { upstreamCalls.n += 1; return { id: "c", choices: [{ message: { role: "assistant", content: "hi" } }], usage: { prompt_tokens: 120, completion_tokens: 333 } }; } };
  const store = options.store ?? new MemoryBudgetSliceStore();
  const events: Record<string, unknown>[] = [];
  const handler = createProviderHandler(config({ budgets: { enabled: true, acceptedJudges: [judge.toBase58()], ...options.budgets } } as never), {
    chain, upstream, replayStore: new MemoryNonceReplayStore(), budgetSlices: store, ...(options.budgetCallPricing ? { budgetCallPricing: options.budgetCallPricing } : {}), ...options.extra,
    signMessage: (m) => edSign(null, m, pkcs8(provider)), now: () => new Date("2026-12-05T00:00:00.000Z"), log: (e) => events.push(e),
  });
  const call = async (sequence: number, extra: Record<string, string> = {}, signWith: Keypair = spender, body = BODY) => {
    const headers = await budgetRequestHeaders({ genesisHash: GENESIS, action: "call", budget: budgetKey, createdSlot: CREATED, provider: provider.publicKey, sequence, body }, signer(signWith));
    return handler(new Request("http://localhost:8787/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", ...headers, ...extra }, body }));
  };
  const reserve = async (offer: PooledBudgetOffer, amount: bigint = BigInt(offer.reservation)) => ({ [BUDGET_RESERVE_HEADER]: await spenderSignedReserve({ offer, budget: budgetKey, createdSlot: CREATED, spender: spender.publicKey, amount, recentBlockhash: Keypair.generate().publicKey.toBase58(), signWithSpender: signer(spender) }) });
  return { chain, handler, call, reserve, store, events, upstreamCalls };
}

test("the 402 offers a budget slice in the provider's own token when budgets are on, and not when they are off", async () => {
  const { handler } = setup();
  const response = await handler(new Request("http://localhost:8787/v1/chat/completions", { method: "POST", body: BODY }));
  assert.equal(response.status, 402);
  const body = (await response.json()) as { budget: PooledBudgetOffer };
  assert.equal(body.budget.scheme, "budget");
  assert.equal(body.budget.mint, USDC.toBase58());
  assert.equal(body.budget.payoutAccount, ata(provider.publicKey).toBase58());
  assert.deepEqual(body.budget.acceptedJudges, [judge.toBase58()]);
  assert.ok(BigInt(body.budget.reservation) >= BigInt(body.budget.minReservation));
  const off = createProviderHandler(config(), { chain: fakeChain(null), upstream: { async createChatCompletion() { return {}; } }, replayStore: new MemoryNonceReplayStore(), signMessage: () => new Uint8Array(64) });
  const plain = (await (await off(new Request("http://localhost:8787/v1/chat/completions", { method: "POST", body: BODY }))).json()) as Record<string, unknown>;
  assert.equal(plain.budget, undefined);
});

test("first call: asks for a reserve, then co-signs the spender's reserve, serves and records the call", async () => {
  const { chain, call, reserve, store, upstreamCalls } = setup();
  setBudget(chain);
  const first = await call(1);
  assert.equal(first.status, 402);
  const asked = (await first.json()) as { error: { code: string }; budget: PooledBudgetOffer };
  assert.equal(asked.error.code, "budget_reservation_required");
  assert.equal(upstreamCalls.n, 0);

  const served = await call(1, await reserve(asked.budget));
  assert.equal(served.status, 200, await served.clone().text());
  assert.equal(chain.cosigned.length, 1);
  assert.equal(upstreamCalls.n, 1);
  const receipt = JSON.parse(Buffer.from(served.headers.get(PROVIDER_RECEIPT_HEADER)!, "base64url").toString("utf8")) as { receipt: { session: Record<string, string> } };
  assert.equal(receipt.receipt.session.escrow, reservationKey.toBase58());
  assert.equal(receipt.receipt.session.payer, payer.toBase58());
  assert.equal(receipt.receipt.session.sequence, "1");
  const slice = await store.get(budgetKey.toBase58());
  assert.equal(slice?.sequence, 1);
  assert.ok(BigInt(slice!.spent) > 0n);
  assert.equal(slice?.status, "open");
});

test("later calls go in order, are signed by the budget's spender, and cost adds up", async () => {
  const { chain, call, store, upstreamCalls } = setup();
  setBudget(chain);
  setReservation(chain, { reserved: 1_000_000n });
  assert.equal((await call(2)).status, 409);
  assert.equal((await call(1, {}, Keypair.generate())).status, 401);
  assert.equal(upstreamCalls.n, 0);
  assert.equal((await call(1)).status, 200);
  const once = BigInt((await store.get(budgetKey.toBase58()))!.spent);
  assert.equal((await call(1)).status, 409);
  assert.equal((await call(2)).status, 200);
  assert.equal(BigInt((await store.get(budgetKey.toBase58()))!.spent), once * 2n);
});

test("asks for a raise when the slice may not cover the next call, and takes a raise signed by the spender", async () => {
  const { chain, call, reserve, upstreamCalls } = setup();
  setBudget(chain);
  setReservation(chain, { reserved: 100n });
  const low = await call(1);
  assert.equal(low.status, 402);
  const body = (await low.json()) as { error: { code: string }; budget: PooledBudgetOffer };
  assert.equal(body.error.code, "reservation_low");
  assert.equal(upstreamCalls.n, 0);
  const raised = await call(1, await reserve(body.budget));
  assert.equal(raised.status, 200);
});

test("refuses budgets it cannot be paid from, before signing anything", async () => {
  for (const [fields, code] of [
    [{ mint: Keypair.generate().publicKey }, "budget_currency_not_accepted"],
    [{ judge: Keypair.generate().publicKey }, "budget_judge_not_accepted"],
    [{ closed: true }, "budget_closed"],
    [{ openSlots: 1_000n + 4_000n }, "budget_closing"],
    [{ unreserved: 10n }, "budget_funds_too_low"],
  ] as const) {
    const { chain, call, reserve, handler } = setup();
    setBudget(chain, fields as BudgetFields);
    const offer = ((await (await handler(new Request("http://localhost:8787/v1/chat/completions", { method: "POST", body: BODY }))).json()) as { budget: PooledBudgetOffer }).budget;
    const response = await call(1, await reserve(offer));
    assert.equal(response.status, 402, code);
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, code);
    assert.equal(chain.cosigned.length, 0, code);
  }
});

test("refuses a reserve for more than it offered, and one that did not land, without serving", async () => {
  const { chain, call, reserve, upstreamCalls } = setup();
  setBudget(chain);
  // The offer that knows the budget: at least 1% of its total, which the program requires.
  const offer = ((await (await call(1)).json()) as { budget: PooledBudgetOffer }).budget;
  assert.equal(offer.reservation, "500000");
  const over = await call(1, await reserve(offer, BigInt(offer.reservation) + 1n));
  assert.equal(((await over.json()) as { error: { code: string } }).error.code, "invalid_reserve");
  chain.failCosign = true;
  const lost = await call(1, await reserve(offer));
  assert.equal(lost.status, 503);
  assert.equal(upstreamCalls.n, 0);
});

test("the sweep posts the total once the budget closes, then pays out after the dispute window", async () => {
  const { chain, call, handler, store } = setup();
  setBudget(chain);
  setReservation(chain, { reserved: 1_000_000n });
  assert.equal((await call(1)).status, 200);
  const spent = BigInt((await store.get(budgetKey.toBase58()))!.spent);

  assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "open" }]);
  assert.equal(chain.sent.length, 0);

  setBudget(chain, { closed: true, closedSlot: CURRENT_SLOT - 10n });
  assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "posted" }]);
  const post = chain.sent[0][0];
  assert.equal(post.data.readBigUInt64LE(16), spent);
  // A closed slice takes no more calls.
  assert.equal((await call(2)).status, 409);

  setReservation(chain, { reserved: 1_000_000n, state: 1, finalAmount: spent, postedSlot: CURRENT_SLOT });
  assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "posted" }]);
  assert.equal(chain.sent.length, 1);

  setBudget(chain, { closed: true, closedSlot: CURRENT_SLOT - 216_000n });
  setReservation(chain, { reserved: 1_000_000n, state: 1, finalAmount: spent, postedSlot: CURRENT_SLOT - MIN_REVIEW_SLOTS });
  assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "paid" }]);
  assert.equal(chain.sent.length, 2);

  chain.accounts.delete(reservationKey.toBase58());
  assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "done" }]);
  assert.deepEqual(await handler.settleDueBudgets(), []);
});

test("a waived slice is paid at once, without waiting for the dispute window", async () => {
  const { chain, call, handler } = setup();
  setBudget(chain, { openSlots: 2_000n + 648_000n });
  setReservation(chain, { reserved: 1_000_000n });
  assert.equal((await call(1)).status, 200);
  setBudget(chain, { closed: true, closedSlot: CURRENT_SLOT - 5n });
  await handler.settleDueBudgets();
  setReservation(chain, { reserved: 1_000_000n, state: 1, waived: true, postedSlot: CURRENT_SLOT });
  assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "paid" }]);
});

test("a handler built in code refuses pooled budgets on mainnet", () => {
  const devnet = config({ budgets: { enabled: true } } as never);
  const mainnet = { ...devnet, network: "solana-mainnet-beta" as const };
  const deps = { chain: fakeChain(null), upstream: { async createChatCompletion() { return {}; } }, replayStore: new MemoryNonceReplayStore(), signMessage: () => new Uint8Array(64) };
  assert.throws(() => createProviderHandler(mainnet, deps), /pooled budgets are not offered on mainnet/);
  assert.doesNotThrow(() => createProviderHandler({ ...mainnet, budgets: { ...mainnet.budgets, enabled: false } }, deps));
});

test("two calls of one budget never run at once, however their headers are encoded", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let served = 0;
  const slow: Upstream = { async createChatCompletion() { served += 1; await gate; return { id: "c", choices: [{ message: { role: "assistant", content: "hi" } }], usage: { prompt_tokens: 120, completion_tokens: 333 } }; } };
  const { chain, call, store } = setup({ upstream: slow });
  setBudget(chain);
  setReservation(chain, { reserved: 1_000_000n });
  const first = call(1);
  while (served === 0) await new Promise((r) => setTimeout(r, 1));
  // The same call, its header re-encoded with spaces: a different header text for the same budget.
  const headers = await budgetRequestHeaders({ genesisHash: GENESIS, action: "call", budget: budgetKey, createdSlot: CREATED, provider: provider.publicKey, sequence: 1, body: BODY }, signer(spender));
  const respaced = Buffer.from(JSON.stringify(JSON.parse(Buffer.from(headers["x402-budget"], "base64").toString()), null, 1)).toString("base64");
  const second = await call(1, { "x402-budget": respaced });
  assert.equal(second.status, 409);
  assert.equal(((await second.json()) as { error: { code: string } }).error.code, "budget_call_in_progress");
  release();
  assert.equal((await first).status, 200);
  assert.equal(served, 1);
  assert.equal((await store.get(budgetKey.toBase58()))?.sequence, 1);
});

const PAID = 3;
const payoutDisc = disc("global:payout_token_budget");

test("a slice paid early is closed once its budget opens again at the same address, so it cannot block a new reserve", async () => {
  const { chain, call, handler, store } = setup();
  setBudget(chain);
  setReservation(chain, { reserved: 1_000_000n });
  assert.equal((await call(1)).status, 200);
  await store.save({ ...(await store.get(budgetKey.toBase58()))!, status: "posted" });
  // The budget is closed and opened again at the same address; this provider's earlier slice is still on record as paid.
  const LATER = CREATED + 5_000n;
  setBudget(chain, { createdSlot: LATER });
  setReservation(chain, { reserved: 1_000_000n, state: PAID, budgetCreatedSlot: CREATED });
  assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "done" }]);
  assert.equal(chain.sent.length, 1);
  const close = chain.sent[0][0];
  assert.ok(close.data.subarray(0, 8).equals(payoutDisc));
  assert.equal(close.data.readBigUInt64LE(8), CREATED, "the payout names the earlier budget");
});

test("a reserve in a budget opened again at the same address first closes this provider's paid slice of the earlier one", async () => {
  const { chain, handler } = setup();
  const LATER = CREATED + 5_000n;
  setBudget(chain, { createdSlot: LATER });
  setReservation(chain, { reserved: 1_000_000n, state: PAID, budgetCreatedSlot: CREATED });
  const headersFor = async (sequence: number, extra: Record<string, string> = {}) => {
    const headers = await budgetRequestHeaders({ genesisHash: GENESIS, action: "call", budget: budgetKey, createdSlot: LATER, provider: provider.publicKey, sequence, body: BODY }, signer(spender));
    return handlerCall(headers, extra);
  };
  const handlerCall = (headers: Record<string, string>, extra: Record<string, string>) => handler(new Request("http://localhost:8787/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", ...headers, ...extra }, body: BODY }));
  const asked = (await (await headersFor(1)).json()) as { error: { code: string }; budget: PooledBudgetOffer };
  assert.equal(asked.error.code, "budget_reservation_required");
  const reserveHeader = { [BUDGET_RESERVE_HEADER]: await spenderSignedReserve({ offer: asked.budget, budget: budgetKey, createdSlot: LATER, spender: spender.publicKey, amount: BigInt(asked.budget.reservation), recentBlockhash: Keypair.generate().publicKey.toBase58(), signWithSpender: signer(spender) }) };
  const served = await headersFor(1, reserveHeader);
  assert.equal(served.status, 200, await served.clone().text());
  assert.equal(chain.sent.length, 1, "the earlier slice was closed first");
  assert.equal(chain.sent[0][0].data.readBigUInt64LE(8), CREATED);
  assert.equal(chain.cosigned.length, 1);
});

test("an operator's pricing hook sets what the budget pays for a call, from the budget the kit read on chain", async () => {
  const seen: BudgetCallPricingInput[] = [];
  const { chain, call, store } = setup({ budgetCallPricing: async (input) => { seen.push(input); return { paid: input.cost / 2n }; } });
  setBudget(chain);
  setReservation(chain, { reserved: 1_000_000n });
  const served = await call(1);
  assert.equal(served.status, 200, await served.clone().text());
  assert.equal(seen.length, 1);
  assert.equal(seen[0].budget, budgetKey.toBase58());
  assert.equal(seen[0].payer, payer.toBase58());
  assert.equal(seen[0].mint, USDC.toBase58());
  assert.equal(seen[0].total, 50_000_000n);
  assert.equal(seen[0].createdSlot, CREATED);
  assert.ok(seen[0].cost > 0n);
  assert.equal((await store.get(budgetKey.toBase58()))?.spent, (seen[0].cost / 2n).toString());
});

test("a pricing hook that fails or answers out of range refuses the call, and nothing is recorded", async () => {
  for (const hook of [async () => { throw new Error("store down"); }, async (input: BudgetCallPricingInput) => ({ paid: input.cost + 1n }), async () => ({ paid: -1n })]) {
    const { chain, call, store } = setup({ budgetCallPricing: hook as ProviderDeps["budgetCallPricing"] });
    setBudget(chain);
    setReservation(chain, { reserved: 1_000_000n });
    const refused = await call(1);
    assert.equal(refused.status, 503);
    assert.equal(((await refused.json()) as { error: { code: string } }).error.code, "budget_pricing_failed");
    assert.equal(await store.get(budgetKey.toBase58()), undefined);
  }
});

test("a priced call that is then refused is reported, so what its pricing set aside can be given back", async () => {
  class FailingStore extends MemoryBudgetSliceStore { override async save(): Promise<void> { throw new Error("disk full"); } }
  const voided: { budget: string; createdSlot: string; requestId: string }[] = [];
  const ids: string[] = [];
  const { chain, call } = setup({ store: new FailingStore(), budgetCallPricing: async (input) => { ids.push(input.requestId); return { paid: input.cost }; }, extra: { budgetCallPricingVoided: async (v) => { voided.push(v); } } });
  setBudget(chain);
  setReservation(chain, { reserved: 1_000_000n });
  const refused = await call(1);
  assert.equal(refused.status, 503);
  assert.deepEqual(voided, [{ budget: budgetKey.toBase58(), createdSlot: CREATED.toString(), requestId: ids[0] }]);
});

test("the sweep reports a budget slice that is done, and keeps it until the report goes through", async () => {
  const done: { budget: string; createdSlot: string }[] = [];
  let fail = true;
  const { chain, call, handler, store } = setup({ extra: { onBudgetDone: async (d) => { if (fail) throw new Error("pool down"); done.push(d); } } });
  setBudget(chain);
  setReservation(chain, { reserved: 1_000_000n });
  assert.equal((await call(1)).status, 200);
  chain.accounts.delete(reservationKey.toBase58());
  chain.accounts.delete(budgetKey.toBase58());
  await handler.settleDueBudgets().catch(() => undefined);
  assert.equal((await store.get(budgetKey.toBase58()))?.status, "open");
  fail = false;
  assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "done" }]);
  assert.deepEqual(done, [{ budget: budgetKey.toBase58(), createdSlot: CREATED.toString() }]);
});

test("after an early waived payout the slice waits for the budget to close: no repeated payouts and no done report", async () => {
  const done: unknown[] = [];
  const { chain, call, handler } = setup({ extra: { onBudgetDone: async (d) => { done.push(d); } } });
  setBudget(chain, { openSlots: 2_000n + 648_000n });
  setReservation(chain, { reserved: 1_000_000n });
  assert.equal((await call(1)).status, 200);
  setReservation(chain, { reserved: 1_000_000n, state: PAID, waived: true, postedSlot: CURRENT_SLOT });
  const before = chain.sent.length;
  assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "paid" }]);
  assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "paid" }]);
  assert.equal(chain.sent.length, before, "nothing is sent while the budget is open");
  assert.deepEqual(done, []);
});
