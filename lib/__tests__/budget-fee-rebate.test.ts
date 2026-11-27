import { createHash } from "crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  BUDGET_OPENED_EVENT,
  BUDGET_PAID_EVENT,
  JUDGE_FREE_REBATE_ENDS_UNIX,
  decodeBudgetOpened,
  decodeBudgetPaid,
  judgeFreeRebates,
  type ProgramTx,
} from "@/lib/budget/fee-rebate";

const PROGRAM = "DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu";
const ZERO = new PublicKey(new Uint8Array(32));
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const key = () => Keypair.generate().publicKey;
const u64 = (n: bigint | number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};

function opened(budget: PublicKey, judge: PublicKey, createdSlot: number, mint = ZERO): string {
  const payer = key();
  return Buffer.concat([
    BUDGET_OPENED_EVENT,
    budget.toBuffer(),
    payer.toBuffer(),
    key().toBuffer(),
    judge.toBuffer(),
    mint.toBuffer(),
    u64(5_000_000),
    u64(createdSlot),
  ]).toString("base64");
}

function paid(budget: PublicKey, payee: PublicKey, fee: number, slot: number, outcome = 0): string {
  return Buffer.concat([
    BUDGET_PAID_EVENT,
    budget.toBuffer(),
    payee.toBuffer(),
    u64(1_000_000 - fee),
    u64(fee),
    u64(0),
    Buffer.from([outcome]),
    u64(slot),
  ]).toString("base64");
}

function tx(signature: string, slot: number, data: string[], extra: Partial<ProgramTx> = {}): ProgramTx {
  return {
    signature,
    slot,
    blockTime: JUDGE_FREE_REBATE_ENDS_UNIX - 86_400,
    err: null,
    logs: [`Program ${PROGRAM} invoke [1]`, ...data.map((d) => `Program data: ${d}`), `Program ${PROGRAM} success`],
    ...extra,
  };
}

describe("judge-free Budget fee rebate", () => {
  it("uses the program's own event discriminators", () => {
    expect(createHash("sha256").update("event:BudgetOpened").digest().subarray(0, 8)).toEqual(BUDGET_OPENED_EVENT);
    expect(createHash("sha256").update("event:BudgetPaid").digest().subarray(0, 8)).toEqual(BUDGET_PAID_EVENT);
  });

  it("ends at the same instant as the program's launch rate (2027-04-01 00:00 UTC)", () => {
    expect(new Date(JUDGE_FREE_REBATE_ENDS_UNIX * 1000).toISOString()).toBe("2027-04-01T00:00:00.000Z");
  });

  it("decodes BudgetOpened, naming SOL for the zero mint", () => {
    const budget = key();
    const judge = key();
    const sol = decodeBudgetOpened(Buffer.from(opened(budget, judge, 42), "base64"));
    expect(sol).toMatchObject({ budget: budget.toBase58(), judge: judge.toBase58(), mint: "SOL", createdSlot: BigInt(42) });
    const usdc = decodeBudgetOpened(Buffer.from(opened(budget, ZERO, 42, USDC), "base64"));
    expect(usdc?.mint).toBe(USDC.toBase58());
    expect(decodeBudgetOpened(Buffer.from(paid(budget, key(), 1, 1), "base64"))).toBeUndefined();
    expect(decodeBudgetPaid(Buffer.from(opened(budget, judge, 1), "base64"))).toBeUndefined();
  });

  it("refunds the fee of a judge-free payout and totals it per provider and token", () => {
    const budget = key();
    const other = key();
    const provider = key();
    const report = judgeFreeRebates(
      [
        tx("open-1", 10, [opened(budget, ZERO, 10)]),
        tx("pay-1", 20, [paid(budget, provider, 25_000, 20)]),
        tx("open-2", 30, [opened(other, ZERO, 30, USDC)]),
        tx("pay-2", 40, [paid(other, provider, 12_500, 40)]),
        tx("pay-3", 41, [paid(other, provider, 2_500, 41, 1)]),
      ],
      { programId: PROGRAM },
    );
    expect(report.skipped).toEqual([]);
    expect(report.lines.map((l) => l.signature)).toEqual(["pay-1", "pay-2", "pay-3"]);
    const owed = Object.fromEntries(report.owed.map((o) => [o.mint, o]));
    expect(owed.SOL).toMatchObject({ payee: provider.toBase58(), fee: BigInt(25_000), payouts: 1 });
    expect(owed[USDC.toBase58()]).toMatchObject({ fee: BigInt(15_000), payouts: 2 });
  });

  it("gives nothing for a judged Budget, a zero fee or a failed transaction", () => {
    const judged = key();
    const free = key();
    const provider = key();
    const report = judgeFreeRebates(
      [
        tx("open-judged", 1, [opened(judged, key(), 1)]),
        tx("pay-judged", 2, [paid(judged, provider, 25_000, 2)]),
        tx("open-free", 3, [opened(free, ZERO, 3)]),
        tx("pay-zero", 4, [paid(free, provider, 0, 4)]),
        tx("pay-failed", 5, [paid(free, provider, 25_000, 5)], { err: { InstructionError: [0, "Custom"] } }),
      ],
      { programId: PROGRAM },
    );
    expect(report.lines).toEqual([]);
    expect(report.owed).toEqual([]);
  });

  it("uses the opening in force at the payout when a Budget address is reused", () => {
    const budget = key();
    const provider = key();
    const report = judgeFreeRebates(
      [
        tx("open-free", 1, [opened(budget, ZERO, 1)]),
        tx("pay-free", 2, [paid(budget, provider, 100, 2)]),
        tx("open-judged", 3, [opened(budget, key(), 3)]),
        tx("pay-judged", 4, [paid(budget, provider, 100, 4)]),
      ],
      { programId: PROGRAM },
    );
    expect(report.lines.map((l) => l.signature)).toEqual(["pay-free"]);
  });

  it("fails closed: unknown opening, unknown time and payouts after the end are skipped with a reason", () => {
    const budget = key();
    const orphan = key();
    const provider = key();
    const report = judgeFreeRebates(
      [
        tx("open", 1, [opened(budget, ZERO, 1)]),
        tx("pay-orphan", 2, [paid(orphan, provider, 100, 2)]),
        tx("pay-no-time", 3, [paid(budget, provider, 100, 3)], { blockTime: null }),
        tx("pay-at-end", 4, [paid(budget, provider, 100, 4)], { blockTime: JUDGE_FREE_REBATE_ENDS_UNIX }),
        tx("pay-last-second", 5, [paid(budget, provider, 100, 5)], { blockTime: JUDGE_FREE_REBATE_ENDS_UNIX - 1 }),
      ],
      { programId: PROGRAM },
    );
    expect(report.lines.map((l) => l.signature)).toEqual(["pay-last-second"]);
    expect(Object.fromEntries(report.skipped.map((s) => [s.signature, s.reason]))).toEqual({
      "pay-orphan": "opening not found in the scanned history",
      "pay-no-time": "block time unknown",
      "pay-at-end": "paid out on or after the end of the offer",
    });
  });

  it("never pays twice and honours excluded payees", () => {
    const budget = key();
    const provider = key();
    const treasury = key();
    const report = judgeFreeRebates(
      [
        tx("open", 1, [opened(budget, ZERO, 1)]),
        tx("pay-1", 2, [paid(budget, provider, 100, 2)]),
        tx("pay-1", 2, [paid(budget, provider, 100, 2)]),
        tx("pay-2", 3, [paid(budget, provider, 100, 3)]),
        tx("pay-3", 4, [paid(budget, treasury, 100, 4)]),
      ],
      { programId: PROGRAM, alreadyPaid: new Set(["pay-2"]), excludePayees: new Set([treasury.toBase58()]) },
    );
    expect(report.lines.map((l) => l.signature)).toEqual(["pay-1"]);
    expect(report.skipped.map((s) => s.reason).sort()).toEqual(["already rebated", "payee excluded"]);
  });

  it("ignores events logged by another program", () => {
    const budget = key();
    const provider = key();
    const impostor = key().toBase58();
    const forged: ProgramTx = {
      signature: "forged",
      slot: 2,
      blockTime: JUDGE_FREE_REBATE_ENDS_UNIX - 10,
      err: null,
      logs: [
        `Program ${impostor} invoke [1]`,
        `Program data: ${opened(budget, ZERO, 1)}`,
        `Program data: ${paid(budget, provider, 100, 2)}`,
        `Program ${impostor} success`,
      ],
    };
    const report = judgeFreeRebates([forged], { programId: PROGRAM });
    expect(report.lines).toEqual([]);
    expect(report.skipped).toEqual([]);
  });
});
