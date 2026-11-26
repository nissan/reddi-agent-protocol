import { pinLaunchRateClock } from "./launch-clock.js";
import assert from "node:assert/strict";
import { createHash, createPrivateKey, createSign, generateKeyPairSync, sign as edSign } from "node:crypto";
import test from "node:test";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { MemoryNonceReplayStore, SOLANA_GENESIS_HASHES } from "@redditech/x402-solana";
import { budgetApprovalMessage, compressP256PublicKey, p256SpenderAddress, reserveInstruction, reservationAddress, secp256r1ApprovalInstruction, MIN_REVIEW_SLOTS } from "@redditech/x402-solana/budget";
import { budgetRequestHeaders, budgetRequestHeadersP256, spenderSignedReserve, BUDGET_RESERVE_HEADER, type PooledBudgetOffer } from "@redditech/x402-solana/budget-provider";
import { createProviderHandler, PROVIDER_RECEIPT_HEADER, type BudgetCallPricingInput, type ProviderDeps } from "../src/handler.js";
import { MemoryBudgetSliceStore } from "../src/budgets.js";
import { verifyReddiReceiptV2, type SignedReddiReceiptV2 } from "@redditech/agent-protocol/receipt-v2";
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

interface BudgetFields { mint?: PublicKey; judge?: PublicKey | null; total?: bigint; unreserved?: bigint; closed?: boolean; closedSlot?: bigint; createdSlot?: bigint; openSlots?: bigint; disputeSlots?: bigint; reservations?: number; reviewFromOpenEnd?: boolean; p256Spender?: PublicKey }
function budgetBytes(f: BudgetFields = {}): Uint8Array {
  const data = Buffer.alloc(349);
  disc("account:Budget").copy(data, 0);
  payer.toBuffer().copy(data, 8);
  (f.p256Spender ?? spender.publicKey).toBuffer().copy(data, 40);
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
  data[346] = (f.closed ? 0x02 : 0) | (f.reviewFromOpenEnd ? 0x04 : 0) | (f.p256Spender ? 0x08 : 0);
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
function setup(options: { budgets?: Record<string, unknown>; upstream?: Upstream; budgetCallPricing?: ProviderDeps["budgetCallPricing"]; extra?: Partial<ProviderDeps>; store?: MemoryBudgetSliceStore; now?: () => Date; network?: "solana-mainnet-beta" } = {}) {
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
  const base = config({ budgets: { enabled: true, acceptedJudges: [judge.toBase58()], ...options.budgets } } as never);
  if (options.network) chain.genesis = SOLANA_GENESIS_HASHES[options.network];
  const genesis = options.network ? SOLANA_GENESIS_HASHES[options.network] : GENESIS;
  const handler = createProviderHandler(options.network ? { ...base, network: options.network } : base, {
    chain, upstream, replayStore: new MemoryNonceReplayStore(), budgetSlices: store, ...(options.budgetCallPricing ? { budgetCallPricing: options.budgetCallPricing } : {}), ...options.extra,
    signMessage: (m) => edSign(null, m, pkcs8(provider)), now: options.now ?? (() => new Date("2026-12-05T00:00:00.000Z")), log: (e) => events.push(e),
  });
  const call = async (sequence: number, extra: Record<string, string> = {}, signWith: Keypair = spender, body = BODY) => {
    const headers = await budgetRequestHeaders({ genesisHash: genesis, action: "call", budget: budgetKey, createdSlot: CREATED, provider: provider.publicKey, sequence, body }, signer(signWith));
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
  const receipt = JSON.parse(Buffer.from(served.headers.get(PROVIDER_RECEIPT_HEADER)!, "base64url").toString("utf8")) as { receipt: { session: Record<string, string>; budget: Record<string, string> } };
  assert.equal(receipt.receipt.session.escrow, reservationKey.toBase58());
  // The budget block names the Budget, which opening of it, and the slice the session meters.
  assert.deepEqual(receipt.receipt.budget, { address: budgetKey.toBase58(), createdSlot: CREATED.toString(), reservation: reservationKey.toBase58() });
  assert.equal(receipt.receipt.session.payer, payer.toBase58());
  assert.equal(receipt.receipt.session.sequence, "1");
  const slice = await store.get(budgetKey.toBase58());
  assert.equal(slice?.sequence, 1);
  assert.ok(BigInt(slice!.spent) > 0n);
  assert.equal(slice?.status, "open");
});

const receiptSequence = (r: Response) => (JSON.parse(Buffer.from(r.headers.get(PROVIDER_RECEIPT_HEADER)!, "base64url").toString("utf8")) as { receipt: { session: { sequence: string } } }).receipt.session.sequence;

test("later calls carry rising numbers, are signed by the budget's spender, and cost adds up", async () => {
  const { chain, call, store, upstreamCalls } = setup();
  setBudget(chain);
  setReservation(chain, { reserved: 1_000_000n });
  assert.equal((await call(0)).status, 409);
  assert.equal((await call(1, {}, Keypair.generate())).status, 401);
  assert.equal(upstreamCalls.n, 0);
  // Call 1 never arrived (it failed on the way): call 2 is taken, and its receipt is still the first.
  const first = await call(2);
  assert.equal(first.status, 200, await first.clone().text());
  assert.equal(receiptSequence(first), "1");
  const once = BigInt((await store.get(budgetKey.toBase58()))!.spent);
  assert.equal((await call(1)).status, 409);
  assert.equal((await call(2)).status, 409);
  const second = await call(5);
  assert.equal(second.status, 200);
  assert.equal(receiptSequence(second), "2");
  const saved = (await store.get(budgetKey.toBase58()))!;
  assert.equal(saved.sequence, 5);
  assert.equal(saved.served, 2);
  assert.equal(BigInt(saved.spent), once * 2n);
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
  assert.ok(chain.sent[1].at(-1)!.data.subarray(0, 8).equals(payoutDisc));
  assertCreatesAccounts(chain.sent[1], [provider.publicKey, payer]);

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

test("a handler built in code takes pooled budgets on mainnet", () => {
  const devnet = config({ budgets: { enabled: true } } as never);
  const mainnet = { ...devnet, network: "solana-mainnet-beta" as const };
  const deps = { chain: fakeChain(null), upstream: { async createChatCompletion() { return {}; } }, replayStore: new MemoryNonceReplayStore(), signMessage: () => new Uint8Array(64) };
  assert.doesNotThrow(() => createProviderHandler(mainnet, deps));
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
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/** The instructions before the program call create these owners' token accounts if missing, with the provider paying. */
function assertCreatesAccounts(instructions: TransactionInstruction[], owners: PublicKey[]) {
  const creates = instructions.slice(0, -1);
  assert.equal(creates.length, owners.length);
  creates.forEach((ix, i) => {
    assert.equal(ix.programId.toBase58(), ATA_PROGRAM);
    assert.deepEqual([...ix.data], [1], "CreateIdempotent");
    assert.ok(ix.keys[0].pubkey.equals(provider.publicKey) && ix.keys[0].isSigner, "the provider funds it");
    assert.ok(ix.keys[1].pubkey.equals(ata(owners[i], USDC)), "the owner's associated token account");
    assert.ok(ix.keys[2].pubkey.equals(owners[i]));
    assert.ok(ix.keys[3].pubkey.equals(USDC));
  });
}

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
  const close = chain.sent[0].at(-1)!;
  assert.ok(close.data.subarray(0, 8).equals(payoutDisc));
  assert.equal(chain.sent[0].length, 1, "closing a paid slice moves only its rent, so no token account is created");
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
  assert.equal(chain.sent[0].at(-1)!.data.readBigUInt64LE(8), CREATED);
  assert.equal(chain.sent[0].length, 1, "closing a paid slice creates no token account");
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

test("a pricing hook's bonus is signed into the Budget call's receipt and verifies", async () => {
  let bonus = 0n;
  const { chain, call } = setup({ budgetCallPricing: async (input) => { bonus = input.cost / 3n; return { paid: input.cost - bonus, bonus: { offer: "rap-launch-2026", amount: bonus.toString() } }; } });
  setBudget(chain);
  setReservation(chain, { reserved: 1_000_000n });
  const served = await call(1);
  assert.equal(served.status, 200, await served.clone().text());
  assert.ok(bonus > 0n);
  const signed = JSON.parse(Buffer.from(served.headers.get(PROVIDER_RECEIPT_HEADER)!, "base64url").toString("utf8")) as SignedReddiReceiptV2;
  const verified = verifyReddiReceiptV2(signed, { providerId: provider.publicKey.toBase58(), budget: { address: budgetKey.toBase58() }, bonus: { offer: "rap-launch-2026", amount: bonus.toString() } });
  assert.equal(verified.ok, true, JSON.stringify(verified));
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

test("closing an expired budget first creates the payer's token account if it is missing, at the provider's cost", async () => {
  const { chain, call, handler, store } = setup();
  setBudget(chain);
  setReservation(chain, { reserved: 1_000_000n });
  assert.equal((await call(1)).status, 200);
  await store.save({ ...(await store.get(budgetKey.toBase58()))!, status: "posted" });
  setBudget(chain, { openSlots: 1n });
  setReservation(chain, { reserved: 1_000_000n, state: 1, finalAmount: 1n, postedSlot: CURRENT_SLOT - 1n });
  assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "posted" }]);
  assert.equal(chain.sent.length, 1);
  assert.ok(chain.sent[0].at(-1)!.data.subarray(0, 8).equals(disc("global:close_token_budget")));
  assertCreatesAccounts(chain.sent[0], [payer]);
});

test("after an early close by the spender, the payout waits for the end of the open period", async () => {
  for (const reviewFromOpenEnd of [false, true]) {
    const { chain, call, handler, store } = setup();
    setBudget(chain);
    setReservation(chain, { reserved: 1_000_000n });
    assert.equal((await call(1)).status, 200);
    await store.save({ ...(await store.get(budgetKey.toBase58()))!, status: "posted" });
    // Closed early, long before the open period ends; the dispute window alone has passed.
    setBudget(chain, { closed: true, closedSlot: CREATED + 10n, disputeSlots: 100n, reviewFromOpenEnd });
    setReservation(chain, { reserved: 1_000_000n, state: 1, finalAmount: 1n, postedSlot: CURRENT_SLOT - MIN_REVIEW_SLOTS });
    const expected = reviewFromOpenEnd ? "posted" : "paid";
    assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: expected }], `reviewFromOpenEnd=${reviewFromOpenEnd}`);
    assert.equal(chain.sent.length, reviewFromOpenEnd ? 0 : 1);
  }
});

test("a budget whose spender is a P-256 key: the kit checks its secp256r1 reserve approval and its call signatures", async () => {
  const p256 = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = p256.publicKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
  const key = compressP256PublicKey(raw);
  const signP256 = (message: Uint8Array) => new Uint8Array(createSign("SHA256").update(Buffer.from(message)).sign(p256.privateKey));
  const address = await p256SpenderAddress(key);
  const { chain, handler, upstreamCalls } = setup();
  setBudget(chain, { p256Spender: address });
  const send = async (sequence: number, extra: Record<string, string> = {}) => {
    const headers = await budgetRequestHeadersP256({ genesisHash: GENESIS, action: "call", budget: budgetKey, createdSlot: CREATED, provider: provider.publicKey, sequence, body: BODY }, raw, signP256);
    return handler(new Request("http://localhost:8787/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", ...headers, ...extra }, body: BODY }));
  };
  const reserveFor = (offer: PooledBudgetOffer, cluster: "mainnet" | "devnet") => {
    const amount = BigInt(offer.reservation);
    const payoutAccount = new PublicKey(offer.payoutAccount);
    const expiresSlot = CURRENT_SLOT + 150n;
    const message = budgetApprovalMessage({ programId: PROGRAM, budget: budgetKey, createdSlot: CREATED, action: "reserve", payee: provider.publicKey, payoutAccount, amount, expiresSlot, cluster });
    const tx = new Transaction({ feePayer: provider.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() });
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 40_000 }));
    tx.add(secp256r1ApprovalInstruction({ publicKey: key, signature: signP256(message), message }));
    tx.add(reserveInstruction({ programId: PROGRAM, budget: budgetKey, createdSlot: CREATED, spender: { p256ExpiresSlot: expiresSlot }, payee: provider.publicKey, amount, payoutAccount }));
    return { [BUDGET_RESERVE_HEADER]: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64") };
  };

  // An Ed25519-style signature header is not a P-256 spender's.
  const wrongKind = await handler(new Request("http://localhost:8787/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", ...(await budgetRequestHeaders({ genesisHash: GENESIS, action: "call", budget: budgetKey, createdSlot: CREATED, provider: provider.publicKey, sequence: 1, body: BODY }, signer(spender))) }, body: BODY }));
  assert.equal(wrongKind.status, 401);

  const asked = (await (await send(1)).json()) as { error: { code: string }; budget: PooledBudgetOffer };
  assert.equal(asked.error.code, "budget_reservation_required");
  // This provider runs on devnet: an approval made for the mainnet build is refused.
  const otherCluster = await send(1, reserveFor(asked.budget, "mainnet"));
  assert.equal(otherCluster.status, 402);
  assert.equal(chain.cosigned.length, 0);

  const served = await send(1, reserveFor(asked.budget, "devnet"));
  assert.equal(served.status, 200, await served.clone().text());
  assert.equal(chain.cosigned.length, 1);
  assert.deepEqual(chain.cosigned[0].signatures.map((s) => s.publicKey.toBase58()), [provider.publicKey.toBase58()], "the provider is the only signer");
  assert.equal(upstreamCalls.n, 1);
  assert.equal((await send(2)).status, 200);
});

// ── What a budget may cost the provider before it is paid (#1207) ───────────

const errorCode = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;
const offerFor = async (call: (n: number) => Promise<Response>) => ((await (await call(1)).json()) as { budget: PooledBudgetOffer }).budget;

test("one budget gets a limited number of reserves and raises an hour, refused before anything is signed", async () => {
  let ms = Date.parse("2026-12-05T00:00:00.000Z");
  const { chain, call, reserve, store, upstreamCalls } = setup({ budgets: { maxReservesPerHour: 2 }, now: () => new Date(ms) });
  setBudget(chain);
  let attempts = 0;
  const land = chain.cosignAndSend!;
  chain.cosignAndSend = async (tx) => {
    attempts += 1;
    if (chain.failCosign) throw new Error("did not land");
    return land(tx);
  };
  const offer = await offerFor(call);
  chain.failCosign = true;
  assert.equal((await call(1, await reserve(offer))).status, 503);
  ms += 60_000;
  assert.equal((await call(1, await reserve(offer))).status, 503);
  assert.equal(attempts, 2);
  assert.equal((await store.get(budgetKey.toBase58()))?.reserveTimes?.length, 2, "each signed reserve is remembered, landed or not");

  ms += 60_000;
  chain.failCosign = false;
  const third = await call(1, await reserve(offer));
  assert.equal(third.status, 429);
  assert.equal(await errorCode(third), "budget_reserve_limit");
  assert.equal(attempts, 2, "nothing was signed for the third");
  assert.equal(upstreamCalls.n, 0);

  // An hour after the first one, there is room for one more.
  ms += HOUR;
  assert.equal((await call(1, await reserve(offer))).status, 200);
  assert.equal(attempts, 3);
});
const HOUR = 3_600_000;

/** A reserve the spender signed with a compute-unit limit and price, as an agent paying for priority would send. */
function pricedReserve(offer: PooledBudgetOffer, microLamports: number): Record<string, string> {
  const tx = new Transaction();
  tx.feePayer = provider.publicKey;
  tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  tx.add(reserveInstruction({ programId: PROGRAM, budget: budgetKey, createdSlot: CREATED, spender: spender.publicKey, payee: provider.publicKey, amount: BigInt(offer.reservation), payoutAccount: new PublicKey(offer.payoutAccount) }));
  tx.partialSign(spender);
  return { [BUDGET_RESERVE_HEADER]: tx.serialize({ requireAllSignatures: false }).toString("base64") };
}

test("a reserve that could cost more priority fee than the provider pays is refused unsigned", async () => {
  const { chain, call } = setup();
  setBudget(chain);
  const offer = await offerFor(call);
  // 60,000 units at 20,000 micro-lamports is 1,200 lamports: above the default 600.
  const dear = await call(1, pricedReserve(offer, 20_000));
  assert.equal(dear.status, 402);
  assert.match(((await dear.json()) as { error: { message: string } }).error.message, /1200 lamports of priority fee; it pays at most 600/);
  assert.equal(chain.cosigned.length, 0);
  // 10,000 micro-lamports is 600 lamports: within it.
  assert.equal((await call(1, pricedReserve(offer, 10_000))).status, 200);

  const raised = setup({ budgets: { maxPriorityFeeLamports: 1_200 } });
  setBudget(raised.chain);
  assert.equal((await raised.call(1, pricedReserve(await offerFor(raised.call), 20_000))).status, 200);
  const none = setup({ budgets: { maxPriorityFeeLamports: 0 } });
  setBudget(none.chain);
  assert.equal((await none.call(1, pricedReserve(await offerFor(none.call), 1))).status, 402);
  assert.equal(none.chain.cosigned.length, 0);
});

test("the provider fronts rent for a limited number of reservations at once; a raise needs no new rent", async () => {
  // Room for one reservation's rent (about 0.0019 SOL each).
  const { chain, call, reserve, store, events } = setup({ budgets: { maxFrontedRent: "0.002" } });
  setBudget(chain);
  const other = Keypair.generate().publicKey.toBase58();
  await store.save({ budget: other, createdSlot: "1", payer: payer.toBase58(), spender: spender.publicKey.toBase58(), reserved: "500000", spent: "0", inputTokens: 0, outputTokens: 0, sequence: 0, lastCallMs: 0, status: "open" });
  const offer = await offerFor(call);
  const full = await call(1, await reserve(offer));
  assert.equal(full.status, 503);
  assert.equal(await errorCode(full), "provider_budget_slots_full");
  assert.equal(chain.cosigned.length, 0);
  assert.ok(events.some((e) => e.event === "budget_rent_limit" && e.alert === true));
  assert.equal(await store.get(budgetKey.toBase58()), undefined, "nothing is remembered for a reserve that was never signed");

  // Once the other slice is paid out, there is room again.
  await store.save({ ...(await store.get(other))!, status: "done" });
  assert.equal((await call(1, await reserve(offer))).status, 200);

  // A raise of a slice it already holds adds no rent, so the limit does not stop it.
  const held = setup({ budgets: { maxFrontedRent: "0.002" } });
  setBudget(held.chain);
  setReservation(held.chain, { reserved: 100n });
  await held.store.save({ budget: other, createdSlot: "1", payer: payer.toBase58(), spender: spender.publicKey.toBase58(), reserved: "500000", spent: "0", inputTokens: 0, outputTokens: 0, sequence: 0, lastCallMs: 0, status: "open" });
  const low = ((await (await held.call(1)).json()) as { budget: PooledBudgetOffer }).budget;
  assert.equal((await held.call(1, await held.reserve(low))).status, 200);
});

test("the chain's own rent figure is used when it can be asked", async () => {
  const { chain, call, reserve } = setup({ budgets: { maxFrontedRent: "0.002" } });
  setBudget(chain);
  chain.readRentExempt = async (bytes) => {
    assert.equal(bytes, 147);
    return 2_500_000n;
  };
  assert.equal(await errorCode(await call(1, await reserve(await offerFor(call)))), "provider_budget_slots_full");
  chain.readRentExempt = async () => {
    throw new Error("rpc down");
  };
  assert.equal(await errorCode(await call(1, await reserve(await offerFor(call)))), "payment_check_unavailable");
  assert.equal(chain.cosigned.length, 0);
});

test("a reservation whose first call failed is settled by the sweep: nothing is posted, and a payout closes it and returns its rent", async () => {
  const failing: Upstream = { async createChatCompletion() { throw new Error("model down"); } };
  const { chain, call, reserve, handler, store, events } = setup({ upstream: failing });
  setBudget(chain);
  const failed = await call(1, await reserve(await offerFor(call)));
  assert.ok(failed.status >= 500, "the model failed, so the call was not served");
  assert.equal(chain.cosigned.length, 1, "but the reserve had landed");
  const slice = await store.get(budgetKey.toBase58());
  assert.equal(slice?.spent, "0");
  assert.equal(slice?.reserved, "500000");
  assert.equal(slice?.status, "open");

  assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "open" }]);
  setBudget(chain, { closed: true, closedSlot: CURRENT_SLOT - 10n });
  assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "posted" }]);
  assert.equal(chain.sent.length, 0, "nothing is owed, so nothing is posted");
  assert.ok(events.some((e) => e.event === "budget_nothing_owed"));
  // Still inside the dispute window: no payout yet.
  assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "posted" }]);
  assert.equal(chain.sent.length, 0);

  setBudget(chain, { closed: true, closedSlot: CURRENT_SLOT - 216_000n });
  assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "paid" }]);
  assert.equal(chain.sent.length, 1);
  assert.ok(chain.sent[0].at(-1)!.data.subarray(0, 8).equals(payoutDisc), "the payout that closes the unposted reservation");
  chain.accounts.delete(reservationKey.toBase58());
  assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "done" }]);
});

test("a reserve that was signed but never landed leaves the budget usable, and is dropped once the budget ends", async () => {
  const { chain, call, reserve, handler, store } = setup();
  setBudget(chain);
  const offer = await offerFor(call);
  chain.failCosign = true;
  assert.equal((await call(1, await reserve(offer))).status, 503);
  assert.equal((await store.get(budgetKey.toBase58()))?.reserved, "0");
  assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "open" }]);
  assert.equal((await store.get(budgetKey.toBase58()))?.status, "open");
  chain.failCosign = false;
  assert.equal((await call(1, await reserve(offer))).status, 200);

  const never = setup();
  setBudget(never.chain);
  never.chain.failCosign = true;
  assert.equal((await never.call(1, await never.reserve(await offerFor(never.call)))).status, 503);
  setBudget(never.chain, { closed: true, closedSlot: CURRENT_SLOT - 10n });
  assert.deepEqual(await never.handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "done" }]);
  assert.equal(never.chain.sent.length, 0);
});

test("the sweep reads a slice's size from the chain when a reserve's result was not recorded", async () => {
  const { chain, call, reserve, handler, store } = setup();
  setBudget(chain);
  const offer = await offerFor(call);
  const land = chain.cosignAndSend!;
  // Lands on chain, but the provider is told it failed.
  chain.cosignAndSend = async (tx) => {
    await land(tx);
    throw new Error("timed out");
  };
  assert.equal((await call(1, await reserve(offer))).status, 503);
  assert.equal((await store.get(budgetKey.toBase58()))?.reserved, "0");
  assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "open" }]);
  assert.equal((await store.get(budgetKey.toBase58()))?.reserved, "500000", "so its rent counts toward the limit and it is settled");
});

test("the provider pays for a limited number of payers' missing token accounts a day; past that the payout goes without one", async () => {
  const run = async (budgets: Record<string, unknown>, payerHasAccount: boolean) => {
    const s = setup({ budgets });
    setBudget(s.chain);
    setReservation(s.chain, { reserved: 1_000_000n });
    assert.equal((await s.call(1)).status, 200);
    if (payerHasAccount) s.chain.accounts.set(ata(payer).toBase58(), { owner: PROGRAM, data: new Uint8Array(165), lamports: 2_039_280n, executable: false });
    setBudget(s.chain, { closed: true, closedSlot: CURRENT_SLOT - 216_000n });
    assert.deepEqual(await s.handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "posted" }]);
    setReservation(s.chain, { reserved: 1_000_000n, state: 1, finalAmount: 1n, postedSlot: CURRENT_SLOT - MIN_REVIEW_SLOTS });
    assert.deepEqual(await s.handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "paid" }]);
    return s;
  };
  const created = await run({}, false);
  assertCreatesAccounts(created.chain.sent[1], [provider.publicKey, payer]);
  assert.equal(typeof (await created.store.get(budgetKey.toBase58()))?.payerAccountMs, "number");
  assert.equal(await created.store.payerAccountsSince(0), 1);

  const present = await run({}, true);
  assertCreatesAccounts(present.chain.sent[1], [provider.publicKey]);
  assert.equal((await present.store.get(budgetKey.toBase58()))?.payerAccountMs, undefined);

  const capped = await run({ maxPayerAccountsPerDay: 0 }, false);
  assertCreatesAccounts(capped.chain.sent[1], [provider.publicKey]);
  assert.ok(capped.events.some((e) => e.event === "budget_payer_account_missing" && e.alert === true));
});

test("on mainnet a budget in the provider's token with a judge it lists is reserved, served and posted; another judge is refused before reserving", async () => {
  const { chain, call, reserve, handler, store } = setup({ network: "solana-mainnet-beta" });
  setBudget(chain);
  const offer = await offerFor(call);
  assert.equal(offer.network, SOLANA_GENESIS_HASHES["solana-mainnet-beta"]);
  assert.equal((await call(1, await reserve(offer))).status, 200);
  assert.equal(chain.cosigned.length, 1);
  setBudget(chain, { closed: true, closedSlot: CURRENT_SLOT - 10n });
  assert.deepEqual(await handler.settleDueBudgets(), [{ budget: budgetKey.toBase58(), status: "posted" }]);
  assert.equal(chain.sent[0][0].data.readBigUInt64LE(16), BigInt((await store.get(budgetKey.toBase58()))!.spent));

  const other = setup({ network: "solana-mainnet-beta" });
  setBudget(other.chain, { judge: Keypair.generate().publicKey });
  const refused = await other.call(1, await other.reserve(offer));
  assert.equal(await errorCode(refused), "budget_judge_not_accepted");
  assert.equal(other.chain.cosigned.length, 0);
});

test("the sweep's slice-size repair does not roll back calls served after its due() snapshot", async () => {
  const store = new MemoryBudgetSliceStore();
  const { chain, call, handler, upstreamCalls } = setup({ store });
  setBudget(chain);
  setReservation(chain, { reserved: 1_000_000n });
  assert.equal((await call(1)).status, 200);
  const once = BigInt((await store.get(budgetKey.toBase58()))!.spent);
  // The sweep reads every due slice first, then works through them one by one (each several RPCs and
  // possibly a confirmed send). Meanwhile this budget's spender raises its slice and call 2 is served.
  const due = store.due.bind(store);
  store.due = async () => {
    const snapshot = await due();
    setReservation(chain, { reserved: 2_000_000n });
    assert.equal((await call(2)).status, 200);
    return snapshot;
  };
  await handler.settleDueBudgets();
  store.due = due;
  const after = (await store.get(budgetKey.toBase58()))!;
  assert.equal(BigInt(after.spent), once * 2n, "call 2's charge must be kept, or the provider posts less than it served");
  assert.equal(after.sequence, 2, "call 2's number must stay used");
  const served = upstreamCalls.n;
  assert.equal((await call(2)).status, 409, "call 2 must not be served (and charged) a second time");
  assert.equal(upstreamCalls.n, served);
});

test("after a sweep that ran across a raise, an already-served call number is not served again", async () => {
  const store = new MemoryBudgetSliceStore();
  const { chain, call, handler, upstreamCalls } = setup({ store });
  setBudget(chain);
  setReservation(chain, { reserved: 1_000_000n });
  assert.equal((await call(1)).status, 200);
  const due = store.due.bind(store);
  store.due = async () => {
    const snapshot = await due();
    setReservation(chain, { reserved: 2_000_000n });
    assert.equal((await call(2)).status, 200);
    return snapshot;
  };
  await handler.settleDueBudgets();
  store.due = due;
  const served = upstreamCalls.n;
  const again = await call(2);
  assert.equal(again.status, 409, "call 2 was already served and charged");
  assert.equal(upstreamCalls.n, served);
});

test("maxFrontedRent holds when reserves for two budgets are in flight at once", async () => {
  // Room for one reservation's rent only.
  const { chain, handler } = setup({ budgets: { maxFrontedRent: "0.002" } });
  const budgetB = Keypair.generate().publicKey;
  setBudget(chain);
  chain.accounts.set(budgetB.toBase58(), { owner: PROGRAM, data: budgetBytes(), lamports: 3_000_000n, executable: false });
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let signed = 0;
  chain.cosignAndSend = async (tx) => {
    signed += 1;
    tx.partialSign(provider);
    const ix = tx.instructions[tx.instructions.length - 1];
    const budget = ix.keys[0].pubkey;
    await gate; // the reserve is in flight (cosignAndSend polls for up to a minute)
    chain.accounts.set(reservationAddress(budget, provider.publicKey, PROGRAM).toBase58(), { owner: PROGRAM, data: reservationBytes({ reserved: ix.data.readBigUInt64LE(16) }), lamports: 1_500_000n, executable: false });
    return "reserve-sig";
  };
  const callFor = async (budget: PublicKey, extra: Record<string, string> = {}) => {
    const headers = await budgetRequestHeaders({ genesisHash: GENESIS, action: "call", budget, createdSlot: CREATED, provider: provider.publicKey, sequence: 1, body: BODY }, signer(spender));
    return handler(new Request("http://localhost:8787/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", ...headers, ...extra }, body: BODY }));
  };
  const reserveFor = async (budget: PublicKey) => {
    const offer = ((await (await callFor(budget)).json()) as { budget: PooledBudgetOffer }).budget;
    return { [BUDGET_RESERVE_HEADER]: await spenderSignedReserve({ offer, budget, createdSlot: CREATED, spender: spender.publicKey, amount: BigInt(offer.reservation), recentBlockhash: Keypair.generate().publicKey.toBase58(), signWithSpender: signer(spender) }) };
  };
  const headersA = await reserveFor(budgetKey);
  const headersB = await reserveFor(budgetB);
  const a = callFor(budgetKey, headersA);
  await new Promise((r) => setTimeout(r, 50));
  const b = callFor(budgetB, headersB);
  await new Promise((r) => setTimeout(r, 50));
  release();
  const statuses = [(await a).status, (await b).status];
  assert.equal(signed, 1, `only one reservation's rent fits, but ${signed} reserves were co-signed (statuses ${statuses})`);
});

test("a slice of an earlier budget at the same address is reported done before a new reserve replaces its record", async () => {
  const done: { budget: string; createdSlot: string }[] = [];
  let fail = true;
  const store = new MemoryBudgetSliceStore();
  const { chain, handler } = setup({ store, extra: { onBudgetDone: async (d) => { if (fail) throw new Error("pool down"); done.push(d); } } });
  const LATER = CREATED + 5_000n;
  // The earlier budget's slice was posted and paid out, and the sweep has not yet marked it done.
  await store.save({ budget: budgetKey.toBase58(), createdSlot: CREATED.toString(), payer: Keypair.generate().publicKey.toBase58(), spender: spender.publicKey.toBase58(), reserved: "1000000", spent: "5355", inputTokens: 120, outputTokens: 333, sequence: 1, lastCallMs: 0, status: "posted", posted: "5355" });
  setBudget(chain, { createdSlot: LATER });
  const callLater = async (extra: Record<string, string> = {}) => {
    const headers = await budgetRequestHeaders({ genesisHash: GENESIS, action: "call", budget: budgetKey, createdSlot: LATER, provider: provider.publicKey, sequence: 1, body: BODY }, signer(spender));
    return handler(new Request("http://localhost:8787/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", ...headers, ...extra }, body: BODY }));
  };
  const asked = (await (await callLater()).json()) as { budget: PooledBudgetOffer };
  const reserveHeader = async () => ({ [BUDGET_RESERVE_HEADER]: await spenderSignedReserve({ offer: asked.budget, budget: budgetKey, createdSlot: LATER, spender: spender.publicKey, amount: BigInt(asked.budget.reservation), recentBlockhash: Keypair.generate().publicKey.toBase58(), signWithSpender: signer(spender) }) });
  const refused = await callLater(await reserveHeader());
  assert.equal(refused.status, 503, "the report failed, so nothing is signed and the earlier record is kept");
  assert.equal(chain.cosigned.length, 0);
  assert.equal((await store.get(budgetKey.toBase58()))!.createdSlot, CREATED.toString());
  fail = false;
  const served = await callLater(await reserveHeader());
  assert.equal(served.status, 200, await served.clone().text());
  assert.deepEqual(done, [{ budget: budgetKey.toBase58(), createdSlot: CREATED.toString() }]);
  assert.equal((await store.get(budgetKey.toBase58()))!.createdSlot, LATER.toString());
});
