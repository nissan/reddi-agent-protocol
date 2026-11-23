import assert from "node:assert/strict";
import { createHash, createPrivateKey, sign as edSign } from "node:crypto";
import test from "node:test";
import { Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { ESCROW_PROTOCOL_TREASURY, MemoryNonceReplayStore, paidCallAuthHeaders, SOLANA_GENESIS_HASHES, tokenEscrowAddresses, treasuryTokenAccount } from "@redditech/x402-solana";
import { MockOpenRouterClient } from "../src/openrouter.js";
import { getProfile } from "../src/profiles/index.js";
import bs58 from "bs58";
import { handleRuntimeRequest, MemoryHeldAnswerStore, PROVIDER_RECEIPT_HEADER, SettleNotSentError, type ProviderReceiptStatement, type RuntimeConfig, type RuntimeDeps, type SpecialistSettleSigner } from "../src/index.js";

const PROGRAM = new PublicKey("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");
const USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SETTLE_SIG = "4".repeat(88);
const profile = getProfile("planning-agent")!;
const payee = new PublicKey(profile.walletAddress);
const payerKeypair = Keypair.generate();
const payer = payerKeypair.publicKey;
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

/** The slot the fake chain is at. Locks are made 10 slots earlier unless a test says otherwise. */
const CURRENT_SLOT = BigInt(1_000_000);

const disc = (name: string) => createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);

function tokenEscrowBytes(fields: { amount: bigint; payee?: PublicKey; mint?: PublicKey; recipient?: PublicKey; status?: number; metered?: boolean; payer?: PublicKey; /** `null`: an account the earlier program wrote, with no windows. */ windows?: { claim: bigint; cancel: bigint } | null; createdSlot?: bigint }): Uint8Array {
  const mint = fields.mint ?? USDC;
  const owner = fields.payee ?? payee;
  const data = Buffer.alloc(fields.windows === null ? 203 : 219);
  disc("TokenEscrowAccount").copy(data, 0);
  (fields.payer ?? payer).toBuffer().copy(data, 8);
  owner.toBuffer().copy(data, 40);
  mint.toBuffer().copy(data, 72);
  treasuryTokenAccount({ mint, tokenProgram: TOKEN_PROGRAM }, fields.payer ?? payer).toBuffer().copy(data, 104);
  (fields.recipient ?? treasuryTokenAccount({ mint, tokenProgram: TOKEN_PROGRAM }, owner)).toBuffer().copy(data, 136);
  data.writeBigUInt64LE(fields.amount, 168);
  Buffer.from(NONCE, "hex").copy(data, 176);
  data[192] = fields.status ?? 0;
  data.writeBigUInt64LE(fields.createdSlot ?? CURRENT_SLOT - BigInt(10), 193);
  data[201] = 254;
  data[202] = fields.metered === false ? 0 : 1;
  if (fields.windows !== null) {
    data.writeBigUInt64LE(fields.windows?.claim ?? BigInt(1_500), 203);
    data.writeBigUInt64LE(fields.windows?.cancel ?? BigInt(4_500), 211);
  }
  return data;
}

const escrow = tokenEscrowAddresses({ programId: PROGRAM, payer, nonce: Buffer.from(NONCE, "hex") }).escrow;

const TREASURY_TOKEN = treasuryTokenAccount({ mint: USDC, tokenProgram: TOKEN_PROGRAM });

/**
 * The fake chain's record of sent settles, as getParsedTransaction returns them: the settle
 * instruction, and the treasury token account credited `fee(actual)` (2.5% by default).
 */
function chainOf(fee: (actual: bigint) => bigint = (actual) => (actual * BigInt(250)) / BigInt(10_000)) {
  const landed = new Map<string, TransactionInstruction>();
  return {
    landed,
    read: (async (signature: string) => {
      const ix = landed.get(signature);
      if (!ix) return null;
      const actual = ix.data.readBigUInt64LE(8);
      const keys = [...new Set(ix.keys.map((k) => k.pubkey.toBase58()))];
      const index = keys.indexOf(TREASURY_TOKEN.toBase58());
      const balance = (amount: bigint) => [{ accountIndex: index, mint: USDC.toBase58(), uiTokenAmount: { amount: amount.toString() } }];
      return {
        meta: { err: null, preTokenBalances: balance(BigInt(100)), postTokenBalances: balance(BigInt(100) + fee(actual)) },
        transaction: { message: { accountKeys: keys.map((pubkey) => ({ pubkey })), instructions: [{ programId: ix.programId.toBase58(), accounts: ix.keys.map((k) => k.pubkey.toBase58()), data: bs58.encode(ix.data) }] } },
      };
    }) as (signature: string) => Promise<unknown>,
  };
}

function deps(account: { owner?: PublicKey; data: Uint8Array } | null, settle?: SpecialistSettleSigner, readSlot: () => Promise<bigint> = async () => CURRENT_SLOT, chain = chainOf()) {
  // The settle instruction of each transaction, and each whole transaction's instructions.
  const settled: TransactionInstruction[] = [];
  const transactions: TransactionInstruction[][] = [];
  const statements: ProviderReceiptStatement[] = [];
  const value: RuntimeDeps = {
    readSettleTransaction: chain.read,
    listEscrowSignatures: async () => [...chain.landed.keys()].reverse(),
    heldAnswers: new MemoryHeldAnswerStore(),
    settleReadSleep: async () => {},
    replayStore: new MemoryNonceReplayStore(),
    readAccount: async (address) => {
      if (address.equals(escrow)) return account ? { owner: account.owner ?? PROGRAM, data: account.data } : null;
      // The provider's, the treasury's and the buyer's USDC accounts exist and can receive.
      const owner = [payee, ESCROW_PROTOCOL_TREASURY, payer].find((wallet) => treasuryTokenAccount({ mint: USDC, tokenProgram: TOKEN_PROGRAM }, wallet).equals(address));
      if (!owner) return null;
      const data = Buffer.alloc(165);
      USDC.toBuffer().copy(data, 0);
      owner.toBuffer().copy(data, 32);
      data[108] = 1;
      return { owner: TOKEN_PROGRAM, data };
    },
    readSlot,
    settleMeteredEscrow:
      settle ??
      (async (ixs) => {
        transactions.push(ixs);
        settled.push(ixs[ixs.length - 1]);
        chain.landed.set(SETTLE_SIG, ixs[ixs.length - 1]);
        return SETTLE_SIG;
      }),
    signProviderReceipt: (statement) => {
      statements.push(statement);
      return { receipt: statement, proof: { type: "ed25519", signature: "test" } };
    },
    now: () => new Date("2026-11-21T02:00:00Z"),
  };
  return { value, settled, transactions, statements, chain };
}

const BODY = JSON.stringify({ messages: [{ role: "user", content: "Plan a three step rollout." }], max_tokens: 200 });

// The payer's signature over BODY on the test lock (#866); any metered payment sends it unless `unsigned`.
const payerKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(payerKeypair.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
const SIGNED = await paidCallAuthHeaders({
  genesisHash: SOLANA_GENESIS_HASHES["solana-devnet"],
  escrow: tokenEscrowAddresses({ programId: PROGRAM, payer, nonce: Buffer.from(NONCE, "hex") }).escrow.toBase58(),
  provider: payee.toBase58(),
  body: BODY,
  payer: payer.toBase58(),
  signWithPayer: (m) => new Uint8Array(edSign(null, Buffer.from(m), payerKey)),
});

function request(payment?: Record<string, unknown>, unsigned = false) {
  return new Request("https://planning.example.test/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", ...(payment ? { "x402-payment": JSON.stringify(payment), ...(unsigned ? {} : SIGNED) } : {}) },
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
  // The floor counts the input as 26 bytes plus 8 for its one message (34 tokens), plus 200 output, at $3 / $15 per million, rounded up.
  assert.equal(body.metered.minimumLockBaseUnits, "3102");

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
  // The settle goes alone: the accounts it pays were read with the lock, and nothing is created.
  const [settle] = d.transactions[0];
  assert.equal(d.transactions[0].length, 1);
  assert.equal(settle, d.settled[0]);
  assert.ok(settle.keys[6].pubkey.equals(treasuryTokenAccount({ mint: USDC, tokenProgram: TOKEN_PROGRAM }, ESCROW_PROTOCOL_TREASURY)));
  assert.ok(settle.keys[7].pubkey.equals(treasuryTokenAccount({ mint: USDC, tokenProgram: TOKEN_PROGRAM }, payer)));
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
    ["refund window too short", { data: tokenEscrowBytes({ amount: BigInt(6000), windows: { claim: BigInt(1), cancel: BigInt(1_499) } }) }, 402],
    // A long window named at lock, most of it already used up before the call.
    ["refund window nearly over", { data: tokenEscrowBytes({ amount: BigInt(6000), createdSlot: CURRENT_SLOT - BigInt(3_001) }) }, 402],
    ["refund window already open", { data: tokenEscrowBytes({ amount: BigInt(6000), createdSlot: CURRENT_SLOT - BigInt(10_000) }) }, 402],
    ["no window stated", { data: tokenEscrowBytes({ amount: BigInt(6000), windows: null }) }, 402],
    ["already settled", { data: tokenEscrowBytes({ amount: BigInt(6000), status: 1 }) }, 409],
    ["other payer named", { data: tokenEscrowBytes({ amount: BigInt(6000) }) }, 401, { payer: stranger.toBase58() }], // refused at the signature check, before any chain read (#866)
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

test("accepts a lock with exactly the seller's minimum left, and accepts nothing when the slot cannot be read", async () => {
  const edge = deps({ data: tokenEscrowBytes({ amount: BigInt(6000), createdSlot: CURRENT_SLOT - BigInt(3_000) }) });
  assert.equal((await handleRuntimeRequest(request(meteredPayment()), config, new MockOpenRouterClient(), edge.value)).status, 200);

  const blind = deps({ data: tokenEscrowBytes({ amount: BigInt(6000) }) }, undefined, async () => {
    throw new Error("rpc down");
  });
  const client = new MockOpenRouterClient();
  const response = await handleRuntimeRequest(request(meteredPayment()), config, client, blind.value);
  assert.equal(response.status, 503);
  assert.equal(client.callCount, 0);
  assert.equal(blind.settled.length, 0);
  // Nothing was remembered, so the same lock is good once the chain can be read.
  const retry = await handleRuntimeRequest(request(meteredPayment()), config, new MockOpenRouterClient(), { ...blind.value, readSlot: async () => CURRENT_SLOT });
  assert.equal(retry.status, 200);
});

test("does not answer when the settle was not sent, and refuses metered payment without a signer", async () => {
  const failing = deps({ data: tokenEscrowBytes({ amount: BigInt(6000) }) }, async () => {
    throw new SettleNotSentError("rpc down before send");
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

test("a metered call the payer did not sign is refused before the lock is read or the model runs (#866)", async () => {
  const d = deps({ data: tokenEscrowBytes({ amount: BigInt(6000) }) });
  const client = new MockOpenRouterClient();
  const response = await handleRuntimeRequest(request(meteredPayment(), true), config, client, d.value);
  assert.equal(response.status, 401);
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, "session_auth_required");
  assert.equal(client.callCount, 0);
  assert.equal(d.settled.length, 0);
});

test("every profile carries a per-token price, the mid tier by default, and the operator's setting overrides it", async () => {
  const { specialistProfiles, PER_TOKEN_TIERS, validateProfileRegistry } = await import("../src/profiles/index.js");
  assert.deepEqual(validateProfileRegistry(), []);
  for (const p of specialistProfiles) assert.deepEqual(p.meteredPrice, { inputPerMillion: "3", outputPerMillion: "15", maxOutputTokens: 2000 }, p.id);
  assert.equal(PER_TOKEN_TIERS.mid.outputPerMillion, "15");

  // With no operator price, the profile's own price is offered: 34 bounded input tokens + 200 output (the request's limit) at $3 / $15.
  const { meteredPrice: _unused, ...unpriced } = config;
  const offered = await handleRuntimeRequest(request(), unpriced, new MockOpenRouterClient(), deps(null).value);
  const body = (await offered.json()) as { metered: { price: Record<string, unknown>; minimumLockBaseUnits: string } };
  assert.equal(body.metered.minimumLockBaseUnits, "3102");
  // The listing states the per-token price.
  const listing = await handleRuntimeRequest(new Request("https://planning.example.test/.well-known/reddi-agent.json"), unpriced, new MockOpenRouterClient(), {});
  assert.deepEqual(((await listing.json()) as { meteredPrice: unknown }).meteredPrice, { currency: "USDC", inputPerMillion: "3", outputPerMillion: "15", maxOutputTokens: 2000 });
  const overridden = await handleRuntimeRequest(new Request("https://planning.example.test/.well-known/reddi-agent.json"), config, new MockOpenRouterClient(), {});
  assert.deepEqual(((await overridden.json()) as { meteredPrice: unknown }).meteredPrice, { currency: "USDC", ...config.meteredPrice });

  const { validateProfile } = await import("../src/profiles/index.js");
  assert.deepEqual(validateProfile({ ...specialistProfiles[0], meteredPrice: { inputPerMillion: "-1", outputPerMillion: "15" } }), [`${specialistProfiles[0].id}: invalid meteredPrice`]);
  assert.deepEqual(validateProfile({ ...specialistProfiles[0], meteredPrice: { inputPerMillion: "3", outputPerMillion: "15", maxOutputTokens: 0 } }), [`${specialistProfiles[0].id}: invalid meteredPrice.maxOutputTokens`]);
});

test("an unknown settle outcome is never reported as uncharged, and the payer collects the answer once it lands (audit S7-Codex-R2-04)", async () => {
  const PENDING = "6".repeat(88);
  const chain = chainOf();
  let sentIx: TransactionInstruction | undefined;
  const d = deps({ data: tokenEscrowBytes({ amount: BigInt(6000) }) }, async (ixs, context) => {
    sentIx = ixs[ixs.length - 1];
    context?.onSigned?.(PENDING);
    throw new Error("socket hang up after send");
  }, undefined, chain);
  const client = new MockOpenRouterClient();
  const first = await handleRuntimeRequest(request(meteredPayment()), config, client, d.value);
  assert.equal(first.status, 202);
  const body = (await first.json()) as Record<string, unknown>;
  assert.equal(body.charged, "unknown");
  assert.equal(body.settleSignature, PENDING);
  assert.equal(body.choices, undefined);
  assert.doesNotMatch(JSON.stringify(body), /nothing was charged/i);

  // Not on chain yet: still pending, the model is not called again.
  const early = await handleRuntimeRequest(request(meteredPayment()), config, client, d.value);
  assert.equal(early.status, 202);
  // It landed: the payer's retry of the same request gets the answer, with the fee the chain took.
  chain.landed.set(PENDING, sentIx!);
  const collected = await handleRuntimeRequest(request(meteredPayment()), config, client, d.value);
  assert.equal(collected.status, 200);
  assert.equal(client.callCount, 1);
  const answer = (await collected.clone().json()) as { choices: unknown[]; reddi: { metered: Record<string, unknown> } };
  assert.ok(answer.choices.length > 0);
  assert.equal(answer.reddi.metered.settleSignature, PENDING);
  assert.equal(d.statements.at(-1)!.payment.txSignature, PENDING);
  // Collected once.
  assert.equal((await handleRuntimeRequest(request(meteredPayment()), config, client, d.value)).status, 409);
});

test("a held answer goes only to the payer's signed retry, and a settle that did not land is reported as such", async () => {
  const PENDING = "7".repeat(88);
  const chain = chainOf();
  const d = deps({ data: tokenEscrowBytes({ amount: BigInt(6000) }) }, async (_ixs, context) => {
    context?.onSigned?.(PENDING);
    throw new Error("timeout");
  }, undefined, chain);
  const client = new MockOpenRouterClient();
  assert.equal((await handleRuntimeRequest(request(meteredPayment()), config, client, d.value)).status, 202);
  // Unsigned: refused before anything held is read.
  assert.equal((await handleRuntimeRequest(request(meteredPayment(), true), config, client, d.value)).status, 401);
  // The signature is on chain but failed: nothing charged by it, and the hold is dropped.
  chain.read = async () => ({ meta: { err: { InstructionError: [0, { Custom: 6053 }] } }, transaction: { message: { accountKeys: [], instructions: [] } } });
  d.value.readSettleTransaction = chain.read;
  const failed = await handleRuntimeRequest(request(meteredPayment()), config, client, d.value);
  assert.equal(failed.status, 502);
  assert.equal(((await failed.json()) as { charged: unknown }).charged, false);
});

test("a held answer whose signature the signer never gave is found among the escrow's transactions", async () => {
  const chain = chainOf();
  let sentIx: TransactionInstruction | undefined;
  const d = deps({ data: tokenEscrowBytes({ amount: BigInt(6000) }) }, async (ixs) => {
    sentIx = ixs[ixs.length - 1];
    throw new Error("timeout");
  }, undefined, chain);
  const client = new MockOpenRouterClient();
  const first = await handleRuntimeRequest(request(meteredPayment()), config, client, d.value);
  assert.equal(first.status, 202);
  assert.equal(((await first.json()) as { settleSignature?: string }).settleSignature, undefined);
  chain.landed.set("8".repeat(88), sentIx!);
  assert.equal((await handleRuntimeRequest(request(meteredPayment()), config, client, d.value)).status, 200);
});

test("the receipt's fee is what the treasury received in the settle, not the server clock's rate (audit S7-Codex-R2-05)", async () => {
  // The server clock says launch rate (2.5%); the settle landed at 5% and the chain shows 9 units for a fake 18-unit charge.
  const chain = chainOf(() => BigInt(9));
  const d = deps({ data: tokenEscrowBytes({ amount: BigInt(6000) }) }, undefined, undefined, chain);
  const response = await handleRuntimeRequest(request(meteredPayment()), config, new MockOpenRouterClient(), d.value);
  assert.equal(response.status, 200);
  assert.deepEqual(d.statements[0].payment.fee, { amount: "9", treasury: ESCROW_PROTOCOL_TREASURY.toBase58() });
  const body = (await response.json()) as { reddi: { metered: Record<string, unknown> } };
  assert.equal(body.reddi.metered.fee, "0.000009");
  assert.equal(body.reddi.metered.provider, "0.000009");
});

test("answers without a receipt when the confirmed settle cannot be read back, rather than guess the fee", async () => {
  const d = deps({ data: tokenEscrowBytes({ amount: BigInt(6000) }) });
  d.value.readSettleTransaction = async () => null;
  const response = await handleRuntimeRequest(request(meteredPayment()), config, new MockOpenRouterClient(), d.value);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get(PROVIDER_RECEIPT_HEADER), null);
  assert.equal(d.statements.length, 0);
  assert.equal(((await response.json()) as { reddi: { metered: { fee: unknown } } }).reddi.metered.fee, null);
});

test("a settle that names another escrow instance is not this job's settle", async () => {
  const chain = chainOf();
  const d = deps({ data: tokenEscrowBytes({ amount: BigInt(6000) }) }, undefined, undefined, chain);
  const read = chain.read;
  d.value.readSettleTransaction = async (signature) => {
    const tx = (await read(signature)) as { transaction: { message: { instructions: { data: string }[] } } } | null;
    if (!tx) return tx;
    const data = Buffer.from(bs58.decode(tx.transaction.message.instructions[0].data));
    data.writeBigUInt64LE(data.readBigUInt64LE(16) + BigInt(1), 16);
    tx.transaction.message.instructions[0].data = bs58.encode(data);
    return tx;
  };
  const response = await handleRuntimeRequest(request(meteredPayment()), config, new MockOpenRouterClient(), d.value);
  assert.equal(response.status, 502);
  assert.equal(((await response.json()) as { charged: unknown }).charged, false);
});

test("another wallet that signs correctly but names the payer's escrow learns nothing of a held answer, and the payer still collects", async () => {
  const PENDING = "6".repeat(88);
  const chain = chainOf();
  let sentIx: TransactionInstruction | undefined;
  const d = deps({ data: tokenEscrowBytes({ amount: BigInt(6000) }) }, async (ixs, context) => {
    sentIx = ixs[ixs.length - 1];
    context?.onSigned?.(PENDING);
    throw new Error("timeout");
  }, undefined, chain);
  const client = new MockOpenRouterClient();
  assert.equal((await handleRuntimeRequest(request(meteredPayment()), config, client, d.value)).status, 202);
  chain.landed.set(PENDING, sentIx!);

  // The other wallet signs this exact request with its own key and names the payer's escrow and nonce.
  const other = Keypair.generate();
  const otherKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(other.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
  const otherSigned = await paidCallAuthHeaders({
    genesisHash: SOLANA_GENESIS_HASHES["solana-devnet"],
    escrow: escrow.toBase58(),
    provider: payee.toBase58(),
    body: BODY,
    payer: other.publicKey.toBase58(),
    signWithPayer: (m) => new Uint8Array(edSign(null, Buffer.from(m), otherKey)),
  });
  const intruding = await handleRuntimeRequest(
    new Request("https://planning.example.test/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x402-payment": JSON.stringify(meteredPayment({ payer: other.publicKey.toBase58() })), ...otherSigned },
      body: BODY,
    }),
    config,
    client,
    d.value,
  );
  assert.equal(intruding.status, 402);
  const text = await intruding.text();
  assert.ok(!text.includes(PENDING), "no settle signature");
  assert.ok(!text.includes("settle_pending"), "no settle state");
  assert.ok(!text.includes("choices"), "no answer");

  // The payer's own retry still collects the held answer.
  assert.equal((await handleRuntimeRequest(request(meteredPayment()), config, client, d.value)).status, 200);
});

test("a hold is never handed to a wallet other than the payer who locked it", async () => {
  // A store entry keyed to a different wallet's escrow but recorded for the payer: the caller sees nothing held.
  const other = Keypair.generate();
  const otherNonce = "ffeeddccbbaa99887766554433221100";
  const otherEscrow = tokenEscrowAddresses({ programId: PROGRAM, payer: other.publicKey, nonce: Buffer.from(otherNonce, "hex") }).escrow;
  const store = new MemoryHeldAnswerStore();
  const { heldAnswerKey } = await import("../src/index.js");
  await store.put(heldAnswerKey(otherEscrow, BODY), {
    upstreamJson: "{\"choices\":[]}",
    reddiJson: "{}",
    chargedBaseUnits: "18",
    createdSlot: "1",
    settleSignature: "5".repeat(88),
    settlement: { currency: "USDC", inputTokens: 1, outputTokens: 1, charged: "0.000018", capped: false, maxBaseUnits: "6000", payer: payer.toBase58() },
  });
  const otherKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(other.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
  const otherSigned = await paidCallAuthHeaders({
    genesisHash: SOLANA_GENESIS_HASHES["solana-devnet"],
    escrow: otherEscrow.toBase58(),
    provider: payee.toBase58(),
    body: BODY,
    payer: other.publicKey.toBase58(),
    signWithPayer: (m) => new Uint8Array(edSign(null, Buffer.from(m), otherKey)),
  });
  const d = deps(null);
  d.value.heldAnswers = store;
  const response = await handleRuntimeRequest(
    new Request("https://planning.example.test/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x402-payment": JSON.stringify(meteredPayment({ payer: other.publicKey.toBase58(), escrow: otherEscrow.toBase58(), nonce: otherNonce })), ...otherSigned },
      body: BODY,
    }),
    config,
    new MockOpenRouterClient(),
    d.value,
  );
  const text = await response.text();
  assert.notEqual(response.status, 202);
  assert.notEqual(response.status, 200);
  assert.ok(!text.includes("5".repeat(88)));
});
