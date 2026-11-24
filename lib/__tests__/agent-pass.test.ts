/**
 * @jest-environment node
 */
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { MEMO_PROGRAM_ID, MemoryNonceReplayStore, sessionDelegationMemo, transactionFactsReader } from "@redditech/x402-solana";
import { findSandboxProviderById } from "@/lib/sandbox/catalog";
import { SANDBOX_ESCROW_DISCRIMINATORS, SANDBOX_ESCROW_PROGRAM_ID, sandboxEscrowAddress } from "@/lib/sandbox/escrow";
import type { SandboxGatewayDeps } from "@/lib/sandbox/gateway";
import { sandboxBuildOfRecord } from "@/lib/sandbox/deployment";
import type { SandboxSettleInput, SandboxSettler } from "@/lib/sandbox/settle-signer";
import { decodeReceiptHeader, type SandboxReceipt } from "@/lib/sandbox/receipt";
import { maxChargeLamports, requestInputTokens } from "@/lib/sandbox/pricing";
import {
  activatePass,
  buildPassTransaction,
  closePass,
  hashPassKey,
  passCall,
  passCloseReserveLamports,
  passKeyFromAuthorization,
  passMinBudgetLamports,
  passReceiptProblem,
  passRelayKeypair,
  passView,
  PASS_EXPIRY_MARGIN_SECONDS,
  PASS_LOCK_COMPUTE_UNITS_EACH,
  PASS_MAX_BUDGET_LAMPORTS,
  PASS_SECONDS,
  PASS_WINDOW_SLOTS,
  startPass,
} from "@/lib/pass/pass";
import { MemoryAgentPassStore, SupabaseAgentPassStore, type AgentPass } from "@/lib/pass/store";

const ORIGIN = "https://app.example";
const NOW_MS = Date.UTC(2026, 10, 24, 8, 0, 0);
const SECRET = Buffer.alloc(32, 9);
const CURRENT_SLOT = BigInt(2_000_000);
const SETTLE_SIG = "3".repeat(88);
const LOCK_SIG = "4".repeat(88);
const BLOCKHASH = Keypair.generate().publicKey.toBase58();
const ATLAS = findSandboxProviderById("atlas-review")!;
const SWIFT = findSandboxProviderById("swift-infer")!;
const BUDGET = "20000000";

function escrowBytes(payer: PublicKey, payee: PublicKey, amount: bigint, nonce: Uint8Array, claim: bigint, cancel: bigint): Uint8Array {
  const parts: number[] = [...SANDBOX_ESCROW_DISCRIMINATORS.escrowAccount, ...payer.toBytes(), ...payee.toBytes()];
  const a = Buffer.alloc(8);
  a.writeBigUInt64LE(amount);
  parts.push(...a, ...nonce, 0);
  const time = Buffer.alloc(16);
  time.writeBigInt64LE(BigInt(Math.floor(NOW_MS / 1000)));
  time.writeBigUInt64LE(CURRENT_SLOT - BigInt(10), 8);
  parts.push(...time);
  const windows = Buffer.alloc(16);
  windows.writeBigUInt64LE(claim);
  windows.writeBigUInt64LE(cancel, 8);
  parts.push(...windows, 0, 0, 255, 1);
  while (parts.length < 165) parts.push(0);
  return Uint8Array.from(parts);
}

function world() {
  const accounts = new Map<string, { owner: PublicKey; data: Uint8Array }>();
  const settles: SandboxSettleInput[] = [];
  const settler: SandboxSettler = {
    canSettle: () => true,
    deployment: async () => ({ ok: true, build: sandboxBuildOfRecord()! }),
    async settle(input) {
      settles.push(input);
      // The escrow is settled: it no longer takes calls.
      accounts.delete(input.escrow.toBase58());
      return { ok: true, signature: SETTLE_SIG, feeLamports: (input.actualLamports * BigInt(250)) / BigInt(10_000) };
    },
    async lookup() {
      return { state: "unknown" };
    },
  };
  const landed: { signature: string; tx: Transaction; slot: number }[] = [];
  const connection = {
    getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 100 }),
    getSignaturesForAddress: async (address: PublicKey, options?: { limit?: number }) =>
      landed
        .filter((l) => l.tx.compileMessage().accountKeys.some((k) => k.equals(address)))
        .map((l) => ({ signature: l.signature, err: null }))
        .slice(0, options?.limit ?? 1_000),
    getTransaction: async (signature: string) => {
      const l = landed.find((x) => x.signature === signature);
      return l ? { slot: l.slot, meta: { err: null }, transaction: { message: l.tx.compileMessage() } } : null;
    },
  };
  let counter = 0;
  const deps: SandboxGatewayDeps = {
    connection: { getGenesisHash: async () => "", getParsedTransaction: async () => null } as unknown as SandboxGatewayDeps["connection"],
    replayStore: new MemoryNonceReplayStore(),
    readAccount: async (address) => accounts.get(address.toBase58()) ?? null,
    readSlot: async () => CURRENT_SLOT,
    settler,
    acceptMeteredSessions: true,
    readTransaction: transactionFactsReader(connection as never),
    now: () => NOW_MS,
    newNonce: () => (++counter).toString(16).padStart(32, "a"),
  };
  /** The wallet signs what the transaction request returned, and every lock in it lands. Newest first, like RPC. */
  function walletSignsAndLands(base64: string, payer: Keypair, signature = LOCK_SIG) {
    const tx = Transaction.from(Buffer.from(base64, "base64"));
    tx.partialSign(payer);
    landed.unshift({ signature, tx, slot: Number(CURRENT_SLOT - BigInt(10)) });
    for (const ix of tx.instructions.filter((i) => i.programId.equals(SANDBOX_ESCROW_PROGRAM_ID))) {
      const data = Buffer.from(ix.data);
      accounts.set(ix.keys[0].pubkey.toBase58(), {
        owner: SANDBOX_ESCROW_PROGRAM_ID,
        data: escrowBytes(payer.publicKey, ix.keys[2].pubkey, data.readBigUInt64LE(8), data.subarray(16, 32), data.readBigUInt64LE(32), data.readBigUInt64LE(40)),
      });
    }
    return tx;
  }
  const store = new MemoryAgentPassStore();
  return { accounts, settles, connection, deps, walletSignsAndLands, landed, store };
}

type World = ReturnType<typeof world>;

async function opened(w: World, budgets = [{ providerId: ATLAS.id, lamports: BUDGET }, { providerId: SWIFT.id, lamports: BUDGET }], perCallMaxLamports?: string) {
  const s = await startPass({ budgets, perCallMaxLamports, deps: w.deps, store: w.store, nowMs: NOW_MS });
  if (!s.ok) throw new Error(s.message);
  return s;
}

async function active(w: World, ...args: Parameters<typeof opened> extends [World, ...infer R] ? R : never) {
  const s = await opened(w, ...args);
  const payer = Keypair.generate();
  const built = await buildPassTransaction({ passId: s.pass.id, account: payer.publicKey.toBase58(), secret: SECRET, store: w.store, connection: w.connection, nowMs: NOW_MS });
  if (!built.ok) throw new Error(built.message);
  w.walletSignsAndLands(built.transaction, payer);
  const a = await activatePass({ passId: s.pass.id, secret: SECRET, connection: w.connection, store: w.store });
  if (!a.ok || a.pass.status !== "active") throw new Error("pass did not activate");
  return { ...s, payer, pass: a.pass };
}

const ask = (model: string, content = "Review this function for bugs.") => ({ model, messages: [{ role: "user", content }] });
const call = (w: World, key: string, body: unknown, nowMs = NOW_MS) => passCall({ key, body, origin: ORIGIN, secret: SECRET, deps: w.deps, store: w.store, nowMs });

describe("agent pass (#1048)", () => {
  it("one signature locks a budget per provider, delegated to the pass's relay key for 24 hours", async () => {
    const w = world();
    const s = await opened(w);
    expect(s.pass.expiresAt).toBe(NOW_MS / 1000 + PASS_SECONDS);
    expect(s.pass.status).toBe("waiting");
    const payer = Keypair.generate();
    const built = await buildPassTransaction({ passId: s.pass.id, account: payer.publicKey.toBase58(), secret: SECRET, store: w.store, connection: w.connection, nowMs: NOW_MS });
    if (!built.ok) throw new Error(built.message);
    const tx = Transaction.from(Buffer.from(built.transaction, "base64"));
    expect(tx.feePayer?.equals(payer.publicKey)).toBe(true);
    const [limit, price, lockA, memoA, lockB, memoB] = tx.instructions;
    expect(tx.instructions).toHaveLength(6);
    expect(limit.programId.equals(ComputeBudgetProgram.programId) && price.programId.equals(ComputeBudgetProgram.programId)).toBe(true);
    expect(Buffer.from(limit.data)).toEqual(Buffer.from(ComputeBudgetProgram.setComputeUnitLimit({ units: PASS_LOCK_COMPUTE_UNITS_EACH * 2 }).data));
    const relay = passRelayKeypair(s.pass.id, SECRET).publicKey.toBase58();
    for (const [index, [lock, memo, provider]] of ([[lockA, memoA, ATLAS], [lockB, memoB, SWIFT]] as const).entries()) {
      const escrow = sandboxEscrowAddress(payer.publicKey, s.pass.sessions[index].nonce);
      expect(lock.programId.equals(SANDBOX_ESCROW_PROGRAM_ID)).toBe(true);
      expect(lock.keys[0].pubkey.equals(escrow)).toBe(true);
      // The payee is the provider: nothing the relay or the key holder does can pay anyone else.
      expect(lock.keys[2].pubkey.toBase58()).toBe(provider.payTo);
      const data = Buffer.from(lock.data);
      expect(data.readBigUInt64LE(8)).toBe(BigInt(BUDGET));
      // Neither side can end the lock alone for more than the pass's 24 hours.
      expect(data.readBigUInt64LE(32)).toBe(PASS_WINDOW_SLOTS);
      expect(data.readBigUInt64LE(40)).toBe(PASS_WINDOW_SLOTS);
      expect(Number(PASS_WINDOW_SLOTS) * 0.34).toBeGreaterThan(PASS_SECONDS);
      expect(memo.programId.equals(MEMO_PROGRAM_ID)).toBe(true);
      expect(memo.data.toString("utf8")).toBe(
        sessionDelegationMemo({ genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", escrow: escrow.toBase58(), provider: provider.payTo, sessionKey: relay, expiresAt: s.pass.expiresAt }),
      );
    }
    // The reference rides on the first lock only.
    expect(lockA.keys.at(-1)).toEqual({ pubkey: new PublicKey(s.pass.reference), isSigner: false, isWritable: false });
    expect(lockB.keys.some((k) => k.pubkey.toBase58() === s.pass.reference)).toBe(false);

    // Waiting until the lock lands, then active with both escrows.
    expect((await activatePass({ passId: s.pass.id, secret: SECRET, connection: w.connection, store: w.store })).ok && (await w.store.byId(s.pass.id))!.status).toBe("waiting");
    w.walletSignsAndLands(built.transaction, payer);
    const a = await activatePass({ passId: s.pass.id, secret: SECRET, connection: w.connection, store: w.store });
    if (!a.ok) throw new Error(a.message);
    expect(a.pass).toMatchObject({ status: "active", payer: payer.publicKey.toBase58(), lockSignature: LOCK_SIG });
    expect(a.pass.sessions.map((x) => x.escrow)).toEqual(s.pass.sessions.map((x) => sandboxEscrowAddress(payer.publicKey, x.nonce).toBase58()));
    // A paid pass builds no second transaction.
    expect(await buildPassTransaction({ passId: s.pass.id, account: payer.publicKey.toBase58(), secret: SECRET, store: w.store, connection: w.connection, nowMs: NOW_MS })).toMatchObject({ ok: false, code: "pass_invalid" });
  });

  it("keeps only a hash of the agent's key", async () => {
    const w = world();
    const s = await opened(w);
    expect(passKeyFromAuthorization(`Bearer ${s.key}`)).toBe(s.key);
    expect(passKeyFromAuthorization("Bearer sk-something-else")).toBeUndefined();
    const stored = JSON.stringify(await w.store.byId(s.pass.id));
    expect(stored).not.toContain(s.key);
    expect(stored).toContain(hashPassKey(s.key));
  });

  it("pays calls from the provider's lock, chains each receipt, and settles once per provider on close", async () => {
    const w = world();
    const s = await active(w);
    const first = await call(w, s.key, ask(ATLAS.model));
    if (!first.ok) throw new Error(first.message);
    const block = first.body.rap_pass as Record<string, unknown>;
    expect(block).toMatchObject({ provider: ATLAS.id, sequence: 1, expiresAt: s.pass.expiresAt });
    expect(BigInt(block.callCostLamports as string)).toBeGreaterThan(BigInt(0));
    expect(BigInt(block.leftLamports as string)).toBe(BigInt(BUDGET) - BigInt(block.spentLamports as string));
    expect((first.body.choices as unknown[]).length).toBe(1);

    const second = await call(w, s.key, ask(ATLAS.model, "And this one?"));
    if (!second.ok) throw new Error(second.message);
    expect(second.receipt.receipt.session).toMatchObject({ sequence: "2", escrow: s.pass.sessions[0].escrow });
    expect(second.receipt.receipt.session!.previousReceiptHash).toBeDefined();
    expect(w.settles).toHaveLength(0);

    const closed = await closePass({ key: s.key, origin: ORIGIN, secret: SECRET, deps: w.deps, store: w.store, nowMs: NOW_MS });
    if (!closed.ok) throw new Error(closed.message);
    expect(closed.failures).toEqual([]);
    expect(closed.pass.status).toBe("closed");
    // Atlas settles its three calls (two and the close); Swift, never called, settles only the close.
    expect(w.settles).toHaveLength(2);
    expect(w.settles.map((x) => x.payee.toBase58())).toEqual([ATLAS.payTo, SWIFT.payTo]);
    expect(w.settles.map((x) => x.payer.toBase58())).toEqual([s.payer.publicKey.toBase58(), s.payer.publicKey.toBase58()]);
    expect(w.settles[0].actualLamports).toBeGreaterThan(BigInt(second.receipt.receipt.session!.cumulativeCost));
    const view = passView(closed.pass);
    expect(view.providers.every((p) => p.closed && p.settleSignature === SETTLE_SIG)).toBe(true);
    // The relay's closing call is not counted as one of the agent's.
    expect(view.providers[0].calls).toBe(2);
    expect(view.providers[1].calls).toBe(0);

    expect(await call(w, s.key, ask(ATLAS.model))).toMatchObject({ ok: false, code: "pass_closed" });
  });

  it("refuses before anything is sent: wrong key, unpaid pass, model not in the pass, over the per-call cap", async () => {
    const w = world();
    const waiting = await opened(w);
    expect(await call(w, "rap_pass_" + "x".repeat(43), ask(ATLAS.model))).toMatchObject({ ok: false, status: 401, code: "pass_key_invalid" });
    expect(await call(w, waiting.key, ask(ATLAS.model))).toMatchObject({ ok: false, code: "pass_not_paid" });

    const s = await active(w, [{ providerId: ATLAS.id, lamports: BUDGET }], "1000");
    expect(await call(w, s.key, ask(SWIFT.model))).toMatchObject({ ok: false, status: 404, code: "model_not_in_pass" });
    expect(await call(w, s.key, { model: ATLAS.model })).toMatchObject({ ok: false, status: 400, code: "invalid_request" });
    expect(await call(w, s.key, ask(ATLAS.model))).toMatchObject({ ok: false, status: 402, code: "over_call_cap" });
    const after = (await w.store.byId(s.pass.id))!;
    expect(after.sessions[0].sequence).toBe(0);
    expect(w.settles).toHaveLength(0);
  });

  it("stops at the budget, always leaving room to close and settle", async () => {
    const w = world();
    const prompt = ask(ATLAS.model, "word ".repeat(1_200));
    const oneCall = maxChargeLamports(ATLAS, requestInputTokens(prompt.messages));
    // Room for one worst-case call and the close: once the first call has cost anything, not a second.
    const budget = (oneCall + passCloseReserveLamports(ATLAS)).toString();
    expect(BigInt(budget)).toBeGreaterThanOrEqual(passMinBudgetLamports(ATLAS));
    const s = await active(w, [{ providerId: ATLAS.id, lamports: budget }]);
    expect(await call(w, s.key, prompt)).toMatchObject({ ok: true });
    expect(await call(w, s.key, prompt)).toMatchObject({ ok: false, status: 402, code: "budget_reached" });
    const closed = await closePass({ key: s.key, origin: ORIGIN, secret: SECRET, deps: w.deps, store: w.store, nowMs: NOW_MS });
    expect(closed).toMatchObject({ ok: true, failures: [] });
    expect(w.settles[0].actualLamports).toBeLessThanOrEqual(BigInt(budget));
  });

  it("takes one call per provider at a time", async () => {
    const w = world();
    const s = await active(w);
    const [a, b] = await Promise.all([call(w, s.key, ask(ATLAS.model)), call(w, s.key, ask(ATLAS.model, "Other"))]);
    const results = [a, b].map((r) => (r.ok ? "ok" : r.code)).sort();
    expect(results).toEqual(["ok", "pass_busy"]);
    // A hold left by a call that died lapses.
    const pass = (await w.store.byId(s.pass.id))!;
    const stuck: AgentPass = { ...pass, sessions: pass.sessions.map((x, i) => (i === 0 ? { ...x, heldUntil: NOW_MS + 30_000 } : x)) as AgentPass["sessions"], version: pass.version + 1 };
    expect((await w.store.update(stuck)).ok).toBe(true);
    expect(await call(w, s.key, ask(ATLAS.model))).toMatchObject({ ok: false, code: "pass_busy" });
    expect(await call(w, s.key, ask(ATLAS.model), NOW_MS + 61_000)).toMatchObject({ ok: true });
  });

  it("near the end of its 24 hours a pass takes no more calls and closes itself", async () => {
    const w = world();
    const s = await active(w);
    expect(await call(w, s.key, ask(ATLAS.model))).toMatchObject({ ok: true });
    const late = (s.pass.expiresAt - PASS_EXPIRY_MARGIN_SECONDS) * 1000;
    expect(await call(w, s.key, ask(ATLAS.model), late)).toMatchObject({ ok: false, code: "pass_expired" });
    expect(w.settles).toHaveLength(2);
    expect((await w.store.byId(s.pass.id))!.status).toBe("closed");
  });

  it("does not take a stranger's transaction that names the reference for the lock", async () => {
    const w = world();
    const s = await opened(w);
    const payer = Keypair.generate();
    const built = await buildPassTransaction({ passId: s.pass.id, account: payer.publicKey.toBase58(), secret: SECRET, store: w.store, connection: w.connection, nowMs: NOW_MS });
    if (!built.ok) throw new Error(built.message);
    // Same locks, but the memos that delegate to the relay are dropped.
    const tx = Transaction.from(Buffer.from(built.transaction, "base64"));
    const stripped = new Transaction({ feePayer: payer.publicKey, blockhash: BLOCKHASH, lastValidBlockHeight: 100 }).add(...tx.instructions.filter((ix) => !ix.programId.equals(MEMO_PROGRAM_ID)));
    w.walletSignsAndLands(stripped.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), payer, "5".repeat(88));
    const a = await activatePass({ passId: s.pass.id, secret: SECRET, connection: w.connection, store: w.store });
    expect(a.ok && a.pass.status).toBe("waiting");
  });

  it("checks budgets and providers before a pass is opened", async () => {
    const w = world();
    const start = (budgets: unknown, perCallMaxLamports?: unknown) => startPass({ budgets, perCallMaxLamports, deps: w.deps, store: w.store, nowMs: NOW_MS });
    expect(await start([])).toMatchObject({ ok: false, code: "invalid_budgets" });
    expect(await start([{ providerId: ATLAS.id, lamports: BUDGET }, { providerId: ATLAS.id, lamports: BUDGET }])).toMatchObject({ ok: false, code: "invalid_budgets" });
    expect(await start([{ providerId: ATLAS.id, lamports: 5 }])).toMatchObject({ ok: false, code: "invalid_budgets" });
    expect(await start([{ providerId: ATLAS.id, lamports: "1" }])).toMatchObject({ ok: false, code: "budget_too_small" });
    expect(await start([{ providerId: ATLAS.id, lamports: (PASS_MAX_BUDGET_LAMPORTS + BigInt(1)).toString() }])).toMatchObject({ ok: false, code: "budget_too_large" });
    expect(await start([{ providerId: "nobody", lamports: BUDGET }])).toMatchObject({ ok: false, code: "unknown_provider" });
    expect(await start([{ providerId: ATLAS.id, lamports: BUDGET }], "-1")).toMatchObject({ ok: false, code: "invalid_cap" });
    // Simulated-only and offline providers cannot take a devnet lock.
    expect(await start([{ providerId: "reddi-humaniser", lamports: BUDGET }])).toMatchObject({ ok: false, status: 503, code: "provider_unavailable" });
    expect(await start([{ providerId: "night-owl", lamports: BUDGET }])).toMatchObject({ ok: false, status: 503, code: "provider_unavailable" });
  });

  it("keeps a provider's receipt only when it is that provider's, for the next call, on the same lock", async () => {
    const w = world();
    const s = await active(w, [{ providerId: ATLAS.id, lamports: BUDGET }]);
    const before = (await w.store.byId(s.pass.id))!.sessions[0];
    const first = await call(w, s.key, ask(ATLAS.model));
    if (!first.ok) throw new Error(first.message);
    const receipt = first.receipt;
    expect(await passReceiptProblem(receipt, ATLAS, 1, before)).toBeUndefined();
    expect(await passReceiptProblem(receipt, ATLAS, 2, before)).toMatch(/different call/);
    expect(await passReceiptProblem(receipt, SWIFT, 1, before)).toMatch(/not signed by this provider/);
    expect(await passReceiptProblem(receipt, ATLAS, 1, { ...before, escrow: Keypair.generate().publicKey.toBase58() })).toMatch(/different lock/);
    const forged: SandboxReceipt = { ...receipt, receipt: { ...receipt.receipt, session: { ...receipt.receipt.session!, cumulativeCost: "1" } } };
    expect(await passReceiptProblem(forged, ATLAS, 1, before)).toMatch(/signature does not verify/);
    expect(await passReceiptProblem(decodeReceiptHeader("not a receipt"), ATLAS, 1, before)).toMatch(/without a session receipt/);
  });
});

describe("Supabase pass store", () => {
  it("writes only over the version it read", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    let rows: unknown[] = [];
    const store = new SupabaseAgentPassStore({
      url: "https://db.example",
      serviceKey: "service",
      fetchImpl: async (url, init) => {
        calls.push({ url, method: init.method, body: init.body });
        return { ok: true, status: 200, json: async () => rows };
      },
    });
    const pass: AgentPass = { id: "a".repeat(32), keyHash: "b".repeat(64), network: "solana-devnet", reference: Keypair.generate().publicKey.toBase58(), expiresAt: 1, status: "waiting", sessions: [], version: 1, createdAt: new Date(NOW_MS).toISOString() };
    expect(await store.create(pass)).toEqual({ ok: true });
    rows = [];
    expect(await store.update({ ...pass, version: 2 })).toEqual({ ok: false, code: "conflict" });
    expect(calls[1].url).toBe(`https://db.example/rest/v1/agent_passes?id=eq.${pass.id}&version=eq.1`);
    rows = [{}];
    expect(await store.update({ ...pass, version: 2 })).toMatchObject({ ok: true });
    // Ids and hashes that are not hex never reach the query string.
    expect(await store.byId("a&id=neq.x")).toBeUndefined();
    expect(await store.byKeyHash("zz")).toBeUndefined();
    expect(calls).toHaveLength(3);
  });
});
