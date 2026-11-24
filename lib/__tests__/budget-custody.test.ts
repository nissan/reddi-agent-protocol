/**
 * @jest-environment node
 */
import { createHash, createHmac } from "crypto";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { BUDGET_DISCRIMINATORS, closeBudgetInstruction, reserveInstruction, reservationAddress, waiveInstruction } from "@redditech/x402-solana/budget";
import { signReddiReceiptV2, type ReddiReceiptV2 } from "@redditech/agent-protocol";
import { signWebhookBody, type AlertSender } from "@/lib/budget/alerts";
import { activateSpender, createSpender, inspectSpenderTransaction, pausedByEnv, signAsSpender, type CustodyDeps } from "@/lib/budget/custody";
import { buildDisputeTransaction } from "@/lib/budget/dispute";
import { closeAllBudgets } from "@/lib/budget/incident";
import { openSpenderSeed, readKeks, resealSpenderKey, sealSpenderKey } from "@/lib/budget/keys";
import { resealAll } from "@/lib/budget/reseal";
import { MemoryBudgetCustodyStore, type SpenderRecord } from "@/lib/budget/store";
import { base58, GONE_CONFIRM_MS, watchBudgets, type BudgetChainReader } from "@/lib/budget/watch";
import { BUDGET_PAID_EVENT, decodeBudgetPaid, programDataLogs, verifyAndRecordBudgetCall } from "@/lib/jobs/budget-call";

const PROGRAM = Keypair.generate().publicKey;
const KEKS = readKeks({ BUDGET_SPENDER_KEKS: `k2:${Buffer.alloc(32, 2).toString("base64")},k1:${Buffer.alloc(32, 1).toString("base64")}` })!;
const NOW_MS = Date.UTC(2026, 10, 25, 1, 0, 0);
const CREATED = BigInt(5_000_000);
const ORIGIN = "https://app.example";
const BLOCKHASH = Keypair.generate().publicKey.toBase58();

type Outcome = "sent" | "failed" | "hang";
function sender() {
  const sent: { channel: string; to: string; subject: string; body?: Record<string, unknown>; secret?: string }[] = [];
  /** Per recipient: what its channel does. */
  const behaviour = new Map<string, Outcome>();
  const answer = (to: string) => {
    const b = behaviour.get(to) ?? "sent";
    return b === "hang" ? new Promise<never>(() => undefined) : Promise.resolve(b);
  };
  const s: AlertSender = {
    async email(to, subject) {
      sent.push({ channel: "email", to, subject });
      return answer(to);
    },
    async webhook(url, body, secret) {
      sent.push({ channel: "webhook", to: url, subject: String(body.subject), body, ...(secret ? { secret } : {}) });
      return answer(url);
    },
  };
  return { sent, sender: s, behaviour };
}

const ALERT_ENV = { BUDGET_OPS_EMAIL: "ops@example.com", RESEND_API_KEY: "re_test", BUDGET_ALERT_FROM: "RAP <alerts@example.com>" };

function setup(env: Record<string, string | undefined> = {}) {
  const store = new MemoryBudgetCustodyStore();
  const { sent, sender: s, behaviour } = sender();
  const deps: CustodyDeps & { alertTimeoutMs: number } = { store, keks: KEKS, sender: s, env: { ...ALERT_ENV, BUDGET_SPENDER_KEKS: `k2:${Buffer.alloc(32, 2).toString("base64")},k1:${Buffer.alloc(32, 1).toString("base64")}`, ...env }, nowMs: NOW_MS, alertTimeoutMs: 50 };
  return { store, sent, deps, behaviour };
}

type BudgetBytes = { payer: PublicKey; spender: PublicKey; judge?: PublicKey; mint?: PublicKey; total?: bigint; unreserved?: bigint; closed?: boolean; closedSlot?: bigint; createdSlot?: bigint };
function budgetBytes(b: BudgetBytes): Uint8Array {
  const d = Buffer.alloc(349);
  Buffer.from(BUDGET_DISCRIMINATORS["account:Budget"]).copy(d, 0);
  b.payer.toBuffer().copy(d, 8);
  b.spender.toBuffer().copy(d, 40);
  if (b.judge) b.judge.toBuffer().copy(d, 72);
  if (b.mint) b.mint.toBuffer().copy(d, 104);
  d.writeBigUInt64LE(b.createdSlot ?? CREATED, 152);
  d.writeBigUInt64LE(BigInt(20_000), 160);
  d.writeBigUInt64LE(BigInt(9_000), 168);
  d.writeBigUInt64LE(BigInt(3_000), 176);
  d.writeBigUInt64LE(b.total ?? BigInt(10_000_000), 184);
  d.writeBigUInt64LE(b.unreserved ?? BigInt(10_000_000), 192);
  d.writeBigUInt64LE(BigInt(5_000_000), 200);
  d.writeBigUInt64LE(b.closedSlot ?? BigInt(0), 336);
  d[346] = b.closed ? 0x02 : 0;
  return Uint8Array.from(d);
}

type SliceBytes = { budget: PublicKey; payee: PublicKey; reserved: bigint; state?: number; finalAmount?: bigint; postedSlot?: bigint; createdSlot?: bigint };
function sliceBytes(r: SliceBytes): Uint8Array {
  const d = Buffer.alloc(147);
  Buffer.from(BUDGET_DISCRIMINATORS["account:Reservation"]).copy(d, 0);
  r.budget.toBuffer().copy(d, 8);
  d.writeBigUInt64LE(r.createdSlot ?? CREATED, 40);
  r.payee.toBuffer().copy(d, 48);
  r.payee.toBuffer().copy(d, 80);
  d.writeBigUInt64LE(r.reserved, 112);
  d.writeBigUInt64LE(r.finalAmount ?? BigInt(0), 120);
  d.writeBigUInt64LE(r.postedSlot ?? BigInt(0), 128);
  d[144] = r.state ?? 0;
  return Uint8Array.from(d);
}

function fakeChain() {
  const accounts = new Map<string, { owner: PublicKey; data: Uint8Array }>();
  const sentTxs: Transaction[] = [];
  let slot = CREATED + BigInt(100);
  const chain: BudgetChainReader & { latestBlockhash(): Promise<string>; sendAndConfirm(tx: Transaction): Promise<string> } = {
    async readAccount(a) {
      return accounts.get(a.toBase58()) ?? null;
    },
    async budgetsBySpender(spender) {
      return [...accounts.entries()]
        .filter(([, v]) => v.data.length === 349 && new PublicKey(v.data.subarray(40, 72)).equals(spender))
        .map(([address, v]) => ({ address: new PublicKey(address), data: v.data }));
    },
    async reservations(budget) {
      return [...accounts.entries()]
        .filter(([, v]) => v.data.length === 147 && new PublicKey(v.data.subarray(8, 40)).equals(budget))
        .map(([address, v]) => ({ address: new PublicKey(address), data: v.data }));
    },
    async slot() {
      return slot;
    },
    async latestBlockhash() {
      return BLOCKHASH;
    },
    async sendAndConfirm(tx) {
      if (!tx.verifySignatures()) throw new Error("not fully signed");
      sentTxs.push(tx);
      return "5".repeat(88);
    },
  };
  return { accounts, chain, sentTxs, setSlot: (s: bigint) => (slot = s) };
}

const WALLET = () => Keypair.generate().publicKey;

async function openBudget(deps: CustodyDeps, accounts: Map<string, { owner: PublicKey; data: Uint8Array }>, opts: { expected?: string[]; judge?: PublicKey; mint?: PublicKey } = {}) {
  const payer = WALLET();
  const made = await createSpender({ payer: payer.toBase58(), network: "solana-devnet", contact: { email: "payer@example.com" }, expectedPayees: opts.expected }, deps);
  if (!made.ok) throw new Error(made.message);
  const budget = WALLET();
  accounts.set(budget.toBase58(), { owner: PROGRAM, data: budgetBytes({ payer, spender: new PublicKey(made.record.spender), judge: opts.judge, mint: opts.mint }) });
  const active = await activateSpender({ id: made.record.id, budget: budget.toBase58(), programId: PROGRAM, readAccount: async (a) => accounts.get(a.toBase58()) ?? null }, deps);
  if (!active.ok) throw new Error(active.message);
  return { payer, budget, record: active.record, spender: new PublicKey(made.record.spender) };
}

function reserveTx(record: SpenderRecord, payee: PublicKey, extra: Parameters<Transaction["add"]>[number][] = []): Transaction {
  const tx = new Transaction({ feePayer: payee, recentBlockhash: BLOCKHASH });
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 40_000 }));
  tx.add(reserveInstruction({ programId: PROGRAM, budget: new PublicKey(record.budget!), createdSlot: BigInt(record.createdSlot!), spender: new PublicKey(record.spender), payee, amount: BigInt(1_000_000) }));
  for (const ix of extra) tx.add(ix);
  return tx;
}

describe("Budget spender keys (audit round 4, S7-claude-03)", () => {
  it("seals each key under the current KEK, bound to its record, and reseals on rotation", () => {
    const kp = Keypair.generate();
    const sealed = sealSpenderKey(kp, "a".repeat(32), KEKS);
    expect(sealed.startsWith("v1.k2.")).toBe(true);
    expect(sealed).not.toContain(Buffer.from(kp.secretKey.subarray(0, 32)).toString("base64url"));
    expect(Keypair.fromSeed(openSpenderSeed(sealed, "a".repeat(32), kp.publicKey.toBase58(), KEKS)).publicKey.equals(kp.publicKey)).toBe(true);
    // Copied onto another record, or altered, or without its KEK: does not open.
    expect(() => openSpenderSeed(sealed, "b".repeat(32), kp.publicKey.toBase58(), KEKS)).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from(Buffer.from(parts[3], "base64url").map((b, i) => (i === 0 ? b ^ 1 : b))).toString("base64url");
    expect(() => openSpenderSeed(parts.join("."), "a".repeat(32), kp.publicKey.toBase58(), KEKS)).toThrow();
    expect(() => openSpenderSeed(sealed, "a".repeat(32), kp.publicKey.toBase58(), [KEKS[1]])).toThrow(/KEK k2 is not configured/);
    // Rotation: a key sealed under k1 is resealed under k2 (first listed).
    const old = sealSpenderKey(kp, "a".repeat(32), [KEKS[1]]);
    expect(resealSpenderKey(old, "a".repeat(32), kp.publicKey.toBase58(), KEKS).startsWith("v1.k2.")).toBe(true);
    expect(readKeks({ BUDGET_SPENDER_KEKS: "k:short" })).toBeUndefined();
  });

  it("needs a contact to alert the payer, and stores the key only sealed", async () => {
    const { store, deps } = setup();
    expect(await createSpender({ payer: WALLET().toBase58(), network: "solana-devnet", contact: {} }, deps)).toMatchObject({ ok: false, code: "contact_required" });
    expect(await createSpender({ payer: WALLET().toBase58(), network: "solana-devnet", contact: { webhook: "http://x.example" } }, deps)).toMatchObject({ ok: false, code: "contact_required" });
    expect(await createSpender({ payer: WALLET().toBase58(), network: "solana-devnet", contact: { email: "a@b.co" } }, { ...deps, keks: undefined })).toMatchObject({ ok: false, code: "custody_not_configured" });
    const made = await createSpender({ payer: WALLET().toBase58(), network: "solana-devnet", contact: { email: "a@b.co" } }, deps);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const stored = (await store.byId(made.record.id))!;
    expect(stored.status).toBe("pending");
    expect(Object.keys(stored)).not.toContain("secretKey");
    expect(stored.sealed!.split(".")).toHaveLength(5);
  });

  it("marks a Budget open only when the chain names its payer and spender", async () => {
    const { deps } = setup();
    const { accounts } = fakeChain();
    const made = await createSpender({ payer: WALLET().toBase58(), network: "solana-devnet", contact: { email: "a@b.co" } }, deps);
    if (!made.ok) throw new Error();
    const budget = WALLET();
    accounts.set(budget.toBase58(), { owner: PROGRAM, data: budgetBytes({ payer: WALLET(), spender: new PublicKey(made.record.spender) }) });
    expect(await activateSpender({ id: made.record.id, budget: budget.toBase58(), programId: PROGRAM, readAccount: async (a) => accounts.get(a.toBase58()) ?? null }, deps)).toMatchObject({ ok: false, code: "budget_mismatch" });
  });

  it("signs a reserve for a provider the payer named, logged before signing, and nothing else", async () => {
    const { store, sent, deps } = setup();
    const { accounts } = fakeChain();
    const named = WALLET();
    const { record, spender } = await openBudget(deps, accounts, { expected: [named.toBase58()] });

    const signed = await signAsSpender({ id: record.id, transaction: reserveTx(record, named), programId: PROGRAM }, deps);
    expect(signed).toMatchObject({ ok: true, purpose: "reserve" });
    if (signed.ok) expect(signed.transaction.signatures.find((s) => s.publicKey.equals(spender))?.signature).not.toBeNull();
    expect(store.uses).toHaveLength(1);
    expect(store.uses[0]).toMatchObject({ purpose: "reserve", payee: named.toBase58() });

    // Someone the payer did not name: refused, and the operator is told.
    const stranger = WALLET();
    expect(await signAsSpender({ id: record.id, transaction: reserveTx(record, stranger), programId: PROGRAM }, deps)).toMatchObject({ ok: false, code: "unexpected_payee" });
    expect(sent.some((s) => s.to === "ops@example.com" && /did not name/.test(s.subject))).toBe(true);

    // The spender key in any other instruction, another opening, another Budget, two Budget instructions, the spender paying fees.
    const drain = SystemProgram.transfer({ fromPubkey: spender, toPubkey: stranger, lamports: 1 });
    expect(await signAsSpender({ id: record.id, transaction: reserveTx(record, named, [drain]), programId: PROGRAM }, deps)).toMatchObject({ ok: false, code: "instruction_not_allowed" });
    expect(inspectSpenderTransaction(reserveTx({ ...record, createdSlot: "1" }, named), record, PROGRAM)).toMatchObject({ ok: false, code: "budget_instance_mismatch" });
    expect(inspectSpenderTransaction(reserveTx({ ...record, budget: WALLET().toBase58() }, named), record, PROGRAM)).toMatchObject({ ok: false, code: "budget_mismatch" });
    const twice = reserveTx(record, named);
    twice.add(reserveTx(record, named).instructions[1]);
    expect(inspectSpenderTransaction(twice, record, PROGRAM)).toMatchObject({ ok: false, code: "not_one_budget_instruction" });
    const feePaid = reserveTx(record, named);
    feePaid.feePayer = spender;
    expect(inspectSpenderTransaction(feePaid, record, PROGRAM)).toMatchObject({ ok: false, code: "spender_pays_fee" });
    // A waive of its own Budget is allowed, for a named provider's slice only.
    const waiveFor = (payee: PublicKey) => new Transaction({ feePayer: named, recentBlockhash: BLOCKHASH }).add(waiveInstruction({ programId: PROGRAM, budget: new PublicKey(record.budget!), createdSlot: CREATED, payee, signer: spender }));
    expect(inspectSpenderTransaction(waiveFor(named), record, PROGRAM)).toMatchObject({ ok: true, purpose: "waive" });
    expect(await signAsSpender({ id: record.id, transaction: waiveFor(stranger), programId: PROGRAM }, deps)).toMatchObject({ ok: false, code: "unexpected_payee" });
    expect(store.uses).toHaveLength(1);
  });

  it("signs nothing while paused or when the use cannot be logged, and freezes an overused key", async () => {
    const { store, sent, deps } = setup({ BUDGET_SPENDER_MAX_USES_PER_10_MIN: "3" });
    const { accounts } = fakeChain();
    const { record } = await openBudget(deps, accounts);
    const p = WALLET();
    expect(await signAsSpender({ id: record.id, transaction: reserveTx(record, p), programId: PROGRAM }, { ...deps, env: { BUDGET_SPENDING_PAUSED: "true" } })).toMatchObject({ ok: false, code: "budgets_paused" });
    await store.setPaused(true, "drill");
    expect(await signAsSpender({ id: record.id, transaction: reserveTx(record, p), programId: PROGRAM }, deps)).toMatchObject({ ok: false, code: "budgets_paused" });
    await store.setPaused(false, "drill over");
    store.failLogs = true;
    expect(await signAsSpender({ id: record.id, transaction: reserveTx(record, p), programId: PROGRAM }, deps)).toMatchObject({ ok: false, code: "store_unavailable" });
    store.failLogs = false;
    for (let i = 0; i < 3; i += 1) expect(await signAsSpender({ id: record.id, transaction: reserveTx(record, WALLET()), programId: PROGRAM }, deps)).toMatchObject({ ok: true });
    expect(await signAsSpender({ id: record.id, transaction: reserveTx(record, WALLET()), programId: PROGRAM }, deps)).toMatchObject({ ok: false, code: "key_overuse" });
    expect((await store.byId(record.id))!.status).toBe("frozen");
    expect(sent.some((s) => s.to === "ops@example.com" && /frozen/.test(s.subject))).toBe(true);
    // Frozen: no reserve, but the close still signs.
    expect(await signAsSpender({ id: record.id, transaction: reserveTx(record, WALLET()), programId: PROGRAM }, { ...deps, nowMs: NOW_MS + 3_600_000 })).toMatchObject({ ok: false, code: "budget_not_open" });
    const close = new Transaction({ feePayer: WALLET(), recentBlockhash: BLOCKHASH }).add(closeBudgetInstruction({ programId: PROGRAM, budget: new PublicKey(record.budget!), createdSlot: CREATED, signer: new PublicKey(record.spender), payer: new PublicKey(record.payer) }));
    expect(await signAsSpender({ id: record.id, transaction: close, programId: PROGRAM }, deps)).toMatchObject({ ok: true, purpose: "close" });
  });
});

describe("Budget watcher: the payer hears of every reserve and post", () => {
  it("alerts on a new slice, a raise, a post with a dispute link, once each, and tells the operator of a provider the payer did not name", async () => {
    const { store, sent, deps } = setup();
    const { accounts, chain } = fakeChain();
    const named = WALLET();
    const judge = WALLET();
    const { record, budget, payer, spender } = await openBudget(deps, accounts, { expected: [named.toBase58()], judge });
    let now = NOW_MS;
    const watch = async () => [...(await watchBudgets({ ...deps, nowMs: now, chain, programId: PROGRAM, origin: ORIGIN }))];
    const stranger = WALLET();
    accounts.set(reservationAddress(budget, named, PROGRAM).toBase58(), { owner: PROGRAM, data: sliceBytes({ budget, payee: named, reserved: BigInt(1_000_000) }) });
    accounts.set(reservationAddress(budget, stranger, PROGRAM).toBase58(), { owner: PROGRAM, data: sliceBytes({ budget, payee: stranger, reserved: BigInt(2_000_000) }) });
    // A slice left over from an earlier opening of the same address is not this Budget's.
    const old = WALLET();
    accounts.set(reservationAddress(budget, old, PROGRAM).toBase58(), { owner: PROGRAM, data: sliceBytes({ budget, payee: old, reserved: BigInt(5), createdSlot: BigInt(7) }) });

    const first = await watch();
    expect(first[0].alerts.sort()).toEqual(["operator:unexpected_payee", "payer:slice_reserved", "payer:slice_reserved"]);
    expect(sent.filter((s) => s.to === "payer@example.com")).toHaveLength(2);
    expect(sent.some((s) => s.to === "ops@example.com" && /did not name/.test(s.subject))).toBe(true);
    expect(await watch()).toEqual([expect.objectContaining({ alerts: [] })]);

    accounts.set(reservationAddress(budget, named, PROGRAM).toBase58(), { owner: PROGRAM, data: sliceBytes({ budget, payee: named, reserved: BigInt(1_500_000), state: 1, finalAmount: BigInt(900_000), postedSlot: CREATED + BigInt(50) }) });
    const second = await watch();
    expect(second[0].alerts.sort()).toEqual(["payer:slice_posted", "payer:slice_raised"]);
    const postAlert = store.alerts.find((a) => a.kind === "slice_posted")!;
    expect(postAlert.detail.disputeLink).toBe(`solana:${encodeURIComponent(`${ORIGIN}/api/budget/v1/dispute?budget=${budget.toBase58()}&payee=${named.toBase58()}`)}`);
    expect(postAlert.delivered).toEqual({ email: "sent" });

    // The dispute link builds a dispute only for the payer.
    const build = (account: string) => buildDisputeTransaction({ budget: budget.toBase58(), payee: named.toBase58(), account, programId: PROGRAM, chain });
    expect(await build(WALLET().toBase58())).toMatchObject({ ok: false, code: "not_the_payer" });
    const dispute = await build(payer.toBase58());
    expect(dispute.ok).toBe(true);
    if (dispute.ok) {
      const tx = Transaction.from(Buffer.from(dispute.transaction, "base64"));
      expect(tx.feePayer!.equals(payer)).toBe(true);
      expect(Buffer.from(tx.instructions[0].data.subarray(0, 8))).toEqual(Buffer.from(BUDGET_DISCRIMINATORS["global:dispute"]));
    }

    // Closed on chain: the key reserves no more. Gone: the key is erased.
    accounts.set(budget.toBase58(), { owner: PROGRAM, data: budgetBytes({ payer, spender, judge, closed: true, closedSlot: CREATED + BigInt(60) }) });
    expect((await watch())[0].status).toBe("closing");
    accounts.delete(budget.toBase58());
    // One missing read keeps the key; missing again four minutes later is proof it is over.
    expect((await watch())[0].status).toBe("closing");
    expect((await store.byId(record.id))!.sealed).toBeDefined();
    now += GONE_CONFIRM_MS;
    expect((await watch())[0].status).toBe("closed");
    const done = (await store.byId(record.id))!;
    expect(done.status).toBe("closed");
    expect(done.sealed).toBeUndefined();
  });
});

describe("Budget incident step", () => {
  it("pauses, then closes every open Budget with its own key, freezes unopened keys, and tells each payer", async () => {
    const { store, sent, deps } = setup();
    const { accounts, chain, sentTxs } = fakeChain();
    const a = await openBudget(deps, accounts);
    const b = await openBudget(deps, accounts);
    const pending = await createSpender({ payer: WALLET().toBase58(), network: "solana-devnet", contact: { webhook: "https://hooks.example/budget" } }, deps);
    if (!pending.ok) throw new Error();
    const feePayer = Keypair.generate();

    const result = await closeAllBudgets({ reason: "KEK exposure drill", feePayer, programId: PROGRAM, chain }, deps);
    expect(result.paused).toBe(true);
    expect(result.results.every((r) => r.ok)).toBe(true);
    expect(sentTxs).toHaveLength(2);
    for (const tx of sentTxs) {
      expect(tx.feePayer!.equals(feePayer.publicKey)).toBe(true);
      expect(Buffer.from(tx.instructions[0].data.subarray(0, 8))).toEqual(Buffer.from(BUDGET_DISCRIMINATORS["global:close_budget"]));
    }
    expect((await store.byId(a.record.id))!.status).toBe("closing");
    expect((await store.byId(pending.record.id))!.status).toBe("frozen");
    expect(sent.filter((s) => s.to === "payer@example.com" && /closed early/.test(s.subject))).toHaveLength(2);
    expect((await store.paused()).paused).toBe(true);
    // Paused: no reserve anywhere.
    expect(await signAsSpender({ id: b.record.id, transaction: reserveTx(b.record, WALLET()), programId: PROGRAM }, deps)).toMatchObject({ ok: false });
  });

  it("without a fee payer it still pauses and lists what is left to close", async () => {
    const { deps } = setup();
    const { accounts, chain } = fakeChain();
    await openBudget(deps, accounts);
    const result = await closeAllBudgets({ reason: "drill", feePayer: undefined, programId: PROGRAM, chain }, deps);
    expect(result.paused).toBe(true);
    expect(result.results).toEqual([expect.objectContaining({ ok: false, error: "no_fee_payer" })]);
  });
});

describe("Budget custody review S6 fixes", () => {
  it("signs only the compiled message: no durable nonce, an explicit fee payer, no other program", async () => {
    const { deps } = setup();
    const { accounts } = fakeChain();
    const named = WALLET();
    const { record, spender } = await openBudget(deps, accounts);
    const nonced = reserveTx(record, named);
    nonced.nonceInfo = { nonce: BLOCKHASH, nonceInstruction: SystemProgram.nonceAdvance({ noncePubkey: WALLET(), authorizedPubkey: named }) };
    expect(inspectSpenderTransaction(nonced, record, PROGRAM)).toMatchObject({ ok: false, code: "durable_nonce" });
    const advance = reserveTx(record, named, [SystemProgram.nonceAdvance({ noncePubkey: WALLET(), authorizedPubkey: named })]);
    expect(inspectSpenderTransaction(advance, record, PROGRAM)).toMatchObject({ ok: false, code: "instruction_not_allowed" });
    const noFeePayer = reserveTx(record, named);
    noFeePayer.feePayer = undefined;
    noFeePayer.signatures = [{ publicKey: spender, signature: null }];
    expect(inspectSpenderTransaction(noFeePayer, record, PROGRAM)).toMatchObject({ ok: false, code: "fee_payer_required" });
    // What is signed verifies against the message the provider then signs.
    const signed = await signAsSpender({ id: record.id, transaction: reserveTx(record, named), programId: PROGRAM }, deps);
    expect(signed.ok).toBe(true);
    if (signed.ok) expect(signed.transaction.verifySignatures(false)).toBe(true);
  });

  it("lets only the allowed number of concurrent signs through, and reads the pause switch leniently", async () => {
    const { store, deps } = setup({ BUDGET_SPENDER_MAX_USES_PER_10_MIN: "3" });
    const { accounts } = fakeChain();
    const { record } = await openBudget(deps, accounts);
    const all = await Promise.all(Array.from({ length: 12 }, () => signAsSpender({ id: record.id, transaction: reserveTx(record, WALLET()), programId: PROGRAM }, deps)));
    expect(all.filter((r) => r.ok)).toHaveLength(3);
    expect(store.uses).toHaveLength(3);
    for (const v of ["true", "TRUE", "1", "yes", " on "]) expect(pausedByEnv(v)).toBe(true);
    for (const v of [undefined, "", "false", "0", "no", "off", "False"]) expect(pausedByEnv(v)).toBe(false);
  });

  it("makes no key unless the payer and the operator can actually be alerted, and signs webhook alerts", async () => {
    const payer = WALLET().toBase58();
    const { deps } = setup({ RESEND_API_KEY: undefined });
    expect(await createSpender({ payer, network: "solana-devnet", contact: { email: "a@b.co" } }, deps)).toMatchObject({ ok: false, code: "alerts_not_configured" });
    const hook = await createSpender({ payer, network: "solana-devnet", contact: { webhook: "https://hooks.example/a" } }, { ...deps, env: { ...deps.env, BUDGET_OPS_EMAIL: undefined, BUDGET_OPS_WEBHOOK: "https://ops.example/hook" } });
    expect(hook.ok).toBe(true);
    if (hook.ok) expect(hook.record.contact.webhookSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const noOps = setup({ BUDGET_OPS_EMAIL: undefined });
    expect(await createSpender({ payer, network: "solana-devnet", contact: { webhook: "https://hooks.example/a" } }, noOps.deps)).toMatchObject({ ok: false, code: "alerts_not_configured" });
    const header = signWebhookBody('{"a":1}', "secret", 1_700_000_000_000);
    expect(header).toBe(`t=1700000000,v1=${createHmac("sha256", "secret").update('1700000000.{"a":1}').digest("hex")}`);
  });

  it("sends an undelivered alert again every pass, tells the operator after three, and a hanging payer does not block others", async () => {
    const { sent, deps, behaviour } = setup();
    const { accounts, chain } = fakeChain();
    const slow = await openBudget(deps, accounts);
    const other = await openBudget(deps, accounts);
    behaviour.set("payer@example.com", "failed");
    const p1 = WALLET();
    accounts.set(reservationAddress(slow.budget, p1, PROGRAM).toBase58(), { owner: PROGRAM, data: sliceBytes({ budget: slow.budget, payee: p1, reserved: BigInt(1_000) }) });
    let pass = await watchBudgets({ ...deps, chain, programId: PROGRAM, origin: ORIGIN });
    expect(pass.find((r) => r.budget === slow.budget.toBase58())).toMatchObject({ error: "alerts_undelivered" });
    await watchBudgets({ ...deps, chain, programId: PROGRAM, origin: ORIGIN });
    await watchBudgets({ ...deps, chain, programId: PROGRAM, origin: ORIGIN });
    expect(sent.filter((s) => s.to === "payer@example.com" && /reserved/.test(s.subject))).toHaveLength(3);
    expect(sent.filter((s) => s.to === "ops@example.com" && /not getting through/.test(s.subject))).toHaveLength(1);
    behaviour.set("payer@example.com", "sent");
    pass = await watchBudgets({ ...deps, chain, programId: PROGRAM, origin: ORIGIN });
    expect(pass.every((r) => !r.error)).toBe(true);
    expect(sent.filter((s) => s.to === "payer@example.com" && /reserved/.test(s.subject))).toHaveLength(4);

    // A payer whose webhook never answers: the other Budget's payer still hears, within the timeout.
    const hanging = await createSpender({ payer: WALLET().toBase58(), network: "solana-devnet", contact: { webhook: "https://hang.example/hook" } }, deps);
    if (!hanging.ok) throw new Error();
    const hb = WALLET();
    accounts.set(hb.toBase58(), { owner: PROGRAM, data: budgetBytes({ payer: new PublicKey(hanging.record.payer), spender: new PublicKey(hanging.record.spender) }) });
    await activateSpender({ id: hanging.record.id, budget: hb.toBase58(), programId: PROGRAM, readAccount: async (a) => accounts.get(a.toBase58()) ?? null }, deps);
    behaviour.set("https://hang.example/hook", "hang");
    const p2 = WALLET();
    accounts.set(reservationAddress(hb, p2, PROGRAM).toBase58(), { owner: PROGRAM, data: sliceBytes({ budget: hb, payee: p2, reserved: BigInt(5) }) });
    accounts.set(reservationAddress(other.budget, p2, PROGRAM).toBase58(), { owner: PROGRAM, data: sliceBytes({ budget: other.budget, payee: p2, reserved: BigInt(7) }) });
    const started = Date.now();
    pass = await watchBudgets({ ...deps, chain, programId: PROGRAM, origin: ORIGIN });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(pass.find((r) => r.budget === other.budget.toBase58())?.alerts).toEqual(["payer:slice_reserved"]);
    expect(pass.find((r) => r.budget === hb.toBase58())).toMatchObject({ error: "alerts_undelivered" });
  });

  it("keeps the key on an unreadable Budget, tells the payer of a settled slice, and reports a stalled watcher", async () => {
    const { store, sent, deps } = setup();
    const { accounts, chain } = fakeChain();
    const { record, budget, payer, spender } = await openBudget(deps, accounts);
    const p = WALLET();
    const slice = reservationAddress(budget, p, PROGRAM).toBase58();
    accounts.set(slice, { owner: PROGRAM, data: sliceBytes({ budget, payee: p, reserved: BigInt(10), state: 1, finalAmount: BigInt(5), postedSlot: CREATED + BigInt(1) }) });
    expect((await watchBudgets({ ...deps, chain, programId: PROGRAM, origin: ORIGIN })).every((r) => !r.error)).toBe(true);
    expect(await store.watchedAt()).toBe(new Date(NOW_MS).toISOString());

    accounts.set(budget.toBase58(), { owner: WALLET(), data: budgetBytes({ payer, spender }) });
    const odd = await watchBudgets({ ...deps, chain, programId: PROGRAM, origin: ORIGIN });
    expect(odd[0]).toMatchObject({ error: "budget_unreadable", status: "open" });
    expect((await store.byId(record.id))!.sealed).toBeDefined();

    accounts.set(budget.toBase58(), { owner: PROGRAM, data: budgetBytes({ payer, spender }) });
    accounts.delete(slice);
    const later = NOW_MS + 60 * 60 * 1000;
    const settled = await watchBudgets({ ...deps, nowMs: later, chain, programId: PROGRAM, origin: ORIGIN });
    expect(settled[0].alerts).toEqual(["payer:slice_settled"]);
    expect(sent.some((s) => s.to === "ops@example.com" && /stalled/.test(s.subject))).toBe(true);
    expect((await store.byId(record.id))!.seen).toEqual({});
  });

  it("alerts the operator when a live key is sealed under a KEK the server no longer has, and reseals on request", async () => {
    const { store, sent, deps } = setup();
    const { accounts, chain } = fakeChain();
    const { record } = await openBudget(deps, accounts);
    const old = { ...(await store.byId(record.id))!, sealed: sealSpenderKey(Keypair.fromSeed(openSpenderSeed(record.sealed!, record.id, record.spender, KEKS)), record.id, [KEKS[1]]) };
    store.records.set(record.id, { ...old });
    const onlyNew = { ...deps, env: { ...deps.env, BUDGET_SPENDER_KEKS: `k2:${Buffer.alloc(32, 2).toString("base64")}` } };
    expect((await watchBudgets({ ...onlyNew, chain, programId: PROGRAM, origin: ORIGIN }))[0]).toMatchObject({ error: "kek_missing" });
    expect(sent.some((s) => s.to === "ops@example.com" && /KEK k1/.test(s.subject))).toBe(true);
    expect(await resealAll(store, KEKS, false)).toMatchObject({ byKek: { k1: 1 }, resealed: 0 });
    expect(await resealAll(store, KEKS, true)).toMatchObject({ byKek: { k1: 1 }, resealed: 1, failed: [] });
    expect((await store.byId(record.id))!.sealed!.startsWith("v1.k2.")).toBe(true);
  });

  it("incident: finds a frozen key the payer opened anyway, skips Budgets already closed, and lists what it did not reach", async () => {
    const { store, sent, deps } = setup();
    const { accounts, chain, sentTxs } = fakeChain();
    const feePayer = Keypair.generate();
    const pending = await createSpender({ payer: WALLET().toBase58(), network: "solana-devnet", contact: { email: "late@example.com" } }, deps);
    if (!pending.ok) throw new Error();
    await closeAllBudgets({ reason: "first", feePayer, programId: PROGRAM, chain }, deps);
    expect(sent.some((s) => s.to === "late@example.com" && /Do not open/.test(s.subject))).toBe(true);
    // The payer opens it anyway; a frozen key cannot be activated, but the next run finds and closes it.
    const opened = WALLET();
    accounts.set(opened.toBase58(), { owner: PROGRAM, data: budgetBytes({ payer: new PublicKey(pending.record.payer), spender: new PublicKey(pending.record.spender) }) });
    expect(await activateSpender({ id: pending.record.id, budget: opened.toBase58(), programId: PROGRAM, readAccount: async (a) => accounts.get(a.toBase58()) ?? null }, deps)).toMatchObject({ ok: false, code: "not_pending" });
    const closedAlready = await openBudget(deps, accounts);
    accounts.set(closedAlready.budget.toBase58(), { owner: PROGRAM, data: budgetBytes({ payer: closedAlready.payer, spender: closedAlready.spender, closed: true, closedSlot: CREATED + BigInt(9) }) });
    const second = await closeAllBudgets({ reason: "second", feePayer, programId: PROGRAM, chain }, deps);
    expect(second.unreached).toEqual([]);
    expect(second.results).toEqual(expect.arrayContaining([expect.objectContaining({ budget: opened.toBase58(), ok: true }), expect.objectContaining({ budget: closedAlready.budget.toBase58(), ok: true, note: "already_closed" })]));
    expect(sentTxs).toHaveLength(1);
    expect((await store.byId(pending.record.id))!.incident).toMatchObject({ reason: "second", ok: true });

    const late = await openBudget(deps, accounts);
    const third = await closeAllBudgets({ reason: "third", feePayer, programId: PROGRAM, chain, deadlineMs: Date.now() - 1 }, deps);
    expect(third.unreached).toContain(late.budget.toBase58());
    expect(sent.some((s) => s.to === "ops@example.com" && /NOT closed/.test(s.subject))).toBe(true);
  });
});

describe("Budget job recorder (audit round 4, S7-claude-06)", () => {
  const budget = WALLET();
  const payer = WALLET();
  const provider = Keypair.generate();
  const reservation = reservationAddress(budget, provider.publicKey, PROGRAM);
  const SIG = "4".repeat(88);
  const HASH = "c".repeat(64);

  function eventBytes(paid: bigint, fee: bigint, outcome = 1, who = provider.publicKey): string {
    const d = Buffer.alloc(105);
    BUDGET_PAID_EVENT.copy(d, 0);
    budget.toBuffer().copy(d, 8);
    who.toBuffer().copy(d, 40);
    d.writeBigUInt64LE(paid, 72);
    d.writeBigUInt64LE(fee, 80);
    d.writeBigUInt64LE(BigInt(100), 88);
    d[96] = outcome;
    d.writeBigUInt64LE(CREATED + BigInt(9_000), 97);
    return d.toString("base64");
  }
  function payoutTx(opts: { slot?: bigint; logs?: string[] } = {}) {
    const data = Buffer.concat([Buffer.from(BUDGET_DISCRIMINATORS["global:payout_budget"]), Buffer.alloc(8)]);
    data.writeBigUInt64LE(opts.slot ?? CREATED, 8);
    return {
      meta: { err: null, logMessages: opts.logs ?? [`Program ${PROGRAM.toBase58()} invoke [1]`, `Program data: ${eventBytes(BigInt(975), BigInt(25))}`, `Program ${PROGRAM.toBase58()} success`] },
      transaction: { message: { instructions: [{ programId: PROGRAM, accounts: [budget, reservation, provider.publicKey, payer, WALLET()], data: base58(data) }] } },
    };
  }
  async function receipt(cumulativeCost = "1000") {
    const r: ReddiReceiptV2 = {
      schemaVersion: "reddi.receipt.v2",
      providerId: provider.publicKey.toBase58(),
      declaredModel: "mid-tier",
      requestHash: HASH,
      responseHash: HASH,
      session: { escrow: reservation.toBase58(), payer: payer.toBase58(), network: "solana-devnet", currency: "SOL", maxAmount: "2000", sequence: "1", inputTokens: "10", outputTokens: "5", cumulativeInputTokens: "10", cumulativeOutputTokens: "5", cumulativeCost, closed: false },
      budget: { address: budget.toBase58(), createdSlot: CREATED.toString(), reservation: reservation.toBase58() },
      issuedAt: "2026-11-25T01:00:00.000Z",
    };
    const { sign } = await import("crypto");
    const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(provider.secretKey.subarray(0, 32))]);
    const { createPrivateKey } = await import("crypto");
    const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    return signReddiReceiptV2(r, (m) => sign(null, m, key));
  }
  function deps(tx: unknown) {
    const writes: Record<string, unknown>[] = [];
    return {
      writes,
      deps: {
        programId: PROGRAM,
        getParsedTransaction: async () => tx as never,
        url: "https://db.example.supabase.co",
        serviceKey: "service",
        fetchImpl: (async (_url: string, init: { body?: string }) => {
          writes.push(JSON.parse(init.body!));
          return { ok: true, status: 201, json: async () => [{ id: "job-1" }] };
        }) as never,
      },
    };
  }
  const input = async (over: Record<string, unknown> = {}) => ({ payoutSignature: SIG, budget: budget.toBase58(), createdSlot: CREATED.toString(), payer: payer.toBase58(), provider: provider.publicKey.toBase58(), network: "solana-devnet" as const, receipt: await receipt(), ...over });

  it("records a landed payout of this slice with the program's own BudgetPaid amounts", async () => {
    const d = deps(payoutTx());
    const out = await verifyAndRecordBudgetCall(await input(), d.deps);
    expect(out).toMatchObject({ recorded: true, jobId: "job-1" });
    expect(d.writes[0]).toMatchObject({ buyer_wallet: payer.toBase58(), provider_wallet: provider.publicKey.toBase58(), amount_base_units: "1000", mint: "SOL", tx_signature: SIG, request_hash: HASH });
  });

  it("refuses another opening, a forged event from another program, nothing paid, more than the receipts, and a receipt for another Budget", async () => {
    expect(await verifyAndRecordBudgetCall(await input(), deps(payoutTx({ slot: BigInt(7) })).deps)).toEqual({ recorded: false, reason: "payout_not_for_this_slice" });
    const other = Keypair.generate().publicKey.toBase58();
    const forged = [`Program ${PROGRAM.toBase58()} invoke [1]`, `Program ${other} invoke [2]`, `Program data: ${eventBytes(BigInt(975), BigInt(25))}`, `Program ${other} success`, `Program ${PROGRAM.toBase58()} success`];
    expect(await verifyAndRecordBudgetCall(await input(), deps(payoutTx({ logs: forged })).deps)).toEqual({ recorded: false, reason: "budget_paid_not_found" });
    const refund = [`Program ${PROGRAM.toBase58()} invoke [1]`, `Program data: ${eventBytes(BigInt(0), BigInt(0), 3)}`, `Program ${PROGRAM.toBase58()} success`];
    expect(await verifyAndRecordBudgetCall(await input(), deps(payoutTx({ logs: refund })).deps)).toEqual({ recorded: false, reason: "nothing_paid" });
    expect(await verifyAndRecordBudgetCall(await input({ receipt: await receipt("900") }), deps(payoutTx()).deps)).toEqual({ recorded: false, reason: "paid_above_receipts" });
    expect(await verifyAndRecordBudgetCall(await input({ createdSlot: "8" }), deps(payoutTx()).deps)).toMatchObject({ recorded: false, reason: "receipt_budget_mismatch" });
  });

  it("decodes BudgetPaid and reads only the logs of the program itself", () => {
    const bytes = Buffer.from(eventBytes(BigInt(1), BigInt(2), 2), "base64");
    expect(decodeBudgetPaid(bytes)).toMatchObject({ paid: BigInt(1), fee: BigInt(2), outcome: "resolved", budget: budget.toBase58() });
    expect(programDataLogs([`Program data: ${bytes.toString("base64")}`], PROGRAM.toBase58())).toHaveLength(0);
    expect(createHash("sha256").update("event:BudgetPaid").digest().subarray(0, 8)).toEqual(BUDGET_PAID_EVENT);
  });
});
