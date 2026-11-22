#!/usr/bin/env node
/**
 * A buyer's side of one paid call, for trying your provider on devnet.
 *
 *   BUYER_KEYPAIR_PATH=~/.config/solana/buyer.json \
 *     node examples/paid-call.mjs http://localhost:8787 "Write a haiku about escrow"
 *
 * It asks for the price, shows the quote, locks the maximum in a metered
 * escrow, repeats the call with the lock, then checks the receipt.
 *
 * Devnet only. It refuses a provider on any other network. The buyer wallet
 * needs a little devnet SOL and devnet USDC (https://faucet.circle.com).
 */
import { createHash, createPrivateKey, randomBytes, sign as edSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { verifyReddiReceiptV2 } from "@redditech/agent-protocol/receipt-v2";
import x402 from "@redditech/x402-solana";

const { buildLockTokenEscrowInstruction, directPaymentCurrency, meteredPaymentHeaderValue, paidCallAuthHeaders, SOLANA_GENESIS_HASHES, tokenEscrowAddresses, treasuryTokenAccount } = x402;

const [providerUrl, prompt = "Say hello in one sentence."] = process.argv.slice(2);
if (!providerUrl) {
  console.error('Usage: node examples/paid-call.mjs <provider url> "<prompt>"');
  process.exit(1);
}
const keyPath = (process.env.BUYER_KEYPAIR_PATH ?? "").replace(/^~(?=\/)/, homedir());
if (!keyPath) {
  console.error("Set BUYER_KEYPAIR_PATH to the buyer wallet's keypair file. Use a devnet-only wallet.");
  process.exit(1);
}
const buyer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));
const endpoint = `${providerUrl.replace(/\/+$/, "")}/v1/chat/completions`;
const body = JSON.stringify({ messages: [{ role: "user", content: prompt }], max_tokens: 200 });
const post = (headers = {}) => fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

const first = await post();
if (first.status !== 402) throw new Error(`expected a 402 with the price, got ${first.status}`);
const offer = (await first.json()).metered;
if (offer?.settlement !== "metered-escrow") throw new Error("the provider made no per-token offer");
if (offer.network !== "solana-devnet") throw new Error(`this example pays on devnet only; the provider is on ${offer.network}`);
const currency = directPaymentCurrency(offer.currency);
if (!currency?.tokenProgram) throw new Error(`unsupported currency ${offer.currency}`);

console.log(`Price: ${offer.inputPerMillion} in / ${offer.outputPerMillion} out ${offer.currency} per million tokens`);
console.log(`Estimate: ${offer.estimatedCost} ${offer.currency}. Locking the maximum: ${offer.suggestedMaxCharge} ${offer.currency} (twice the estimate).`);

const connection = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
if ((await connection.getGenesisHash()) !== SOLANA_GENESIS_HASHES["solana-devnet"]) throw new Error("SOLANA_RPC_URL is not a devnet endpoint");

const programId = new PublicKey(offer.escrowProgramId);
const mint = new PublicKey(offer.mint);
const tokenProgram = new PublicKey(currency.tokenProgram);
const payee = new PublicKey(offer.payTo);
const nonce = randomBytes(16);
const lock = buildLockTokenEscrowInstruction({
  programId,
  tokenProgram,
  payer: buyer.publicKey,
  payee,
  mint,
  source: treasuryTokenAccount({ mint, tokenProgram }, buyer.publicKey),
  recipient: treasuryTokenAccount({ mint, tokenProgram }, payee),
  amount: BigInt(offer.suggestedMaxChargeBaseUnits),
  nonce,
  metered: true,
});
const latest = await connection.getLatestBlockhash("confirmed");
const transaction = new Transaction({ feePayer: buyer.publicKey, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }).add(lock);
transaction.sign(buyer);
const lockSignature = await connection.sendRawTransaction(transaction.serialize());
await connection.confirmTransaction({ signature: lockSignature, ...latest }, "confirmed");
console.log(`Locked: ${lockSignature}`);

// The lock is public on chain, so the buyer also signs this exact request: only the payer's call is served.
const buyerKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(buyer.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
const authHeaders = await paidCallAuthHeaders({
  genesisHash: SOLANA_GENESIS_HASHES["solana-devnet"],
  escrow: tokenEscrowAddresses({ programId, payer: buyer.publicKey, nonce }).escrow.toBase58(),
  provider: payee.toBase58(),
  body,
  payer: buyer.publicKey.toBase58(),
  signWithPayer: (message) => new Uint8Array(edSign(null, Buffer.from(message), buyerKey)),
});
const paid = await post({ "x402-payment": meteredPaymentHeaderValue({ payer: buyer.publicKey, nonce, programId }), ...authHeaders });
const responseText = await paid.text();
if (paid.status !== 200) throw new Error(`the paid call failed (${paid.status}): ${responseText}`);
const answer = JSON.parse(responseText);
console.log(`\n${answer.choices?.[0]?.message?.content}\n`);
const m = answer.reddi.metered;
console.log(`Used ${m.inputTokens} in / ${m.outputTokens} out tokens. Charged ${m.charged} ${m.currency} (fee ${m.fee}, provider ${m.provider}). Refunded ${m.refund}.`);
console.log(`Settled: ${m.settleSignature}`);

const signed = JSON.parse(Buffer.from(paid.headers.get("x-reddi-provider-receipt") ?? "", "base64url").toString("utf8") || "null");
const sha = (text) => createHash("sha256").update(text).digest("hex");
const check = verifyReddiReceiptV2(signed, {
  providerId: offer.payTo,
  requestHash: sha(body),
  responseHash: sha(responseText),
  payment: { network: "solana-devnet", txSignature: m.settleSignature, payer: buyer.publicKey.toBase58(), settlement: "metered-escrow" },
});
console.log(check.ok ? "Receipt: signed by the provider and matches this call." : `Receipt did NOT verify: ${JSON.stringify(check.errors)}`);
process.exit(check.ok ? 0 : 1);
