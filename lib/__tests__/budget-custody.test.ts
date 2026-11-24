/**
 * @jest-environment node
 */
import { createHash, createHmac, generateKeyPairSync, randomBytes, sign as nodeSign, type KeyObject } from "crypto";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { BUDGET_DISCRIMINATORS, SECP256R1_PROGRAM_ID, budgetAddress, budgetApprovalMessage, compressP256PublicKey, reservationAddress } from "@redditech/x402-solana/budget";
import { checkReserveTransaction, readSecp256r1Approval } from "@redditech/x402-solana/budget-provider";
import { ed25519Sign, p256Verify } from "@redditech/x402-solana/ed25519";
import { signReddiReceiptV2, type ReddiReceiptV2 } from "@redditech/agent-protocol";
import { sendBudgetAlert, signWebhookBody, type AlertDeps, type AlertSender } from "@/lib/budget/alerts";
import {
  APPROVAL_SLOTS,
  WAIVE_APPROVAL_SLOTS,
  activateSpender,
  approveAsSpender,
  createSpender,
  pausedByEnv,
  relayAuthorizationMessage,
  type ApprovalRequest,
  type CustodyDeps,
} from "@/lib/budget/custody";
import { buildDisputeTransaction } from "@/lib/budget/dispute";
import { closeAllBudgets } from "@/lib/budget/incident";
import { parseP256PublicKey, readKmsSigner, type SpenderSigner } from "@/lib/budget/kms";
import { GENESIS_HASH, MemoryBudgetCustodyStore, type BudgetContact } from "@/lib/budget/store";
import { base58, GONE_CONFIRM_MS, KEY_ROTATED_REPEAT_MS, watchBudgets, type BudgetChainReader } from "@/lib/budget/watch";
import { BUDGET_PAID_EVENT, decodeBudgetPaid, programDataLogs, verifyAndRecordBudgetCall } from "@/lib/jobs/budget-call";

const PROGRAM = Keypair.generate().publicKey;

/** A stand-in for the Vercel KMS issuer: a P-256 key that signs ES256 (DER, possibly high S, as KMS may). */
function kmsKey(): SpenderSigner & { calls: number; fail?: boolean; hex: string; pem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const key: KeyObject = privateKey;
  const compressed = compressP256PublicKey(publicKey.export({ format: "der", type: "spki" }).subarray(-65));
  const signer = {
    publicKey: compressed,
    hex: Buffer.from(compressed).toString("hex"),
    pem: String(publicKey.export({ format: "pem", type: "spki" })),
    calls: 0,
    fail: false,
    async sign(message: Uint8Array) {
      signer.calls += 1;
      if (signer.fail) throw new Error("KMS 503");
      return Uint8Array.from(nodeSign("sha256", message, key));
    },
  };
  return signer;
}
const KMS = kmsKey();
const NOW_MS = Date.UTC(2026, 10, 25, 1, 0, 0);
const NOW_S = Math.floor(NOW_MS / 1000);
const CREATED = BigInt(5_000_000);
const SLOT = CREATED + BigInt(100);
const ORIGIN = "https://app.example";
const BLOCKHASH = Keypair.generate().publicKey.toBase58();
const DEVNET = GENESIS_HASH["solana-devnet"];

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

type BudgetBytes = { payer: PublicKey; spender: PublicKey; judge?: PublicKey; mint?: PublicKey; total?: bigint; unreserved?: bigint; closed?: boolean; closedSlot?: bigint; createdSlot?: bigint; ed25519Spender?: boolean; allowlist?: string[] };
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
  (b.allowlist ?? []).forEach((p, i) => new PublicKey(p).toBuffer().copy(d, 208 + 32 * i));
  d.writeBigUInt64LE(b.closedSlot ?? BigInt(0), 336);
  d[346] = (b.closed ? 0x02 : 0) | (b.ed25519Spender ? 0 : 0x08);
  return Uint8Array.from(d);
}

type SliceBytes = { budget: PublicKey; payee: PublicKey; reserved: bigint; state?: number; finalAmount?: bigint; postedSlot?: bigint; createdSlot?: bigint; waived?: boolean };
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
  d[145] = r.waived ? 1 : 0;
  return Uint8Array.from(d);
}

type Accounts = Map<string, { owner: PublicKey; data: Uint8Array }>;
function fakeChain() {
  const accounts: Accounts = new Map();
  const sentTxs: Transaction[] = [];
  let slot = SLOT;
  let genesis = DEVNET;
  const chain: BudgetChainReader & { latestBlockhash(): Promise<string>; sendAndConfirm(tx: Transaction): Promise<string> } = {
    async readAccount(a) {
      return accounts.get(a.toBase58()) ?? null;
    },
    async reservations(budget) {
      return [...accounts.entries()]
        .filter(([, v]) => v.data.length === 147 && new PublicKey(v.data.subarray(8, 40)).equals(budget))
        .map(([address, v]) => ({ address: new PublicKey(address), data: v.data }));
    },
    async slot() {
      return slot;
    },
    async genesisHash() {
      return genesis;
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
  return { accounts, chain, sentTxs, setSlot: (s: bigint) => (slot = s), setGenesis: (g: string) => (genesis = g) };
}

function setup(env: Record<string, string | undefined> = {}, signer: SpenderSigner = KMS) {
  const store = new MemoryBudgetCustodyStore();
  const { sent, sender: s, behaviour } = sender();
  const chainParts = fakeChain();
  const deps: CustodyDeps & { alertTimeoutMs: number } = {
    store,
    signer,
    sender: s,
    chain: chainParts.chain,
    env: { ...ALERT_ENV, BUDGET_SPENDER_P256_PUBLIC_KEY: Buffer.from(signer.publicKey).toString("hex"), ...env },
    nowMs: NOW_MS,
    alertTimeoutMs: 50,
  };
  return { store, sent, deps, behaviour, ...chainParts };
}

const WALLET = () => Keypair.generate().publicKey;

type AuthOpts = { payer?: Keypair; signer?: Keypair; providers?: string[]; maxReserve?: bigint; contact?: BudgetContact; issuedAt?: number; nonce?: string; tamper?: (input: Record<string, unknown>) => void };
/** The payer's signed authorization for a new Budget, as a wallet would produce it. */
function authorization(opts: AuthOpts = {}) {
  const payer = opts.payer ?? Keypair.generate();
  const nonce = opts.nonce ?? randomBytes(16).toString("hex");
  const budget = budgetAddress(payer.publicKey, Buffer.from(nonce, "hex"), PROGRAM).toBase58();
  const fields = {
    network: "solana-devnet" as const,
    payer: payer.publicKey.toBase58(),
    budget,
    providers: opts.providers ?? [WALLET().toBase58()],
    maxReserve: opts.maxReserve ?? BigInt(5_000_000),
    contact: opts.contact ?? { email: "payer@example.com" },
    issuedAt: opts.issuedAt ?? NOW_S,
  };
  const signature = Buffer.from(ed25519Sign((opts.signer ?? payer) as unknown as Parameters<typeof ed25519Sign>[0], relayAuthorizationMessage(fields))).toString("base64");
  const input = { ...fields, signature, nonce, programId: PROGRAM };
  opts.tamper?.(input as unknown as Record<string, unknown>);
  return { input, payer };
}

async function openBudget(deps: CustodyDeps, accounts: Accounts, opts: AuthOpts & { judge?: PublicKey; mint?: PublicKey } = {}) {
  const { input, payer } = authorization(opts);
  const made = await createSpender(input, deps);
  if (!made.ok) throw new Error(made.message);
  const budget = new PublicKey(input.budget);
  accounts.set(budget.toBase58(), { owner: PROGRAM, data: budgetBytes({ payer: payer.publicKey, spender: new PublicKey(made.record.spender), judge: opts.judge, mint: opts.mint, allowlist: input.providers }) });
  const active = await activateSpender({ id: made.record.id, programId: PROGRAM, readAccount: async (a) => accounts.get(a.toBase58()) ?? null }, deps);
  if (!active.ok) throw new Error(active.message);
  return { payer: payer.publicKey, budget, record: active.record, spender: new PublicKey(made.record.spender), secret: made.agentSecret, providers: input.providers.map((p) => new PublicKey(p)) };
}

type Opened = Awaited<ReturnType<typeof openBudget>>;
const approve = (deps: CustodyDeps, opened: Pick<Opened, "record" | "secret">, request: ApprovalRequest, secret = opened.secret) =>
  approveAsSpender({ id: opened.record.id, auth: { agentSecret: secret }, request, programId: PROGRAM }, deps);
const reserve = (payee: PublicKey, amount = BigInt(1_000_000)): ApprovalRequest => ({ purpose: "reserve", payee: payee.toBase58(), amount });

describe("Budget spender approvals through Vercel KMS (audit rounds 4 and 5)", () => {
  it("reads the KMS settings, and stores no key material, only the public key the Budget names", async () => {
    expect(readKmsSigner({ BUDGET_SPENDER_KMS_ISSUER_ID: "iss_1" })).toBeUndefined();
    expect(readKmsSigner({ BUDGET_SPENDER_KMS_ISSUER_ID: "iss_1", BUDGET_SPENDER_P256_PUBLIC_KEY: "zz" })).toBeUndefined();
    expect(readKmsSigner({ BUDGET_SPENDER_KMS_ISSUER_ID: "iss_1", BUDGET_SPENDER_P256_PUBLIC_KEY: KMS.hex })?.publicKey).toEqual(KMS.publicKey);
    expect(parseP256PublicKey(Buffer.from(KMS.publicKey).toString("base64"))).toEqual(KMS.publicKey);
    // The PEM as the issuer shows it, also with escaped newlines as an env value may hold it.
    expect(parseP256PublicKey(KMS.pem)).toEqual(KMS.publicKey);
    expect(parseP256PublicKey(KMS.pem.replace(/\n/g, "\\n"))).toEqual(KMS.publicKey);
    expect(parseP256PublicKey(KMS.pem.replace("PUBLIC KEY-----\nM", "PUBLIC KEY-----\nN"))).toBeUndefined();

    const { store, deps } = setup();
    expect(await createSpender(authorization({ contact: {} }).input, deps)).toMatchObject({ ok: false, code: "contact_required" });
    expect(await createSpender(authorization({ contact: { webhook: "http://x.example" } }).input, deps)).toMatchObject({ ok: false, code: "contact_required" });
    expect(await createSpender(authorization().input, { ...deps, signer: undefined })).toMatchObject({ ok: false, code: "custody_not_configured" });
    const made = await createSpender(authorization().input, deps);
    if (!made.ok) throw new Error(made.message);
    const stored = (await store.byId(made.record.id))!;
    expect(stored.status).toBe("pending");
    expect(stored.spenderKey).toBe(KMS.hex);
    expect(stored.spender).toBe(new PublicKey(createHash("sha256").update(KMS.publicKey).digest()).toBase58());
    expect(made.agentSecret).toMatch(/^rap_budget_[A-Za-z0-9_-]{43}$/);
    // Only the secret's hash is kept.
    expect(JSON.stringify(stored)).not.toContain(made.agentSecret.slice("rap_budget_".length));
    expect(stored.agentSecretSha256).toBe(createHash("sha256").update(made.agentSecret).digest("hex"));
    expect(JSON.stringify(stored)).not.toMatch(/sealed|seed/i);
  });

  it("R5-M1: makes a record only on the payer's own signature, pinned to the payer's Budget, one record per Budget", async () => {
    const { deps, accounts } = setup();
    const read = async (a: PublicKey) => accounts.get(a.toBase58()) ?? null;
    // Someone else's signature, or a field changed after signing.
    expect(await createSpender(authorization({ signer: Keypair.generate() }).input, deps)).toMatchObject({ ok: false, code: "not_the_payer" });
    expect(await createSpender(authorization({ tamper: (i) => (i.contact = { email: "attacker@example.com" }) }).input, deps)).toMatchObject({ ok: false, code: "not_the_payer" });
    expect(await createSpender(authorization({ tamper: (i) => (i.providers = [WALLET().toBase58()]) }).input, deps)).toMatchObject({ ok: false, code: "not_the_payer" });
    expect(await createSpender(authorization({ tamper: (i) => (i.maxReserve = BigInt(9_000_000)) }).input, deps)).toMatchObject({ ok: false, code: "not_the_payer" });
    // Too old, or a Budget that is not the payer's own address for the nonce.
    expect(await createSpender(authorization({ issuedAt: NOW_S - 601 }).input, deps)).toMatchObject({ ok: false, code: "authorization_expired" });
    expect(await createSpender(authorization({ tamper: (i) => (i.nonce = randomBytes(16).toString("hex")) }).input, deps)).toMatchObject({ ok: false, code: "budget_mismatch" });
    // A relay Budget needs an allowlist: the providers, at most four.
    expect(await createSpender(authorization({ providers: [] }).input, deps)).toMatchObject({ ok: false, code: "providers_required" });
    expect(await createSpender(authorization({ providers: Array.from({ length: 5 }, () => WALLET().toBase58()) }).input, deps)).toMatchObject({ ok: false, code: "too_many_providers" });
    expect(await createSpender(authorization({ maxReserve: BigInt(0) }).input, deps)).toMatchObject({ ok: false, code: "invalid_amount" });

    const victim = authorization();
    const made = await createSpender(victim.input, deps);
    if (!made.ok) throw new Error(made.message);
    expect(made.record.budget).toBe(victim.input.budget);
    // Replaying the same signed authorization makes no second record for that Budget.
    expect(await createSpender(victim.input, deps)).toMatchObject({ ok: false, code: "budget_taken" });

    // Activation reads the pinned Budget: it must name the payer, the P-256 spender and exactly the providers signed for.
    const spender = new PublicKey(made.record.spender);
    const budget = victim.input.budget;
    accounts.set(budget, { owner: PROGRAM, data: budgetBytes({ payer: WALLET(), spender, allowlist: victim.input.providers }) });
    expect(await activateSpender({ id: made.record.id, programId: PROGRAM, readAccount: read }, deps)).toMatchObject({ ok: false, code: "budget_mismatch" });
    accounts.set(budget, { owner: PROGRAM, data: budgetBytes({ payer: victim.payer.publicKey, spender, ed25519Spender: true, allowlist: victim.input.providers }) });
    expect(await activateSpender({ id: made.record.id, programId: PROGRAM, readAccount: read }, deps)).toMatchObject({ ok: false, code: "budget_not_p256" });
    accounts.set(budget, { owner: PROGRAM, data: budgetBytes({ payer: victim.payer.publicKey, spender }) });
    expect(await activateSpender({ id: made.record.id, programId: PROGRAM, readAccount: read }, deps)).toMatchObject({ ok: false, code: "allowlist_mismatch" });
    accounts.set(budget, { owner: PROGRAM, data: budgetBytes({ payer: victim.payer.publicKey, spender, allowlist: [...victim.input.providers, WALLET().toBase58()] }) });
    expect(await activateSpender({ id: made.record.id, programId: PROGRAM, readAccount: read }, deps)).toMatchObject({ ok: false, code: "allowlist_mismatch" });
    accounts.set(budget, { owner: PROGRAM, data: budgetBytes({ payer: victim.payer.publicKey, spender, allowlist: victim.input.providers }) });
    expect(await activateSpender({ id: made.record.id, programId: PROGRAM, readAccount: read }, deps)).toMatchObject({ ok: true });
  });

  it("approves a reserve for a provider the payer named, up to the payer's maximum, only with the agent's secret, logged with what it allowed", async () => {
    const { store, sent, deps, accounts } = setup();
    const named = WALLET();
    const opened = await openBudget(deps, accounts, { providers: [named.toBase58()], maxReserve: BigInt(2_000_000) });
    const { budget, record } = opened;

    const approved = await approve(deps, opened, reserve(named));
    if (!approved.ok) throw new Error(approved.message);
    expect(approved).toMatchObject({ purpose: "reserve", expiresSlot: SLOT + APPROVAL_SLOTS });
    const [pre, call] = approved.instructions;
    expect(pre.programId.equals(SECP256R1_PROGRAM_ID)).toBe(true);
    const read = readSecp256r1Approval(pre)!;
    expect(Buffer.from(read.publicKey).toString("hex")).toBe(KMS.hex);
    expect(read.message).toEqual(budgetApprovalMessage({ programId: PROGRAM, budget, createdSlot: CREATED, action: "reserve", payee: named, amount: BigInt(1_000_000), expiresSlot: SLOT + APPROVAL_SLOTS, cluster: "devnet" }));
    expect(p256Verify(read.publicKey, read.message, read.signature)).toBe(true);
    expect(call.keys[2].isSigner).toBe(false);
    // The log keeps the approval itself and what it allowed (S6-claude-05).
    expect(store.uses).toEqual([
      expect.objectContaining({
        purpose: "reserve",
        payee: named.toBase58(),
        messageSha256: createHash("sha256").update(read.message).digest("hex"),
        detail: expect.objectContaining({ message: Buffer.from(read.message).toString("hex"), amount: "1000000", expiresSlot: (SLOT + APPROVAL_SLOTS).toString(), createdSlot: CREATED.toString(), caller: "agent" }),
      }),
    ]);

    // The provider builds the transaction around it and its kit's check passes it.
    const tx = new Transaction({ feePayer: named, recentBlockhash: BLOCKHASH }).add(pre, call);
    const check = (cluster: "devnet" | "mainnet") =>
      checkReserveTransaction({
        transactionBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
        programId: PROGRAM, budget, createdSlot: CREATED, spender: new PublicKey(record.spender), payee: named, payoutAccount: named, minAmount: BigInt(1), maxAmount: BigInt(1_000_000), p256: { cluster },
      });
    expect(check("devnet")).toMatchObject({ ok: true, amount: BigInt(1_000_000) });
    // Read as a mainnet build, the same approval is refused.
    expect(check("mainnet")).toMatchObject({ ok: false });

    // Before KMS is asked: no secret or the wrong one, the operator path, above the maximum, someone the payer did not name.
    const calls = KMS.calls;
    expect(await approve(deps, opened, reserve(named), "rap_budget_wrong")).toMatchObject({ ok: false, code: "not_authorized" });
    expect(await approve(deps, opened, reserve(named), "")).toMatchObject({ ok: false, code: "not_authorized" });
    expect(await approveAsSpender({ id: record.id, auth: { operator: "incident" }, request: reserve(named), programId: PROGRAM }, deps)).toMatchObject({ ok: false, code: "not_authorized" });
    expect(await approve(deps, opened, reserve(named, BigInt(2_000_001)))).toMatchObject({ ok: false, code: "above_max_reserve" });
    const stranger = WALLET();
    expect(await approve(deps, opened, reserve(stranger))).toMatchObject({ ok: false, code: "unexpected_payee" });
    expect(await approve(deps, opened, { purpose: "waive", payee: stranger.toBase58(), amount: BigInt(1) })).toMatchObject({ ok: false, code: "unexpected_payee" });
    expect(sent.some((s) => s.to === "ops@example.com" && /did not name/.test(s.subject))).toBe(true);
    expect(await approve(deps, opened, reserve(named, BigInt(0)))).toMatchObject({ ok: false, code: "invalid_amount" });
    expect(await approve(deps, opened, { purpose: "reserve", payee: "not-an-address", amount: BigInt(1) })).toMatchObject({ ok: false, code: "invalid_payee" });
    expect(KMS.calls).toBe(calls);
    expect(store.uses).toHaveLength(1);
  });

  it("R5-L1: approves a waive only for a slice that posted the amount the agent names, with a short expiry", async () => {
    const { deps, accounts } = setup();
    const named = WALLET();
    const opened = await openBudget(deps, accounts, { providers: [named.toBase58()] });
    const { budget, payer, spender } = opened;
    const waive = (amount: bigint) => approve(deps, opened, { purpose: "waive", payee: named.toBase58(), amount });
    const slice = reservationAddress(budget, named, PROGRAM).toBase58();
    const calls = KMS.calls;
    expect(await waive(BigInt(900))).toMatchObject({ ok: false, code: "slice_not_found" });
    accounts.set(slice, { owner: PROGRAM, data: sliceBytes({ budget, payee: named, reserved: BigInt(1_000) }) });
    expect(await waive(BigInt(900))).toMatchObject({ ok: false, code: "slice_not_posted" });
    accounts.set(slice, { owner: PROGRAM, data: sliceBytes({ budget, payee: named, reserved: BigInt(1_000), state: 1, finalAmount: BigInt(900), postedSlot: CREATED + BigInt(5) }) });
    expect(await waive(BigInt(1_000))).toMatchObject({ ok: false, code: "amount_mismatch" });
    // A slice left from an earlier opening at the same address is not this one.
    accounts.set(slice, { owner: PROGRAM, data: sliceBytes({ budget, payee: named, reserved: BigInt(1_000), state: 1, finalAmount: BigInt(900), createdSlot: BigInt(7) }) });
    expect(await waive(BigInt(900))).toMatchObject({ ok: false, code: "slice_not_found" });
    accounts.set(slice, { owner: PROGRAM, data: sliceBytes({ budget, payee: named, reserved: BigInt(1_000), state: 1, finalAmount: BigInt(900), waived: true }) });
    expect(await waive(BigInt(900))).toMatchObject({ ok: false, code: "slice_not_posted" });
    expect(KMS.calls).toBe(calls);

    accounts.set(slice, { owner: PROGRAM, data: sliceBytes({ budget, payee: named, reserved: BigInt(1_000), state: 1, finalAmount: BigInt(900), postedSlot: CREATED + BigInt(5) }) });
    const ok = await waive(BigInt(900));
    expect(ok).toMatchObject({ ok: true, purpose: "waive", expiresSlot: SLOT + WAIVE_APPROVAL_SLOTS });
    if (ok.ok) expect(ok.instructions[1].keys[1].pubkey.equals(reservationAddress(budget, named, PROGRAM))).toBe(true);
    // Once the Budget is closed on chain, no more waives.
    accounts.set(budget.toBase58(), { owner: PROGRAM, data: budgetBytes({ payer, spender, closed: true, closedSlot: CREATED + BigInt(9), allowlist: [named.toBase58()] }) });
    expect(await waive(BigInt(900))).toMatchObject({ ok: false, code: "budget_not_open" });
  });

  it("S6-claude-03/06: takes the slot from its own RPC, and refuses one on another cluster", async () => {
    const { sent, deps, accounts, setSlot, setGenesis } = setup();
    const opened = await openBudget(deps, accounts);
    const payee = opened.providers[0];
    setSlot(SLOT + BigInt(1_000));
    expect(await approve(deps, opened, reserve(payee))).toMatchObject({ ok: true, expiresSlot: SLOT + BigInt(1_000) + APPROVAL_SLOTS });
    setGenesis(GENESIS_HASH["solana-mainnet-beta"]);
    const calls = KMS.calls;
    expect(await approve(deps, opened, reserve(payee, BigInt(2_000_000)))).toMatchObject({ ok: false, code: "wrong_cluster" });
    expect(sent.some((s) => s.to === "ops@example.com" && /wrong|not on this Budget's cluster/.test(s.subject))).toBe(true);
    expect(await approve({ ...deps, chain: undefined }, opened, reserve(payee, BigInt(2_000_000)))).toMatchObject({ ok: false, code: "chain_unavailable" });
    expect(KMS.calls).toBe(calls);
  });

  it("approves nothing while paused or when the use cannot be logged, freezes an overused Budget, and pauses at the global ceiling", async () => {
    const { store, sent, deps, accounts } = setup({ BUDGET_SPENDER_MAX_USES_PER_10_MIN: "3" });
    const opened = await openBudget(deps, accounts, { providers: [WALLET(), WALLET(), WALLET(), WALLET()].map((w) => w.toBase58()) });
    const p = opened.providers;
    expect(await approve({ ...deps, env: { ...deps.env, BUDGET_SPENDING_PAUSED: "true" } }, opened, reserve(p[0]))).toMatchObject({ ok: false, code: "budgets_paused" });
    await store.setPaused(true, "drill");
    expect(await approve(deps, opened, reserve(p[0]))).toMatchObject({ ok: false, code: "budgets_paused" });
    await store.setPaused(false, "drill over");
    store.failLogs = true;
    const calls = KMS.calls;
    expect(await approve(deps, opened, reserve(p[0]))).toMatchObject({ ok: false, code: "store_unavailable" });
    expect(KMS.calls).toBe(calls);
    store.failLogs = false;
    for (let i = 0; i < 3; i += 1) expect(await approve(deps, opened, reserve(p[i]))).toMatchObject({ ok: true });
    expect(await approve(deps, opened, reserve(p[3]))).toMatchObject({ ok: false, code: "key_overuse" });
    expect((await store.byId(opened.record.id))!.status).toBe("frozen");
    expect(sent.some((s) => s.to === "ops@example.com" && /frozen/.test(s.subject))).toBe(true);
    // Frozen: no reserve, but the close is still approved.
    expect(await approve({ ...deps, nowMs: NOW_MS + 3_600_000 }, opened, reserve(p[3]))).toMatchObject({ ok: false, code: "budget_not_open" });
    const close = await approve(deps, opened, { purpose: "close" });
    expect(close).toMatchObject({ ok: true, purpose: "close" });
    if (close.ok) expect(Buffer.from(close.instructions[1].data.subarray(0, 8))).toEqual(Buffer.from(BUDGET_DISCRIMINATORS["global:close_budget"]));

    // Across all relay Budgets (R5-M2): past the ceiling, spending pauses for everyone and the operator is told.
    const g = setup({ BUDGET_SPENDER_MAX_GLOBAL_PER_10_MIN: "2" });
    const a = await openBudget(g.deps, g.accounts);
    const b = await openBudget(g.deps, g.accounts);
    expect(await approve(g.deps, a, reserve(a.providers[0]))).toMatchObject({ ok: true });
    expect(await approve(g.deps, b, reserve(b.providers[0]))).toMatchObject({ ok: true });
    expect(await approve(g.deps, b, reserve(b.providers[0], BigInt(2_000_000)))).toMatchObject({ ok: false, code: "budgets_paused" });
    expect((await g.store.paused()).paused).toBe(true);
    expect(g.sent.some((s) => s.to === "ops@example.com" && /global approval ceiling/.test(s.subject))).toBe(true);
    expect(await approve(g.deps, a, { purpose: "close" })).toMatchObject({ ok: true });
  });

  it("hands out no approval KMS signed with another key, or when KMS fails, and tells the operator", async () => {
    const { sent, deps, accounts } = setup();
    const opened = await openBudget(deps, accounts);
    const rotated = kmsKey();
    expect(await approve({ ...deps, signer: rotated }, opened, reserve(opened.providers[0]))).toMatchObject({ ok: false, code: "kms_key_mismatch" });
    const down = kmsKey();
    down.fail = true;
    expect(await approve({ ...deps, signer: down }, opened, { purpose: "close" })).toMatchObject({ ok: false, code: "kms_unavailable" });
    const junk: SpenderSigner = { publicKey: KMS.publicKey, sign: async () => new Uint8Array(10) };
    expect(await approve({ ...deps, signer: junk }, opened, { purpose: "close" })).toMatchObject({ ok: false, code: "kms_unavailable" });
    expect(sent.filter((s) => s.to === "ops@example.com" && /KMS approval failed/.test(s.subject))).toHaveLength(3);
  });
});

const watchDeps = (deps: CustodyDeps, chain: BudgetChainReader, nowMs = NOW_MS) => ({ ...deps, nowMs, chain, programId: PROGRAM, origin: ORIGIN });

describe("Budget watcher: the payer hears of every reserve and post", () => {
  it("alerts on a new slice, a raise, a post with a dispute link, once each, and tells the operator of a provider the payer did not name", async () => {
    const { store, sent, deps, accounts, chain } = setup();
    const named = WALLET();
    const judge = WALLET();
    const { record, budget, payer, spender } = await openBudget(deps, accounts, { providers: [named.toBase58()], judge });
    let now = NOW_MS;
    const watch = async () => [...(await watchBudgets(watchDeps(deps, chain, now)))];
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

    // Closed on chain: no more reserves. Gone: the record is closed.
    accounts.set(budget.toBase58(), { owner: PROGRAM, data: budgetBytes({ payer, spender, judge, closed: true, closedSlot: CREATED + BigInt(60), allowlist: [named.toBase58()] }) });
    expect((await watch())[0].status).toBe("closing");
    accounts.delete(budget.toBase58());
    // One missing read keeps the record; missing again four minutes later is proof it is over.
    expect((await watch())[0].status).toBe("closing");
    expect((await store.byId(record.id))!.status).toBe("closing");
    now += GONE_CONFIRM_MS;
    expect((await watch())[0].status).toBe("closed");
    expect((await store.byId(record.id))!.status).toBe("closed");
  });

  it("S6-claude-02: keeps an operator alert no channel took and sends it again every pass", async () => {
    const { store, sent, deps, accounts, chain, behaviour } = setup();
    const { record, budget } = await openBudget(deps, accounts);
    const stranger = WALLET();
    accounts.set(reservationAddress(budget, stranger, PROGRAM).toBase58(), { owner: PROGRAM, data: sliceBytes({ budget, payee: stranger, reserved: BigInt(10) }) });
    behaviour.set("ops@example.com", "failed");
    const first = await watchBudgets(watchDeps(deps, chain));
    expect(first[0]).toMatchObject({ error: "operator_alerts_undelivered" });
    expect((await store.byId(record.id))!.operatorPending).toEqual([expect.objectContaining({ kind: "unexpected_payee" })]);
    expect(await store.watchedAt()).toBeUndefined();
    const second = await watchBudgets(watchDeps(deps, chain));
    expect(second[0]).toMatchObject({ error: "operator_alerts_undelivered" });
    behaviour.set("ops@example.com", "sent");
    const third = await watchBudgets(watchDeps(deps, chain));
    expect(third[0].error).toBeUndefined();
    expect(third[0].alerts).toEqual(["operator:unexpected_payee"]);
    expect((await store.byId(record.id))!.operatorPending).toBeUndefined();
    expect(sent.filter((s) => s.to === "ops@example.com" && /did not name/.test(s.subject))).toHaveLength(3);
    expect(await store.watchedAt()).toBe(new Date(NOW_MS).toISOString());
  });

  it("S6-claude-06: watches nothing through an RPC on another cluster, and tells the operator when many Budgets vanish at once", async () => {
    const { store, sent, deps, accounts, chain, setGenesis } = setup();
    const a = await openBudget(deps, accounts);
    const b = await openBudget(deps, accounts);
    accounts.delete(a.budget.toBase58());
    accounts.delete(b.budget.toBase58());
    setGenesis(GENESIS_HASH["solana-mainnet-beta"]);
    for (const now of [NOW_MS, NOW_MS + GONE_CONFIRM_MS]) {
      const pass = await watchBudgets(watchDeps(deps, chain, now));
      expect(pass.map((r) => r.error)).toEqual(["wrong_cluster", "wrong_cluster"]);
    }
    expect((await store.byId(a.record.id))!.status).toBe("open");
    expect((await store.byId(b.record.id))!.status).toBe("open");
    expect(sent.filter((s) => s.to === "ops@example.com" && /wrong cluster/.test(s.subject))).toHaveLength(2);
    expect(await store.watchedAt()).toBeUndefined();

    // Back on the right cluster, both are gone on two reads: closed, and the operator is told it happened to many at once.
    setGenesis(DEVNET);
    await watchBudgets(watchDeps(deps, chain, NOW_MS));
    const pass = await watchBudgets(watchDeps(deps, chain, NOW_MS + GONE_CONFIRM_MS));
    expect(pass.map((r) => r.status)).toEqual(["closed", "closed"]);
    expect(sent.some((s) => s.to === "ops@example.com" && /2 Budget records were closed in one pass/.test(s.subject))).toBe(true);
  });
});

describe("Budget incident step", () => {
  it("pauses, then closes every open Budget with a KMS approval, freezes unopened records, and tells each payer", async () => {
    const { store, sent, deps, accounts, chain, sentTxs } = setup();
    const a = await openBudget(deps, accounts);
    const b = await openBudget(deps, accounts);
    const pending = await createSpender(authorization({ contact: { webhook: "https://hooks.example/budget" } }).input, deps);
    if (!pending.ok) throw new Error();
    const feePayer = Keypair.generate();

    const result = await closeAllBudgets({ reason: "relay compromise drill", feePayer, programId: PROGRAM, chain }, deps);
    expect(result.paused).toBe(true);
    expect(result.results.every((r) => r.ok)).toBe(true);
    expect(sentTxs).toHaveLength(2);
    for (const tx of sentTxs) {
      expect(tx.feePayer!.equals(feePayer.publicKey)).toBe(true);
      expect(tx.signatures).toHaveLength(1);
      expect(tx.instructions[0].programId.equals(SECP256R1_PROGRAM_ID)).toBe(true);
      const read = readSecp256r1Approval(tx.instructions[0])!;
      expect(p256Verify(read.publicKey, read.message, read.signature)).toBe(true);
      expect(Buffer.from(tx.instructions[1].data.subarray(0, 8))).toEqual(Buffer.from(BUDGET_DISCRIMINATORS["global:close_budget"]));
    }
    // The approvals are logged as the operator's.
    expect(store.uses.filter((u) => u.purpose === "close").map((u) => u.detail?.caller)).toEqual(["incident", "incident"]);
    expect((await store.byId(a.record.id))!.status).toBe("closing");
    expect((await store.byId(pending.record.id))!.status).toBe("frozen");
    expect(sent.filter((s) => s.to === "payer@example.com" && /closed early/.test(s.subject))).toHaveLength(2);
    expect((await store.paused()).paused).toBe(true);
    // Closing and paused: no reserve, and KMS is not asked.
    const calls = KMS.calls;
    expect(await approve(deps, b, reserve(b.providers[0]))).toMatchObject({ ok: false });
    expect(KMS.calls).toBe(calls);
  });

  it("without a fee payer it still pauses and lists what is left to close; through the wrong cluster it closes nothing", async () => {
    const { deps, accounts, chain, setGenesis, sentTxs } = setup();
    const opened = await openBudget(deps, accounts);
    const result = await closeAllBudgets({ reason: "drill", feePayer: undefined, programId: PROGRAM, chain }, deps);
    expect(result.paused).toBe(true);
    expect(result.results).toEqual([expect.objectContaining({ ok: false, error: "no_fee_payer" })]);
    setGenesis(GENESIS_HASH["solana-mainnet-beta"]);
    accounts.delete(opened.budget.toBase58());
    const wrong = await closeAllBudgets({ reason: "drill", feePayer: Keypair.generate(), programId: PROGRAM, chain }, deps);
    expect(wrong.results).toEqual([expect.objectContaining({ ok: false, error: "wrong_cluster" })]);
    expect(sentTxs).toHaveLength(0);
  });

  it("finds the pinned Budget a payer opened after its record was frozen, skips Budgets already closed, and lists what it did not reach", async () => {
    const { store, sent, deps, accounts, chain, sentTxs } = setup();
    const feePayer = Keypair.generate();
    const pending = await createSpender(authorization({ contact: { email: "late@example.com" } }).input, deps);
    if (!pending.ok) throw new Error();
    await closeAllBudgets({ reason: "first", feePayer, programId: PROGRAM, chain }, deps);
    expect(sent.some((s) => s.to === "late@example.com" && /Do not open/.test(s.subject))).toBe(true);
    // The payer opens it anyway; a frozen key cannot be activated, but the next run finds and closes it.
    const pinned = pending.record.budget!;
    accounts.set(pinned, { owner: PROGRAM, data: budgetBytes({ payer: new PublicKey(pending.record.payer), spender: new PublicKey(pending.record.spender), allowlist: pending.record.expectedPayees }) });
    expect(await activateSpender({ id: pending.record.id, programId: PROGRAM, readAccount: async (a) => accounts.get(a.toBase58()) ?? null }, deps)).toMatchObject({ ok: false, code: "not_pending" });
    const closedAlready = await openBudget(deps, accounts);
    accounts.set(closedAlready.budget.toBase58(), { owner: PROGRAM, data: budgetBytes({ payer: closedAlready.payer, spender: closedAlready.spender, closed: true, closedSlot: CREATED + BigInt(9) }) });
    const second = await closeAllBudgets({ reason: "second", feePayer, programId: PROGRAM, chain }, deps);
    expect(second.unreached).toEqual([]);
    expect(second.results).toEqual(expect.arrayContaining([expect.objectContaining({ budget: pinned, ok: true }), expect.objectContaining({ budget: closedAlready.budget.toBase58(), ok: true, note: "already_closed" })]));
    expect(sentTxs).toHaveLength(1);
    expect((await store.byId(pending.record.id))!.incident).toMatchObject({ reason: "second", ok: true });

    const late = await openBudget(deps, accounts);
    const third = await closeAllBudgets({ reason: "third", feePayer, programId: PROGRAM, chain, deadlineMs: Date.now() - 1 }, deps);
    expect(third.unreached).toContain(late.budget.toBase58());
    expect(sent.some((s) => s.to === "ops@example.com" && /NOT closed/.test(s.subject))).toBe(true);
  });
});

describe("Budget custody review S6 fixes", () => {
  it("lets only the allowed number of concurrent approvals through, and reads the pause switch leniently", async () => {
    const { store, deps, accounts } = setup({ BUDGET_SPENDER_MAX_USES_PER_10_MIN: "3" });
    const opened = await openBudget(deps, accounts);
    const all = await Promise.all(Array.from({ length: 12 }, () => approve(deps, opened, reserve(opened.providers[0]))));
    expect(all.filter((r) => r.ok)).toHaveLength(3);
    expect(store.uses).toHaveLength(3);
    for (const v of ["true", "TRUE", "1", "yes", " on "]) expect(pausedByEnv(v)).toBe(true);
    for (const v of [undefined, "", "false", "0", "no", "off", "False"]) expect(pausedByEnv(v)).toBe(false);
  });

  it("makes no key unless the payer and the operator can actually be alerted, and signs every webhook alert (S6-claude-04)", async () => {
    const { deps } = setup({ RESEND_API_KEY: undefined });
    expect(await createSpender(authorization({ contact: { email: "a@b.co" } }).input, deps)).toMatchObject({ ok: false, code: "alerts_not_configured" });
    const opsHook = { ...deps.env, BUDGET_OPS_EMAIL: undefined, BUDGET_OPS_WEBHOOK: "https://ops.example/hook" };
    // An operator webhook without its secret would be unsigned: refused.
    expect(await createSpender(authorization({ contact: { webhook: "https://hooks.example/a" } }).input, { ...deps, env: opsHook })).toMatchObject({ ok: false, code: "alerts_not_configured" });
    const signedOps = { ...deps, env: { ...opsHook, BUDGET_OPS_WEBHOOK_SECRET: "ops-secret" } };
    const hook = await createSpender(authorization({ contact: { webhook: "https://hooks.example/a" } }).input, signedOps);
    expect(hook.ok).toBe(true);
    if (hook.ok) expect(hook.record.contact.webhookSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const noOps = setup({ BUDGET_OPS_EMAIL: undefined });
    expect(await createSpender(authorization({ contact: { webhook: "https://hooks.example/a" } }).input, noOps.deps)).toMatchObject({ ok: false, code: "alerts_not_configured" });

    // At send time: the operator webhook goes out signed with its secret, and never without one.
    const alert = { audience: "operator" as const, kind: "incident" as const, subject: "drill", text: "drill", detail: {} };
    const signed = setup({ BUDGET_OPS_EMAIL: undefined, BUDGET_OPS_WEBHOOK: "https://ops.example/hook", BUDGET_OPS_WEBHOOK_SECRET: "ops-secret" });
    expect(await sendBudgetAlert(alert, undefined, signed.deps as AlertDeps)).toBe(true);
    expect(signed.sent).toEqual([expect.objectContaining({ channel: "webhook", secret: "ops-secret" })]);
    const unsigned = setup({ BUDGET_OPS_EMAIL: undefined, BUDGET_OPS_WEBHOOK: "https://ops.example/hook" });
    expect(await sendBudgetAlert(alert, undefined, unsigned.deps as AlertDeps)).toBe(false);
    expect(unsigned.sent).toEqual([]);
    expect(unsigned.store.alerts[0].delivered).toEqual({ webhook: "not_configured" });

    const header = signWebhookBody('{"a":1}', "secret", 1_700_000_000_000);
    expect(header).toBe(`t=1700000000,v1=${createHmac("sha256", "secret").update('1700000000.{"a":1}').digest("hex")}`);
  });

  it("sends an undelivered alert again every pass, tells the operator after three, and a hanging payer does not block others", async () => {
    const { sent, deps, behaviour, accounts, chain } = setup();
    const slow = await openBudget(deps, accounts);
    const other = await openBudget(deps, accounts);
    behaviour.set("payer@example.com", "failed");
    const p1 = slow.providers[0];
    accounts.set(reservationAddress(slow.budget, p1, PROGRAM).toBase58(), { owner: PROGRAM, data: sliceBytes({ budget: slow.budget, payee: p1, reserved: BigInt(1_000) }) });
    let pass = await watchBudgets(watchDeps(deps, chain));
    expect(pass.find((r) => r.budget === slow.budget.toBase58())).toMatchObject({ error: "alerts_undelivered" });
    await watchBudgets(watchDeps(deps, chain));
    await watchBudgets(watchDeps(deps, chain));
    expect(sent.filter((s) => s.to === "payer@example.com" && /reserved/.test(s.subject))).toHaveLength(3);
    expect(sent.filter((s) => s.to === "ops@example.com" && /not getting through/.test(s.subject))).toHaveLength(1);
    behaviour.set("payer@example.com", "sent");
    pass = await watchBudgets(watchDeps(deps, chain));
    expect(pass.every((r) => !r.error)).toBe(true);
    expect(sent.filter((s) => s.to === "payer@example.com" && /reserved/.test(s.subject))).toHaveLength(4);

    // A payer whose webhook never answers: the other Budget's payer still hears, within the timeout.
    const hanging = await openBudget(deps, accounts, { contact: { webhook: "https://hang.example/hook" } });
    behaviour.set("https://hang.example/hook", "hang");
    const p2 = hanging.providers[0];
    const p3 = other.providers[0];
    accounts.set(reservationAddress(hanging.budget, p2, PROGRAM).toBase58(), { owner: PROGRAM, data: sliceBytes({ budget: hanging.budget, payee: p2, reserved: BigInt(5) }) });
    accounts.set(reservationAddress(other.budget, p3, PROGRAM).toBase58(), { owner: PROGRAM, data: sliceBytes({ budget: other.budget, payee: p3, reserved: BigInt(7) }) });
    const started = Date.now();
    pass = await watchBudgets(watchDeps(deps, chain));
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(pass.find((r) => r.budget === other.budget.toBase58())?.alerts).toEqual(["payer:slice_reserved"]);
    expect(pass.find((r) => r.budget === hanging.budget.toBase58())).toMatchObject({ error: "alerts_undelivered" });
  });

  it("keeps the record on an unreadable Budget, tells the payer of a settled slice, and reports a stalled watcher", async () => {
    const { store, sent, deps, accounts, chain } = setup();
    const { record, budget, payer, spender } = await openBudget(deps, accounts);
    const p = WALLET();
    const slice = reservationAddress(budget, p, PROGRAM).toBase58();
    accounts.set(slice, { owner: PROGRAM, data: sliceBytes({ budget, payee: p, reserved: BigInt(10), state: 1, finalAmount: BigInt(5), postedSlot: CREATED + BigInt(1) }) });
    await watchBudgets(watchDeps(deps, chain));
    expect(await store.watchedAt()).toBe(new Date(NOW_MS).toISOString());

    accounts.set(budget.toBase58(), { owner: WALLET(), data: budgetBytes({ payer, spender }) });
    const odd = await watchBudgets(watchDeps(deps, chain));
    expect(odd[0]).toMatchObject({ error: "budget_unreadable", status: "open" });
    expect((await store.byId(record.id))!.status).toBe("open");

    accounts.set(budget.toBase58(), { owner: PROGRAM, data: budgetBytes({ payer, spender }) });
    accounts.delete(slice);
    const settled = await watchBudgets(watchDeps(deps, chain, NOW_MS + 60 * 60 * 1000));
    expect(settled[0].alerts).toEqual(["payer:slice_settled"]);
    expect(sent.some((s) => s.to === "ops@example.com" && /stalled/.test(s.subject))).toBe(true);
    expect((await store.byId(record.id))!.seen).toEqual({});
  });

  it("warns the operator once a day when a live Budget names a KMS key the relay no longer signs with, without holding up the watcher", async () => {
    const { store, sent, deps, accounts, chain } = setup();
    await openBudget(deps, accounts);
    expect((await watchBudgets(watchDeps(deps, chain)))[0].error).toBeUndefined();
    const rotated = { ...deps, env: { ...deps.env, BUDGET_SPENDER_P256_PUBLIC_KEY: kmsKey().hex } };
    const later = NOW_MS + 60_000;
    const first = await watchBudgets(watchDeps(rotated, chain, later));
    expect(first[0]).toMatchObject({ warning: "key_rotated" });
    expect(first[0].error).toBeUndefined();
    // A warning is not a failed pass: the watcher still counts as running.
    expect(await store.watchedAt()).toBe(new Date(later).toISOString());
    const unset = { ...deps, env: { ...deps.env, BUDGET_SPENDER_P256_PUBLIC_KEY: undefined } };
    expect((await watchBudgets(watchDeps(unset, chain, later + 60_000)))[0]).toMatchObject({ warning: "key_rotated" });
    const rotatedAlerts = () => sent.filter((s) => s.to === "ops@example.com" && /no longer signs with/.test(s.subject));
    expect(rotatedAlerts()).toHaveLength(1);
    await watchBudgets(watchDeps(unset, chain, later + KEY_ROTATED_REPEAT_MS));
    expect(rotatedAlerts()).toHaveLength(2);
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
