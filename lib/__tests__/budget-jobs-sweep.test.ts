/**
 * #1145: calls paid from a Budget show up in My jobs. The sweep finds each paid-out slice and
 * hands it to the recorder with the provider's latest receipt.
 */
import { createPrivateKey, sign } from "crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BUDGET_DISCRIMINATORS, reservationAddress } from "@redditech/x402-solana/budget";
import { signReddiReceiptV2, type ReddiReceiptV2 } from "@redditech/agent-protocol";
import { BUDGET_PAID_EVENT } from "@/lib/jobs/budget-call";
import { BUDGET_JOBS_LOOKBACK_MS, latestV2Receipt, recordBudgetJobs, type BudgetJobsDeps } from "@/lib/jobs/budget-jobs-sweep";
import { recordVerifiedJob } from "@/lib/jobs/job-store";
import { base58 } from "@/lib/budget/watch";
import type { SpenderRecord } from "@/lib/budget/store";

const PROGRAM = Keypair.generate().publicKey;
const CREATED = BigInt(5_000_000);
const NOW = Date.UTC(2026, 10, 26, 6, 0, 0);
const budget = Keypair.generate().publicKey;
const payer = Keypair.generate().publicKey;
const provider = Keypair.generate();
const reservation = reservationAddress(budget, provider.publicKey, PROGRAM);
const PAYOUT = "4".repeat(88);
const RESERVE = "5".repeat(88);
const HASH = "c".repeat(64);

function eventBytes(paid: bigint, fee: bigint): string {
  const d = Buffer.alloc(105);
  BUDGET_PAID_EVENT.copy(d, 0);
  budget.toBuffer().copy(d, 8);
  provider.publicKey.toBuffer().copy(d, 40);
  d.writeBigUInt64LE(paid, 72);
  d.writeBigUInt64LE(fee, 80);
  d.writeBigUInt64LE(BigInt(100), 88);
  d[96] = 1;
  d.writeBigUInt64LE(CREATED + BigInt(9_000), 97);
  return d.toString("base64");
}

function payoutTx() {
  const data = Buffer.concat([Buffer.from(BUDGET_DISCRIMINATORS["global:payout_budget"]), Buffer.alloc(8)]);
  data.writeBigUInt64LE(CREATED, 8);
  return {
    meta: { err: null, logMessages: [`Program ${PROGRAM.toBase58()} invoke [1]`, `Program data: ${eventBytes(BigInt(975), BigInt(25))}`, `Program ${PROGRAM.toBase58()} success`] },
    transaction: { message: { instructions: [{ programId: PROGRAM, accounts: [budget, reservation, provider.publicKey, payer, Keypair.generate().publicKey], data: base58(data) }] } },
  };
}

/** A reserve (or post): the program, but not a payout. */
function reserveTx() {
  const data = Buffer.concat([Buffer.from(BUDGET_DISCRIMINATORS["global:reserve_budget"] ?? Buffer.alloc(8, 9)), Buffer.alloc(16)]);
  return { meta: { err: null, logMessages: [] }, transaction: { message: { instructions: [{ programId: PROGRAM, accounts: [budget, reservation], data: base58(data) }] } } };
}

async function receipt(opts: { cumulativeCost?: string; sequence?: string; createdSlot?: string } = {}): Promise<string> {
  const r: ReddiReceiptV2 = {
    schemaVersion: "reddi.receipt.v2",
    providerId: provider.publicKey.toBase58(),
    declaredModel: "mid-tier",
    requestHash: HASH,
    responseHash: HASH,
    session: {
      escrow: reservation.toBase58(), payer: payer.toBase58(), network: "solana-devnet", currency: "SOL", maxAmount: "2000",
      sequence: opts.sequence ?? "3", inputTokens: "10", outputTokens: "5",
      ...((opts.sequence ?? "3") === "1"
        ? { cumulativeInputTokens: "10", cumulativeOutputTokens: "5" }
        : { cumulativeInputTokens: "30", cumulativeOutputTokens: "15", previousReceiptHash: "d".repeat(64) }),
      cumulativeCost: opts.cumulativeCost ?? "1000", closed: false,
    },
    budget: { address: budget.toBase58(), createdSlot: opts.createdSlot ?? CREATED.toString(), reservation: reservation.toBase58() },
    issuedAt: "2026-11-26T05:00:00.000Z",
  };
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(provider.secretKey.subarray(0, 32))]);
  const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const signed = await signReddiReceiptV2(r, (m) => sign(null, m, key));
  return Buffer.from(JSON.stringify(signed)).toString("base64url");
}

function record(over: Partial<SpenderRecord> = {}): SpenderRecord {
  return {
    id: "a".repeat(32),
    payer: payer.toBase58(),
    network: "solana-devnet",
    status: "closed",
    budget: budget.toBase58(),
    createdSlot: CREATED.toString(),
    expectedPayees: [provider.publicKey.toBase58()],
    createdAt: new Date(NOW - 3 * 24 * 3600 * 1000).toISOString(),
    ...over,
  } as SpenderRecord;
}

type Opts = {
  records?: SpenderRecord[];
  exists?: boolean;
  signatures?: string[];
  txs?: Record<string, unknown>;
  receipts?: string[];
  recorded?: string[];
  insert?: { status: number; body?: unknown };
  failReceipts?: boolean;
};

function harness(opts: Opts) {
  const writes: Record<string, unknown>[] = [];
  const parsedReads: string[] = [];
  const stats: string[] = [];
  const deps: BudgetJobsDeps = {
    programId: PROGRAM,
    now: () => NOW,
    records: async () => opts.records ?? [record()],
    receipts: async () => {
      if (opts.failReceipts) throw new Error("store down");
      return opts.receipts ?? [];
    },
    accountExists: async () => opts.exists ?? false,
    signaturesFor: async () => (opts.signatures ?? [PAYOUT]).map((signature) => ({ signature, err: null })),
    getParsedTransaction: async (signature) => {
      parsedReads.push(signature);
      return (opts.txs ?? { [PAYOUT]: payoutTx() })[signature] as never;
    },
    refreshProviderStats: async (p) => {
      stats.push(p);
    },
    url: "https://db.example.supabase.co",
    serviceKey: "service",
    fetchImpl: (async (url: string, init: { method: string; body?: string }) => {
      if (init.method === "GET") return { ok: true, status: 200, json: async () => (opts.recorded ?? []).map((tx_signature) => ({ tx_signature })) };
      writes.push(JSON.parse(init.body!));
      const insert = opts.insert ?? { status: 201, body: [{ id: "job-1" }] };
      return { ok: insert.status < 300, status: insert.status, json: async () => insert.body };
    }) as never,
  };
  return { deps, writes, parsedReads, stats };
}

describe("Budget job sweep (#1145)", () => {
  it("records one job, tagged with its Budget, for a slice paid out with a matching receipt (RAP-1145-S1)", async () => {
    const h = harness({ receipts: [await receipt()], signatures: [PAYOUT, RESERVE], txs: { [PAYOUT]: payoutTx(), [RESERVE]: reserveTx() } });
    const out = await recordBudgetJobs(h.deps);
    expect(out).toEqual([{ budget: budget.toBase58(), payee: provider.publicKey.toBase58(), status: "recorded", jobId: "job-1", signature: PAYOUT }]);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]).toMatchObject({
      buyer_wallet: payer.toBase58(),
      provider_wallet: provider.publicKey.toBase58(),
      amount_base_units: "1000",
      mint: "SOL",
      tx_signature: PAYOUT,
      status: "delivered",
      budget: budget.toBase58(),
      budget_created_slot: CREATED.toString(),
    });
    expect(h.stats).toEqual([provider.publicKey.toBase58()]);
  });

  it("finds the payout behind newer transactions on the reservation", async () => {
    const h = harness({ receipts: [await receipt()], signatures: [RESERVE, PAYOUT], txs: { [PAYOUT]: payoutTx(), [RESERVE]: reserveTx() } });
    expect((await recordBudgetJobs(h.deps))[0]).toMatchObject({ status: "recorded", signature: PAYOUT });
  });

  it("writes nothing while the slice is reserved or posted (RAP-1145-S2)", async () => {
    const open = harness({ exists: true, receipts: [await receipt()] });
    expect((await recordBudgetJobs(open.deps))[0]).toMatchObject({ status: "not_paid_out" });
    expect(open.writes).toEqual([]);
    expect(open.parsedReads).toEqual([]);
    const onlyReserve = harness({ receipts: [await receipt()], signatures: [RESERVE], txs: { [RESERVE]: reserveTx() } });
    expect((await recordBudgetJobs(onlyReserve.deps))[0]).toMatchObject({ status: "no_payout_found" });
    expect(onlyReserve.writes).toEqual([]);
  });

  it("refuses a receipt that names another opening of the Budget and writes nothing (RAP-1145-S3)", async () => {
    const h = harness({ receipts: [await receipt({ createdSlot: "8" })] });
    expect((await recordBudgetJobs(h.deps))[0]).toMatchObject({ status: "refused", reason: "receipt_budget_mismatch" });
    expect(h.writes).toEqual([]);
  });

  it("refuses a payout above what the receipts show", async () => {
    const h = harness({ receipts: [await receipt({ cumulativeCost: "900" })] });
    expect((await recordBudgetJobs(h.deps))[0]).toMatchObject({ status: "refused", reason: "paid_above_receipts" });
    expect(h.writes).toEqual([]);
  });

  it("does not read the chain again for a slice already recorded", async () => {
    const h = harness({ receipts: [await receipt()], recorded: [PAYOUT] });
    expect((await recordBudgetJobs(h.deps))[0]).toMatchObject({ status: "already_recorded", signature: PAYOUT });
    expect(h.parsedReads).toEqual([]);
    expect(h.writes).toEqual([]);
  });

  it("needs a v2 receipt: none, or only sandbox ones, records nothing", async () => {
    const sandbox = Buffer.from(JSON.stringify({ receipt: { schemaVersion: "rap.sandbox.budget-receipt.v1" } })).toString("base64url");
    for (const receipts of [[], [sandbox], ["not base64url!"]]) {
      const h = harness({ receipts });
      expect((await recordBudgetJobs(h.deps))[0]).toMatchObject({ status: "no_receipt" });
      expect(h.writes).toEqual([]);
    }
  });

  it("says a slice could not be read, so the pass fails visibly and retries it", async () => {
    const h = harness({ failReceipts: true });
    expect((await recordBudgetJobs(h.deps))[0]).toMatchObject({ status: "unreadable" });
    const down = harness({});
    down.deps.records = async () => {
      throw new Error("custody down");
    };
    expect(await recordBudgetJobs(down.deps)).toEqual([expect.objectContaining({ status: "unreadable" })]);
  });

  it("tells a provider with no listing apart from a job already recorded", async () => {
    const unlisted = harness({ receipts: [await receipt()], insert: { status: 409, body: { code: "23503" } } });
    expect((await recordBudgetJobs(unlisted.deps))[0]).toMatchObject({ status: "refused", reason: "provider_not_listed" });
    const dup = harness({ receipts: [await receipt()], insert: { status: 409, body: { code: "23505" } } });
    expect((await recordBudgetJobs(dup.deps))[0]).toMatchObject({ status: "already_recorded" });
  });

  it("looks only at Budgets opened within the look-back and with an opening recorded", async () => {
    const old = record({ createdAt: new Date(NOW - BUDGET_JOBS_LOOKBACK_MS - 1000).toISOString() });
    const pending = record({ budget: undefined, createdSlot: undefined });
    const h = harness({ records: [old, pending], receipts: [await receipt()] });
    expect(await recordBudgetJobs(h.deps)).toEqual([]);
  });

  it("picks the receipt with the most calls served", async () => {
    const first = await receipt({ sequence: "1", cumulativeCost: "300" });
    const latest = await receipt({ sequence: "3", cumulativeCost: "1000" });
    const picked = latestV2Receipt([first, latest]) as { receipt: { session: { sequence: string } } };
    expect(picked.receipt.session.sequence).toBe("3");
  });
});

describe("job store: Budget jobs", () => {
  const job = {
    buyerWallet: payer.toBase58(),
    providerWallet: provider.publicKey.toBase58(),
    network: "solana-devnet" as const,
    declaredModel: "m",
    requestHash: HASH,
    amountBaseUnits: "1",
    mint: "SOL",
    txSignature: PAYOUT,
    status: "delivered" as const,
  };
  it("refuses a malformed Budget reference", async () => {
    for (const bad of [{ address: "nope", createdSlot: "1" }, { address: budget.toBase58(), createdSlot: "0" }]) {
      expect(await recordVerifiedJob({ ...job, budget: bad }, { url: "https://db.example.supabase.co", serviceKey: "k", fetchImpl: (async () => ({ ok: true, status: 201, json: async () => [{ id: "x" }] })) as never })).toEqual({ ok: false, code: "invalid_job" });
    }
  });
  it("leaves the Budget columns off a job that no Budget paid", async () => {
    let body: Record<string, unknown> = {};
    await recordVerifiedJob(job, { url: "https://db.example.supabase.co", serviceKey: "k", fetchImpl: (async (_u: string, init: { body?: string }) => ((body = JSON.parse(init.body!)), { ok: true, status: 201, json: async () => [{ id: "x" }] })) as never });
    expect(body).not.toHaveProperty("budget");
    expect(body).not.toHaveProperty("budget_created_slot");
  });
});
