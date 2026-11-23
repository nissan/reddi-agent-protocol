import { pinLaunchRateClock } from "@/lib/test-support/launch-clock";
import { sandboxBuildOfRecord } from "@/lib/sandbox/deployment";
import { MemoryNonceReplayStore } from "@redditech/x402-solana";
import { Keypair } from "@solana/web3.js";
import { findSandboxProviderById, findSandboxScenario, SANDBOX_PROVIDERS, STUDIO_PIPELINE, studioStepPrompt } from "@/lib/sandbox/catalog";
import { handleSandboxChatCompletion, sandboxModelsListing, type SandboxGatewayDeps } from "@/lib/sandbox/gateway";
import { runSandboxPipeline, studioProviders, typicalVideoCostMicroUsd } from "@/lib/sandbox/pipeline-run";
import { maxChargeLamports, requestInputTokens, formatUnits } from "@/lib/sandbox/pricing";
import { decodeReceiptHeader, encodeReceiptHeader, SANDBOX_SIMULATED_RECEIPT_HEADER, type SandboxReceipt } from "@/lib/sandbox/receipt";
import { applySandboxRating } from "@/lib/sandbox/reputation";

const ORIGIN = "https://sandbox.example";

function makeDeps(): SandboxGatewayDeps {
  let counter = 0;
  const unreachable = async () => {
    throw new Error("a studio call must not read the chain");
  };
  return {
    connection: { getGenesisHash: unreachable, getParsedTransaction: unreachable } as unknown as SandboxGatewayDeps["connection"],
    replayStore: new MemoryNonceReplayStore(),
    readAccount: unreachable,
    readSlot: unreachable,
    acceptMeteredSessions: true,
    newNonce: () => (++counter).toString(16).padStart(32, "b"),
  };
}

function gatewayFetch(deps: SandboxGatewayDeps, alter?: (headers: Record<string, string>, call: number) => void): typeof fetch {
  let call = 0;
  return (async (_url: string, init: { headers: Record<string, string>; body: string }) => {
    call += 1;
    const response = await handleSandboxChatCompletion({ body: JSON.parse(init.body), rawBody: init.body, paymentHeader: init.headers["x402-payment"], origin: ORIGIN }, deps);
    alter?.(response.headers, call);
    return new Response(response.bodyText, { status: response.status, headers: response.headers });
  }) as unknown as typeof fetch;
}

describe("sandbox: make a video with independent studios", () => {
  it("lists the scenario with five studios in pipeline order, each simulated-only with a public and a private side", () => {
    const scenario = findSandboxScenario("make-a-video")!;
    expect(scenario.providerIds).toEqual(STUDIO_PIPELINE.map((step) => step.providerId));
    for (const studio of studioProviders()) {
      expect(studio.simulatedOnly).toBe(true);
      expect(studio.model).toMatch(/^sandbox\//);
      expect(studio.studio?.shows).toBeTruthy();
      expect(studio.studio?.keeps).toBeTruthy();
    }
    // No studio shares a payee with another provider.
    const payees = SANDBOX_PROVIDERS.map((provider) => provider.payTo);
    expect(new Set(payees).size).toBe(payees.length);
  });

  it("hires every studio in turn: a quote, a simulated payment, a receipt checked with the 2.5% fee", async () => {
    const steps: string[] = [];
    const result = await runSandboxPipeline({ fetchImpl: gatewayFetch(makeDeps()), onStep: (row) => steps.push(row.provider.id) });
    if (!result.ok) throw new Error(result.message);
    expect(steps).toEqual(STUDIO_PIPELINE.map((step) => step.providerId));
    expect(result.rows.every((row) => row.checked)).toBe(true);
    expect(result.exchanges).toHaveLength(STUDIO_PIPELINE.length * 2);
    for (const row of result.rows) {
      const payment = row.receipt!.receipt.payment!;
      expect(row.receipt!.receipt.declaredModel).toBe(row.provider.model);
      expect(payment.amount).toBe(row.costLamports.toString());
      expect(BigInt(payment.fee.amount)).toBe((row.costLamports * BigInt(250)) / BigInt(10_000));
      expect(row.costLamports + row.refundedLamports).toBe(row.maxLamports);
      expect(row.maxLamports).toBe(maxChargeLamports(row.provider, requestInputTokens([{ content: studioStepPrompt(row.ask) }])));
    }
    expect(result.totalLamports).toBe(result.rows.reduce((sum, row) => sum + row.costLamports, BigInt(0)));
    expect(result.feeLamports > BigInt(0)).toBe(true);
  });

  it("stops at the first receipt that does not check, and hires nobody after it", async () => {
    // Call 6 is the third studio's paid call: its receipt claims a higher cost.
    const result = await runSandboxPipeline({
      fetchImpl: gatewayFetch(makeDeps(), (headers, call) => {
        if (call !== 6) return;
        const receipt = decodeReceiptHeader(headers[SANDBOX_SIMULATED_RECEIPT_HEADER]) as SandboxReceipt;
        receipt.receipt.payment!.amount = "999999";
        headers[SANDBOX_SIMULATED_RECEIPT_HEADER] = encodeReceiptHeader(receipt);
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[2].checked).toBe(false);
    expect(result.exchanges).toHaveLength(6);
    expect(!result.ok && result.message).toMatch(/^Kettle Voice:/);
  });

  it("refuses a receipt signed by a key other than the listed one", async () => {
    const result = await runSandboxPipeline({ fetchImpl: gatewayFetch(makeDeps()), providerReceiptIds: { "frame-foundry": Keypair.generate().publicKey.toBase58() } });
    expect(result.ok).toBe(false);
    expect(result.rows).toHaveLength(1);
  });

  it("refuses a devnet transfer or a metered escrow for a studio before reading the chain", async () => {
    const studio = findSandboxProviderById("frame-foundry")!;
    const deps = makeDeps();
    const messages = [{ role: "user", content: "Animate one shot." }];
    const amount = formatUnits(maxChargeLamports(studio, requestInputTokens(messages)), 9);
    const base = { network: "solana-devnet", payTo: studio.payTo, amount, currency: "SOL", nonce: "c".repeat(32) };
    for (const header of [
      { ...base, txSignature: "4".repeat(88), payer: Keypair.generate().publicKey.toBase58() },
      { ...base, settlement: "metered-escrow", escrow: Keypair.generate().publicKey.toBase58(), payer: Keypair.generate().publicKey.toBase58() },
    ]) {
      const body = { model: studio.model, messages };
      const response = await handleSandboxChatCompletion({ body, rawBody: JSON.stringify(body), paymentHeader: JSON.stringify(header), origin: ORIGIN }, deps);
      expect(response.status).toBe(402);
      expect(response.body).toMatchObject({ reason: "unsupported_receipt" });
      expect(String((response.body.error as { message: string }).message)).toMatch(/simulated payments only/);
    }
  });

  it("offers studios no devnet payment route in the challenge or the listing", async () => {
    const studio = findSandboxProviderById("tidepool-audio")!;
    const body = { model: studio.model, messages: [{ role: "user", content: "Score 30 seconds." }] };
    const challenge = await handleSandboxChatCompletion({ body, rawBody: JSON.stringify(body), origin: ORIGIN }, makeDeps());
    expect(challenge.status).toBe(402);
    const sandbox = challenge.body.sandbox as Record<string, unknown>;
    expect(sandbox.devnetPayment).toBeUndefined();
    expect(sandbox.meteredPayment).toBeUndefined();
    expect(sandbox.simulatedOnly).toMatch(/simulated payments only/);
    const listing = (await sandboxModelsListing({ canSettle: () => true, deployment: async () => ({ ok: true, build: sandboxBuildOfRecord()! }), settle: async () => ({ ok: false, message: "" }), lookup: async () => ({ state: "unknown" }) })) as { data: { rap: { providerId: string; simulatedPaymentsOnly?: boolean; meteredEscrow: { available: boolean } } }[] };
    const entry = listing.data.find((item) => item.rap.providerId === studio.id)!;
    expect(entry.rap.simulatedPaymentsOnly).toBe(true);
    expect(entry.rap.meteredEscrow.available).toBe(false);
  });

  it("estimates a real 30-second video at a few dollars across the five listings", () => {
    const usd = Number(typicalVideoCostMicroUsd()) / 1_000_000;
    expect(usd).toBeGreaterThan(5);
    expect(usd).toBeLessThan(6.5);
  });

  it("folds a buyer's star rating into the running average", () => {
    expect(applySandboxRating({ score: 4, receipts: 3 }, 5)).toEqual({ score: 4.25, receipts: 4 });
    expect(applySandboxRating({ score: 4, receipts: 3 }, 9)).toEqual({ score: 4.25, receipts: 4 });
    expect(applySandboxRating({ score: 4, receipts: 3 }, 0)).toEqual({ score: 3.25, receipts: 4 });
  });
});

// Fee terms built from the current time stay at the launch rate after 1 April 2027.
pinLaunchRateClock();
