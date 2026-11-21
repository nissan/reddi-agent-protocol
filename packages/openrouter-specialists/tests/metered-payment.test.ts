import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { MemoryNonceReplayStore, tokenEscrowAddresses, treasuryTokenAccount } from "@reddi/x402-solana";
import { MockOpenRouterClient } from "../src/openrouter.js";
import { getProfile } from "../src/profiles/index.js";
import { handleRuntimeRequest, PROVIDER_RECEIPT_HEADER, type ProviderReceiptStatement, type RuntimeConfig, type RuntimeDeps } from "../src/index.js";

const PROGRAM = new PublicKey("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");
const USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SETTLE_SIG = "4".repeat(88);
const profile = getProfile("planning-agent")!;
const payee = new PublicKey(profile.walletAddress);
const payer = Keypair.generate().publicKey;
const NONCE = "00112233445566778899aabbccddeeff";

const config: RuntimeConfig = {
  profileId: "planning-agent",
  endpointBaseUrl: "https://planning.example.test",
  openRouterBaseUrl: "https://openrouter.ai/api/v1",
  mockOpenRouter: true,
  requirePayment: true,
  allowDemoPayment: false,
  allowRealPayment: true,
  usdcDevnetMint: USDC.toBase58(),
  meteredPrice: { inputPerMillion: "3", outputPerMillion: "15", maxOutputTokens: 500 },
  escrowProgramId: PROGRAM.toBase58(),
};

const disc = (name: string) => createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);

function tokenEscrowBytes(fields: { amount: bigint; payee?: PublicKey; mint?: PublicKey; recipient?: PublicKey; status?: number; metered?: boolean; payer?: PublicKey }): Uint8Array {
  const mint = fields.mint ?? USDC;
  const owner = fields.payee ?? payee;
  const data = Buffer.alloc(203);
  disc("TokenEscrowAccount").copy(data, 0);
  (fields.payer ?? payer).toBuffer().copy(data, 8);
  owner.toBuffer().copy(data, 40);
  mint.toBuffer().copy(data, 72);
  treasuryTokenAccount({ mint, tokenProgram: TOKEN_PROGRAM }, fields.payer ?? payer).toBuffer().copy(data, 104);
  (fields.recipient ?? treasuryTokenAccount({ mint, tokenProgram: TOKEN_PROGRAM }, owner)).toBuffer().copy(data, 136);
  data.writeBigUInt64LE(fields.amount, 168);
  Buffer.from(NONCE, "hex").copy(data, 176);
  data[192] = fields.status ?? 0;
  data[201] = 254;
  data[202] = fields.metered === false ? 0 : 1;
  return data;
}

const escrow = tokenEscrowAddresses({ programId: PROGRAM, payer, nonce: Buffer.from(NONCE, "hex") }).escrow;

function deps(account: { owner?: PublicKey; data: Uint8Array } | null, settle?: (ixs: TransactionInstruction[]) => Promise<string>) {
  // The settle instruction of each transaction, and each whole transaction's instructions.
  const settled: TransactionInstruction[] = [];
  const transactions: TransactionInstruction[][] = [];
  const statements: ProviderReceiptStatement[] = [];
  const value: RuntimeDeps = {
    replayStore: new MemoryNonceReplayStore(),
    readAccount: async (address) => (address.equals(escrow) && account ? { owner: account.owner ?? PROGRAM, data: account.data } : null),
    settleMeteredEscrow:
      settle ??
      (async (ixs) => {
        transactions.push(ixs);
        settled.push(ixs[ixs.length - 1]);
        return SETTLE_SIG;
      }),
    signProviderReceipt: (statement) => {
      statements.push(statement);
      return { receipt: statement, proof: { type: "ed25519", signature: "test" } };
    },
    now: () => new Date("2026-11-21T02:00:00Z"),
  };
  return { value, settled, transactions, statements };
}

const BODY = JSON.stringify({ messages: [{ role: "user", content: "Plan a three step rollout." }], max_tokens: 200 });

function request(payment?: Record<string, unknown>) {
  return new Request("https://planning.example.test/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...(payment ? { "x402-payment": JSON.stringify(payment) } : {}) },
    body: BODY,
  });
}

const meteredPayment = (overrides: Record<string, unknown> = {}) => ({ settlement: "metered-escrow", nonce: NONCE, escrow: escrow.toBase58(), payer: payer.toBase58(), ...overrides });

test("a 402 offers metered terms when the operator configured a price, a program and a settle signer", async () => {
  const response = await handleRuntimeRequest(request(), config, new MockOpenRouterClient(), deps(null).value);
  assert.equal(response.status, 402);
  const body = (await response.json()) as { metered: Record<string, unknown> };
  assert.equal(body.metered.escrowProgramId, PROGRAM.toBase58());
  assert.equal(body.metered.payTo, profile.walletAddress);
  // 7 input tokens plus 200 output at $3 / $15 per million, in USDC base units, rounded up.
  assert.equal(body.metered.minimumLockBaseUnits, "3021");

  const none = await handleRuntimeRequest(request(), config, new MockOpenRouterClient(), {});
  assert.equal(((await none.json()) as { metered?: unknown }).metered, undefined);
});

test("settles the reported tokens, answers, and signs a metered-escrow receipt naming the settle", async () => {
  const d = deps({ data: tokenEscrowBytes({ amount: BigInt(6000) }) });
  const client = new MockOpenRouterClient();
  const response = await handleRuntimeRequest(request(meteredPayment()), config, client, d.value);
  assert.equal(response.status, 200);
  assert.equal(client.callCount, 1);
  assert.equal(d.settled.length, 1);
  // The mock reports 1 input and 1 output token: $3 and $15 per million are 3 and 15 USDC base units a token.
  assert.equal(d.settled[0].data.readBigUInt64LE(8), BigInt(18));
  assert.ok(d.settled[0].keys[2].pubkey.equals(payee));
  assert.equal(d.settled[0].keys[2].isSigner, true);
  // Before the settle, idempotent creates of the treasury's and the buyer's token accounts, paid by the provider.
  const [treasuryCreate, refundCreate, settle] = d.transactions[0];
  assert.equal(d.transactions[0].length, 3);
  assert.equal(settle, d.settled[0]);
  for (const create of [treasuryCreate, refundCreate]) {
    assert.ok(create.programId.equals(ASSOCIATED_TOKEN_PROGRAM));
    assert.deepEqual(Array.from(create.data), [1]);
    assert.ok(create.keys[0].pubkey.equals(payee));
  }
  // The treasury account it creates is the one the settle pays the fee to; the unused part goes to the buyer's associated token account.
  assert.ok(treasuryCreate.keys[1].pubkey.equals(settle.keys[6].pubkey));
  assert.ok(refundCreate.keys[1].pubkey.equals(settle.keys[7].pubkey));
  assert.ok(refundCreate.keys[2].pubkey.equals(payer));
  const body = (await response.clone().json()) as { reddi: { metered: Record<string, unknown> } };
  assert.equal(body.reddi.metered.settleSignature, SETTLE_SIG);
  assert.equal(body.reddi.metered.refund, "0.005982");
  assert.ok(response.headers.get(PROVIDER_RECEIPT_HEADER));
  assert.deepEqual(d.statements[0].payment, {
    network: "solana-devnet",
    txSignature: SETTLE_SIG,
    currency: "USDC",
    mint: USDC.toBase58(),
    amount: "18",
    fee: { amount: "0" },
    payer: payer.toBase58(),
    settlement: "metered-escrow",
    metered: { inputTokens: "1", outputTokens: "1", maxAmount: "6000", refunded: "5982" },
  });

  // One lock pays for one call.
  const again = await handleRuntimeRequest(request(meteredPayment()), config, client, d.value);
  assert.equal(again.status, 409);
  assert.equal(client.callCount, 1);
});

test("refuses a lock that does not match the provider's terms, before calling the model or settling", async () => {
  const stranger = Keypair.generate().publicKey;
  const cases: [string, { owner?: PublicKey; data: Uint8Array } | null, number, Record<string, unknown>?][] = [
    ["missing", null, 402],
    ["wrong program", { owner: stranger, data: tokenEscrowBytes({ amount: BigInt(6000) }) }, 402],
    ["below estimate", { data: tokenEscrowBytes({ amount: BigInt(3020) }) }, 402],
    ["other payee", { data: tokenEscrowBytes({ amount: BigInt(6000), payee: stranger }) }, 402],
    ["other mint", { data: tokenEscrowBytes({ amount: BigInt(6000), mint: stranger }) }, 402],
    ["other recipient", { data: tokenEscrowBytes({ amount: BigInt(6000), recipient: stranger }) }, 402],
    ["not metered", { data: tokenEscrowBytes({ amount: BigInt(6000), metered: false }) }, 402],
    ["already settled", { data: tokenEscrowBytes({ amount: BigInt(6000), status: 1 }) }, 409],
    ["other payer named", { data: tokenEscrowBytes({ amount: BigInt(6000) }) }, 402, { payer: stranger.toBase58() }],
    ["bad nonce", { data: tokenEscrowBytes({ amount: BigInt(6000) }) }, 402, { nonce: "xyz" }],
  ];
  for (const [name, account, status, overrides] of cases) {
    const d = deps(account);
    const client = new MockOpenRouterClient();
    const response = await handleRuntimeRequest(request(meteredPayment(overrides)), config, client, d.value);
    assert.equal(response.status, status, name);
    assert.equal(client.callCount, 0, name);
    assert.equal(d.settled.length, 0, name);
  }
});

test("does not answer when the settle fails, and refuses metered payment without a signer", async () => {
  const failing = deps({ data: tokenEscrowBytes({ amount: BigInt(6000) }) }, async () => {
    throw new Error("rpc down");
  });
  const response = await handleRuntimeRequest(request(meteredPayment()), config, new MockOpenRouterClient(), failing.value);
  assert.equal(response.status, 502);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.charged, false);
  assert.equal(body.choices, undefined);

  const unsigned = await handleRuntimeRequest(request(meteredPayment()), config, new MockOpenRouterClient(), { readAccount: failing.value.readAccount });
  assert.equal(unsigned.status, 402);
  assert.equal(((await unsigned.json()) as { error: { code: string } }).error.code, "metered_not_offered");

});
