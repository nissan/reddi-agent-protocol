#!/usr/bin/env node
/**
 * A buyer's side of a session: one metered escrow lock pays for several
 * calls, and the provider settles once, for the total.
 *
 *   BUYER_KEYPAIR_PATH=~/.config/solana/buyer.json \
 *     node examples/session-call.mjs http://localhost:8787 3
 *
 * It locks enough for the calls, makes a session key and has the buyer
 * wallet sign a delegation to it, sends the calls numbered 1..n (the last
 * one closes the session), then checks the whole receipt chain.
 *
 * Devnet only. The buyer wallet needs a little devnet SOL and devnet USDC.
 */
import { createHash, createPrivateKey, randomBytes, sign as edSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { verifyReddiReceiptV2Session } from "@redditech/agent-protocol/receipt-v2";
import x402 from "@redditech/x402-solana";

const { buildLockTokenEscrowInstruction, directPaymentCurrency, meteredPaymentHeaderValue, SOLANA_GENESIS_HASHES, sessionCallAction, sessionDelegationHeaderValue, sessionSignatureHeaderValue, tokenEscrowAddresses, treasuryTokenAccount } = x402;

const [providerUrl, callsText = "3"] = process.argv.slice(2);
const calls = Number(callsText);
if (!providerUrl || !Number.isSafeInteger(calls) || calls < 1 || calls > 20) {
  console.error("Usage: node examples/session-call.mjs <provider url> [calls, 1-20]");
  process.exit(1);
}
const keyPath = (process.env.BUYER_KEYPAIR_PATH ?? "").replace(/^~(?=\/)/, homedir());
if (!keyPath) {
  console.error("Set BUYER_KEYPAIR_PATH to the buyer wallet's keypair file. Use a devnet-only wallet.");
  process.exit(1);
}
const buyer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyPath, "utf8"))));
const signer = (keypair) => {
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(keypair.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
  return (message) => new Uint8Array(edSign(null, Buffer.from(message), key));
};
const base = providerUrl.replace(/\/+$/, "");
const endpoint = `${base}/v1/chat/completions`;
const bodyOf = (n) => JSON.stringify({ messages: [{ role: "user", content: `Call ${n}: say hello in one sentence.` }], max_tokens: 200 });

const first = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: bodyOf(1) });
if (first.status !== 402) throw new Error(`expected a 402 with the price, got ${first.status}`);
const offer = (await first.json()).metered;
if (offer?.network !== "solana-devnet") throw new Error("this example pays on devnet only");
const currency = directPaymentCurrency(offer.currency);
// Enough for every call's worst case, twice over.
const amount = BigInt(offer.suggestedMaxChargeBaseUnits) * BigInt(calls);
console.log(`Price: ${offer.inputPerMillion} in / ${offer.outputPerMillion} out ${offer.currency} per million tokens. Locking ${amount} base units for ${calls} calls.`);

const connection = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
if ((await connection.getGenesisHash()) !== SOLANA_GENESIS_HASHES["solana-devnet"]) throw new Error("SOLANA_RPC_URL is not a devnet endpoint");
const programId = new PublicKey(offer.escrowProgramId);
const mint = new PublicKey(offer.mint);
const tokenProgram = new PublicKey(currency.tokenProgram);
const payee = new PublicKey(offer.payTo);
const nonce = randomBytes(16);
const lock = buildLockTokenEscrowInstruction({
  programId, tokenProgram, payer: buyer.publicKey, payee, mint,
  source: treasuryTokenAccount({ mint, tokenProgram }, buyer.publicKey),
  recipient: treasuryTokenAccount({ mint, tokenProgram }, payee),
  amount, nonce, metered: true,
});
const latest = await connection.getLatestBlockhash("confirmed");
const transaction = new Transaction({ feePayer: buyer.publicKey, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }).add(lock);
transaction.sign(buyer);
const lockSignature = await connection.sendRawTransaction(transaction.serialize());
await connection.confirmTransaction({ signature: lockSignature, ...latest }, "confirmed");
console.log(`Locked: ${lockSignature}`);

const escrow = tokenEscrowAddresses({ programId, payer: buyer.publicKey, nonce }).escrow.toBase58();
const sessionKey = Keypair.generate();
const delegation = await sessionDelegationHeaderValue({ genesisHash: SOLANA_GENESIS_HASHES["solana-devnet"], escrow, provider: payee.toBase58(), sessionKey: sessionKey.publicKey.toBase58(), expiresAt: Math.floor(Date.now() / 1000) + 3600 }, signer(buyer));
const payment = meteredPaymentHeaderValue({ payer: buyer.publicKey, nonce, programId });

const receipts = [];
let closing;
for (let n = 1; n <= calls; n += 1) {
  const body = bodyOf(n);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x402-payment": payment,
      "x402-session-sequence": String(n),
      ...(n === calls ? { "x402-session": "close" } : {}),
      "x402-session-delegation": delegation,
      "x402-session-signature": await sessionSignatureHeaderValue({ genesisHash: SOLANA_GENESIS_HASHES["solana-devnet"], action: sessionCallAction(n === calls), escrow, sequence: n, body }, signer(sessionKey)),
    },
    body,
  });
  const text = await response.text();
  if (response.status !== 200) throw new Error(`call ${n} failed (${response.status}): ${text}`);
  const m = JSON.parse(text).reddi.metered;
  console.log(`Call ${n}: ${m.inputTokens} in / ${m.outputTokens} out; session so far ${m.session.cumulativeCost} ${offer.currency}.`);
  receipts.push(JSON.parse(Buffer.from(response.headers.get("x-reddi-provider-receipt"), "base64url").toString("utf8")));
  if (n === calls) {
    console.log(`Session ${response.headers.get("x-reddi-session-state")}.`);
    const value = response.headers.get("x-reddi-session-receipt");
    if (value) closing = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  }
}
if (!closing) throw new Error("the session closed without a closing receipt");
receipts.push(closing);
const p = closing.receipt.payment;
console.log(`Settled once: ${p.txSignature}. Charged ${p.amount} base units (fee ${p.fee.amount}); refunded ${p.metered.refunded}.`);
const check = verifyReddiReceiptV2Session(receipts, { providerId: offer.payTo, session: { escrow } });
console.log(check.ok ? `Receipt chain: ${receipts.length} receipts, signed, linked and closed.` : `Receipt chain did NOT verify: ${JSON.stringify(check)}`);
process.exit(check.ok ? 0 : 1);
