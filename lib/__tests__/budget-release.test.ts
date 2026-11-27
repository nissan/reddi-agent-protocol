/**
 * @jest-environment node
 *
 * Release on completion for Budgets without a judge (Nissan, 27 November
 * 2026): the payer chooses no judge on the Budget page, the open lets the
 * spender waive (flag 0x01), and the watcher has the signer waive and pay out
 * each posted slice as soon as it sees it.
 */
import { generateKeyPairSync, sign as nodeSign } from "crypto";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  BUDGET_DISCRIMINATORS,
  BUDGET_FLAG_CLOSED,
  BUDGET_FLAG_P256_SPENDER,
  BUDGET_FLAG_SPENDER_WAIVES,
  compressP256PublicKey,
  p256SpenderAddress,
  reservationAddress,
  SECP256R1_PROGRAM_ID,
} from "@redditech/x402-solana/budget";
import { ed25519Sign } from "@redditech/x402-solana/ed25519";
import { activateSpender, approveAsSpender, type CustodyDeps } from "@/lib/budget/custody";
import type { SpenderSigner } from "@/lib/budget/kms";
import { BUDGET_DISPUTE_SLOTS, BUDGET_JUDGE_SLOTS, BUDGET_OPEN_SLOTS, budgetProviders, prepareBudget, startBudget } from "@/lib/budget/page";
import { releaseSlice } from "@/lib/budget/release";
import { handleRelease, type SignerContext } from "@/lib/budget/signer-service";
import { releaseViaSigner } from "@/lib/budget/signer-client";
import { GENESIS_HASH, MemoryBudgetCustodyStore } from "@/lib/budget/store";
import { checkBudgetTransaction } from "@/lib/budget/tx-check";
import { watchBudgets, type BudgetChainReader } from "@/lib/budget/watch";

const PROGRAM = Keypair.generate().publicKey;
const NOW_MS = Date.UTC(2026, 10, 27, 5, 0, 0);
const CREATED = BigInt(9_000_000);
const DEVNET = GENESIS_HASH["solana-devnet"];
const JUDGE = Keypair.generate().publicKey;
const FEE_PAYER = Keypair.generate();
const ENV = {
  BUDGET_OPS_EMAIL: "ops@example.com",
  RESEND_API_KEY: "re_test",
  BUDGET_ALERT_FROM: "alerts@example.com",
  BUDGET_DEFAULT_JUDGE: JUDGE.toBase58(),
  BUDGET_OPS_FEE_PAYER: JSON.stringify(Array.from(FEE_PAYER.secretKey)),
};
const [A, B] = budgetProviders();

function kms(): SpenderSigner {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    publicKey: compressP256PublicKey(publicKey.export({ format: "der", type: "spki" }).subarray(-65)),
    sign: async (m: Uint8Array) => Uint8Array.from(nodeSign("sha256", m, privateKey)),
  };
}

const u64 = (v: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};

function budgetData(input: { payer: PublicKey; spender: PublicKey; judge: PublicKey | null; waives: boolean; closed?: boolean }): Buffer {
  const data = Buffer.alloc(349);
  Buffer.from(BUDGET_DISCRIMINATORS["account:Budget"]).copy(data, 0);
  input.payer.toBuffer().copy(data, 8);
  input.spender.toBuffer().copy(data, 40);
  if (input.judge) input.judge.toBuffer().copy(data, 72);
  u64(CREATED).copy(data, 152);
  u64(BUDGET_OPEN_SLOTS).copy(data, 160);
  u64(BUDGET_DISPUTE_SLOTS).copy(data, 168);
  u64(BUDGET_JUDGE_SLOTS).copy(data, 176);
  u64(BigInt(30_000_000)).copy(data, 184);
  u64(BigInt(15_000_000)).copy(data, 200);
  new PublicKey(A.payee).toBuffer().copy(data, 208);
  new PublicKey(B.payee).toBuffer().copy(data, 240);
  data[346] = BUDGET_FLAG_P256_SPENDER | (input.waives ? BUDGET_FLAG_SPENDER_WAIVES : 0) | (input.closed ? BUDGET_FLAG_CLOSED : 0);
  return data;
}

function sliceData(budget: PublicKey, payee: PublicKey, input: { state: number; finalAmount: bigint; waived?: boolean }): Buffer {
  const data = Buffer.alloc(147);
  Buffer.from(BUDGET_DISCRIMINATORS["account:Reservation"]).copy(data, 0);
  budget.toBuffer().copy(data, 8);
  u64(CREATED).copy(data, 40);
  payee.toBuffer().copy(data, 48);
  payee.toBuffer().copy(data, 80);
  u64(BigInt(10_000_000)).copy(data, 112);
  u64(input.finalAmount).copy(data, 120);
  u64(CREATED + BigInt(100)).copy(data, 128);
  data[144] = input.state;
  data[145] = input.waived ? 1 : 0;
  return data;
}

/** A Budget opened through the page, activated, with the chain the tests read. */
async function open(judged: boolean) {
  const payer = Keypair.generate();
  const signer = kms();
  const store = new MemoryBudgetCustodyStore();
  const sent: string[] = [];
  const deps: CustodyDeps = { store, signer, sender: { email: async (_to, subject, text) => (sent.push(`${subject}\n${text}`), "sent"), webhook: async () => "sent" }, env: ENV, nowMs: NOW_MS };
  const prepared = prepareBudget({ payer: payer.publicKey.toBase58(), token: "SOL", total: "30000000", providerIds: [A.id, B.id], email: "me@example.com", judged }, PROGRAM, NOW_MS, ENV);
  if (!prepared.ok) throw new Error(prepared.message);
  const started = await startBudget({ terms: prepared.terms, signature: Buffer.from(ed25519Sign(payer, Buffer.from(prepared.message, "base64"))).toString("base64"), programId: PROGRAM, blockhash: async () => Keypair.generate().publicKey.toBase58(), env: ENV }, deps);
  if (!started.ok) throw new Error(started.message);
  const spender = await p256SpenderAddress(signer.publicKey);
  const budget = new PublicKey(started.budget);
  const accounts = new Map<string, { owner: PublicKey; data: Uint8Array }>();
  accounts.set(budget.toBase58(), { owner: PROGRAM, data: budgetData({ payer: payer.publicKey, spender, judge: judged ? JUDGE : null, waives: !judged }) });
  const txs: Transaction[] = [];
  let failNext = 0;
  const chain = {
    slot: async () => CREATED + BigInt(200),
    genesisHash: async () => DEVNET,
    readAccount: async (a: PublicKey) => accounts.get(a.toBase58()) ?? null,
    latestBlockhash: async () => Keypair.generate().publicKey.toBase58(),
    sendAndConfirm: async (tx: Transaction) => {
      if (failNext > 0) {
        failNext -= 1;
        throw new Error("simulated failure");
      }
      txs.push(tx);
      return "5".repeat(88);
    },
    reservations: async (b: PublicKey) => [...accounts.entries()].filter(([k, v]) => k !== b.toBase58() && v.data.length === 147 && new PublicKey(v.data.subarray(8, 40)).equals(b)).map(([k, v]) => ({ address: new PublicKey(k), data: v.data })),
  };
  const activated = await activateSpender({ id: started.id, programId: PROGRAM }, { ...deps, chain });
  if (!activated.ok) throw new Error(activated.message);
  const post = (payee: string, finalAmount: bigint, extra: { waived?: boolean } = {}) =>
    accounts.set(reservationAddress(budget, new PublicKey(payee), PROGRAM).toBase58(), { owner: PROGRAM, data: sliceData(budget, new PublicKey(payee), { state: 1, finalAmount, ...extra }) });
  const close = () => accounts.set(budget.toBase58(), { owner: PROGRAM, data: budgetData({ payer: payer.publicKey, spender, judge: judged ? JUDGE : null, waives: !judged, closed: true }) });
  return { payer, store, deps, chain, accounts, budget, started, prepared, txs, sent, post, close, failNext: (n: number) => (failNext = n), signer };
}

describe("Budget page: no judge means release on completion", () => {
  it("opens a Budget without a judge with flag 0x01, and the payer's signed terms say so", async () => {
    const b = await open(false);
    expect(b.prepared.ok && b.prepared.terms.judged).toBe(false);
    const message = Buffer.from(b.prepared.ok ? b.prepared.message : "", "base64").toString();
    expect(message).toContain("judge: none");
    expect(message).toContain("agent may approve posted totals: yes");
    expect(b.started.record.terms).toMatchObject({ judge: null, spenderMayWaive: true });
    const tx = Transaction.from(Buffer.from(b.started.transaction, "base64"));
    const data = Buffer.from(tx.instructions.find((ix) => ix.programId.equals(PROGRAM))!.data);
    expect(data[128] & BUDGET_FLAG_SPENDER_WAIVES).toBe(BUDGET_FLAG_SPENDER_WAIVES);
    expect(new PublicKey(data.subarray(56, 88)).equals(PublicKey.default)).toBe(true);
  });

  it("keeps the judge, and no flag 0x01, by default", async () => {
    const b = await open(true);
    expect(b.started.record.terms).toMatchObject({ judge: JUDGE.toBase58(), spenderMayWaive: false });
    const tx = Transaction.from(Buffer.from(b.started.transaction, "base64"));
    const data = Buffer.from(tx.instructions.find((ix) => ix.programId.equals(PROGRAM))!.data);
    expect(data[128] & BUDGET_FLAG_SPENDER_WAIVES).toBe(0);
  });

  it("opens a no-judge Budget even while the RAP judge is not usable", () => {
    const broken = { ...ENV, BUDGET_DEFAULT_JUDGE: "not-an-address" };
    const payer = Keypair.generate().publicKey.toBase58();
    const terms = { payer, token: "SOL", total: "30000000", providerIds: [A.id, B.id], email: "me@example.com" };
    expect(prepareBudget(terms, PROGRAM, NOW_MS, broken)).toMatchObject({ ok: false, code: "judge_not_configured" });
    expect(prepareBudget({ ...terms, judged: false }, PROGRAM, NOW_MS, broken)).toMatchObject({ ok: true });
    expect(prepareBudget({ ...terms, judged: "no" }, PROGRAM, NOW_MS, ENV)).toMatchObject({ ok: false, code: "invalid_request" });
  });

  it("the page refuses an open whose flag does not match the choice", async () => {
    const b = await open(false);
    const nonce = b.prepared.ok ? b.prepared.terms.nonce : "";
    const base = { nonce, total: BigInt(30_000_000), mint: null, allowlist: [A.payee, B.payee] };
    const check = (open: Parameters<typeof checkBudgetTransaction>[1]["open"]) => checkBudgetTransaction(b.started.transaction, { wallet: b.payer.publicKey.toBase58(), budget: b.budget.toBase58(), open, programId: PROGRAM });
    expect(check({ ...base, judge: null, releaseOnCompletion: true })).toBeUndefined();
    expect(check({ ...base, judge: null })).toBe("it lets the agent approve what providers post");
    const judged = await open(true);
    const jn = judged.prepared.ok ? judged.prepared.terms.nonce : "";
    expect(checkBudgetTransaction(judged.started.transaction, { wallet: judged.payer.publicKey.toBase58(), budget: judged.budget.toBase58(), open: { nonce: jn, total: BigInt(30_000_000), mint: null, allowlist: [A.payee, B.payee], judge: JUDGE.toBase58(), releaseOnCompletion: true }, programId: PROGRAM })).toBe(
      "it holds what providers post although you chose no judge",
    );
  });
});

describe("Budget signer: releasing a posted slice of a no-judge Budget", () => {
  it("waives and pays out in one transaction, paid for by the ops key", async () => {
    const b = await open(false);
    b.post(A.payee, BigInt(4_000_000));
    const released = await releaseSlice({ id: b.started.id, payee: A.payee, programId: PROGRAM, chain: b.chain, env: ENV }, b.deps);
    expect(released).toMatchObject({ ok: true, paidOut: true });
    expect(b.txs).toHaveLength(1);
    expect(b.txs[0].feePayer?.equals(FEE_PAYER.publicKey)).toBe(true);
    expect(b.txs[0].instructions.map((ix) => ix.programId.toBase58())).toEqual([SECP256R1_PROGRAM_ID.toBase58(), PROGRAM.toBase58(), PROGRAM.toBase58()]);
    const use = b.store.uses.find((u) => u.purpose === "waive");
    expect(use).toMatchObject({ payee: A.payee, detail: expect.objectContaining({ caller: "release:no_judge", amount: "4000000" }) });
  });

  it("also releases after the Budget closed, when providers usually post", async () => {
    const b = await open(false);
    b.close();
    const record = (await b.store.byId(b.started.id))!;
    await b.store.update({ ...record, status: "closing", version: record.version + 1 });
    b.post(B.payee, BigInt(1_000));
    expect(await releaseSlice({ id: b.started.id, payee: B.payee, programId: PROGRAM, chain: b.chain, env: ENV }, b.deps)).toMatchObject({ ok: true });
  });

  it("sends the waive alone when the combined transaction fails, so the provider's kit pays it out", async () => {
    const b = await open(false);
    b.post(A.payee, BigInt(4_000_000));
    b.failNext(1);
    const released = await releaseSlice({ id: b.started.id, payee: A.payee, programId: PROGRAM, chain: b.chain, env: ENV }, b.deps);
    expect(released).toMatchObject({ ok: true, paidOut: false, note: "payout_failed" });
    expect(b.txs[0].instructions).toHaveLength(2);
  });

  it("refuses a Budget with a judge, a slice not posted or already released, and a post of nothing", async () => {
    const judged = await open(true);
    judged.post(A.payee, BigInt(4_000_000));
    expect(await releaseSlice({ id: judged.started.id, payee: A.payee, programId: PROGRAM, chain: judged.chain, env: ENV }, judged.deps)).toMatchObject({ ok: false, code: "not_authorized" });
    const b = await open(false);
    expect(await releaseSlice({ id: b.started.id, payee: A.payee, programId: PROGRAM, chain: b.chain, env: ENV }, b.deps)).toMatchObject({ ok: false, code: "slice_not_found" });
    b.post(A.payee, BigInt(4_000_000), { waived: true });
    expect(await releaseSlice({ id: b.started.id, payee: A.payee, programId: PROGRAM, chain: b.chain, env: ENV }, b.deps)).toMatchObject({ ok: false, code: "slice_not_posted" });
    b.post(B.payee, BigInt(0));
    expect(await releaseSlice({ id: b.started.id, payee: B.payee, programId: PROGRAM, chain: b.chain, env: ENV }, b.deps)).toMatchObject({ ok: false, code: "nothing_posted" });
    expect(b.txs).toHaveLength(0);
    expect(await releaseSlice({ id: b.started.id, payee: B.payee, programId: PROGRAM, chain: b.chain, env: { ...ENV, BUDGET_OPS_FEE_PAYER: "" } }, b.deps)).toMatchObject({ ok: false, code: "fee_payer_not_configured" });
  });

  it("refuses when the chain says no judge but the payer signed for one, and while paused or frozen", async () => {
    const judged = await open(true);
    // The Budget on chain claims no judge and flag 0x01, but the payer signed for the judge.
    const onChain = judged.accounts.get(judged.budget.toBase58())!;
    const data = Buffer.from(onChain.data);
    data.fill(0, 72, 104);
    data[346] |= BUDGET_FLAG_SPENDER_WAIVES;
    judged.accounts.set(judged.budget.toBase58(), { owner: PROGRAM, data });
    judged.post(A.payee, BigInt(4_000_000));
    expect(await releaseSlice({ id: judged.started.id, payee: A.payee, programId: PROGRAM, chain: judged.chain, env: ENV }, judged.deps)).toMatchObject({ ok: false, code: "not_authorized" });

    const b = await open(false);
    b.post(A.payee, BigInt(4_000_000));
    expect(await releaseSlice({ id: b.started.id, payee: A.payee, programId: PROGRAM, chain: b.chain, env: ENV }, { ...b.deps, env: { ...ENV, BUDGET_SPENDING_PAUSED: "1" } })).toMatchObject({ ok: false, code: "budgets_paused" });
    const record = (await b.store.byId(b.started.id))!;
    await b.store.update({ ...record, status: "frozen", version: record.version + 1 });
    expect(await releaseSlice({ id: b.started.id, payee: A.payee, programId: PROGRAM, chain: b.chain, env: ENV }, b.deps)).toMatchObject({ ok: false, code: "budget_not_open" });
    expect(b.txs).toHaveLength(0);
  });

  it("the release path approves only a waive", async () => {
    const b = await open(false);
    const reserve = await approveAsSpender({ id: b.started.id, auth: { release: "no_judge" }, request: { purpose: "reserve", payee: A.payee, amount: BigInt(1_000) }, programId: PROGRAM }, { ...b.deps, chain: b.chain });
    expect(reserve).toMatchObject({ ok: false, code: "not_authorized" });
    const close = await approveAsSpender({ id: b.started.id, auth: { release: "no_judge" }, request: { purpose: "close" }, programId: PROGRAM }, { ...b.deps, chain: b.chain });
    expect(close).toMatchObject({ ok: false, code: "not_authorized" });
  });

  it("the route takes only its own token, never the app's or the operator's", async () => {
    const b = await open(false);
    b.post(A.payee, BigInt(4_000_000));
    const env = { ...ENV, BUDGET_RELEASE_TOKEN: "release-token", BUDGET_SIGNER_TOKEN: "app-token", BUDGET_INCIDENT_SECRET: "ops-secret" };
    const ctx: SignerContext = { custody: { ...b.deps, network: "solana-devnet" }, chain: b.chain, programId: PROGRAM, env };
    const call = (token: string, e = env) => handleRelease(new Request("https://signer.example/api/v1/release", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ id: b.started.id, payee: A.payee }) }), { ...ctx, env: e });
    expect((await call("app-token")).status).toBe(401);
    expect((await call("ops-secret")).status).toBe(401);
    expect((await call("release-token", { ...env, BUDGET_RELEASE_TOKEN: "app-token" })).status).toBe(503);
    const ok = await call("release-token");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, paidOut: true });
    // And the watcher's client reads that answer.
    const client = await releaseViaSigner({ id: b.started.id, payee: B.payee }, { env: { BUDGET_SIGNER_URL: "https://signer.example", BUDGET_RELEASE_TOKEN: "release-token" }, fetchImpl: async () => Response.json({ ok: true, signature: "5".repeat(88), paidOut: false, note: "token_account_missing" }) });
    expect(client).toMatchObject({ ok: true, paidOut: false });
    expect(await releaseViaSigner({ id: b.started.id, payee: B.payee }, { env: { BUDGET_SIGNER_URL: "https://signer.example" } })).toMatchObject({ ok: false, code: "release_not_configured" });
  });
});

describe("Budget watcher: releases each post on a no-judge Budget", () => {
  const deps = (b: Awaited<ReturnType<typeof open>>, release?: (i: { id: string; payee: string }) => Promise<never | { ok: true; signature: string; paidOut: boolean } | { ok: false; code: string; message: string }>) => ({
    ...b.deps,
    env: { ...ENV, BUDGET_SPENDER_P256_PUBLIC_KEY: Buffer.from(b.signer.publicKey).toString("hex") },
    chain: b.chain as unknown as BudgetChainReader,
    programId: PROGRAM,
    origin: "https://app.example",
    ...(release ? { release } : {}),
  });

  it("asks the signer to release a new post, and tells the payer it is paid on completion", async () => {
    const b = await open(false);
    b.post(A.payee, BigInt(4_000_000));
    const asked: string[] = [];
    const reports = await watchBudgets(deps(b, async (i) => (asked.push(i.payee), { ok: true, signature: "5".repeat(88), paidOut: true })));
    expect(asked).toEqual([A.payee]);
    expect(reports[0].alerts).toContain("release:paid");
    expect(b.sent.join("\n")).toContain("paid on completion: RAP releases the amount to the provider now");
  });

  it("leaves a judged Budget's post for the payer and the window", async () => {
    const b = await open(true);
    b.post(A.payee, BigInt(4_000_000));
    const asked: string[] = [];
    await watchBudgets(deps(b, async (i) => (asked.push(i.payee), { ok: true, signature: "5".repeat(88), paidOut: true })));
    expect(asked).toEqual([]);
  });

  it("tells the operator once when a release fails, and tries again next pass", async () => {
    const b = await open(false);
    b.post(A.payee, BigInt(4_000_000));
    let tries = 0;
    const failing = async () => (tries++, { ok: false as const, code: "signer_unavailable", message: "down" });
    const first = await watchBudgets(deps(b, failing));
    expect(first[0].alerts).toContain("operator:release_failed");
    expect(first[0].warning).toBe("release_failed");
    expect(first[0].error).toBeUndefined();
    const second = await watchBudgets({ ...deps(b, failing), nowMs: NOW_MS + 5 * 60 * 1000 });
    expect(second[0].alerts).not.toContain("operator:release_failed");
    expect(tries).toBe(2);
  });
});
