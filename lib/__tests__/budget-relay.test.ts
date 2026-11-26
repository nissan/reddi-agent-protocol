/**
 * @jest-environment node
 */
import { generateKeyPairSync, sign as nodeSign } from "crypto";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { BUDGET_DISCRIMINATORS, BUDGET_FLAG_CLOSED, BUDGET_FLAG_P256_SPENDER, compressP256PublicKey, decodeReservation, p256SpenderAddress, reservationAddress } from "@redditech/x402-solana/budget";
import { ed25519Sign } from "@redditech/x402-solana/ed25519";
import { activateSpender, approveAsSpender, signCallAsSpender, type CustodyDeps } from "@/lib/budget/custody";
import type { SpenderSigner } from "@/lib/budget/kms";
import { BUDGET_DISPUTE_SLOTS, BUDGET_OPEN_SLOTS, budgetProviders, prepareBudget, startBudget } from "@/lib/budget/page";
import { parseUsdcProviders, type BudgetProvider } from "@/lib/budget/providers";
import { checkOffer, parseBudgetKey, relayBudgetCall, type RelayDeps } from "@/lib/budget/relay";
import { GENESIS_HASH, MemoryBudgetCustodyStore } from "@/lib/budget/store";
import { decideRuling } from "@/lib/budget/judge/rule";
import { MemoryJudgeStore } from "@/lib/budget/judge/store";
import { BUDGET_RECEIPT_HEADER, MemorySandboxBudgetSliceStore, settleDueSandboxBudgets, SupabaseSandboxBudgetSliceStore, type SandboxBudgetChain, type SandboxBudgetDeps } from "@/lib/sandbox/budget-desk";
import { handleSandboxChatCompletion, type SandboxGatewayDeps } from "@/lib/sandbox/gateway";

const PROGRAM = Keypair.generate().publicKey;
const NOW_MS = Date.UTC(2026, 10, 25, 5, 0, 0);
const CREATED = BigInt(9_000_000);
const TOTAL = BigInt(30_000_000);
const DEVNET = GENESIS_HASH["solana-devnet"];
const ENV = { BUDGET_OPS_EMAIL: "ops@example.com", RESEND_API_KEY: "re_test", BUDGET_ALERT_FROM: "alerts@example.com" };
const SOL = budgetProviders(ENV).filter((p) => p.token === "SOL");
const [A, B, C] = SOL;

function kms(): SpenderSigner {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    publicKey: compressP256PublicKey(publicKey.export({ format: "der", type: "spki" }).subarray(-65)),
    sign: async (m: Uint8Array) => Uint8Array.from(nodeSign("sha256", m, privateKey)),
  };
}

function u64(v: bigint) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

function budgetBytes(o: { payer: PublicKey; spender: PublicKey; unreserved: bigint; reservations: number; closedSlot?: bigint; total?: bigint }): Buffer {
  const total = o.total ?? TOTAL;
  const data = Buffer.alloc(349);
  Buffer.from(BUDGET_DISCRIMINATORS["account:Budget"]).copy(data, 0);
  o.payer.toBuffer().copy(data, 8);
  o.spender.toBuffer().copy(data, 40);
  u64(CREATED).copy(data, 152);
  u64(BUDGET_OPEN_SLOTS).copy(data, 160);
  u64(BUDGET_DISPUTE_SLOTS).copy(data, 168);
  u64(BUDGET_OPEN_SLOTS).copy(data, 176);
  u64(total).copy(data, 184);
  u64(o.unreserved).copy(data, 192);
  u64(total / BigInt(2)).copy(data, 200);
  new PublicKey(A.payee).toBuffer().copy(data, 208);
  new PublicKey(B.payee).toBuffer().copy(data, 240);
  u64(o.closedSlot ?? BigInt(0)).copy(data, 336);
  data[344] = o.reservations;
  data[346] = BUDGET_FLAG_P256_SPENDER | (o.closedSlot !== undefined ? BUDGET_FLAG_CLOSED : 0);
  return data;
}

const STATES = { open: 0, posted: 1, disputed: 2, paid: 3 } as const;
function reservationBytes(o: { budget: PublicKey; payee: PublicKey; reserved: bigint; final?: bigint; postedSlot?: bigint; state: keyof typeof STATES }): Buffer {
  const data = Buffer.alloc(147);
  Buffer.from(BUDGET_DISCRIMINATORS["account:Reservation"]).copy(data, 0);
  o.budget.toBuffer().copy(data, 8);
  u64(CREATED).copy(data, 40);
  o.payee.toBuffer().copy(data, 48);
  o.payee.toBuffer().copy(data, 80);
  u64(o.reserved).copy(data, 112);
  u64(o.final ?? BigInt(0)).copy(data, 120);
  u64(o.postedSlot ?? BigInt(0)).copy(data, 128);
  data[144] = STATES[o.state];
  return data;
}

/** One open Budget for A and B, the relay's record of it, a sandbox desk and a chain that applies reserves. */
async function world(total = TOTAL) {
  const payer = Keypair.generate();
  const signer = kms();
  const store = new MemoryBudgetCustodyStore();
  const accounts = new Map<string, Buffer>();
  let slot = CREATED + BigInt(10);
  const custodyChain = { slot: async () => slot, genesisHash: async () => DEVNET, readAccount: async (k: PublicKey) => { const d = accounts.get(k.toBase58()); return d ? { owner: PROGRAM, data: d } : null; } };
  const custody: CustodyDeps = { store, signer, sender: { email: async () => "sent", webhook: async () => "sent" }, env: ENV, nowMs: NOW_MS, chain: custodyChain };
  const prepared = prepareBudget({ payer: payer.publicKey.toBase58(), token: "SOL", total: total.toString(), providerIds: [A.id, B.id], email: "me@example.com" }, PROGRAM, NOW_MS);
  if (!prepared.ok) throw new Error(prepared.message);
  const started = await startBudget({ terms: prepared.terms, signature: Buffer.from(ed25519Sign(payer, Buffer.from(prepared.message, "base64"))).toString("base64"), programId: PROGRAM, blockhash: async () => Keypair.generate().publicKey.toBase58(), env: ENV }, custody);
  if (!started.ok) throw new Error(started.message);
  const spender = await p256SpenderAddress(signer.publicKey);
  const budget = new PublicKey(started.budget);
  accounts.set(started.budget, budgetBytes({ payer: payer.publicKey, spender, unreserved: total, reservations: 0, total }));
  const activated = await activateSpender({ id: started.id, programId: PROGRAM }, custody);
  if (!activated.ok) throw new Error(activated.message);

  const reserves: { provider: string; amount: bigint; instructions: TransactionInstruction[] }[] = [];
  const sent: { provider: string; instructions: TransactionInstruction[] }[] = [];
  const registered: string[] = [];
  const chain: SandboxBudgetChain = {
    readAccount: custodyChain.readAccount,
    slot: async () => slot,
    canSign: () => true,
    async ensureRegistered(providerId) {
      registered.push(providerId);
    },
    async cosignAndSend(providerId, tx: Transaction) {
      const ix = tx.instructions.filter((i) => !i.programId.equals(ComputeBudgetProgram.programId))[1];
      const amount = Buffer.from(ix.data).readBigUInt64LE(16);
      const payee = ix.keys[3].pubkey;
      const at = reservationAddress(budget, payee, PROGRAM).toBase58();
      const before = accounts.get(at) ? decodeReservation(accounts.get(at)!).reserved : BigInt(0);
      accounts.set(at, reservationBytes({ budget, payee, reserved: amount, state: "open" }));
      const b = accounts.get(started.budget)!;
      b.writeBigUInt64LE(b.readBigUInt64LE(192) - (amount - before), 192);
      if (before === BigInt(0)) b[344] += 1;
      reserves.push({ provider: providerId, amount, instructions: tx.instructions });
      return "reserve-signature";
    },
    async send(providerId, instructions) {
      sent.push({ provider: providerId, instructions });
      return `sent-${sent.length}`;
    },
  };
  const clock = { now: NOW_MS };
  const desk: SandboxBudgetDeps = { chain, store: new MemorySandboxBudgetSliceStore(), programId: PROGRAM, acceptedJudges: [], nowMs: () => clock.now };
  const gateway: SandboxGatewayDeps = { connection: {} as SandboxGatewayDeps["connection"], replayStore: { checkAndStore: () => true }, budget: desk, now: () => NOW_MS };
  const providerCalls: Record<string, string>[] = [];
  const relay: RelayDeps = {
    store,
    programId: PROGRAM,
    env: ENV,
    async callProvider(provider: BudgetProvider, bodyText, headers) {
      providerCalls.push(headers);
      const answer = await handleSandboxChatCompletion({ body: JSON.parse(bodyText), rawBody: bodyText, origin: "https://app.example", budget: { budget: headers["x402-budget"], signature: headers["x402-budget-signature"], reserve: headers["x402-budget-reserve"] ?? null } }, gateway);
      return { status: answer.status, headers: answer.headers, bodyText: answer.bodyText };
    },
    signCall: (input) => signCallAsSpender(input, custody),
    async reservedOnChain(budgetAddress, createdSlot, payee) {
      const data = accounts.get(reservationAddress(new PublicKey(budgetAddress), new PublicKey(payee), PROGRAM).toBase58());
      if (!data) return BigInt(0);
      const slice = decodeReservation(data);
      return slice.budgetCreatedSlot === createdSlot ? slice.reserved : BigInt(0);
    },
    nowMs: () => clock.now,
    approve: (input) => approveAsSpender({ id: input.id, auth: { agentSecret: input.agentSecret }, request: input.request, programId: PROGRAM }, custody),
    blockhash: async () => Keypair.generate().publicKey.toBase58(),
  };
  const key = `${started.agentSecret}.${started.id}`;
  const call = (model: string, content = "Review this", k: string | null = key) => relayBudgetCall({ key: `Bearer ${k}`, bodyText: JSON.stringify({ model, messages: [{ role: "user", content }] }) }, relay);
  return { started, store, accounts, budget, desk, chain, reserves, sent, registered, providerCalls, call, key, relay, custody, clock, setSlot: (s: bigint) => { slot = s; } };
}


/** The last call number the signer gave each provider of a record, read from the append-only use log. */
function callNumbers(store: MemoryBudgetCustodyStore, spenderId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const u of store.uses) if (u.spenderId === spenderId && u.purpose === "call" && u.payee) out[u.payee] = Math.max(out[u.payee] ?? 0, Number(u.detail?.sequence ?? 0));
  return out;
}

describe("Budget relay: an agent pays sandbox providers from its Budget", () => {
  it("reserves a share on the first call, then draws on it", async () => {
    const w = await world();
    const first = await w.call(A.model);
    expect(first.status).toBe(200);
    expect(first.headers["x-rap-budget-provider"]).toBe(A.id);
    expect(first.headers[BUDGET_RECEIPT_HEADER]).toBeTruthy();
    const body = JSON.parse(first.bodyText);
    expect(body.rap_budget).toMatchObject({ budget: w.started.budget, sequence: 1, currency: "SOL" });
    expect(BigInt(body.rap_budget.cost)).toBeGreaterThan(BigInt(0));
    // One reserve, at most half the Budget, approved by the spender and paid for by the provider.
    expect(w.reserves).toHaveLength(1);
    expect(w.reserves[0].amount).toBeLessThanOrEqual(TOTAL / BigInt(2));
    expect(w.registered).toEqual([A.id]);
    expect(callNumbers(w.store as MemoryBudgetCustodyStore, w.started.id)).toEqual({ [A.payee]: 1 });

    const second = await w.call(A.model, "And this");
    expect(second.status).toBe(200);
    expect(JSON.parse(second.bodyText).rap_budget.sequence).toBe(2);
    expect(w.reserves).toHaveLength(1);
    const slice = await w.desk.store.get(A.id, w.started.budget);
    expect(slice).toMatchObject({ sequence: 2, status: "open" });
    expect(BigInt(slice!.spent)).toBe(BigInt(body.rap_budget.cost) + BigInt(JSON.parse(second.bodyText).rap_budget.cost));
  });

  it("takes the relay's smallest raise when it is more than the provider asked for (devnet run 25 Nov)", async () => {
    // A Budget big enough that a quarter of its per-provider cap is far more than ten of A's calls.
    const w = await world(BigInt(500_000_000));
    const first = await w.call(A.model);
    expect(first.status).toBe(200);
    expect(w.reserves).toHaveLength(1);
    expect(w.reserves[0].amount).toBe(BigInt(500_000_000) / BigInt(2) / BigInt(4));
  });

  it("gives each call the signer's next number: a number a failed call used is skipped, never signed again", async () => {
    const w = await world();
    expect((await w.call(A.model)).status).toBe(200);
    // A call whose signature never reached the provider: its number is spent.
    const lost = await w.relay.signCall({ id: w.started.id, agentSecret: w.started.agentSecret, call: { payee: A.payee, bodyHash: "0".repeat(64) }, expect: { budget: w.started.budget, createdSlot: CREATED, spender: "", network: "solana-devnet" } });
    expect(lost.ok && lost.sequence).toBe(2);
    const third = await w.call(A.model, "three");
    expect(third.status).toBe(200);
    expect(JSON.parse(third.bodyText).rap_budget.sequence).toBe(3);
    expect((await w.desk.store.get(A.id, w.started.budget))!.sequence).toBe(3);
    expect(callNumbers(w.store as MemoryBudgetCustodyStore, w.started.id)).toEqual({ [A.payee]: 3 });
  });

  it("does not let a provider pick the call number", async () => {
    const w = await world();
    let asked = 0;
    const relay: RelayDeps = {
      ...w.relay,
      async callProvider(_provider, _body, headers) {
        asked += 1;
        w.providerCalls.push(headers);
        return { status: 409, headers: {}, bodyText: JSON.stringify({ error: { code: "budget_sequence_mismatch", message: "This provider expects call 999999 of this budget next." }, expectedSequence: 999_999 }) };
      },
    };
    const answer = await relayBudgetCall({ key: `Bearer ${w.key}`, bodyText: JSON.stringify({ model: A.model, messages: [{ role: "user", content: "x" }] }) }, relay);
    expect(answer.status).toBe(409);
    expect(asked).toBe(1);
    // One number signed, and the counter did not move to the provider's.
    expect(callNumbers(w.store as MemoryBudgetCustodyStore, w.started.id)).toEqual({ [A.payee]: 1 });
  });

  it("approves bigger slices sparingly for a provider that keeps asking and never takes them (bbe1828 M-b)", async () => {
    const w = await world();
    const approvals = () => (w.custody.store as MemoryBudgetCustodyStore).uses.filter((u) => u.purpose === "reserve").length;
    const offer = { scheme: "budget", network: DEVNET, programId: PROGRAM.toBase58(), payee: A.payee, payoutAccount: A.payee, mint: null, reservation: "1000000", minReservation: "1000", acceptedJudges: [], minOpenSlotsLeft: "9000" };
    const relay: RelayDeps = {
      ...w.relay,
      async callProvider() {
        return { status: 402, headers: {}, bodyText: JSON.stringify({ error: { code: "reservation_low" }, budget: offer }) };
      },
    };
    const call = () => relayBudgetCall({ key: `Bearer ${w.key}`, bodyText: JSON.stringify({ model: A.model, messages: [{ role: "user", content: "x" }] }) }, relay);
    const codes: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const answer = await call();
      codes.push(answer.status === 402 || answer.status === 429 ? JSON.parse(answer.bodyText).error.code : String(answer.status));
      w.clock.now += 20_000;
    }
    // One approval a minute at most, and none after three left unused.
    expect(approvals()).toBe(3);
    expect(codes).toContain("reserve_backoff");
    expect(codes.slice(-3)).toEqual(["provider_not_reserving", "provider_not_reserving", "provider_not_reserving"]);
    expect((await w.store.byId(w.started.id))!.status).toBe("open");
  });

  it("gives no approval to a provider already holding the most a provider may", async () => {
    const w = await world();
    const at = reservationAddress(w.budget, new PublicKey(A.payee), PROGRAM).toBase58();
    w.accounts.set(at, reservationBytes({ budget: w.budget, payee: new PublicKey(A.payee), reserved: TOTAL / BigInt(2), state: "open" }));
    const offer = { scheme: "budget", network: DEVNET, programId: PROGRAM.toBase58(), payee: A.payee, payoutAccount: A.payee, mint: null, reservation: "1000000", minReservation: "1000", acceptedJudges: [], minOpenSlotsLeft: "9000" };
    const relay: RelayDeps = { ...w.relay, callProvider: async () => ({ status: 402, headers: {}, bodyText: JSON.stringify({ error: { code: "reservation_low" }, budget: offer }) }) };
    const answer = await relayBudgetCall({ key: `Bearer ${w.key}`, bodyText: JSON.stringify({ model: A.model, messages: [{ role: "user", content: "x" }] }) }, relay);
    expect(JSON.parse(answer.bodyText).error.code).toBe("budget_share_used");
    expect((w.custody.store as MemoryBudgetCustodyStore).uses.filter((u) => u.purpose === "reserve")).toHaveLength(0);
  });

  it("refuses a provider the payer did not pick, a bad key and a Budget not open yet", async () => {
    const w = await world();
    const other = await w.call(C.model);
    expect(other.status).toBe(400);
    expect(JSON.parse(other.bodyText).error.code).toBe("provider_not_in_budget");
    expect((await w.call(A.model, "x", `rap_budget_${"a".repeat(43)}.${w.started.id}`)).status).toBe(401);
    expect((await w.call(A.model, "x", "nonsense")).status).toBe(401);
    const record = (await w.store.byId(w.started.id))!;
    await w.store.update({ ...record, status: "frozen", version: record.version + 1 });
    expect(JSON.parse((await w.call(A.model)).bodyText).error.code).toBe("budget_not_open");
    expect(w.providerCalls).toHaveLength(0);
  });

  it("serves a call number once: a replay and a changed body are refused before answering", async () => {
    const w = await world();
    expect((await w.call(A.model)).status).toBe(200);
    const signed = w.providerCalls[w.providerCalls.length - 1];
    const gateway: SandboxGatewayDeps = { connection: {} as SandboxGatewayDeps["connection"], replayStore: { checkAndStore: () => true }, budget: w.desk };
    const bodyText = JSON.stringify({ model: A.model, messages: [{ role: "user", content: "Review this" }] });
    const replay = await handleSandboxChatCompletion({ body: JSON.parse(bodyText), rawBody: bodyText, origin: "https://app.example", budget: { budget: signed["x402-budget"], signature: signed["x402-budget-signature"] } }, gateway);
    expect(replay.status).toBe(409);
    expect(replay.body).toMatchObject({ error: { code: "budget_sequence_mismatch" }, lastSequence: 1, charged: false });
    // Call 2 with call 1's signature: the provider checks the spender signed this exact call.
    const header = JSON.parse(Buffer.from(signed["x402-budget"], "base64").toString());
    const forged = Buffer.from(JSON.stringify({ ...header, sequence: 2 })).toString("base64");
    const tampered = await handleSandboxChatCompletion({ body: JSON.parse(bodyText), rawBody: bodyText, origin: "https://app.example", budget: { budget: forged, signature: signed["x402-budget-signature"] } }, gateway);
    expect(tampered.status).toBe(401);
    expect((await w.desk.store.get(A.id, w.started.budget))!.sequence).toBe(1);
  });

  it("posts each share when the Budget ends and pays it out after the dispute window", async () => {
    const w = await world();
    expect((await w.call(A.model)).status).toBe(200);
    const spent = (await w.desk.store.get(A.id, w.started.budget))!.spent;
    expect(await settleDueSandboxBudgets(w.desk)).toEqual([{ provider: A.id, budget: w.started.budget, status: "open" }]);
    // Near the end of the open period the provider posts what its calls cost.
    w.setSlot(CREATED + BUDGET_OPEN_SLOTS - BigInt(100));
    expect((await settleDueSandboxBudgets(w.desk))[0].status).toBe("posted");
    expect(w.sent).toHaveLength(1);
    expect(Buffer.from(w.sent[0].instructions[0].data).readBigUInt64LE(16)).toBe(BigInt(spent));
    // Closed, posted and past the dispute window: paid out.
    const at = reservationAddress(w.budget, new PublicKey(A.payee), PROGRAM).toBase58();
    const r = decodeReservation(w.accounts.get(at)!);
    w.accounts.set(at, reservationBytes({ budget: w.budget, payee: new PublicKey(A.payee), reserved: r.reserved, final: BigInt(spent), postedSlot: CREATED + BUDGET_OPEN_SLOTS - BigInt(100), state: "posted" }));
    const payer = new PublicKey(w.accounts.get(w.started.budget)!.subarray(8, 40));
    const spender = new PublicKey(w.accounts.get(w.started.budget)!.subarray(40, 72));
    w.accounts.set(w.started.budget, budgetBytes({ payer, spender, unreserved: BigInt(0), reservations: 1, closedSlot: CREATED + BUDGET_OPEN_SLOTS }));
    w.setSlot(CREATED + BUDGET_OPEN_SLOTS + BUDGET_DISPUTE_SLOTS + BigInt(10));
    expect((await settleDueSandboxBudgets(w.desk))[0].status).toBe("paid");
    expect(w.sent).toHaveLength(2);
  });
});

describe("Budget relay: evidence for the RAP judge", () => {
  it("keeps each served call's receipt, which the judge's rule then counts against the signed calls", async () => {
    const w = await world();
    const judgeStore = new MemoryJudgeStore();
    w.relay.saveReceipt = ({ budget, createdSlot, payee, receipt }) => judgeStore.addReceipt({ budget, createdSlot, payee }, "relay", receipt);
    expect((await w.call(A.model, "first")).status).toBe(200);
    const second = await w.call(A.model, "second");
    expect(second.status).toBe(200);
    const slice = { budget: w.started.budget, createdSlot: CREATED.toString(), payee: A.payee };
    expect(judgeStore.saved).toHaveLength(2);
    // The relay's call log, as the judge reads it from budget_spender_uses.
    const uses = w.store.uses.filter((u) => u.spenderId === w.started.id && u.purpose === "call" && u.payee === A.payee);
    const signedCalls = { count: uses.length, bodyHashes: new Set(uses.map((u) => String(u.detail?.bodyHash))) };
    const posted = BigInt(JSON.parse(second.bodyText).rap_budget.cumulativeCost);
    const ruling = decideRuling({
      slice: { network: "solana-devnet", ...slice, reservation: reservationAddress(w.budget, new PublicKey(A.payee), PROGRAM).toBase58(), payer: w.started.record.payer },
      posted: posted * BigInt(3),
      signedCalls,
      receipts: await judgeStore.receipts(slice, 200),
    });
    // The sandbox receipt's request hash is the body the spender signed, so the receipts count: only what they show is paid.
    expect(ruling).toMatchObject({ basis: "evidence", payout: posted, receipt: expect.objectContaining({ served: 2 }) });
  });

  it("never fails a call because its receipt could not be kept", async () => {
    const w = await world();
    w.relay.saveReceipt = async () => {
      throw new Error("database down");
    };
    expect((await w.call(A.model)).status).toBe(200);
  });
});

describe("Budget relay: the sweep", () => {
  it("lets a slice go only when its Budget is still missing on a later pass", async () => {
    const w = await world();
    expect((await w.call(A.model)).status).toBe(200);
    w.accounts.delete(w.started.budget);
    expect((await settleDueSandboxBudgets(w.desk))[0].status).toBe("missing");
    expect((await w.desk.store.get(A.id, w.started.budget))!.status).toBe("open");
    w.clock.now += 60_000;
    expect((await settleDueSandboxBudgets(w.desk))[0].status).toBe("missing");
    w.clock.now += 5 * 60_000;
    expect((await settleDueSandboxBudgets(w.desk))[0].status).toBe("done");
  });

  it("reads every page of slices, not only the oldest 200", async () => {
    const pages: string[] = [];
    const rows = Array.from({ length: 450 }, (_, i) => ({ record: { provider: "p", budget: `b${i}`, status: "open" }, version: 1 }));
    const fetchImpl = (async (url: string) => {
      pages.push(url);
      const offset = Number(/offset=(\d+)/.exec(url)![1]);
      return new Response(JSON.stringify(rows.slice(offset, offset + 200)), { status: 200 });
    }) as unknown as typeof fetch;
    const store = new SupabaseSandboxBudgetSliceStore({ url: "https://db.example", serviceKey: "k", fetchImpl });
    expect(await store.due()).toHaveLength(450);
    expect(pages).toHaveLength(3);
  });
});

describe("Budget relay: what it trusts", () => {
  it("reads the key as secret then record id", () => {
    const secret = `rap_budget_${"x".repeat(43)}`;
    expect(parseBudgetKey(`Bearer ${secret}.${"a".repeat(32)}`)).toEqual({ agentSecret: secret, id: "a".repeat(32) });
    expect(parseBudgetKey(`${secret}.short`)).toBeUndefined();
    expect(parseBudgetKey("rap_pass_abc.def")).toBeUndefined();
    expect(parseBudgetKey(null)).toBeUndefined();
  });

  it("refuses an offer for another payee, program, token or payout account", async () => {
    const w = await world();
    const record = (await w.store.byId(w.started.id))!;
    const good = { scheme: "budget", network: DEVNET, programId: PROGRAM.toBase58(), payee: A.payee, payoutAccount: A.payee, mint: null, reservation: "100", minReservation: "10", acceptedJudges: [], minOpenSlotsLeft: "9000" };
    expect(typeof checkOffer(good, { provider: A, record, programId: PROGRAM })).toBe("object");
    const other = Keypair.generate().publicKey.toBase58();
    for (const change of [{ payee: other }, { programId: other }, { payoutAccount: other }, { mint: other }, { network: "x" }, { reservation: "-1" }]) {
      expect(typeof checkOffer({ ...good, ...change }, { provider: A, record, programId: PROGRAM })).toBe("string");
    }
  });
});

describe("Budget providers by token", () => {
  const entry = { id: "rap-humaniser", name: "RAP Humaniser", url: "https://providers.example/humaniser", payee: Keypair.generate().publicKey.toBase58(), inputPerMillionUsd: "0.13", outputPerMillionUsd: "0.65" };

  it("lists RAP's own USDC providers from settings, and only well-formed ones", () => {
    expect(parseUsdcProviders(JSON.stringify([entry]))).toEqual([expect.objectContaining({ id: "rap-humaniser", token: "USDC", endpoint: { kind: "url", url: "https://providers.example/humaniser" } })]);
    for (const bad of [{ url: "http://providers.example" }, { payee: "nope" }, { inputPerMillionUsd: "free" }, { id: "Bad Id" }]) {
      expect(parseUsdcProviders(JSON.stringify([{ ...entry, ...bad }]))).toEqual([]);
    }
    expect(parseUsdcProviders(JSON.stringify([entry, { ...entry, id: "again" }]))).toHaveLength(1);
    expect(parseUsdcProviders("not json")).toEqual([]);
    expect(parseUsdcProviders(JSON.stringify([{ ...entry, id: A.id }]), new Set([A.id]))).toEqual([]);
  });

  it("will not open a Budget in one token for a provider paid in the other", () => {
    const payer = Keypair.generate().publicKey.toBase58();
    const env = { ...ENV, BUDGET_USDC_PROVIDERS: JSON.stringify([entry]) };
    const providers = budgetProviders(env);
    expect(providers.filter((p) => p.token === "USDC").map((p) => p.id)).toEqual(["rap-humaniser"]);
    const mixed = prepareBudget({ payer, token: "USDC", total: "5000000", providerIds: [A.id], email: "me@example.com" }, PROGRAM, NOW_MS);
    expect(mixed.ok ? "ok" : mixed.code).toBe("provider_token_mismatch");
  });
});
