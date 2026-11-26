/**
 * @jest-environment node
 */
import { createHash, createPrivateKey, generateKeyPairSync, sign as nodeSign } from "crypto";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { signReddiReceiptV2, type ReddiReceiptV2 } from "@redditech/agent-protocol";
import { BUDGET_DISCRIMINATORS, reservationAddress } from "@redditech/x402-solana/budget";
import type { ChainAccount, JudgeChain } from "@/lib/budget/judge/chain";
import { ed25519Verifies, readJudgeSigner, signAsJudge, type JudgeSigner } from "@/lib/budget/judge/kms";
import { judgeWindows, MEMO_PROGRAM_ID, ruleByHand, runJudgePass, type JudgeDeps } from "@/lib/budget/judge/pass";
import { readSliceReceipt, type SliceExpectation } from "@/lib/budget/judge/receipts";
import { decideRuling, JUDGE_RULE_VERSION } from "@/lib/budget/judge/rule";
import { handleCron, handleEvidence, handleHealth, handleOps, type JudgeContext } from "@/lib/budget/judge/service";
import { appendOverride, heldBy, MemoryJudgeStore, type SliceKey } from "@/lib/budget/judge/store";

const PROGRAM = Keypair.generate().publicKey;
const CREATED = BigInt(9_000_000);
const HOUR = BigInt(9_000);
const JUDGE_SLOTS = HOUR * BigInt(72);
const DISPUTED = CREATED + HOUR * BigInt(80);
const OPS = "x".repeat(40);
const ENV = { BUDGET_JUDGE_OPS_SECRET: OPS, BUDGET_JUDGE_CRON_SECRET: "cron-secret" };

function u64(v: bigint) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

function sha(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

/** A judge key held in memory. */
function memoryJudge(): JudgeSigner & { keypair: Keypair } {
  const keypair = Keypair.generate();
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(keypair.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
  return { keypair, address: keypair.publicKey, sign: async (m) => Uint8Array.from(nodeSign(null, Buffer.from(m), key)) };
}

function budgetBytes(o: { payer: PublicKey; judge: PublicKey | null; mint?: PublicKey }): Buffer {
  const data = Buffer.alloc(349);
  Buffer.from(BUDGET_DISCRIMINATORS["account:Budget"]).copy(data, 0);
  o.payer.toBuffer().copy(data, 8);
  Keypair.generate().publicKey.toBuffer().copy(data, 40);
  if (o.judge) o.judge.toBuffer().copy(data, 72);
  if (o.mint) o.mint.toBuffer().copy(data, 104);
  u64(CREATED).copy(data, 152);
  u64(HOUR * BigInt(72)).copy(data, 160);
  u64(HOUR * BigInt(24)).copy(data, 168);
  u64(JUDGE_SLOTS).copy(data, 176);
  u64(BigInt(30_000_000)).copy(data, 184);
  u64(CREATED + HOUR).copy(data, 336);
  data[344] = 1;
  data[345] = 1;
  data[346] = 0x02 | 0x08;
  return data;
}

const STATES = { open: 0, posted: 1, disputed: 2, paid: 3 } as const;
function reservationBytes(o: { budget: PublicKey; payee: PublicKey; final: bigint; state?: keyof typeof STATES; created?: bigint }): Buffer {
  const data = Buffer.alloc(147);
  Buffer.from(BUDGET_DISCRIMINATORS["account:Reservation"]).copy(data, 0);
  o.budget.toBuffer().copy(data, 8);
  u64(o.created ?? CREATED).copy(data, 40);
  o.payee.toBuffer().copy(data, 48);
  o.payee.toBuffer().copy(data, 80);
  u64(BigInt(5_000_000)).copy(data, 112);
  u64(o.final).copy(data, 120);
  u64(CREATED + HOUR * BigInt(2)).copy(data, 128);
  u64(DISPUTED).copy(data, 136);
  data[144] = STATES[o.state ?? "disputed"];
  return data;
}

type World = Awaited<ReturnType<typeof world>>;

async function world(opts: { posted?: bigint; judgeIsOther?: boolean } = {}) {
  const payer = Keypair.generate().publicKey;
  const provider = Keypair.generate();
  const budget = Keypair.generate().publicKey;
  const judge = memoryJudge();
  const reservation = reservationAddress(budget, provider.publicKey, PROGRAM);
  const posted = opts.posted ?? BigInt(1_000);
  const accounts = new Map<string, Buffer>();
  accounts.set(budget.toBase58(), budgetBytes({ payer, judge: opts.judgeIsOther ? Keypair.generate().publicKey : judge.address }));
  accounts.set(reservation.toBase58(), reservationBytes({ budget, payee: provider.publicKey, final: posted }));
  let slot = DISPUTED + BigInt(100);
  const sent: Transaction[] = [];
  let sendError: Error | undefined;
  const chain: JudgeChain = {
    slot: async () => slot,
    disputedReservations: async () => [...accounts.entries()].filter(([, d]) => d.length === 147 && d[144] === 2).map(([k, d]) => ({ address: new PublicKey(k), data: d })),
    readAccount: async (k: PublicKey): Promise<ChainAccount | null> => {
      const d = accounts.get(k.toBase58());
      return d ? { owner: PROGRAM, data: d, lamports: 1 } : null;
    },
    balance: async () => 50_000_000,
    latestBlockhash: async () => Keypair.generate().publicKey.toBase58(),
    sendAndConfirm: async (tx) => {
      if (sendError) throw sendError;
      sent.push(tx);
      // The slice leaves the disputed state once ruled.
      accounts.get(reservation.toBase58())![144] = STATES.paid;
      return "5".repeat(88);
    },
    genesisHash: async () => "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  };
  const store = new MemoryJudgeStore();
  const notes: string[] = [];
  const slice: SliceKey = { budget: budget.toBase58(), createdSlot: CREATED.toString(), payee: provider.publicKey.toBase58() };
  const deps: JudgeDeps = { chain, store, signer: judge, programId: PROGRAM, network: "solana-devnet", env: ENV, notify: async (s) => (notes.push(s), true) };
  const providerKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(provider.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
  async function receipt(o: { sequence: number; cumulativeCost: bigint; body: string; signer?: typeof providerKey; providerId?: string; budgetAddress?: string }) {
    const r: ReddiReceiptV2 = {
      schemaVersion: "reddi.receipt.v2",
      providerId: o.providerId ?? provider.publicKey.toBase58(),
      declaredModel: "mid-tier",
      requestHash: sha(o.body),
      responseHash: sha(`answer ${o.body}`),
      session: { escrow: reservation.toBase58(), payer: payer.toBase58(), network: "solana-devnet", currency: "SOL", maxAmount: "5000000", sequence: String(o.sequence), inputTokens: "10", outputTokens: "5", cumulativeInputTokens: String(10 * o.sequence), cumulativeOutputTokens: String(5 * o.sequence), cumulativeCost: o.cumulativeCost.toString(), ...(o.sequence > 1 ? { previousReceiptHash: sha(`receipt ${o.sequence - 1}`) } : {}), closed: false },
      budget: { address: o.budgetAddress ?? budget.toBase58(), createdSlot: CREATED.toString(), reservation: reservation.toBase58() },
      issuedAt: "2026-11-26T01:00:00.000Z",
    };
    const key = o.signer ?? providerKey;
    const signed = await signReddiReceiptV2(r, (m) => nodeSign(null, m, key)).catch(() => ({ receipt: r, proof: { type: "ed25519", signature: Buffer.from(nodeSign(null, Buffer.from("x"), key)).toString("base64") } }));
    return Buffer.from(JSON.stringify(signed), "utf8").toString("base64url");
  }
  function call(body: string) {
    store.calls.push({ ...slice, bodyHash: sha(body) });
  }
  const expect_: SliceExpectation = { network: "solana-devnet", ...slice, reservation: reservation.toBase58(), payer: payer.toBase58() };
  return {
    payer, provider, budget, judge, reservation, accounts, chain, store, notes, slice, deps, receipt, call, sent, expectation: expect_,
    setSlot: (s: bigint) => { slot = s; },
    failSends: (e: Error) => { sendError = e; },
  };
}

function resolvePayout(tx: Transaction): bigint {
  const ix = tx.instructions.find((i) => i.programId.equals(PROGRAM))!;
  expect(Buffer.from(ix.data.subarray(0, 8))).toEqual(Buffer.from(BUDGET_DISCRIMINATORS["global:resolve_budget"]));
  return ix.data.readBigUInt64LE(16);
}

describe("RAP judge: receipts", () => {
  it("reads a provider's v2 receipt for the slice", async () => {
    const w = await world();
    const read = readSliceReceipt(await w.receipt({ sequence: 2, cumulativeCost: BigInt(900), body: "b2" }), w.expectation);
    expect(read).toEqual({ ok: true, receipt: expect.objectContaining({ kind: "receipt-v2", served: 2, cumulativeCost: BigInt(900), requestHash: sha("b2") }) });
  });

  it("sets aside receipts signed by someone else, for another Budget, or of an unknown kind", async () => {
    const w = await world();
    const stranger = generateKeyPairSync("ed25519").privateKey;
    expect(readSliceReceipt(await w.receipt({ sequence: 1, cumulativeCost: BigInt(1), body: "b", signer: stranger }), w.expectation).ok).toBe(false);
    expect(readSliceReceipt(await w.receipt({ sequence: 1, cumulativeCost: BigInt(1), body: "b", budgetAddress: Keypair.generate().publicKey.toBase58() }), w.expectation)).toEqual({ ok: false, reason: "receipt_budget_mismatch" });
    expect(readSliceReceipt(Buffer.from(JSON.stringify({ receipt: { schemaVersion: "other" }, proof: {} })).toString("base64url"), w.expectation)).toEqual({ ok: false, reason: "receipt_kind_not_accepted" });
    expect(readSliceReceipt("not base64 !", w.expectation)).toEqual({ ok: false, reason: "receipt_malformed" });
    expect(readSliceReceipt(undefined, w.expectation)).toEqual({ ok: false, reason: "receipt_malformed" });
  });

  it("takes sandbox receipts on devnet only", async () => {
    const w = await world();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const providerId = new PublicKey(raw).toBase58();
    const receipt = {
      schemaVersion: "rap.sandbox.budget-receipt.v1",
      providerId,
      payee: w.slice.payee,
      declaredModel: "sandbox",
      requestHash: sha("sb"),
      responseHash: sha("answer"),
      budget: { address: w.slice.budget, createdSlot: w.slice.createdSlot, reservation: w.reservation.toBase58(), sequence: 3 },
      payment: { network: "solana-devnet", currency: "SOL", settlement: "budget", amount: "10", cumulativeAmount: "30", reserved: "100", inputTokens: "1", outputTokens: "1" },
      issuedAt: "2026-11-26T01:00:00.000Z",
    };
    const signature = nodeSign(null, Buffer.from(JSON.stringify(receipt)), privateKey).toString("base64");
    const header = Buffer.from(JSON.stringify({ receipt, proof: { type: "ed25519", signature } })).toString("base64url");
    expect(readSliceReceipt(header, w.expectation)).toEqual({ ok: true, receipt: expect.objectContaining({ kind: "sandbox-budget-v1", served: 3, cumulativeCost: BigInt(30) }) });
    expect(readSliceReceipt(header, { ...w.expectation, network: "solana-mainnet-beta" })).toEqual({ ok: false, reason: "sandbox_receipt_not_on_mainnet" });
    const tampered = Buffer.from(JSON.stringify({ receipt: { ...receipt, payment: { ...receipt.payment, cumulativeAmount: "3000" } }, proof: { type: "ed25519", signature } })).toString("base64url");
    expect(readSliceReceipt(tampered, w.expectation)).toEqual({ ok: false, reason: "receipt_signature_invalid" });
  });
});

describe("RAP judge: the decision rule", () => {
  async function rule(w: World, receipts: string[], posted = BigInt(1_000)) {
    return decideRuling({ slice: w.expectation, posted, signedCalls: await w.store.signedCalls(w.slice), receipts });
  }

  it("lets a post stand when the receipts cover it", async () => {
    const w = await world();
    ["b1", "b2"].forEach(w.call);
    const r = await rule(w, [await w.receipt({ sequence: 2, cumulativeCost: BigInt(1_200), body: "b2" })]);
    expect(r).toMatchObject({ rule: JUDGE_RULE_VERSION, basis: "evidence", payout: BigInt(1_000) });
  });

  it("pays only what the receipts show when the post is higher", async () => {
    const w = await world();
    ["b1", "b2"].forEach(w.call);
    const r = await rule(w, [await w.receipt({ sequence: 1, cumulativeCost: BigInt(300), body: "b1" }), await w.receipt({ sequence: 2, cumulativeCost: BigInt(600), body: "b2" })]);
    expect(r).toMatchObject({ basis: "evidence", payout: BigInt(600) });
    expect(r.reason).toContain("rest goes back to the payer");
  });

  it("refunds in full with no receipt, or only receipts that do not match signed calls", async () => {
    const w = await world();
    w.call("b1");
    expect(await rule(w, [])).toMatchObject({ basis: "no_evidence", payout: BigInt(0) });
    const more = await rule(w, [await w.receipt({ sequence: 5, cumulativeCost: BigInt(900), body: "b1" })]);
    expect(more).toMatchObject({ basis: "no_evidence", payout: BigInt(0), setAside: ["served_5_above_signed_1"] });
    const unsigned = await rule(w, [await w.receipt({ sequence: 1, cumulativeCost: BigInt(900), body: "never-signed" })]);
    expect(unsigned).toMatchObject({ basis: "no_evidence", setAside: ["request_not_signed"] });
  });

  it("is the same whatever order the evidence comes in", async () => {
    const w = await world();
    ["b1", "b2", "b3"].forEach(w.call);
    const rs = [await w.receipt({ sequence: 1, cumulativeCost: BigInt(100), body: "b1" }), await w.receipt({ sequence: 3, cumulativeCost: BigInt(700), body: "b3" }), await w.receipt({ sequence: 2, cumulativeCost: BigInt(400), body: "b2" })];
    const a = await rule(w, rs);
    const b = await rule(w, [...rs].reverse());
    expect(a.payout).toBe(BigInt(700));
    expect(b.evidenceHash).toBe(a.evidenceHash);
  });
});

describe("RAP judge: the key from its env var", () => {
  const keygen = (kp: Keypair) => JSON.stringify(Array.from(kp.secretKey));

  it("signs as the pinned address with a solana-keygen key", async () => {
    const kp = Keypair.generate();
    const signer = readJudgeSigner({ BUDGET_JUDGE_SECRET_KEY: keygen(kp), BUDGET_JUDGE_ADDRESS: kp.publicKey.toBase58() });
    expect(signer?.address.equals(kp.publicKey)).toBe(true);
    const message = Buffer.from("ruling");
    expect(await signAsJudge(signer!, message)).toEqual({ ok: true, signature: expect.any(Uint8Array) });
  });

  it("refuses a missing, malformed or mismatched key", () => {
    const kp = Keypair.generate();
    const other = Keypair.generate();
    const address = kp.publicKey.toBase58();
    expect(readJudgeSigner({ BUDGET_JUDGE_ADDRESS: address })).toBeUndefined();
    expect(readJudgeSigner({ BUDGET_JUDGE_SECRET_KEY: keygen(kp) })).toBeUndefined();
    expect(readJudgeSigner({ BUDGET_JUDGE_SECRET_KEY: "[1,2,3]", BUDGET_JUDGE_ADDRESS: address })).toBeUndefined();
    expect(readJudgeSigner({ BUDGET_JUDGE_SECRET_KEY: "not json", BUDGET_JUDGE_ADDRESS: address })).toBeUndefined();
    expect(readJudgeSigner({ BUDGET_JUDGE_SECRET_KEY: keygen(other), BUDGET_JUDGE_ADDRESS: address })).toBeUndefined();
    // A seed from one key with another key's public half still derives the wrong address.
    const spliced = Uint8Array.from([...other.secretKey.subarray(0, 32), ...kp.secretKey.subarray(32)]);
    expect(readJudgeSigner({ BUDGET_JUDGE_SECRET_KEY: JSON.stringify(Array.from(spliced)), BUDGET_JUDGE_ADDRESS: address })).toBeUndefined();
  });
});

describe("RAP judge: signatures", () => {
  it("refuses a signature from any key but the judge's address", async () => {
    const judge = memoryJudge();
    const other = memoryJudge();
    const message = Buffer.from("ruling");
    expect(await signAsJudge(judge, message)).toEqual({ ok: true, signature: expect.any(Uint8Array) });
    expect(await signAsJudge({ address: judge.address, sign: other.sign }, message)).toMatchObject({ ok: false, code: "kms_key_mismatch" });
    expect(await signAsJudge({ address: judge.address, sign: async () => { throw new Error("down"); } }, message)).toMatchObject({ ok: false, code: "kms_unavailable" });
    expect(ed25519Verifies(judge.address, message, new Uint8Array(64))).toBe(false);
  });
});

describe("RAP judge: the pass", () => {
  it("rules at once when the evidence covers the post, signed by the judge, with a memo", async () => {
    const w = await world();
    ["b1", "b2"].forEach(w.call);
    await w.store.addReceipt(w.slice, "relay", await w.receipt({ sequence: 2, cumulativeCost: BigInt(1_000), body: "b2" }));
    const result = await runJudgePass(w.deps);
    expect(result).toMatchObject({ ok: true, disputed: 1, slices: [expect.objectContaining({ status: "ruled", payout: "1000" })] });
    const tx = w.sent[0];
    expect(tx.verifySignatures()).toBe(true);
    expect(tx.feePayer!.equals(w.judge.address)).toBe(true);
    expect(resolvePayout(tx)).toBe(BigInt(1_000));
    const memo = tx.instructions.find((i) => i.programId.equals(MEMO_PROGRAM_ID))!;
    expect(memo.data.toString()).toMatch(/^rap-judge rap-judge-rule\/1 [0-9a-f]{64}$/);
    const ruling = w.store.rows.find((r) => r.kind === "ruling")!;
    expect(ruling.detail).toMatchObject({ by: "rule", payout: "1000", basis: "evidence" });
    expect(w.notes).toEqual(["RAP judge: a Budget slice was disputed", "RAP judge ruled a dispute"]);
  });

  it("waits for evidence while a ruling would fall short, then rules on what it has", async () => {
    const w = await world();
    const first = await runJudgePass(w.deps);
    expect(first.slices[0]).toMatchObject({ status: "waiting_for_evidence", payout: "0" });
    expect(w.sent).toHaveLength(0);
    w.setSlot(DISPUTED + JUDGE_SLOTS / BigInt(3));
    const second = await runJudgePass(w.deps);
    expect(second.slices[0]).toMatchObject({ status: "ruled", payout: "0" });
    expect(resolvePayout(w.sent[0])).toBe(BigInt(0));
  });

  it("takes a provider's receipt sent to the evidence route within the window", async () => {
    const w = await world();
    w.call("b1");
    const ctx = context(w);
    const bad = await handleEvidence(post({ budget: w.slice.budget, payee: w.slice.payee, receipt: await w.receipt({ sequence: 1, cumulativeCost: BigInt(1), body: "b1", budgetAddress: Keypair.generate().publicKey.toBase58() }) }), ctx);
    expect(bad.status).toBe(422);
    const good = await handleEvidence(post({ budget: w.slice.budget, payee: w.slice.payee, receipt: await w.receipt({ sequence: 1, cumulativeCost: BigInt(400), body: "b1" }) }), ctx);
    expect(good.status).toBe(200);
    expect(w.store.saved).toHaveLength(1);
    w.setSlot(DISPUTED + JUDGE_SLOTS / BigInt(3));
    const result = await runJudgePass(w.deps);
    expect(result.slices[0]).toMatchObject({ status: "ruled", payout: "400" });
  });

  it("never rules a held slice, and tells the operator once it is past the automatic window", async () => {
    const w = await world();
    w.call("b1");
    await w.store.addReceipt(w.slice, "relay", await w.receipt({ sequence: 1, cumulativeCost: BigInt(1_000), body: "b1" }));
    expect(await appendOverride(w.store, w.slice, "hold", "checking with the provider", ENV)).toBe(true);
    expect((await runJudgePass(w.deps)).slices[0].status).toBe("held");
    w.setSlot(judgeWindows({ judgeSlots: JUDGE_SLOTS } as never, { disputedSlot: DISPUTED, state: "disputed" } as never).autoEnds);
    expect((await runJudgePass(w.deps)).slices[0].status).toBe("held");
    expect((await runJudgePass(w.deps)).slices[0].status).toBe("held");
    expect(w.notes.filter((n) => n.includes("held dispute"))).toHaveLength(1);
    expect(w.sent).toHaveLength(0);
    expect(await appendOverride(w.store, w.slice, "release", "provider answered", ENV)).toBe(true);
    // Released, but past the automatic window: it now needs a ruling by hand.
    expect((await runJudgePass(w.deps)).slices[0].status).toBe("past_auto");
  });

  it("ignores a hold or release the app could write without the ops secret", async () => {
    const w = await world();
    await w.store.append({ ...w.slice, kind: "hold", reason: "forged", detail: {}, mac: "0".repeat(64) });
    expect(heldBy(await w.store.log(w.slice), w.slice, ENV)).toBeUndefined();
    expect(await appendOverride(w.store, w.slice, "hold", "real", ENV)).toBe(true);
    // A copy of a valid hold row lands at another place in the log and does not count as a release or hold by itself.
    const rows = await w.store.log(w.slice);
    const real = rows.find((r) => r.kind === "hold" && r.reason === "real")!;
    await w.store.append({ ...w.slice, kind: "release", reason: "real", detail: {}, mac: real.mac });
    expect(heldBy(await w.store.log(w.slice), w.slice, ENV)).toBe("real");
    expect(await appendOverride(w.store, w.slice, "hold", "x", {})).toBe(false);
  });

  it("leaves slices that name another judge, and does nothing once the judge's window ended", async () => {
    const other = await world({ judgeIsOther: true });
    expect((await runJudgePass(other.deps)).slices).toEqual([]);
    const late = await world();
    late.setSlot(DISPUTED + JUDGE_SLOTS);
    expect((await runJudgePass(late.deps)).slices[0].status).toBe("window_over");
    expect(late.sent).toHaveLength(0);
  });

  it("fails closed: an unreadable log is a hold, a failed send is retried next pass", async () => {
    const w = await world();
    w.call("b1");
    await w.store.addReceipt(w.slice, "relay", await w.receipt({ sequence: 1, cumulativeCost: BigInt(1_000), body: "b1" }));
    w.store.fail = true;
    expect((await runJudgePass(w.deps)).slices[0].status).toBe("log_unreadable");
    w.store.fail = false;
    w.failSends(new Error("blockhash expired"));
    const failed = await runJudgePass(w.deps);
    expect(failed).toMatchObject({ ok: false, slices: [expect.objectContaining({ status: "send_failed" })] });
    expect(w.store.rows.some((r) => r.kind === "ruling")).toBe(false);
  });

  it("does not send what KMS signs with the wrong key", async () => {
    const w = await world();
    w.call("b1");
    await w.store.addReceipt(w.slice, "relay", await w.receipt({ sequence: 1, cumulativeCost: BigInt(1_000), body: "b1" }));
    const imposter = memoryJudge();
    const result = await runJudgePass({ ...w.deps, signer: { address: w.judge.address, sign: imposter.sign } });
    expect(result.slices[0]).toMatchObject({ status: "send_failed", error: "kms_key_mismatch" });
    expect(w.sent).toHaveLength(0);
  });
});

describe("RAP judge: Nissan's ruling by hand", () => {
  it("rules any amount up to the post, with a reason, until the window ends", async () => {
    const w = await world();
    expect(await ruleByHand({ budget: w.slice.budget, payee: w.slice.payee, payout: BigInt(1_001), reason: "too much" }, w.deps)).toMatchObject({ status: "refused", error: "payout_above_post" });
    expect(await ruleByHand({ budget: w.slice.budget, payee: w.slice.payee, payout: BigInt(10), reason: "" }, w.deps)).toMatchObject({ status: "refused", error: "reason_required" });
    const ruled = await ruleByHand({ budget: w.slice.budget, payee: w.slice.payee, payout: BigInt(500), reason: "half the calls failed upstream" }, w.deps);
    expect(ruled).toMatchObject({ status: "ruled", payout: "500" });
    expect(resolvePayout(w.sent[0])).toBe(BigInt(500));
    expect(w.store.rows.find((r) => r.kind === "ruling")).toMatchObject({ reason: "half the calls failed upstream", detail: expect.objectContaining({ by: "nissan" }) });
    expect(await ruleByHand({ budget: w.slice.budget, payee: w.slice.payee, payout: BigInt(0), reason: "again" }, w.deps)).toMatchObject({ status: "refused", error: "slice_paid" });
  });
});

function post(body: unknown, auth?: string) {
  return new Request("https://judge.example/api", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });
}

function context(w: World, env: Record<string, string | undefined> = ENV): JudgeContext {
  return { network: "solana-devnet", programId: PROGRAM, chain: w.chain, store: w.store, signer: w.judge, address: w.judge.address, env, notify: w.deps.notify };
}

describe("RAP judge: routes", () => {
  it("health names the judge and says when it cannot rule", async () => {
    const w = await world();
    const body = await (await handleHealth(context(w))).json();
    expect(body).toMatchObject({ ok: true, judge: w.judge.address.toBase58(), network: "solana-devnet", rule: JUDGE_RULE_VERSION, opsOverride: true });
    const without = await (await handleHealth({ ...context(w), signer: undefined })).json();
    expect(without).toMatchObject({ ok: false, problem: "key_not_configured", judge: w.judge.address.toBase58() });
  });

  it("the pass and the override answer only their own secrets", async () => {
    const w = await world();
    const ctx = context(w);
    expect((await handleCron(new Request("https://judge.example/api/cron/judge"), ctx)).status).toBe(401);
    expect((await handleCron(new Request("https://judge.example/api/cron/judge", { headers: { authorization: `Bearer ${OPS}` } }), ctx)).status).toBe(401);
    expect((await handleCron(new Request("https://judge.example/api/cron/judge", { headers: { authorization: "Bearer cron-secret" } }), ctx)).status).toBe(200);
    expect((await handleOps(post({ action: "hold", budget: w.slice.budget, payee: w.slice.payee, reason: "x" }, "cron-secret"), ctx)).status).toBe(401);
    expect((await handleOps(post({ action: "hold", budget: w.slice.budget, payee: w.slice.payee, reason: "x" }, OPS), { ...ctx, env: { BUDGET_JUDGE_OPS_SECRET: "short" } })).status).toBe(503);
    const held = await handleOps(post({ action: "hold", budget: w.slice.budget, payee: w.slice.payee, reason: "looking" }, OPS), ctx);
    expect(held.status).toBe(200);
    expect(heldBy(await w.store.log(w.slice), w.slice, ENV)).toBe("looking");
    const ruled = await handleOps(post({ action: "rule", budget: w.slice.budget, payee: w.slice.payee, payout: "250", reason: "agreed with both" }, OPS), ctx);
    expect(await ruled.json()).toMatchObject({ status: "ruled", payout: "250" });
  });
});
