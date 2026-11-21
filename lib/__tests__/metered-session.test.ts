import { tokenCostBaseUnits } from "@redditech/x402-solana/metered";
import {
  BuyerSessionBook,
  openBuyerSession,
  planSessionCall,
  recordSessionAnswer,
  recordSessionRefusal,
  sessionRefusalCode,
  type BuyerSession,
} from "@/lib/payments/metered-session";

// RAP-SESSION-S1: 0.15 USDC lock at $2 / $10 per million, ten calls of 1,500 in and 350 out.
const PRICE = { currency: "USDC", inputPerMillion: "2", outputPerMillion: "10" };
const ESCROW = "Esc111111111111111111111111111111111111111";
const USAGE = { inputTokens: 1_500, outputTokens: 350 };
const PER_CALL = tokenCostBaseUnits(PRICE, USAGE); // 6,500 base units = $0.0065
const hash = (n: number) => n.toString(16).padStart(64, "0");

function open(lock = BigInt(150_000)): BuyerSession {
  return openBuyerSession({ providerKey: "prov", escrow: ESCROW, paymentHeader: "pay", lockBaseUnits: lock, price: PRICE, maxOutputTokens: 1_000 });
}

function receipt(seq: number, overrides: Record<string, unknown> = {}, closed = false) {
  const cost = String(PER_CALL * BigInt(seq));
  return {
    session: {
      escrow: ESCROW,
      sequence: String(seq),
      inputTokens: "1500",
      outputTokens: "350",
      cumulativeInputTokens: String(1_500 * seq),
      cumulativeOutputTokens: String(350 * seq),
      cumulativeCost: cost,
      ...(seq > 1 ? { previousReceiptHash: hash(seq - 1) } : {}),
      closed,
      ...overrides,
    },
    ...(closed ? { payment: { settlement: "metered-escrow", txSignature: "settle-sig", amount: cost } } : {}),
  };
}

function run(session: BuyerSession, calls: number): BuyerSession {
  let s = session;
  for (let n = 1; n <= calls; n++) {
    const plan = planSessionCall(s, USAGE.inputTokens, { close: n === calls });
    if (!plan.ok) throw new Error(plan.message);
    const r = recordSessionAnswer(s, { receipt: receipt(n, {}, n === calls), receiptHash: hash(n) });
    if (!r.ok) throw new Error(r.message);
    s = r.session;
  }
  return s;
}

describe("buyer session settlement (#863)", () => {
  it("S1: ten calls under one lock end settled at the last running total", () => {
    const s = run(open(), 10);
    expect(PER_CALL).toBe(BigInt(6_500));
    expect(s.state).toBe("settled");
    expect(s.costBaseUnits).toBe(BigInt(65_000));
    expect(s.settleSignature).toBe("settle-sig");
    expect(s.calls).toHaveLength(10);
  });

  it("sends the payment header and the sequence on every call, and close on the last", () => {
    const s = open();
    expect(planSessionCall(s, 1_500)).toEqual({ ok: true, sequence: 1, headers: { "x402-payment": "pay", "x402-session-sequence": "1" } });
    const closing = planSessionCall(s, 1_500, { close: true });
    expect(closing.ok && closing.headers["x402-session"]).toBe("close");
  });

  it("S2: refuses locally when the next call's worst case would pass the lock", () => {
    // Worst case per call: 1,500 in and 1,000 out = 13,000 base units; 6,500 + 13,000 > 19,000.
    const lock = BigInt(19_000);
    expect(planSessionCall(open(lock), 1_500).ok).toBe(true);
    const s = run(open(lock), 1);
    const next = planSessionCall({ ...s, state: "open" }, 1_500);
    expect(next).toMatchObject({ ok: false, reason: "session_max_reached" });
  });

  it("S3: disputes a skipped or replayed sequence", () => {
    const s = open();
    expect(recordSessionAnswer(s, { receipt: receipt(2), receiptHash: hash(2) })).toMatchObject({ ok: false, reason: "session_mismatch" });
  });

  it("disputes a broken chain", () => {
    const first = recordSessionAnswer(open(), { receipt: receipt(1), receiptHash: hash(1) });
    if (!first.ok) throw new Error("first call");
    const r = recordSessionAnswer(first.session, { receipt: receipt(2, { previousReceiptHash: hash(99) }), receiptHash: hash(2) });
    expect(r).toMatchObject({ ok: false, reason: "session_mismatch" });
    expect(r.session.state).toBe("disputed");
  });

  it("disputes a running total ahead of the tokens served", () => {
    const r = recordSessionAnswer(open(), { receipt: receipt(1, { cumulativeCost: String(PER_CALL + BigInt(1)) }), receiptHash: hash(1) });
    expect(r).toMatchObject({ ok: false, reason: "session_overcharge" });
  });

  it("disputes token totals that do not add up", () => {
    const r = recordSessionAnswer(open(), { receipt: receipt(1, { cumulativeOutputTokens: "400" }), receiptHash: hash(1) });
    expect(r).toMatchObject({ ok: false, reason: "session_mismatch" });
  });

  it("disputes a closing receipt whose payment is not the running total", () => {
    const bad = receipt(1, {}, true);
    (bad.payment as Record<string, unknown>).amount = "1";
    expect(recordSessionAnswer(open(), { receipt: bad, receiptHash: hash(1) })).toMatchObject({ ok: false, reason: "session_mismatch" });
  });

  it("disputes a payment block on an open session's receipt", () => {
    const bad = { ...receipt(1), payment: { settlement: "metered-escrow", txSignature: "x", amount: "6500" } };
    expect(recordSessionAnswer(open(), { receipt: bad, receiptHash: hash(1) })).toMatchObject({ ok: false });
  });

  it("refuses new calls once a session is not open", () => {
    const s = recordSessionRefusal(open(), "session_window_closing");
    expect(s.state).toBe("closing");
    expect(planSessionCall(s, 10)).toMatchObject({ ok: false, reason: "session_not_open" });
    expect(recordSessionRefusal(open(), "session_closed").state).toBe("closed");
  });

  it("reads session refusal codes from a provider's error body", () => {
    expect(sessionRefusalCode({ error: { code: "session_max_reached" } })).toBe("session_max_reached");
    expect(sessionRefusalCode({ error: { code: "other" } })).toBeUndefined();
    expect(sessionRefusalCode(null)).toBeUndefined();
  });

  it("reuses an open session per provider and currency", () => {
    const book = new BuyerSessionBook();
    const s = open();
    book.put(s);
    expect(book.get("prov", "USDC")).toBe(s);
    expect(book.get("prov", "SOL")).toBeUndefined();
    book.put(run(s, 1));
    expect(book.get("prov", "USDC")).toBeUndefined();
  });
});
