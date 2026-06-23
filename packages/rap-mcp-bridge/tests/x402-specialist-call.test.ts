import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { loadConfig } from "../src/config.js";
import { currentPolicy } from "../src/policy.js";
import { BridgeStore } from "../src/store.js";
import { exportDisclosureLedger } from "../src/tools/export-disclosure-ledger.js";
import { executeX402SpecialistCall, prepareX402SpecialistCall, verifyX402SpecialistReceipt, type FetchLike } from "../src/tools/x402-specialist-call.js";
import type { DevnetUsdcPaymentClient } from "@reddi/x402-solana";

const payTo = "3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr";
const usdcMint = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const endpoint = "https://reddi-code-generation.preview.reddi.tech/v1/chat/completions";

function walletFile() {
  const dir = mkdtempSync(join(tmpdir(), "rap-mcp-x402-wallet-"));
  const kp = Keypair.generate();
  const path = join(dir, "wallet.json");
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  return { dir, path, kp };
}

function header(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: "1",
    network: "solana-devnet",
    payTo,
    amount: "0.05",
    currency: "USDC",
    endpoint,
    nonce: "nonce-mcp-1",
    ...overrides,
  });
}

function fakeClient(options: { allowSubmit?: boolean } = {}): DevnetUsdcPaymentClient {
  return {
    async getSolBalanceLamports() { return LAMPORTS_PER_SOL; },
    async getUsdcBalanceMicroUnits() { return 100_000n; },
    async getOrCreateDestinationTokenAccount() { return "dest-token-account"; },
    async submitUsdcTransfer() {
      if (!options.allowSubmit) throw new Error("prepare must not submit transfer");
      return { signature: "fake-devnet-usdc-signature", destinationTokenAccount: "dest-token-account" };
    },
  };
}

test("x402 specialist invoke policy is hidden unless all gates are ready", () => {
  assert.equal(currentPolicy("devnet", true, false).allowInvoke, false);
  assert.equal(currentPolicy("devnet", true, false).toolNames.includes("reddi.prepare_x402_specialist_call"), false);
  const policy = currentPolicy("devnet", true, true);
  assert.equal(policy.allowInvoke, true);
  assert.equal(policy.toolNames.includes("reddi.prepare_x402_specialist_call"), true);
  assert.equal(policy.toolNames.includes("reddi.execute_x402_specialist_call"), true);
  assert.equal(policy.toolNames.includes("reddi.verify_x402_specialist_receipt"), true);
});

test("loadConfig captures specialist invoke gates without enabling them by default", () => {
  const config = loadConfig({ HOME: tmpdir() });
  assert.equal(config.allowSpecialistInvoke, false);
  assert.deepEqual(config.specialistEndpointAllowlist, []);
  assert.equal(config.devnetMaxUsdcMicroUnits, 150_000);
});

test("prepare_x402_specialist_call is non-mutating and returns readiness when gates are configured", async () => {
  const { dir, path, kp } = walletFile();
  try {
    const config = loadConfig({
      HOME: tmpdir(),
      REDDI_RAP_MCP_MODE: "devnet",
      RAP_MCP_DEVNET_PROOF_APPROVED: "1",
      RAP_MCP_ALLOW_SPECIALIST_INVOKE: "1",
      RAP_MCP_DEVNET_WALLET_KEYPAIR: path,
      RAP_MCP_DEVNET_USDC_MINT: usdcMint,
      RAP_MCP_SPECIALIST_ENDPOINT_ALLOWLIST: endpoint,
      RAP_MCP_DEVNET_MAX_USDC_MICRO_UNITS: "150000",
    });
    const result = await prepareX402SpecialistCall({ x402RequestHeader: header() }, config, fakeClient());
    assert.equal(result.ready, true);
    assert.equal(result.payer, kp.publicKey.toBase58());
    assert.equal(result.spend.amountMicroUnits, "50000");
    assert.equal(JSON.stringify(result).includes(JSON.stringify(Array.from(kp.secretKey))), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("execute_x402_specialist_call performs fake 402 to paid retry flow and stores idempotent receipt", async () => {
  const { dir, path, kp } = walletFile();
  const storeDir = mkdtempSync(join(tmpdir(), "rap-mcp-x402-store-"));
  try {
    const config = loadConfig({
      HOME: tmpdir(),
      REDDI_RAP_MCP_MODE: "devnet",
      RAP_MCP_DEVNET_PROOF_APPROVED: "1",
      RAP_MCP_ALLOW_SPECIALIST_INVOKE: "1",
      RAP_MCP_DEVNET_WALLET_KEYPAIR: path,
      RAP_MCP_DEVNET_USDC_MINT: usdcMint,
      RAP_MCP_SPECIALIST_ENDPOINT_ALLOWLIST: endpoint,
      RAP_MCP_DEVNET_MAX_USDC_MICRO_UNITS: "150000",
    });
    const calls: Array<Record<string, unknown>> = [];
    const fetcher: FetchLike = async (_url, init) => {
      calls.push({ headers: init.headers, body: init.body });
      if (!init.headers["x402-payment"]) {
        return { status: 402, headers: { get: (name: string) => name === "x402-request" ? header() : null }, async text() { return "payment required"; } };
      }
      return { status: 200, headers: { get: () => null }, async text() { return JSON.stringify({ answer: "specialist output" }); } };
    };
    const receipt = await executeX402SpecialistCall({
      endpoint,
      body: { messages: [{ role: "user", content: "help" }] },
      idempotencyKey: "idem-live-x402-1",
      maxUsdcMicroUnits: 150_000,
      approvalPhrase: "EXECUTE_DEVNET_X402_SPECIALIST_CALL",
    }, config, new BridgeStore(storeDir), { client: fakeClient({ allowSubmit: true }), fetch: fetcher });
    assert.equal(receipt.boundary, "solana-devnet-only-no-mainnet");
    assert.equal(receipt.response.status, 200);
    assert.equal(receipt.paymentReceipt.payer, kp.publicKey.toBase58());
    assert.equal(calls.length, 2);
    assert.ok((calls[1].headers as Record<string, string>)["x402-payment"]);

    const again = await executeX402SpecialistCall({
      endpoint,
      body: { messages: [{ role: "user", content: "help" }] },
      idempotencyKey: "idem-live-x402-1",
      maxUsdcMicroUnits: 150_000,
      approvalPhrase: "EXECUTE_DEVNET_X402_SPECIALIST_CALL",
    }, config, new BridgeStore(storeDir), { client: fakeClient({ allowSubmit: true }), fetch: fetcher });
    assert.equal(again.receiptId, receipt.receiptId);
    assert.equal(calls.length, 2);

    const verification = verifyX402SpecialistReceipt({ receiptId: receipt.receiptId }, new BridgeStore(storeDir));
    assert.equal(verification.verified, true);
    assert.equal(verification.mainnetSettlement, "not_applicable");

    const ledger = exportDisclosureLedger({ quoteIds: [], x402ReceiptIds: [receipt.receiptId] }, new BridgeStore(storeDir));
    assert.equal(ledger.entries.length, 1);
    assert.equal(ledger.entries[0].verificationStatus, "devnet_verified");
    assert.equal(ledger.entries[0].paymentReceiptHash?.startsWith("sha256:"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(storeDir, { recursive: true, force: true });
  }
});

test("execute_x402_specialist_call rejects a challenge payee that differs from the approved recipient", async () => {
  const { dir, path } = walletFile();
  const storeDir = mkdtempSync(join(tmpdir(), "rap-mcp-x402-store-"));
  try {
    const config = loadConfig({
      HOME: tmpdir(),
      REDDI_RAP_MCP_MODE: "devnet",
      RAP_MCP_DEVNET_PROOF_APPROVED: "1",
      RAP_MCP_ALLOW_SPECIALIST_INVOKE: "1",
      RAP_MCP_DEVNET_WALLET_KEYPAIR: path,
      RAP_MCP_DEVNET_USDC_MINT: usdcMint,
      RAP_MCP_SPECIALIST_ENDPOINT_ALLOWLIST: endpoint,
      RAP_MCP_DEVNET_MAX_USDC_MICRO_UNITS: "150000",
    });
    const fetcher: FetchLike = async (_url, init) => {
      if (!init.headers["x402-payment"]) {
        return { status: 402, headers: { get: (name: string) => name === "x402-request" ? header() : null }, async text() { return "payment required"; } };
      }
      throw new Error("paid retry must not run after payee mismatch");
    };
    await assert.rejects(
      executeX402SpecialistCall({
        endpoint,
        body: { messages: [{ role: "user", content: "help" }] },
        idempotencyKey: "idem-live-x402-payee-mismatch",
        maxUsdcMicroUnits: 150_000,
        expectedPayTo: "4Nd1mDQc7iyQxwkMrMMkRTnYBPVQWuSi7aPdAkM3ccY1",
        approvalPhrase: "EXECUTE_DEVNET_X402_SPECIALIST_CALL",
      }, config, new BridgeStore(storeDir), { client: fakeClient({ allowSubmit: true }), fetch: fetcher }),
      /x402_challenge_payee_mismatch/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(storeDir, { recursive: true, force: true });
  }
});

test("prepare_x402_specialist_call rejects missing gates and non-allowlisted endpoints", async () => {
  await assert.rejects(
    prepareX402SpecialistCall({ x402RequestHeader: header() }, loadConfig({ HOME: tmpdir() }), fakeClient()),
    /devnet_mode_not_enabled/,
  );

  const { dir, path } = walletFile();
  try {
    const config = loadConfig({
      HOME: tmpdir(),
      REDDI_RAP_MCP_MODE: "devnet",
      RAP_MCP_DEVNET_PROOF_APPROVED: "1",
      RAP_MCP_ALLOW_SPECIALIST_INVOKE: "1",
      RAP_MCP_DEVNET_WALLET_KEYPAIR: path,
      RAP_MCP_DEVNET_USDC_MINT: usdcMint,
      RAP_MCP_SPECIALIST_ENDPOINT_ALLOWLIST: endpoint,
    });
    const result = await prepareX402SpecialistCall({ x402RequestHeader: header({ endpoint: "https://evil.example.test/v1/chat/completions" }) }, config, fakeClient());
    assert.equal(result.ready, false);
    assert.match(result.reasons.join(","), /specialist_endpoint_not_allowlisted/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
