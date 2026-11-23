/**
 * @jest-environment node
 */
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { SANDBOX_PROVIDERS, scriptedSandboxAnswer } from "@/lib/sandbox/catalog";
import { countTokens, requestInputTokens, sessionCallLamports } from "@/lib/sandbox/pricing";
import { MEMO_PROGRAM_ID, MemoryNonceReplayStore, sessionDelegationMemo, transactionFactsReader } from "@redditech/x402-solana";
import { SANDBOX_CANCEL_WINDOW_SLOTS, SANDBOX_CLAIM_WINDOW_SLOTS, SANDBOX_ESCROW_DISCRIMINATORS, SANDBOX_ESCROW_PROGRAM_ID, escrowNonceBytes, sandboxEscrowAddress } from "@/lib/sandbox/escrow";
import type { SandboxGatewayDeps } from "@/lib/sandbox/gateway";
import type { SandboxSettleInput, SandboxSettler } from "@/lib/sandbox/settle-signer";
import { sandboxBuildOfRecord, type SandboxDeploymentCheck } from "@/lib/sandbox/deployment";
import { buildTryTransaction, runTry, startTry, TRY_LOCK_COMPUTE_UNITS, TRY_LOCK_MICRO_LAMPORTS_PER_UNIT, TRY_READS_PER_POLL, TryRunCache } from "@/lib/try/flow";
import { openTicket, relayKeypair, sealTicket, trySecret, TryNotConfiguredError } from "@/lib/try/ticket";
import { TRY_TASKS } from "@/lib/try/tasks";
import { devnetOrResponse, solanaPayLink } from "@/lib/try/http";

const ORIGIN = "https://app.example";
const NOW_MS = Date.UTC(2026, 10, 22, 8, 0, 0);
const SECRET = Buffer.alloc(32, 7);
const CURRENT_SLOT = BigInt(1_000_000);
const SETTLE_SIG = "3".repeat(88);
const LOCK_SIG = "4".repeat(88);
const BLOCKHASH = Keypair.generate().publicKey.toBase58();

type Accounts = Map<string, { owner: PublicKey; data: Uint8Array }>;

function escrowBytes(payer: PublicKey, payee: PublicKey, amount: bigint, nonce: Uint8Array): Uint8Array {
  const parts: number[] = [...SANDBOX_ESCROW_DISCRIMINATORS.escrowAccount, ...payer.toBytes(), ...payee.toBytes()];
  const a = Buffer.alloc(8);
  a.writeBigUInt64LE(amount);
  parts.push(...a, ...nonce, 0);
  const time = Buffer.alloc(16);
  time.writeBigInt64LE(BigInt(Math.floor(NOW_MS / 1000)));
  time.writeBigUInt64LE(CURRENT_SLOT - BigInt(10), 8);
  parts.push(...time);
  const windows = Buffer.alloc(16);
  windows.writeBigUInt64LE(SANDBOX_CLAIM_WINDOW_SLOTS);
  windows.writeBigUInt64LE(SANDBOX_CANCEL_WINDOW_SLOTS, 8);
  parts.push(...windows, 0, 0, 255, 1);
  while (parts.length < 165) parts.push(0);
  return Uint8Array.from(parts);
}

function world() {
  const accounts: Accounts = new Map();
  const settles: SandboxSettleInput[] = [];
  const deployment: { check: SandboxDeploymentCheck } = { check: { ok: true, build: sandboxBuildOfRecord()! } };
  const settler: SandboxSettler = { canSettle: () => true, deployment: async () => deployment.check, async settle(input) { settles.push(input); return { ok: true, signature: SETTLE_SIG }; } };
  const landed: { signature: string; tx: Transaction; slot: number }[] = [];
  const connection = {
    getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 100 }),
    // Newest first, like RPC: `landed` is kept newest first.
    getSignaturesForAddress: async (address: PublicKey, options?: { limit?: number; before?: string }) => {
      const all = landed.filter((l) => l.tx.compileMessage().accountKeys.some((k) => k.equals(address))).map((l) => ({ signature: l.signature, err: null }));
      const from = options?.before ? all.findIndex((x) => x.signature === options.before) + 1 : 0;
      return all.slice(from, from + (options?.limit ?? 1_000));
    },
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
    readTransaction: transactionFactsReader(connection as never),
    now: () => NOW_MS,
    newNonce: () => (++counter).toString(16).padStart(32, "a"),
  };
  /** The wallet signs what the transaction request returned, and the lock lands. */
  /** `slot` is where the lock transaction landed; the escrow records CURRENT_SLOT - 10 as its created slot. */
  function walletSignsAndLands(base64: string, payer: Keypair, signature = LOCK_SIG, slot = Number(CURRENT_SLOT - BigInt(10))) {
    const tx = Transaction.from(Buffer.from(base64, "base64"));
    tx.partialSign(payer);
    landed.push({ signature, tx, slot });
    const lockIx = tx.instructions.find((ix) => ix.programId.equals(SANDBOX_ESCROW_PROGRAM_ID))!;
    const amount = Buffer.from(lockIx.data).readBigUInt64LE(8);
    const nonce = lockIx.data.subarray(16, 32);
    accounts.set(lockIx.keys[0].pubkey.toBase58(), { owner: SANDBOX_ESCROW_PROGRAM_ID, data: escrowBytes(payer.publicKey, lockIx.keys[2].pubkey, amount, nonce) });
    return tx;
  }
  return { accounts, settles, connection, deps, walletSignsAndLands, landed, deployment };
}

async function started(w: ReturnType<typeof world>, taskId = "security-check") {
  const s = await startTry({ taskId, origin: ORIGIN, secret: SECRET, deps: w.deps, nowMs: NOW_MS });
  if (!s.ok) throw new Error(s.message);
  return s;
}

describe("try page: Solana Pay transaction request flow (#925)", () => {
  it("one signature from the wallet pays for one answer, settled at actual cost", async () => {
    const w = world();
    const s = await started(w);
    const payer = Keypair.generate();
    const built = await buildTryTransaction({ token: s.token, account: payer.publicKey.toBase58(), secret: SECRET, connection: w.connection, nowMs: NOW_MS });
    if (!built.ok) throw new Error(built.message);

    const tx = Transaction.from(Buffer.from(built.transaction, "base64"));
    expect(tx.feePayer?.equals(payer.publicKey)).toBe(true);
    expect(tx.instructions).toHaveLength(4);
    // The budget comes first, where wallets' transaction checkers expect it.
    const [limit, price, lock, memo] = tx.instructions;
    // An explicit, small compute budget, so the wallet does not add a priority fee larger than the call.
    expect(limit.programId.equals(ComputeBudgetProgram.programId) && price.programId.equals(ComputeBudgetProgram.programId)).toBe(true);
    expect(Buffer.from(limit.data)).toEqual(Buffer.from(ComputeBudgetProgram.setComputeUnitLimit({ units: TRY_LOCK_COMPUTE_UNITS }).data));
    expect(Buffer.from(price.data)).toEqual(Buffer.from(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: TRY_LOCK_MICRO_LAMPORTS_PER_UNIT }).data));
    expect((TRY_LOCK_COMPUTE_UNITS * TRY_LOCK_MICRO_LAMPORTS_PER_UNIT) / 1_000_000).toBeLessThan(5_000);
    const escrow = sandboxEscrowAddress(payer.publicKey, s.ticket.nonce);
    expect(lock.keys[0].pubkey.equals(escrow)).toBe(true);
    expect(lock.keys.at(-1)).toEqual({ pubkey: new PublicKey(s.ticket.reference), isSigner: false, isWritable: false });
    expect(memo.programId.equals(MEMO_PROGRAM_ID)).toBe(true);
    expect(memo.data.toString("utf8")).toBe(
      sessionDelegationMemo({ genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", escrow: escrow.toBase58(), provider: s.provider.payTo, sessionKey: relayKeypair(s.ticket.id, SECRET).publicKey.toBase58(), expiresAt: s.ticket.exp }),
    );

    expect(await runTry({ token: s.token, origin: ORIGIN, secret: SECRET, connection: w.connection, deps: w.deps, nowMs: NOW_MS })).toEqual({ ok: true, state: "waiting" });

    w.walletSignsAndLands(built.transaction, payer);
    const result = await runTry({ token: s.token, origin: ORIGIN, secret: SECRET, connection: w.connection, deps: w.deps, nowMs: NOW_MS });
    expect((result as { receipt?: unknown }).receipt).toBeDefined();
    expect(result).toMatchObject({ ok: true, state: "answered", status: 200, payer: payer.publicKey.toBase58(), escrow: escrow.toBase58(), lockSignature: LOCK_SIG });
    expect(w.settles).toHaveLength(1);
    expect(w.settles[0].escrow.equals(escrow)).toBe(true);
    expect(w.settles[0].actualLamports).toBeLessThanOrEqual(BigInt(s.ticket.maxLamports));

    // The same lock pays once, and a repeat poll gets the same answer back (S2-14).
    const again = await runTry({ token: s.token, origin: ORIGIN, secret: SECRET, connection: w.connection, deps: w.deps, nowMs: NOW_MS });
    expect(again).toEqual(result);
    expect(w.settles).toHaveLength(1);
  });

  it("answers polls that overlap or repeat with the one call, and says settled where the answer is not held (S2-14)", async () => {
    const w = world();
    const s = await started(w);
    const payer = Keypair.generate();
    const built = await buildTryTransaction({ token: s.token, account: payer.publicKey.toBase58(), secret: SECRET, connection: w.connection, nowMs: NOW_MS });
    if (!built.ok) throw new Error(built.message);
    w.walletSignsAndLands(built.transaction, payer);
    const cache = new TryRunCache();
    const poll = (c = cache) => runTry({ token: s.token, origin: ORIGIN, secret: SECRET, connection: w.connection, deps: w.deps, nowMs: NOW_MS, cache: c });
    // The page resends while the first poll is still being served.
    const [first, second] = await Promise.all([poll(), poll()]);
    expect(first).toMatchObject({ state: "answered", status: 200 });
    expect(second).toEqual(first);
    expect(w.settles).toHaveLength(1);
    // The settle lands; another server instance, without the answer, now sees a closed escrow.
    const escrow = sandboxEscrowAddress(payer.publicKey, s.ticket.nonce).toBase58();
    w.accounts.delete(escrow);
    expect(await poll(new TryRunCache())).toEqual({ ok: true, state: "settled", lockSignature: LOCK_SIG, payer: payer.publicKey.toBase58(), escrow });
    expect(w.settles).toHaveLength(1);
  });

  it("calls again after a refusal while the escrow is still locked, instead of keeping it (S2-14)", async () => {
    const w = world();
    const s = await started(w);
    const payer = Keypair.generate();
    const built = await buildTryTransaction({ token: s.token, account: payer.publicKey.toBase58(), secret: SECRET, connection: w.connection, nowMs: NOW_MS });
    if (!built.ok) throw new Error(built.message);
    w.walletSignsAndLands(built.transaction, payer);
    const cache = new TryRunCache();
    const poll = () => runTry({ token: s.token, origin: ORIGIN, secret: SECRET, connection: w.connection, deps: w.deps, nowMs: NOW_MS, cache });
    // Devnet reads fail once: the provider refuses without taking anything and asks for the same receipt again.
    const readAccount = w.deps.readAccount!;
    let failReads = 1;
    w.deps.readAccount = async (address) => {
      if (failReads > 0) {
        failReads -= 1;
        throw new Error("devnet unreachable");
      }
      return readAccount(address);
    };
    expect(await poll()).toMatchObject({ state: "answered", status: 402 });
    expect(w.settles).toHaveLength(0);
    expect(await poll()).toMatchObject({ state: "answered", status: 200 });
    expect(w.settles).toHaveLength(1);
  });

  it("walks back past a full page of later transactions to find the lock (S2-15)", async () => {
    const w = world();
    const s = await started(w);
    const payer = Keypair.generate();
    const built = await buildTryTransaction({ token: s.token, account: payer.publicKey.toBase58(), secret: SECRET, connection: w.connection, nowMs: NOW_MS });
    if (!built.ok) throw new Error(built.message);
    w.walletSignsAndLands(built.transaction, payer);
    const reference = new PublicKey(s.ticket.reference);
    // Page size 3: 12 decoys after the lock fill four pages, newest first.
    for (let i = 0; i < 12; i++) {
      const decoy = Keypair.generate();
      const tx = new Transaction({ feePayer: decoy.publicKey, blockhash: BLOCKHASH, lastValidBlockHeight: 100 }).add({ programId: MEMO_PROGRAM_ID, keys: [{ pubkey: reference, isSigner: false, isWritable: false }], data: Buffer.from(`decoy ${i}`) });
      tx.partialSign(decoy);
      w.landed.unshift({ signature: `${i + 10}`.padStart(88, "7"), tx, slot: Number(CURRENT_SLOT) });
    }
    const cache = new TryRunCache();
    let result: Awaited<ReturnType<typeof runTry>> = { ok: true, state: "waiting" };
    let polls = 0;
    while (polls < 10 && result.ok && result.state === "waiting") {
      result = await runTry({ token: s.token, origin: ORIGIN, secret: SECRET, connection: w.connection, deps: w.deps, nowMs: NOW_MS, cache, pageSize: 3 });
      polls += 1;
    }
    expect(result).toMatchObject({ state: "answered", status: 200, lockSignature: LOCK_SIG });
    expect(polls).toBeLessThanOrEqual(5);
  });

  it("finds the lock behind 25 transactions that name the reference, reading a few per poll (S2-15)", async () => {
    const w = world();
    const s = await started(w);
    const payer = Keypair.generate();
    const built = await buildTryTransaction({ token: s.token, account: payer.publicKey.toBase58(), secret: SECRET, connection: w.connection, nowMs: NOW_MS });
    if (!built.ok) throw new Error(built.message);
    w.walletSignsAndLands(built.transaction, payer);
    const reference = new PublicKey(s.ticket.reference);
    for (let i = 0; i < 25; i++) {
      const decoy = Keypair.generate();
      const tx = new Transaction({ feePayer: decoy.publicKey, blockhash: BLOCKHASH, lastValidBlockHeight: 100 }).add({ programId: MEMO_PROGRAM_ID, keys: [{ pubkey: reference, isSigner: false, isWritable: false }], data: Buffer.from(`decoy ${i}`) });
      tx.partialSign(decoy);
      // Newest first, as RPC lists them: decoys land after the lock.
      w.landed.unshift({ signature: `${i + 10}`.padStart(88, "7"), tx, slot: Number(CURRENT_SLOT) });
    }
    let reads = 0;
    const counted = { ...w.connection, getTransaction: async (sig: string) => { reads += 1; return w.connection.getTransaction(sig); } };
    const result = await runTry({ token: s.token, origin: ORIGIN, secret: SECRET, connection: counted, deps: w.deps, nowMs: NOW_MS, cache: new TryRunCache() });
    expect(result).toMatchObject({ state: "answered", status: 200 });
    expect(reads).toBeLessThanOrEqual(TRY_READS_PER_POLL);
  });

  it("reads each decoy once per ticket, so stuffing cannot fan out RPC reads (S2-15)", async () => {
    const w = world();
    const s = await started(w);
    const reference = new PublicKey(s.ticket.reference);
    for (let i = 0; i < 10; i++) {
      const decoy = Keypair.generate();
      const tx = new Transaction({ feePayer: decoy.publicKey, blockhash: BLOCKHASH, lastValidBlockHeight: 100 }).add({ programId: MEMO_PROGRAM_ID, keys: [{ pubkey: reference, isSigner: false, isWritable: false }], data: Buffer.from(`decoy ${i}`) });
      tx.partialSign(decoy);
      w.landed.unshift({ signature: `${i + 10}`.padStart(88, "7"), tx, slot: Number(CURRENT_SLOT) });
    }
    let reads = 0;
    const counted = { ...w.connection, getTransaction: async (sig: string) => { reads += 1; return w.connection.getTransaction(sig); } };
    const cache = new TryRunCache();
    for (let i = 0; i < 6; i++) expect(await runTry({ token: s.token, origin: ORIGIN, secret: SECRET, connection: counted, deps: w.deps, nowMs: NOW_MS, cache })).toEqual({ ok: true, state: "waiting" });
    expect(reads).toBe(10);
  });

  it("refuses a lock transaction that did not create the escrow now at that address", async () => {
    const w = world();
    const s = await started(w);
    const payer = Keypair.generate();
    const built = await buildTryTransaction({ token: s.token, account: payer.publicKey.toBase58(), secret: SECRET, connection: w.connection, nowMs: NOW_MS });
    if (!built.ok) throw new Error(built.message);
    // The memo is right, but the transaction landed before the escrow at that address was created.
    w.walletSignsAndLands(built.transaction, payer, LOCK_SIG, Number(CURRENT_SLOT - BigInt(500)));
    const result = await runTry({ token: s.token, origin: ORIGIN, secret: SECRET, connection: w.connection, deps: w.deps, nowMs: NOW_MS });
    expect(result).toMatchObject({ ok: true, state: "answered" });
    expect((result as { status: number }).status).not.toBe(200);
    expect(w.settles).toHaveLength(0);
  });

  it("skips a stranger's transaction that names the public reference, then serves the real lock", async () => {
    const w = world();
    const s = await started(w);
    const payer = Keypair.generate();
    const stranger = Keypair.generate();
    // The stranger asks for its own lock under this ticket, then lands it first.
    const theirs = await buildTryTransaction({ token: s.token, account: stranger.publicKey.toBase58(), secret: SECRET, connection: w.connection, nowMs: NOW_MS });
    if (!theirs.ok) throw new Error(theirs.message);
    const tampered = Transaction.from(Buffer.from(theirs.transaction, "base64"));
    const noMemo = new Transaction({ feePayer: stranger.publicKey, blockhash: BLOCKHASH, lastValidBlockHeight: 100 }).add(tampered.instructions.find((ix) => ix.programId.equals(SANDBOX_ESCROW_PROGRAM_ID))!);
    w.walletSignsAndLands(noMemo.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), stranger, "5".repeat(88));
    expect(await runTry({ token: s.token, origin: ORIGIN, secret: SECRET, connection: w.connection, deps: w.deps, nowMs: NOW_MS })).toEqual({ ok: true, state: "waiting" });
    const mine = await buildTryTransaction({ token: s.token, account: payer.publicKey.toBase58(), secret: SECRET, connection: w.connection, nowMs: NOW_MS });
    if (!mine.ok) throw new Error(mine.message);
    w.walletSignsAndLands(mine.transaction, payer);
    const result = await runTry({ token: s.token, origin: ORIGIN, secret: SECRET, connection: w.connection, deps: w.deps, nowMs: NOW_MS });
    expect(result).toMatchObject({ state: "answered", status: 200, payer: payer.publicKey.toBase58() });
    expect(w.settles).toHaveLength(1);
  });

  it("does not serve a lock whose memo delegates to another key", async () => {
    const w = world();
    const s = await started(w);
    const payer = Keypair.generate();
    const built = await buildTryTransaction({ token: s.token, account: payer.publicKey.toBase58(), secret: SECRET, connection: w.connection, nowMs: NOW_MS });
    if (!built.ok) throw new Error(built.message);
    w.walletSignsAndLands(built.transaction, payer);
    // Another server secret derives another relay key, so its signature does not match the memo.
    const result = await runTry({ token: sealTicket(s.ticket, Buffer.alloc(32, 9)), origin: ORIGIN, secret: Buffer.alloc(32, 9), connection: w.connection, deps: w.deps, nowMs: NOW_MS });
    expect(result).toEqual({ ok: true, state: "waiting" });
    expect(w.settles).toHaveLength(0);
  });

  it("does not serve a lock without the memo", async () => {
    const w = world();
    const s = await started(w);
    const payer = Keypair.generate();
    const built = await buildTryTransaction({ token: s.token, account: payer.publicKey.toBase58(), secret: SECRET, connection: w.connection, nowMs: NOW_MS });
    if (!built.ok) throw new Error(built.message);
    const stripped = Transaction.from(Buffer.from(built.transaction, "base64"));
    const withoutMemo = new Transaction({ feePayer: payer.publicKey, blockhash: BLOCKHASH, lastValidBlockHeight: 100 }).add(stripped.instructions.find((ix) => ix.programId.equals(SANDBOX_ESCROW_PROGRAM_ID))!);
    w.walletSignsAndLands(withoutMemo.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), payer);
    const result = await runTry({ token: s.token, origin: ORIGIN, secret: SECRET, connection: w.connection, deps: w.deps, nowMs: NOW_MS });
    expect(result).toEqual({ ok: true, state: "waiting" });
    expect(w.settles).toHaveLength(0);
  });

  it("does not start a paid try while devnet runs a program build the sandbox cannot settle with (audit S7-Codex-R2-06)", async () => {
    const w = world();
    w.deployment.check = { ok: false, message: "paused" };
    const s = await startTry({ taskId: "security-check", origin: ORIGIN, secret: SECRET, deps: w.deps, nowMs: NOW_MS });
    expect(s).toMatchObject({ ok: false, status: 503, code: "paid_try_paused" });
  });

  it("refuses tampered, foreign and expired tickets, and unknown tasks", async () => {
    const w = world();
    const s = await started(w);
    const [payload, tag] = s.token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...s.ticket, maxLamports: "1" })).toString("base64url");
    expect(openTicket(`${forged}.${tag}`, SECRET, NOW_MS)).toBeUndefined();
    expect(openTicket(`${payload}.${tag}`, Buffer.alloc(32, 1), NOW_MS)).toBeUndefined();
    expect(openTicket(s.token, SECRET, (s.ticket.exp + 1) * 1000)).toBeUndefined();
    expect(openTicket(s.token, SECRET, NOW_MS)).toEqual(s.ticket);
    const built = await buildTryTransaction({ token: `${forged}.${tag}`, account: Keypair.generate().publicKey.toBase58(), secret: SECRET, connection: w.connection, nowMs: NOW_MS });
    expect(built).toMatchObject({ ok: false, code: "ticket_invalid" });
    expect(await buildTryTransaction({ token: s.token, account: "not-a-key", secret: SECRET, connection: w.connection, nowMs: NOW_MS })).toMatchObject({ ok: false, code: "account_invalid" });
    expect(await startTry({ taskId: "nope", origin: ORIGIN, secret: SECRET, deps: w.deps })).toMatchObject({ ok: false, code: "unknown_task" });
  });

  it("the pull-request task costs far more than the lock's network fee", () => {
    const task = TRY_TASKS.find((t) => t.id === "pr-review")!;
    const provider = SANDBOX_PROVIDERS.find((p) => p.id === task.providerId)!;
    const inputTokens = requestInputTokens([{ content: task.prompt }]);
    const outputTokens = countTokens(scriptedSandboxAnswer(provider, task.prompt));
    const cost = sessionCallLamports(provider, { inputTokens, outputTokens });
    // Base fee 5,000 lamports plus 80 lamports of priority at the try page's compute budget.
    const lockNetworkFee = BigInt(5_000 + (TRY_LOCK_COMPUTE_UNITS * TRY_LOCK_MICRO_LAMPORTS_PER_UNIT) / 1_000_000);
    expect(inputTokens).toBeGreaterThan(4_000);
    expect(cost > lockNetworkFee * BigInt(20)).toBe(true);
  });

  it("every task has a provider and a challenge", async () => {
    for (const task of TRY_TASKS) {
      const s = await started(world(), task.id);
      expect(BigInt(s.ticket.maxLamports) > BigInt(0)).toBe(true);
      expect(escrowNonceBytes(s.ticket.nonce)).toHaveLength(16);
    }
  });

  it("builds a Solana Pay link and needs a secret", () => {
    const { payUrl, solanaPayUrl } = solanaPayLink(ORIGIN, "a.b");
    expect(payUrl).toBe(`${ORIGIN}/api/try/v1/pay?t=a.b`);
    expect(solanaPayUrl).toBe(`solana:${encodeURIComponent(payUrl)}`);
    expect(() => trySecret({})).toThrow(TryNotConfiguredError);
    expect(() => trySecret({ TRY_RELAY_SECRET: "x".repeat(31) })).toThrow(TryNotConfiguredError);
    // Never derived from the sandbox's signing keys.
    expect(() => trySecret({ SANDBOX_DEVNET_PAYEE_KEYS: "k".repeat(64), SANDBOX_PAYEE_KEYS: "k".repeat(64) })).toThrow(TryNotConfiguredError);
    expect(trySecret({ TRY_RELAY_SECRET: "x".repeat(32) })).toEqual(Buffer.from("x".repeat(32)));
  });

  it("builds and reads nothing unless the RPC is devnet", async () => {
    const mainnet = await devnetOrResponse({ getGenesisHash: async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" });
    expect(mainnet?.status).toBe(503);
    expect(await mainnet?.json()).toMatchObject({ error: { code: "not_devnet" } });
    const down = await devnetOrResponse({ getGenesisHash: async () => { throw new Error("rpc"); } });
    expect(down?.status).toBe(503);
    expect(await devnetOrResponse({ getGenesisHash: async () => "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" })).toBeUndefined();
  });
});
