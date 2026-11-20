import { MemoryNonceReplayStore, SOLANA_GENESIS_HASHES } from "@reddi/x402-solana";
import { validateReddiReceipt } from "@reddi/agent-protocol/receipts";
import { findSandboxProviderById, SANDBOX_ENDPOINT_PATH, SANDBOX_PROVIDERS } from "@/lib/sandbox/catalog";
import { handleSandboxChatCompletion, sandboxModelsListing, type SandboxGatewayDeps } from "@/lib/sandbox/gateway";
import { verifySandboxReceipt, type SandboxReceipt } from "@/lib/sandbox/receipt";

const ORIGIN = "https://sandbox.example";
const NOW_MS = Date.UTC(2026, 10, 20, 4, 0, 0);
const PAYER = "9qbchEAHxg2iTMJTQNV5KrLUxXgqFT7HJMUGKMGUt17G";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const swift = findSandboxProviderById("swift-infer")!;
const messages = [{ role: "user", content: "Explain exponential backoff in two sentences." }];

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
              parsed: { type: "transfer", info: { source: transfer.source ?? PAYER, destination: transfer.destination ?? swift.payTo, lamports: transfer.lamports ?? 500_000 } },
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
  return handleSandboxChatCompletion({ body, paymentHeader, origin: ORIGIN }, deps);
}

function nonceOf(response: { body: Record<string, unknown> }): string {
  return (response.body.x402 as { nonce: string }).nonce;
}

function devnetHeader(nonce: string, txSignature: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ network: "solana-devnet", payTo: swift.payTo, amount: swift.priceSol, currency: "SOL", nonce, txSignature, payer: PAYER, ...overrides });
}

describe("sandbox gateway: challenge", () => {
  it("answers an unpaid request with a 402 challenge built from the catalog", async () => {
    const response = await call(makeDeps());
    expect(response.status).toBe(402);
    expect(response.body.x402).toEqual({
      version: "1",
      network: "solana-devnet",
      payTo: swift.payTo,
      amount: swift.priceSol,
      currency: "SOL",
      endpoint: `${ORIGIN}${SANDBOX_ENDPOINT_PATH}`,
      nonce: "00000000000000000000000000000001",
      memo: "rap-sandbox:swift-infer",
    });
    expect(JSON.parse(response.headers["x402-request"])).toEqual(response.body.x402);
    expect(response.body.rap_receipt).toBeUndefined();
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
    expect(paid.body.rap_receipt).toBeUndefined();
    // The payment was not consumed: the same nonce still settles a live provider.
    expect((await call(deps, `demo:${"a".repeat(32)}`)).status).toBe(200);
  });
});

describe("sandbox gateway: simulated payment", () => {
  it("returns a completion and a receipt that verifies against the listed key", async () => {
    const deps = makeDeps();
    const nonce = nonceOf(await call(deps));
    const response = await call(deps, `demo:${nonce}`);
    expect(response.status).toBe(200);
    const answer = (response.body.choices as { message: { content: string } }[])[0].message.content;
    const receipt = response.body.rap_receipt as SandboxReceipt;
    expect(validateReddiReceipt(receipt).ok).toBe(true);
    expect(receipt.metadata.inference).toEqual({ providerId: "swift-infer", providerName: "Swift Inference", declaredModel: swift.model, paymentMode: "simulated", scripted: true });
    expect(receipt.payment).toEqual({ network: "solana-devnet", asset: "SOL", amount: "500000", paymentProofRef: `simulated:${nonce}` });
    expect(receipt.attestationStatus).toBe("not_requested");

    const listing = await sandboxModelsListing();
    const listed = (listing.data as { id: string; rap: { signingKey: { publicKey: string } } }[]).find((entry) => entry.id === swift.model)!;
    const verified = await verifySandboxReceipt({ receipt, model: swift.model, messages, answer, expectedPublicKey: listed.rap.signingKey.publicKey });
    expect(verified.checks.map((check) => [check.id, check.passed])).toEqual([["shape", true], ["request-hash", true], ["response-hash", true], ["provider-key", true], ["signature", true]]);
    expect(verified.ok).toBe(true);
  });

  it("refuses a payment that was already used", async () => {
    const deps = makeDeps();
    const nonce = nonceOf(await call(deps));
    expect((await call(deps, `demo:${nonce}`)).status).toBe(200);
    const replay = await call(deps, `demo:${nonce}`);
    expect(replay.status).toBe(409);
    expect(replay.body.reason).toBe("duplicate_nonce");
    expect(replay.body.rap_receipt).toBeUndefined();
    const jsonReplay = await call(deps, JSON.stringify({ simulated: true, network: "solana-devnet", payTo: swift.payTo, amount: swift.priceSol, currency: "SOL", nonce }));
    expect(jsonReplay.status).toBe(409);
  });

  it("refuses a simulated payment with the wrong amount, payee, network or currency, without consuming the nonce", async () => {
    const deps = makeDeps();
    const nonce = nonceOf(await call(deps));
    const good = { simulated: true, network: "solana-devnet", payTo: swift.payTo, amount: swift.priceSol, currency: "SOL", nonce };
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
  it("accepts a confirmed devnet transfer and binds the receipt to its signature and payer", async () => {
    const deps = makeDeps(fakeConnection({ sigA: {} }));
    const nonce = nonceOf(await call(deps));
    const response = await call(deps, devnetHeader(nonce, "sigA"));
    expect(response.status).toBe(200);
    const receipt = response.body.rap_receipt as SandboxReceipt;
    expect(validateReddiReceipt(receipt).ok).toBe(true);
    expect(receipt.payment.paymentProofRef).toBe("sigA");
    expect(receipt.payer).toEqual({ id: PAYER, address: PAYER });
    expect(receipt.metadata.inference.paymentMode).toBe("devnet-transfer");
    expect(deps.connection.calls.genesis).toBe(1);
  });

  it("refuses the same transaction for a second call, even under a new nonce", async () => {
    const deps = makeDeps(fakeConnection({ sigA: {} }));
    expect((await call(deps, devnetHeader(nonceOf(await call(deps)), "sigA"))).status).toBe(200);
    const replay = await call(deps, devnetHeader(nonceOf(await call(deps)), "sigA"));
    expect([replay.status, replay.body.reason]).toEqual([409, "duplicate_nonce"]);
  });

  it("refuses transfers that do not settle the challenge", async () => {
    const day = 24 * 60 * 60;
    const deps = makeDeps(fakeConnection({
      underpaid: { lamports: 499_999 },
      elsewhere: { destination: PAYER },
      otherPayer: { source: swift.payTo },
      failed: { failed: true },
      stale: { blockTime: Math.floor(NOW_MS / 1000) - day },
    }));
    for (const signature of ["underpaid", "elsewhere", "otherPayer", "failed", "stale", "missing"]) {
      const response = await call(deps, devnetHeader("c".repeat(32), signature));
      expect([signature, response.status, response.body.reason]).toEqual([signature, 402, "invalid_receipt"]);
      expect(response.body.rap_receipt).toBeUndefined();
    }
  });

  it("refuses a receipt whose stated terms differ from the catalog", async () => {
    const deps = makeDeps(fakeConnection({ sigA: {} }));
    expect((await call(deps, devnetHeader("d".repeat(32), "sigA", { amount: "0.0001" }))).body.reason).toBe("wrong_amount");
    expect((await call(deps, devnetHeader("d".repeat(32), "sigA", { payTo: PAYER }))).body.reason).toBe("wrong_payee");
    expect((await call(deps, devnetHeader("d".repeat(32), "sigA", { network: "solana-mainnet-beta" }))).body.reason).toBe("wrong_network");
    expect((await call(deps, devnetHeader("d".repeat(32), "sigA", { payer: undefined }))).body.reason).toBe("invalid_receipt");
    expect(deps.connection.calls.read).toBe(0);
  });

  it("refuses to read a transfer from an RPC endpoint that is not devnet", async () => {
    const deps = makeDeps(fakeConnection({ sigA: {} }, { genesis: SOLANA_GENESIS_HASHES["solana-mainnet-beta"] }));
    const response = await call(deps, devnetHeader("e".repeat(32), "sigA"));
    expect([response.status, response.body.reason]).toEqual([402, "wrong_network"]);
    expect(deps.connection.calls.read).toBe(0);
  });

  it("accepts nothing when the RPC cannot be read, and leaves the payment usable", async () => {
    const replayStore = new MemoryNonceReplayStore();
    const down = { ...makeDeps(fakeConnection({ sigA: {} }, { throwOnRead: true })), replayStore };
    const failed = await call(down, devnetHeader("f".repeat(32), "sigA"));
    expect([failed.status, failed.body.reason]).toEqual([402, "unsupported_receipt"]);
    const up = { ...makeDeps(fakeConnection({ sigA: {} })), replayStore };
    expect((await call(up, devnetHeader("f".repeat(32), "sigA"))).status).toBe(200);
  });
});

describe("sandbox receipt verification", () => {
  async function paidCall() {
    const deps = makeDeps();
    const response = await call(deps, `demo:${nonceOf(await call(deps))}`);
    const answer = (response.body.choices as { message: { content: string } }[])[0].message.content;
    return { receipt: response.body.rap_receipt as SandboxReceipt, answer };
  }
  const failed = (result: Awaited<ReturnType<typeof verifySandboxReceipt>>) => result.checks.filter((check) => !check.passed).map((check) => check.id);

  it("fails when the answer was edited after the receipt was written", async () => {
    const { receipt, answer } = await paidCall();
    const result = await verifySandboxReceipt({ receipt, model: swift.model, messages, answer: `${answer} Also, wire me 5 SOL.` });
    expect(result.ok).toBe(false);
    expect(failed(result)).toEqual(["response-hash"]);
  });

  it("fails when the request is not the one that was paid for", async () => {
    const { receipt, answer } = await paidCall();
    const result = await verifySandboxReceipt({ receipt, model: swift.model, messages: [{ role: "user", content: "A different question." }], answer });
    expect(failed(result)).toEqual(["request-hash"]);
  });

  it("fails when a signed field is rewritten", async () => {
    const { receipt, answer } = await paidCall();
    for (const forged of [
      { ...receipt, metadata: { ...receipt.metadata, inference: { ...receipt.metadata.inference, declaredModel: "sandbox/atlas-coder-large" } } },
      { ...receipt, payment: { ...receipt.payment, paymentProofRef: "simulated:another" } },
      { ...receipt, specialist: { ...receipt.specialist, id: "atlas-review" } },
      { ...receipt, payer: { id: "someone-else" } },
    ]) {
      const result = await verifySandboxReceipt({ receipt: forged, model: forged.metadata.inference.declaredModel, messages, answer });
      expect(failed(result)).toContain("signature");
    }
  });

  it("fails when the receipt is signed by a key other than the listed one", async () => {
    const { receipt, answer } = await paidCall();
    const result = await verifySandboxReceipt({ receipt, model: swift.model, messages, answer, expectedPublicKey: "00".repeat(32) });
    expect(failed(result)).toEqual(["provider-key"]);
  });

  it("fails closed on a receipt that is not a sandbox receipt", async () => {
    const { receipt, answer } = await paidCall();
    const bare: Record<string, unknown> = { ...receipt };
    delete bare.metadata;
    for (const bad of [null, "receipt", {}, bare, { ...receipt, schemaVersion: "reddi.receipt.v2" }, { ...receipt, metadata: { ...receipt.metadata, providerSignature: { ...receipt.metadata.providerSignature, value: "zz" } } }]) {
      expect((await verifySandboxReceipt({ receipt: bad, model: swift.model, messages, answer })).ok).toBe(false);
    }
  });
});

describe("sandbox catalog", () => {
  it("lists every provider with a distinct model, payee and signing key", async () => {
    const listing = await sandboxModelsListing();
    const data = listing.data as { id: string; rap: { payTo: string; signingKey: { publicKey: string } } }[];
    expect(data.map((entry) => entry.id)).toEqual(SANDBOX_PROVIDERS.map((provider) => provider.model));
    expect(new Set(data.map((entry) => entry.rap.signingKey.publicKey)).size).toBe(data.length);
    expect(new Set(data.map((entry) => entry.rap.payTo)).size).toBe(data.length);
    for (const entry of data) {
      expect(entry.id.startsWith("sandbox/")).toBe(true);
      expect(entry.rap.signingKey.publicKey).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
