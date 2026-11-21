import { MemoryNonceReplayStore, SOLANA_GENESIS_HASHES } from "@reddi/x402-solana";
import { validateReddiReceiptV2, verifyReddiReceiptV2 } from "@reddi/agent-protocol/receipt-v2";
import { findSandboxProviderById, SANDBOX_ENDPOINT_PATH, SANDBOX_PROVIDERS } from "@/lib/sandbox/catalog";
import { marketingSignupUrl } from "@/lib/sandbox/client";
import { countTokens, formatUnits, maxChargeLamports, requestInputTokens, SANDBOX_FEE_TREASURY, settleSandboxCall } from "@/lib/sandbox/pricing";
import { handleSandboxChatCompletion, sandboxModelsListing, type SandboxGatewayDeps } from "@/lib/sandbox/gateway";
import {
  decodeReceiptHeader,
  isSandboxReceipt,
  PROVIDER_RECEIPT_HEADER,
  responseBodyWithAnswer,
  SANDBOX_SIMULATED_RECEIPT_HEADER,
  sha256Hex,
  verifySandboxReceipt,
  type SandboxReceipt,
} from "@/lib/sandbox/receipt";

const ORIGIN = "https://sandbox.example";
const NOW_MS = Date.UTC(2026, 10, 20, 4, 0, 0);
const PAYER = "9qbchEAHxg2iTMJTQNV5KrLUxXgqFT7HJMUGKMGUt17G";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const swift = findSandboxProviderById("swift-infer")!;
const messages = [{ role: "user", content: "Explain exponential backoff in two sentences." }];
// A transaction signature in the form the chain uses. Not a real transaction.
const SIG_A = "5".repeat(88);
const REQUEST_TEXT = JSON.stringify({ model: swift.model, messages });
// The most this request can cost with Swift Inference: its input plus 1,000 output tokens, at $0.20 / $0.80 per million and the demo SOL rate.
const MAX_LAMPORTS = maxChargeLamports(swift, requestInputTokens(messages));
const MAX_SOL = formatUnits(MAX_LAMPORTS, 9);

type FakeTransfer = { source?: string; destination?: string; lamports?: number; blockTime?: number; failed?: boolean };

function fakeConnection(transfers: Record<string, FakeTransfer>, options: { genesis?: string; throwOnRead?: boolean } = {}) {
  const calls = { genesis: 0, read: 0 };
  return {
    calls,
    async getGenesisHash() {
      calls.genesis += 1;
      return options.genesis ?? SOLANA_GENESIS_HASHES["solana-devnet"];
    },
    async getParsedTransaction(signature: string) {
      calls.read += 1;
      if (options.throwOnRead) throw new Error("rpc down");
      const transfer = transfers[signature];
      if (!transfer) return null;
      return {
        blockTime: transfer.blockTime ?? Math.floor(NOW_MS / 1000) - 10,
        meta: { err: transfer.failed ? { InstructionError: [0, "Custom"] } : null },
        transaction: {
          message: {
            instructions: [{
              programId: SYSTEM_PROGRAM,
              parsed: { type: "transfer", info: { source: transfer.source ?? PAYER, destination: transfer.destination ?? swift.payTo, lamports: transfer.lamports ?? Number(MAX_LAMPORTS) } },
            }],
          },
        },
      };
    },
  };
}

function makeDeps(connection = fakeConnection({})): SandboxGatewayDeps & { connection: ReturnType<typeof fakeConnection> } {
  let counter = 0;
  return {
    connection,
    replayStore: new MemoryNonceReplayStore(),
    now: () => NOW_MS,
    newNonce: () => (++counter).toString(16).padStart(32, "0"),
  };
}

function call(deps: SandboxGatewayDeps, paymentHeader?: string, body: unknown = { model: swift.model, messages }) {
  return handleSandboxChatCompletion({ body, rawBody: JSON.stringify(body), paymentHeader, origin: ORIGIN }, deps);
}

type GatewayResponse = Awaited<ReturnType<typeof call>>;

function receiptOf(response: GatewayResponse, header = SANDBOX_SIMULATED_RECEIPT_HEADER): SandboxReceipt {
  const decoded = decodeReceiptHeader(response.headers[header]);
  if (!isSandboxReceipt(decoded)) throw new Error(`no readable receipt in ${header}`);
  return decoded;
}

function noReceipt(response: GatewayResponse) {
  expect(response.headers[PROVIDER_RECEIPT_HEADER]).toBeUndefined();
  expect(response.headers[SANDBOX_SIMULATED_RECEIPT_HEADER]).toBeUndefined();
  expect(response.body.rap_receipt).toBeUndefined();
}

async function listedProviderId(): Promise<string> {
  const listing = await sandboxModelsListing();
  return (listing.data as { id: string; rap: { receiptProviderId: string } }[]).find((entry) => entry.id === swift.model)!.rap.receiptProviderId;
}

function nonceOf(response: { body: Record<string, unknown> }): string {
  return (response.body.x402 as { nonce: string }).nonce;
}

function devnetHeader(nonce: string, txSignature: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ network: "solana-devnet", payTo: swift.payTo, amount: MAX_SOL, currency: "SOL", nonce, txSignature, payer: PAYER, ...overrides });
}

describe("sandbox gateway: challenge", () => {
  it("answers an unpaid request with a 402 challenge built from the catalog", async () => {
    const response = await call(makeDeps());
    expect(response.status).toBe(402);
    expect(response.body.x402).toEqual({
      version: "1",
      network: "solana-devnet",
      payTo: swift.payTo,
      amount: MAX_SOL,
      currency: "SOL",
      endpoint: `${ORIGIN}${SANDBOX_ENDPOINT_PATH}`,
      nonce: "00000000000000000000000000000001",
      memo: "rap-sandbox:swift-infer",
    });
    expect(JSON.parse(response.headers["x402-request"])).toEqual(response.body.x402);
    noReceipt(response);
  });

  it("rejects malformed requests before any challenge", async () => {
    const deps = makeDeps();
    expect((await call(deps, undefined, { model: "gpt-unknown", messages })).status).toBe(404);
    expect((await call(deps, undefined, { model: swift.model, messages: [] })).status).toBe(400);
    expect((await call(deps, undefined, { model: swift.model, messages, stream: true })).status).toBe(400);
    expect((await call(deps, undefined, { model: swift.model, messages: [{ role: "user", content: "x".repeat(9000) }] })).status).toBe(400);
    expect((await call(deps, undefined, { model: swift.model, messages: [{ role: "user", content: 7 }] })).status).toBe(400);
    expect((await call(deps, undefined, "not an object")).status).toBe(400);
  });

  it("never asks for or accepts payment for an offline provider", async () => {
    const owl = findSandboxProviderById("night-owl")!;
    const deps = makeDeps();
    const body = { model: owl.model, messages };
    const unpaid = await call(deps, undefined, body);
    expect(unpaid.status).toBe(503);
    expect(unpaid.body.charged).toBe(false);
    expect(unpaid.body.x402).toBeUndefined();
    const paid = await call(deps, `demo:${"a".repeat(32)}`, body);
    expect(paid.status).toBe(503);
    noReceipt(paid);
    // The payment was not consumed: the same nonce still settles a live provider.
    expect((await call(deps, `demo:${"a".repeat(32)}`)).status).toBe(200);
  });
});

describe("sandbox gateway: simulated payment", () => {
  it("returns a completion and a simulated receipt that verifies, and that no v2 validator accepts", async () => {
    const deps = makeDeps();
    const nonce = nonceOf(await call(deps));
    const response = await call(deps, `demo:${nonce}`);
    expect(response.status).toBe(200);
    expect(response.bodyText).toBe(JSON.stringify(response.body));
    expect(response.headers[PROVIDER_RECEIPT_HEADER]).toBeUndefined();
    expect(response.body.rap_receipt).toBeUndefined();
    const receipt = receiptOf(response);
    // The simulated call settles at the tokens it used: 12 in, and the scripted answer out.
    const outputTokens = countTokens((response.body as { choices: { message: { content: string } }[] }).choices[0].message.content);
    const settled = settleSandboxCall(swift, { inputTokens: 12, outputTokens }, MAX_LAMPORTS);
    expect([settled.amount, settled.fee, settled.provider, settled.refunded]).toEqual([BigInt(160), BigInt(4), BigInt(156), MAX_LAMPORTS - BigInt(160)]);
    expect(receipt.receipt).toEqual({
      schemaVersion: "reddi.sandbox.simulated-receipt.v1",
      providerId: await listedProviderId(),
      declaredModel: swift.model,
      requestHash: await sha256Hex(REQUEST_TEXT),
      responseHash: await sha256Hex(response.bodyText),
      payment: {
        network: "solana-devnet",
        currency: "SOL",
        amount: settled.amount.toString(),
        fee: { amount: settled.fee.toString(), treasury: SANDBOX_FEE_TREASURY },
        settlement: "metered-escrow",
        metered: { inputTokens: "12", outputTokens: String(outputTokens), maxAmount: MAX_LAMPORTS.toString(), refunded: settled.refunded.toString() },
      },
      issuedAt: new Date(NOW_MS).toISOString(),
    });
    // No transaction paid for it, so it must never pass as reddi.receipt.v2.
    expect(validateReddiReceiptV2(receipt.receipt).ok).toBe(false);
    expect(verifyReddiReceiptV2(receipt).ok).toBe(false);
    expect(verifyReddiReceiptV2({ ...receipt, receipt: { ...receipt.receipt, schemaVersion: "reddi.receipt.v2" } }).ok).toBe(false);

    const verified = await verifySandboxReceipt({ receipt, model: swift.model, requestBody: REQUEST_TEXT, responseBody: response.bodyText, expectedProviderId: await listedProviderId(), expectedPayment: { amount: MAX_LAMPORTS.toString() } });
    expect(verified.checks.map((check) => [check.id, check.passed])).toEqual([["shape", true], ["request-hash", true], ["response-hash", true], ["provider-key", true], ["signature", true], ["payment", true]]);
    expect(verified.kind).toBe("simulated");
    expect(verified.ok).toBe(true);
  });

  it("refuses a payment that was already used", async () => {
    const deps = makeDeps();
    const nonce = nonceOf(await call(deps));
    expect((await call(deps, `demo:${nonce}`)).status).toBe(200);
    const replay = await call(deps, `demo:${nonce}`);
    expect(replay.status).toBe(409);
    expect(replay.body.reason).toBe("duplicate_nonce");
    noReceipt(replay);
    const jsonReplay = await call(deps, JSON.stringify({ simulated: true, network: "solana-devnet", payTo: swift.payTo, amount: MAX_SOL, currency: "SOL", nonce }));
    expect(jsonReplay.status).toBe(409);
  });

  it("refuses a simulated payment with the wrong amount, payee, network or currency, without consuming the nonce", async () => {
    const deps = makeDeps();
    const nonce = nonceOf(await call(deps));
    const good = { simulated: true, network: "solana-devnet", payTo: swift.payTo, amount: MAX_SOL, currency: "SOL", nonce };
    const cases: [Record<string, unknown>, string][] = [
      [{ amount: "0.0001" }, "wrong_amount"],
      [{ payTo: PAYER }, "wrong_payee"],
      [{ network: "solana-mainnet-beta" }, "wrong_network"],
      [{ currency: "USDC" }, "wrong_currency"],
    ];
    for (const [override, reason] of cases) {
      const response = await call(deps, JSON.stringify({ ...good, ...override }));
      expect([response.status, response.body.reason]).toEqual([402, reason]);
      expect(response.body.choices).toBeUndefined();
    }
    expect((await call(deps, JSON.stringify(good))).status).toBe(200);
  });

  it("refuses payment headers that are not a sandbox nonce", async () => {
    const deps = makeDeps();
    expect((await call(deps, "demo:not-a-nonce")).body.reason).toBe("invalid_nonce");
    expect((await call(deps, "paid, honest")).body.reason).toBe("invalid_receipt");
    expect((await call(deps, JSON.stringify({ simulated: true, nonce: "short" }))).body.reason).toBe("invalid_nonce");
    expect((await call(deps, JSON.stringify({ demo: true, nonce: "b".repeat(32), payer: PAYER }))).status).toBe(402);
  });
});

describe("sandbox gateway: devnet transfer", () => {
  it("accepts a confirmed devnet transfer and returns a reddi.receipt.v2 the package verifier accepts", async () => {
    const deps = makeDeps(fakeConnection({ [SIG_A]: {} }));
    const nonce = nonceOf(await call(deps));
    const response = await call(deps, devnetHeader(nonce, SIG_A));
    expect(response.status).toBe(200);
    expect(response.headers[SANDBOX_SIMULATED_RECEIPT_HEADER]).toBeUndefined();
    const receipt = receiptOf(response, PROVIDER_RECEIPT_HEADER);
    const providerId = await listedProviderId();
    expect(receipt.receipt.schemaVersion).toBe("reddi.receipt.v2");
    expect(receipt.receipt.payment).toEqual({ network: "solana-devnet", txSignature: SIG_A, currency: "SOL", amount: MAX_LAMPORTS.toString(), fee: { amount: "0" }, payer: PAYER, settlement: "direct" });
    expect(deps.connection.calls.genesis).toBe(1);

    // The package's own offline verifier, given everything the buyer knows.
    const packageCheck = verifyReddiReceiptV2(receipt, {
      providerId,
      declaredModel: swift.model,
      requestHash: await sha256Hex(REQUEST_TEXT),
      responseHash: await sha256Hex(response.bodyText),
      payment: { network: "solana-devnet", txSignature: SIG_A, currency: "SOL", amount: MAX_LAMPORTS.toString(), fee: { amount: "0" }, payer: PAYER, settlement: "direct" },
    });
    expect(packageCheck).toEqual({ ok: true, receipt: receipt.receipt });

    const input = { receipt, model: swift.model, requestBody: REQUEST_TEXT, responseBody: response.bodyText, expectedProviderId: providerId, expectedPayment: { amount: MAX_LAMPORTS.toString(), txSignature: SIG_A, payer: PAYER } };
    const verified = await verifySandboxReceipt(input);
    expect(verified.kind).toBe("v2");
    expect(verified.ok).toBe(true);

    // The browser verifier and the package verifier agree on every tampered form.
    const tampered: SandboxReceipt[] = [
      { ...receipt, receipt: { ...receipt.receipt, declaredModel: "sandbox/atlas-coder-large" } },
      { ...receipt, receipt: { ...receipt.receipt, payment: { ...receipt.receipt.payment, amount: "1" } } },
      { ...receipt, receipt: { ...receipt.receipt, payment: { ...receipt.receipt.payment, txSignature: "4".repeat(88) } } },
      { ...receipt, receipt: { ...receipt.receipt, payment: { ...receipt.receipt.payment, payer: swift.payTo } } },
      { ...receipt, receipt: { ...receipt.receipt, issuedAt: "2026-11-21T00:00:00.000Z" } },
      { ...receipt, receipt: { ...receipt.receipt, schemaVersion: "reddi.sandbox.simulated-receipt.v1" } },
    ];
    for (const forged of tampered) {
      expect(verifyReddiReceiptV2(forged).ok).toBe(false);
      expect((await verifySandboxReceipt({ ...input, receipt: forged, model: forged.receipt.declaredModel })).ok).toBe(false);
    }
    expect((await verifySandboxReceipt({ ...input, expectedPayment: { amount: MAX_LAMPORTS.toString(), txSignature: "4".repeat(88), payer: PAYER } })).checks.filter((check) => !check.passed).map((check) => check.id)).toEqual(["payment"]);
  });

  it("refuses the same transaction for a second call, even under a new nonce", async () => {
    const deps = makeDeps(fakeConnection({ [SIG_A]: {} }));
    expect((await call(deps, devnetHeader(nonceOf(await call(deps)), SIG_A))).status).toBe(200);
    const replay = await call(deps, devnetHeader(nonceOf(await call(deps)), SIG_A));
    expect([replay.status, replay.body.reason]).toEqual([409, "duplicate_nonce"]);
  });

  it("refuses transfers that do not settle the challenge", async () => {
    const day = 24 * 60 * 60;
    const deps = makeDeps(fakeConnection({
      underpaid: { lamports: Number(MAX_LAMPORTS) - 1 },
      elsewhere: { destination: PAYER },
      otherPayer: { source: swift.payTo },
      failed: { failed: true },
      stale: { blockTime: Math.floor(NOW_MS / 1000) - day },
    }));
    for (const signature of ["underpaid", "elsewhere", "otherPayer", "failed", "stale", "missing"]) {
      const response = await call(deps, devnetHeader("c".repeat(32), signature));
      expect([signature, response.status, response.body.reason]).toEqual([signature, 402, "invalid_receipt"]);
      noReceipt(response);
    }
  });

  it("refuses a receipt whose stated terms differ from the catalog", async () => {
    const deps = makeDeps(fakeConnection({ [SIG_A]: {} }));
    expect((await call(deps, devnetHeader("d".repeat(32), SIG_A, { amount: "0.0001" }))).body.reason).toBe("wrong_amount");
    expect((await call(deps, devnetHeader("d".repeat(32), SIG_A, { payTo: PAYER }))).body.reason).toBe("wrong_payee");
    expect((await call(deps, devnetHeader("d".repeat(32), SIG_A, { network: "solana-mainnet-beta" }))).body.reason).toBe("wrong_network");
    expect((await call(deps, devnetHeader("d".repeat(32), SIG_A, { payer: undefined }))).body.reason).toBe("invalid_receipt");
    expect(deps.connection.calls.read).toBe(0);
  });

  it("refuses to read a transfer from an RPC endpoint that is not devnet", async () => {
    const deps = makeDeps(fakeConnection({ [SIG_A]: {} }, { genesis: SOLANA_GENESIS_HASHES["solana-mainnet-beta"] }));
    const response = await call(deps, devnetHeader("e".repeat(32), SIG_A));
    expect([response.status, response.body.reason]).toEqual([402, "wrong_network"]);
    expect(deps.connection.calls.read).toBe(0);
  });

  it("accepts nothing when the RPC cannot be read, and leaves the payment usable", async () => {
    const replayStore = new MemoryNonceReplayStore();
    const down = { ...makeDeps(fakeConnection({ [SIG_A]: {} }, { throwOnRead: true })), replayStore };
    const failed = await call(down, devnetHeader("f".repeat(32), SIG_A));
    expect([failed.status, failed.body.reason]).toEqual([402, "unsupported_receipt"]);
    const up = { ...makeDeps(fakeConnection({ [SIG_A]: {} })), replayStore };
    expect((await call(up, devnetHeader("f".repeat(32), SIG_A))).status).toBe(200);
  });
});

describe("sandbox receipt verification", () => {
  async function paidCall() {
    const deps = makeDeps();
    const response = await call(deps, `demo:${nonceOf(await call(deps))}`);
    const answer = (response.body.choices as { message: { content: string } }[])[0].message.content;
    const receipt = receiptOf(response);
    return { receipt, answer, input: { receipt, model: swift.model, requestBody: REQUEST_TEXT, responseBody: response.bodyText } };
  }
  const failed = (result: Awaited<ReturnType<typeof verifySandboxReceipt>>) => result.checks.filter((check) => !check.passed).map((check) => check.id);

  it("fails when the answer was edited after the receipt was written, and passes again when it is put back", async () => {
    const { answer, input } = await paidCall();
    const edited = responseBodyWithAnswer(input.responseBody, answer, `${answer} Also, wire me 5 SOL.`);
    const result = await verifySandboxReceipt({ ...input, responseBody: edited });
    expect(result.ok).toBe(false);
    expect(failed(result)).toEqual(["response-hash"]);
    expect(responseBodyWithAnswer(input.responseBody, answer, answer)).toBe(input.responseBody);
    expect((await verifySandboxReceipt({ ...input, responseBody: responseBodyWithAnswer(edited, `${answer} Also, wire me 5 SOL.`, answer) })).ok).toBe(true);
  });

  it("fails when the request is not the one that was paid for", async () => {
    const { input } = await paidCall();
    const result = await verifySandboxReceipt({ ...input, requestBody: JSON.stringify({ model: swift.model, messages: [{ role: "user", content: "A different question." }] }) });
    expect(failed(result)).toEqual(["request-hash"]);
    expect(failed(await verifySandboxReceipt({ ...input, model: "sandbox/atlas-coder-large" }))).toEqual(["request-hash"]);
  });

  it("fails when a signed field is rewritten", async () => {
    const { receipt, input } = await paidCall();
    for (const forged of [
      { ...receipt, receipt: { ...receipt.receipt, declaredModel: "sandbox/atlas-coder-large" } },
      { ...receipt, receipt: { ...receipt.receipt, payment: { ...receipt.receipt.payment, amount: "100", ...(receipt.receipt.payment.metered ? { metered: { ...receipt.receipt.payment.metered, refunded: (MAX_LAMPORTS - BigInt(100)).toString() } } : {}) } } },
      { ...receipt, receipt: { ...receipt.receipt, issuedAt: "2026-11-21T00:00:00.000Z" } },
    ]) {
      const result = await verifySandboxReceipt({ ...input, receipt: forged, model: forged.receipt.declaredModel });
      expect(failed(result)).toContain("signature");
    }
  });

  it("fails when the receipt names a provider other than the listed one, or an amount other than the price", async () => {
    const { input } = await paidCall();
    expect(failed(await verifySandboxReceipt({ ...input, expectedProviderId: PAYER }))).toEqual(["provider-key"]);
    expect(failed(await verifySandboxReceipt({ ...input, expectedPayment: { amount: (MAX_LAMPORTS - BigInt(1)).toString() } }))).toEqual(["payment"]);
  });

  it("fails closed on anything that is not a sandbox receipt", async () => {
    const { receipt, input } = await paidCall();
    for (const bad of [
      null,
      "receipt",
      {},
      receipt.receipt,
      { receipt: receipt.receipt },
      { ...receipt, extra: true },
      { ...receipt, receipt: { ...receipt.receipt, schemaVersion: "reddi.receipt.v1" } },
      // A simulated receipt relabelled as v2 names no transaction.
      { ...receipt, receipt: { ...receipt.receipt, schemaVersion: "reddi.receipt.v2" } },
      // A simulated receipt may not name a transaction.
      { ...receipt, receipt: { ...receipt.receipt, payment: { ...receipt.receipt.payment, txSignature: SIG_A } } },
      { ...receipt, receipt: { ...receipt.receipt, providerId: "swift-infer" } },
      { ...receipt, proof: { type: "ed25519", signature: 7 } },
    ]) {
      const result = await verifySandboxReceipt({ ...input, receipt: bad });
      expect(result.ok).toBe(false);
      expect(result.checks.map((check) => check.id)).toEqual(["shape"]);
    }
    expect((await verifySandboxReceipt({ ...input, receipt: { ...receipt, proof: { type: "ed25519", signature: "AAAA" } } })).ok).toBe(false);
    for (const header of [undefined, null, "", "not base64url!", "A".repeat(5000), Buffer.from("not json").toString("base64url")]) {
      expect(decodeReceiptHeader(header)).toBeUndefined();
    }
  });
});

describe("sandbox catalog", () => {
  it("lists every provider with a distinct model, payee and receipt provider address", async () => {
    const listing = await sandboxModelsListing();
    const data = listing.data as { id: string; rap: { payTo: string; receiptProviderId: string } }[];
    expect(data.map((entry) => entry.id)).toEqual(SANDBOX_PROVIDERS.map((provider) => provider.model));
    expect(new Set(data.map((entry) => entry.rap.receiptProviderId)).size).toBe(data.length);
    expect(new Set(data.map((entry) => entry.rap.payTo)).size).toBe(data.length);
    for (const entry of data) {
      expect(entry.id.startsWith("sandbox/")).toBe(true);
      expect(entry.rap.receiptProviderId).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      // The receipt key is a published test key, never the wallet that is paid.
      expect(entry.rap.receiptProviderId).not.toBe(entry.rap.payTo);
    }
  });
});

describe("sandbox signup link", () => {
  it("is built only from an https marketing origin", () => {
    expect(marketingSignupUrl("https://agent-protocol.reddi.tech")).toBe("https://agent-protocol.reddi.tech/#updates");
    expect(marketingSignupUrl(" https://agent-protocol.reddi.tech/some/path?x=1 ")).toBe("https://agent-protocol.reddi.tech/#updates");
    for (const bad of [undefined, "", "   ", "http://agent-protocol.reddi.tech", "javascript:alert(1)", "agent-protocol.reddi.tech", "https://user:pw@agent-protocol.reddi.tech"]) {
      expect(marketingSignupUrl(bad)).toBeUndefined();
    }
  });
});
