import { LAUNCH_RATE_ENDS_AT_MS } from "@redditech/x402-solana/payment";
import { findSandboxScenario } from "@/lib/sandbox/catalog";
import {
  SPLICE_FILM_FUN,
  ARISTOTLE_HARMONIC,
  BUDGET_DEFAULTS,
  budgetCallCost,
  budgetDisputeEnds,
  closeSandboxBudget,
  budgetProtocolFee,
  checkReserve,
  maskAgentKey,
  newSandboxAgentKey,
  runSandboxBudget,
  SLOT_MS,
} from "@/lib/sandbox/budget-run";

const KEY = "rap_pass_testkeytestkeytestkey1234";
const START = Date.UTC(2026, 11, 5, 9, 0, 0); // inside the launch rate

describe("sandbox Budget scenario", () => {
  it("is listed as a scenario", () => {
    expect(findSandboxScenario("budget")?.title).toBe("Set a budget");
  });

  it("runs a $5 USDC Budget: three providers join, one is refused, and every unit is accounted for", async () => {
    const run = await runSandboxBudget({ token: "USDC", agentKey: KEY, startMs: START });
    expect(run.budget.total).toBe(BigInt(5_000_000));
    expect(run.budget.perProviderCap).toBe(BigInt(2_500_000));
    expect(run.joined.map((j) => j.providerId)).toEqual(["splice-film-fun", "tidepool-audio", "kettle-voice"]);
    expect(run.refused.map((r) => r.providerId)).toEqual(["booth-match"]);

    // Splice by film.fun, at its published prices: 6 credits a second at 768p, 5 credits a render, 100 credits = $1.
    const shot = budgetCallCost(SPLICE_FILM_FUN, 10, "USDC");
    expect(shot).toBe(BigInt(600_000));
    const splice = run.calls.filter((c) => c.providerId === "splice-film-fun");
    expect(splice.map((c) => [c.receipt.unit, c.receipt.amount])).toEqual([["second", "600000"], ["second", "600000"], ["second", "600000"], ["render", "50000"]]);
    // Twice the estimate passes the 50% cap, so the cap applies.
    expect(run.joined[0].reserved).toBe(BigInt(2_500_000));
    expect(splice).toHaveLength(4);
    expect(run.calls.every((c) => c.checked)).toBe(true);

    // Unreserved comes back at close; posted amounts are what the receipts add up to.
    const reservedSum = run.joined.reduce((s, j) => s + j.reserved, BigInt(0));
    expect(run.returnedAtClose).toBe(run.budget.total - reservedSum);
    for (const p of run.payouts) {
      const receipts = run.calls.filter((c) => c.providerId === p.providerId);
      expect(p.finalAmount.toString()).toBe(receipts[receipts.length - 1].receipt.cumulative);
      expect(p.fee).toBe((p.finalAmount * BigInt(250)) / BigInt(10_000));
      expect(p.toProvider + p.fee + p.returned).toBe(p.reserved);
    }
    expect(run.feeBps).toBe(BigInt(250));
    expect(run.totals.spent + run.totals.returned).toBe(run.budget.total);
    expect(run.totals.toProviders + run.totals.fee).toBe(run.totals.spent);
    expect(run.invariantHeldThroughout).toBe(true);
    expect(run.events.every((e) => e.invariantHolds)).toBe(true);
    expect(run.budget.reservations).toBe(run.joined.length);
  });

  it("chains each provider's receipts", async () => {
    const run = await runSandboxBudget({ token: "USDC", agentKey: KEY, startMs: START });
    const shots = run.calls.filter((c) => c.providerId === "splice-film-fun");
    expect(shots[0].receipt.previousReceiptHash).toBeNull();
    expect(shots[1].receipt.previousReceiptHash).toBe(shots[0].hash);
    expect(shots[2].receipt.previousReceiptHash).toBe(shots[1].hash);
    expect(shots.map((s) => s.receipt.sequence)).toEqual([1, 2, 3, 4]);
  });

  it("times the dispute window at 24 hours after close and reads the fee at payout", async () => {
    const run = await runSandboxBudget({ token: "USDC", agentKey: KEY, startMs: START });
    expect(run.times.disputeEndsAtMs - run.times.closedAtMs).toBe(BUDGET_DEFAULTS.disputeSlots * SLOT_MS);
    expect(run.times.expiresAtMs - run.times.openedAtMs).toBe(72 * 3600 * 1000);
    const late = await runSandboxBudget({ token: "USDC", agentKey: KEY, startMs: LAUNCH_RATE_ENDS_AT_MS + 1 });
    expect(late.feeBps).toBe(BigInt(500));
  });

  it("lets only providers that take the Budget's token join", async () => {
    const audd = await runSandboxBudget({ token: "AUDD", agentKey: KEY, startMs: START });
    expect(audd.joined.map((j) => j.providerId)).toEqual(["splice-film-fun", "tidepool-audio", "kettle-voice"]);
    expect(audd.refused.map((r) => r.providerId)).toEqual(["booth-match"]);
    const sol = await runSandboxBudget({ token: "SOL", agentKey: KEY, startMs: START });
    expect(sol.joined.map((j) => j.providerId)).toEqual(["splice-film-fun", "tidepool-audio", "booth-match"]);
    expect(sol.budget.total).toBe(BigInt(33_333_334)); // $5 at the 150 USD/SOL demo rate, rounded up
    for (const run of [audd, sol]) {
      expect(run.totals.spent + run.totals.returned).toBe(run.budget.total);
      expect(run.invariantHeldThroughout).toBe(true);
    }
  });

  it("applies the spec's reserve checks", async () => {
    const run = await runSandboxBudget({ token: "USDC", agentKey: KEY, startMs: START });
    const open = { ...run.budget, closed: false, unreserved: BigInt(1_000_000), reservations: 0 };
    expect(checkReserve(open, BigInt(50_000), 1, ["USDC"])).toBeNull();
    expect(checkReserve(open, BigInt(50_000), 1, ["SOL"])).toBe("token_not_accepted");
    expect(checkReserve(open, BigInt(49_999), 1, ["USDC"])).toBe("below_minimum");
    expect(checkReserve(open, BigInt(2_500_001), 1, ["USDC"])).toBe("over_provider_cap");
    expect(checkReserve(open, BigInt(1_000_001), 1, ["USDC"])).toBe("over_unreserved");
    expect(checkReserve({ ...open, reservations: 8 }, BigInt(100_000), 1, ["USDC"])).toBe("too_many_reservations");
    expect(checkReserve(open, BigInt(100_000), open.createdSlot + open.openSlots, ["USDC"])).toBe("budget_expired");
    expect(checkReserve({ ...open, closed: true }, BigInt(100_000), 1, ["USDC"])).toBe("budget_closed");
  });

  it("keeps a late post under review for at least an hour (B3) and caps the SOL fee", () => {
    const closedByPayer = { closedSlot: 100, disputeSlots: 216_000, reviewFromOpenEnd: false, createdSlot: 0, openSlots: 648_000 };
    expect(budgetDisputeEnds(closedByPayer, { postedSlot: 300_000 })).toBe(309_000);
    expect(budgetDisputeEnds(closedByPayer, { postedSlot: 200 })).toBe(216_100);
    expect(budgetProtocolFee(BigInt(10_000_000_000), "SOL", BigInt(500))).toBe(BigInt(100_000_000));
    expect(budgetProtocolFee(BigInt(10_000_000_000), "USDC", BigInt(500))).toBe(BigInt(500_000_000));
    expect(budgetProtocolFee(BigInt(39), "USDC", BigInt(250))).toBe(BigInt(0));
  });

  it("starts the window at the end of the open period when the agent closes early with no allowlist", async () => {
    const run = await runSandboxBudget({ token: "USDC", agentKey: KEY, startMs: START });
    expect(run.budget.reviewFromOpenEnd).toBe(false);
    const openEnd = run.budget.createdSlot + run.budget.openSlots;
    const byAgent = { ...run.budget, closed: false, reviewFromOpenEnd: false };
    closeSandboxBudget(byAgent, 1_000, false);
    expect(byAgent.reviewFromOpenEnd).toBe(true);
    expect(budgetDisputeEnds(byAgent, { postedSlot: 1_100 })).toBe(openEnd + byAgent.disputeSlots);
    const allowlisted = { ...run.budget, closed: false, reviewFromOpenEnd: false, allowlist: ["Splice by film.fun"] };
    closeSandboxBudget(allowlisted, 1_000, false);
    expect(allowlisted.reviewFromOpenEnd).toBe(false);
    expect(budgetDisputeEnds(allowlisted, { postedSlot: 1_100 })).toBe(1_000 + allowlisted.disputeSlots);
    const byPayer = { ...run.budget, closed: false, reviewFromOpenEnd: false };
    closeSandboxBudget(byPayer, 1_000, true);
    expect(byPayer.reviewFromOpenEnd).toBe(false);
  });

  it("makes rap_pass_ keys and masks them", () => {
    const key = newSandboxAgentKey();
    expect(key).toMatch(/^rap_pass_[A-Za-z0-9]{24}$/);
    expect(maskAgentKey(KEY)).toBe("rap_pass_test…1234");
  });
  it("features Splice by film.fun at its published prices, in every token, without a payout address", async () => {
    expect(SPLICE_FILM_FUN.featured.pricingSource.url).toBe("https://github.com/Rogues-Lab/splice-agent-skills");
    expect(SPLICE_FILM_FUN.payTo).not.toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    for (const token of ["USDC", "AUDD", "SOL"] as const) {
      const run = await runSandboxBudget({ token, agentKey: KEY, startMs: START });
      expect(run.joined[0].providerName).toBe("Splice by film.fun");
    }
  });

  it("verifies a Solana program on a $200 USDC Budget: Aristotle runs twice, billed by credits", async () => {
    expect(ARISTOTLE_HARMONIC.payTo).not.toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(ARISTOTLE_HARMONIC.featured.pricingSource.summary).toContain("illustrative");
    const run = await runSandboxBudget({ token: "USDC", job: "verify", agentKey: KEY, startMs: START });
    expect(run.budget.total).toBe(BigInt(200_000_000));
    expect(run.joined.map((j) => j.providerId)).toEqual(["aristotle-harmonic"]);
    // Aristotle: 65 credits estimated, twice that passes the 50% cap, so the cap applies.
    expect(run.joined[0].reserved).toBe(BigInt(100_000_000));
    const runs = run.calls.filter((c) => c.providerId === "aristotle-harmonic");
    expect(runs.map((c) => [c.receipt.unit, c.receipt.units, c.receipt.amount])).toEqual([["run", 40, "40000000"], ["run", 25, "25000000"]]);
    expect(run.calls.every((c) => c.checked)).toBe(true);
    const aristotle = run.payouts.find((p) => p.providerId === "aristotle-harmonic")!;
    expect(aristotle.finalAmount).toBe(BigInt(65_000_000));
    expect(aristotle.fee).toBe(BigInt(1_625_000));
    expect(aristotle.returned).toBe(BigInt(35_000_000));
    expect(run.totals.spent + run.totals.returned).toBe(run.budget.total);
    expect(run.invariantHeldThroughout).toBe(true);
  });

  it("leaves the launch-video job unchanged when no job is named", async () => {
    const named = await runSandboxBudget({ token: "USDC", job: "video", agentKey: KEY, startMs: START });
    const unnamed = await runSandboxBudget({ token: "USDC", agentKey: KEY, startMs: START });
    expect(unnamed.events.map((e) => e.text)).toEqual(named.events.map((e) => e.text));
  });

  it("lets nothing join a verification Budget in a token Aristotle doesn't take", async () => {
    const run = await runSandboxBudget({ token: "SOL", job: "verify", agentKey: KEY, startMs: START });
    expect(run.joined).toEqual([]);
    expect(run.refused.map((r) => r.providerId)).toEqual(["aristotle-harmonic"]);
    expect(run.totals.returned).toBe(run.budget.total);
  });
});
