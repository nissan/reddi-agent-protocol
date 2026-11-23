import { pinLaunchRateClock } from "@/lib/test-support/launch-clock";
import { MemoryNonceReplayStore } from "@redditech/x402-solana";
import { handleSandboxChatCompletion, type SandboxGatewayDeps } from "@/lib/sandbox/gateway";
import { PREVIEW_LOCK_NETWORK_FEE_LAMPORTS, PREVIEW_SETTLE_NETWORK_FEE_LAMPORTS, previewAnswer, previewMaxLamports, previewQuote } from "@/lib/try/preview";
import { TRY_LOCK_COMPUTE_UNITS, TRY_LOCK_MICRO_LAMPORTS_PER_UNIT } from "@/lib/try/flow";
import { TRY_TASKS, tryTaskProvider } from "@/lib/try/tasks";

const ORIGIN = "https://app.example.test";
const NOW_MS = Date.UTC(2026, 10, 23, 6, 0, 0);
pinLaunchRateClock();

function makeDeps(): SandboxGatewayDeps {
  let counter = 0;
  // A preview never reads the chain, so any read fails the test.
  const connection = new Proxy({}, { get: () => () => { throw new Error("a preview must not read the chain"); } }) as SandboxGatewayDeps["connection"];
  return { connection, replayStore: new MemoryNonceReplayStore(), now: () => NOW_MS, newNonce: () => (++counter).toString(16).padStart(32, "0") };
}

/** A fetch that serves the sandbox gateway in process, the way the route does, with no wallet and no chain. */
function gatewayFetch(deps: SandboxGatewayDeps, calls: { headers: Record<string, string> }[] = []): typeof fetch {
  return (async (_url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ headers: init.headers });
    const reply = await handleSandboxChatCompletion({ body: JSON.parse(init.body), rawBody: init.body, paymentHeader: init.headers["x402-payment"], origin: ORIGIN }, deps);
    return {
      status: reply.status,
      text: async () => reply.bodyText,
      headers: { get: (name: string) => reply.headers[name.toLowerCase()] ?? reply.headers[name] ?? null },
    };
  }) as unknown as typeof fetch;
}

describe("try page preview without a wallet", () => {
  it("quotes, answers and returns a signed simulated receipt that checks out for every task", async () => {
    for (const task of TRY_TASKS) {
      const deps = makeDeps();
      const calls: { headers: Record<string, string> }[] = [];
      const fetchImpl = gatewayFetch(deps, calls);
      const quote = await previewQuote(task, fetchImpl);
      if (!quote.ok) throw new Error(`${task.id}: ${quote.message}`);
      expect(quote.maxLamports).toBe(previewMaxLamports(task));
      expect(quote.challenge.payTo).toBe(tryTaskProvider(task).payTo);

      const reply = await previewAnswer(task, quote.challenge, fetchImpl);
      if (!reply.ok) throw new Error(`${task.id}: ${reply.message}`);
      expect(reply.verification.kind).toBe("simulated");
      expect(reply.verification.checks.length).toBeGreaterThan(0);
      expect(reply.verification.checks.filter((check) => !check.passed)).toEqual([]);
      // No wallet, no transaction: the payment sent is the simulated form, and the receipt names no payer or transaction.
      expect(JSON.parse(calls[1].headers["x402-payment"]).simulated).toBe(true);
      const payment = (reply.result.receipt as { receipt: { payment: Record<string, unknown> } }).receipt.payment;
      expect(payment.txSignature).toBeUndefined();
      expect(payment.payer).toBeUndefined();
      expect(BigInt(payment.amount as string)).toBeLessThanOrEqual(quote.maxLamports);
    }
  });

  it("shows the PR review's real arithmetic: the protocol fee inside the cost and the change back", async () => {
    const task = TRY_TASKS.find((t) => t.id === "pr-review")!;
    const fetchImpl = gatewayFetch(makeDeps());
    const quote = await previewQuote(task, fetchImpl);
    if (!quote.ok) throw new Error(quote.message);
    const reply = await previewAnswer(task, quote.challenge, fetchImpl);
    if (!reply.ok) throw new Error(reply.message);
    const payment = (reply.result.receipt as { receipt: { payment: { amount: string; fee: { amount: string }; metered: { refunded: string; maxAmount: string } } } }).receipt.payment;
    expect(BigInt(payment.fee.amount)).toBeGreaterThan(BigInt(0));
    expect(BigInt(payment.metered.refunded)).toBe(BigInt(payment.metered.maxAmount) - BigInt(payment.amount));
    // The typical network fees shown beside it stay well under the call's cost.
    expect(BigInt(payment.amount)).toBeGreaterThan(BigInt(20) * PREVIEW_LOCK_NETWORK_FEE_LAMPORTS);
  });

  it("refuses a second use of the same preview payment", async () => {
    const task = TRY_TASKS[0];
    const fetchImpl = gatewayFetch(makeDeps());
    const quote = await previewQuote(task, fetchImpl);
    if (!quote.ok) throw new Error(quote.message);
    expect((await previewAnswer(task, quote.challenge, fetchImpl)).ok).toBe(true);
    const again = await previewAnswer(task, quote.challenge, fetchImpl);
    expect(again.ok).toBe(false);
  });

  it("states typical network fees that match the devnet lock's compute budget", () => {
    const priority = Math.ceil((TRY_LOCK_COMPUTE_UNITS * TRY_LOCK_MICRO_LAMPORTS_PER_UNIT) / 1_000_000);
    expect(PREVIEW_LOCK_NETWORK_FEE_LAMPORTS).toBe(BigInt(5_000 + priority));
    expect(PREVIEW_SETTLE_NETWORK_FEE_LAMPORTS).toBe(BigInt(5_000));
  });
});
