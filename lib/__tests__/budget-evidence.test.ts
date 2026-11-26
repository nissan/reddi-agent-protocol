/**
 * #1157: beside each posted share, the payer sees the calls their Budget signed and the
 * provider's latest receipt, and, on a Budget the RAP judge rules on, what a dispute would pay.
 */
import { createPrivateKey, sign } from "crypto";
import { Keypair } from "@solana/web3.js";
import { reservationAddress } from "@redditech/x402-solana/budget";
import { signReddiReceiptV2, type ReddiReceiptV2 } from "@redditech/agent-protocol";
import { budgetEvidence, type EvidenceDeps } from "@/lib/budget/evidence";
import type { BudgetView, SliceView } from "@/lib/budget/page";

const PROGRAM = Keypair.generate().publicKey;
const CREATED = "5000000";
const budget = Keypair.generate().publicKey;
const payer = Keypair.generate().publicKey;
const provider = Keypair.generate();
const other = Keypair.generate().publicKey;
const judge = Keypair.generate().publicKey.toBase58();
const reservation = reservationAddress(budget, provider.publicKey, PROGRAM);
const HASH = "c".repeat(64);

async function receipt(cumulativeCost: string, sequence = "3"): Promise<string> {
  const r: ReddiReceiptV2 = {
    schemaVersion: "reddi.receipt.v2",
    providerId: provider.publicKey.toBase58(),
    declaredModel: "mid-tier",
    requestHash: HASH,
    responseHash: HASH,
    session: {
      escrow: reservation.toBase58(), payer: payer.toBase58(), network: "solana-devnet", currency: "SOL", maxAmount: "2000",
      sequence, inputTokens: "10", outputTokens: "5",
      ...(sequence === "1"
        ? { cumulativeInputTokens: "10", cumulativeOutputTokens: "5" }
        : { cumulativeInputTokens: "30", cumulativeOutputTokens: "15", previousReceiptHash: "d".repeat(64) }),
      cumulativeCost, closed: false,
    },
    budget: { address: budget.toBase58(), createdSlot: CREATED, reservation: reservation.toBase58() },
    issuedAt: "2026-11-26T05:00:00.000Z",
  };
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(provider.secretKey.subarray(0, 32))]);
  const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const signed = await signReddiReceiptV2(r, (m) => sign(null, m, key));
  return Buffer.from(JSON.stringify(signed)).toString("base64url");
}

function slice(over: Partial<SliceView> = {}): SliceView {
  return { payee: provider.publicKey.toBase58(), reserved: "2000", posted: "1500", state: "posted", approved: false, actions: ["approve", "dispute"], ...over };
}

function view(slices: SliceView[], judgeAddress: string | null = judge): BudgetView {
  return {
    address: budget.toBase58(), payer: payer.toBase58(), token: "SOL", decimals: 9, total: "10000", unreserved: "8000", perProviderCap: "2000",
    judge: judgeAddress, createdSlot: CREATED, openEndsSlot: "6000000", closedSlot: null, closed: false, reviewFromOpenEnd: false, slot: "5000500",
    providers: [], slices, canClose: true,
  };
}

function deps(opts: { receipts?: string[]; hashes?: string[]; count?: number; fail?: boolean; rapJudge?: string | null } = {}): EvidenceDeps & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    programId: PROGRAM,
    network: "solana-devnet",
    rapJudge: opts.rapJudge === undefined ? judge : opts.rapJudge,
    store: {
      signedCalls: async (s) => {
        reads.push(s.payee);
        if (opts.fail) throw new Error("store down");
        return { count: opts.count ?? 3, bodyHashes: new Set(opts.hashes ?? [HASH]) };
      },
      receipts: async () => opts.receipts ?? [],
    },
  };
}

describe("budgetEvidence", () => {
  it("shows the signed calls, the latest receipt and what the RAP judge would pay", async () => {
    const out = await budgetEvidence(view([slice()]), deps({ receipts: [await receipt("1000"), await receipt("400", "1")] }));
    expect(out[provider.publicKey.toBase58()]).toEqual({ signedCalls: 3, receipt: { served: 3, cost: "1000" }, judgeWouldPay: "1000" });
  });

  it("never says a dispute pays more than the post", async () => {
    const out = await budgetEvidence(view([slice({ posted: "800" })]), deps({ receipts: [await receipt("1000")] }));
    expect(out[provider.publicKey.toBase58()].judgeWouldPay).toBe("800");
  });

  it("leaves out what a dispute would pay when another judge rules on the Budget", async () => {
    const out = await budgetEvidence(view([slice()], Keypair.generate().publicKey.toBase58()), deps({ receipts: [await receipt("1000")] }));
    expect(out[provider.publicKey.toBase58()]).toEqual({ signedCalls: 3, receipt: { served: 3, cost: "1000" } });
    const none = await budgetEvidence(view([slice()]), deps({ receipts: [await receipt("1000")], rapJudge: null }));
    expect(none[provider.publicKey.toBase58()].judgeWouldPay).toBeUndefined();
  });

  it("shows no receipt when none matches a call the Budget signed", async () => {
    const unsigned = await budgetEvidence(view([slice()]), deps({ receipts: [await receipt("1000")], hashes: ["e".repeat(64)] }));
    expect(unsigned[provider.publicKey.toBase58()]).toEqual({ signedCalls: 3, receipt: null, judgeWouldPay: "0" });
    const tooMany = await budgetEvidence(view([slice()]), deps({ receipts: [await receipt("1000")], count: 2 }));
    expect(tooMany[provider.publicKey.toBase58()].receipt).toBeNull();
  });

  it("reads only posted or disputed shares, and leaves out a share it cannot read", async () => {
    const d = deps({ receipts: [await receipt("1000")] });
    const out = await budgetEvidence(view([slice({ state: "open", posted: "0" }), slice({ payee: other.toBase58(), state: "paid" })]), d);
    expect(out).toEqual({});
    expect(d.reads).toEqual([]);
    expect(await budgetEvidence(view([slice()]), deps({ fail: true }))).toEqual({});
  });
});
