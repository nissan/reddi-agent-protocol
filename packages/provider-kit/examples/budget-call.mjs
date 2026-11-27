#!/usr/bin/env node
/**
 * A buyer's side of a pooled Budget, for trying your provider on devnet:
 * one Budget opened up front pays for several calls, with no lock per call.
 *
 *   BUYER_KEYPAIR_PATH=~/.config/solana/buyer.json \
 *     node examples/budget-call.mjs http://localhost:8787 3
 *
 * The provider needs `"budgets": { "enabled": true }` in provider.json.
 *
 * It opens a small USDC Budget that only this provider may join, with a
 * fresh spender key; the first call carries a spender-signed reserve, which
 * the provider checks, co-signs and sends; the calls are numbered 1..n and
 * signed by the spender; then the buyer closes the Budget, which returns
 * everything the provider did not reserve. The provider posts its total and
 * is paid after the dispute window (about an hour here); what it did not
 * earn of its slice comes back to the buyer then.
 *
 * Devnet only. The buyer wallet needs a little devnet SOL and 0.30 devnet USDC.
 */
import { createHash, createPrivateKey, randomBytes, sign as edSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { verifyReddiReceiptV2 } from "@redditech/agent-protocol/receipt-v2";
import x402 from "@redditech/x402-solana";
import budgets from "@redditech/x402-solana/budget";
import budgetProvider from "@redditech/x402-solana/budget-provider";

const { directPaymentCurrency, SOLANA_GENESIS_HASHES, treasuryTokenAccount } = x402;
const { budgetAddress, closeBudgetInstruction, decodeBudget, openBudgetInstruction } = budgets;
const { budgetRequestHeaders, spenderSignedReserve } = budgetProvider;

const [providerUrl, callsText = "3"] = process.argv.slice(2);
const calls = Number(callsText);
if (!providerUrl || !Number.isSafeInteger(calls) || calls < 1 || calls > 20) {
  console.error("Usage: node examples/budget-call.mjs <provider url> [calls, 1-20]");
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
const endpoint = `${providerUrl.replace(/\/+$/, "")}/v1/chat/completions`;
const bodyOf = (n) => JSON.stringify({ messages: [{ role: "user", content: `Call ${n}: say hello in one sentence.` }], max_tokens: 200 });
const post = (body, headers = {}) => fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

// 1. Ask what the provider takes.
const first = await post(bodyOf(1));
if (first.status !== 402) throw new Error(`expected a 402 with the price, got ${first.status}`);
const quote = await first.json();
const offer = quote.budget;
if (offer?.scheme !== "budget") throw new Error('the provider takes no Budgets: set "budgets": { "enabled": true } in provider.json and restart it');
const devnet = SOLANA_GENESIS_HASHES["solana-devnet"];
if (offer.network !== devnet) throw new Error("this example pays on devnet only");
if (!offer.mint) throw new Error("this example opens a token Budget; the provider is priced in SOL");
const currency = directPaymentCurrency(quote.metered.currency);
if (!currency?.tokenProgram) throw new Error(`unsupported currency ${quote.metered.currency}`);

const connection = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
if ((await connection.getGenesisHash()) !== devnet) throw new Error("SOLANA_RPC_URL is not a devnet endpoint");
const send = async (instruction) => {
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: buyer.publicKey, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }).add(instruction);
  transaction.sign(buyer);
  const signature = await connection.sendRawTransaction(transaction.serialize());
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  return signature;
};

// 2. Open the Budget: three times the slice the provider asks for, so its slice stays under the default per-provider cap (half).
const programId = new PublicKey(offer.programId);
const mint = new PublicKey(offer.mint);
const tokenProgram = new PublicKey(currency.tokenProgram);
const payee = new PublicKey(offer.payee);
const buyerTokens = treasuryTokenAccount({ mint, tokenProgram }, buyer.publicKey);
const slice = BigInt(offer.reservation);
const total = slice * 3n;
const nonce = randomBytes(16);
const spender = Keypair.generate();
const budget = budgetAddress(buyer.publicKey, nonce, programId);
const minOpen = BigInt(offer.minOpenSlotsLeft);
const opened = await send(openBudgetInstruction({
  programId,
  payer: buyer.publicKey,
  nonce,
  spender: spender.publicKey,
  judge: null, // no judge, so the Budget names who may join instead
  allowlist: [payee],
  openSlots: minOpen * 2n > 18_000n ? minOpen * 2n : 18_000n, // about two hours
  disputeSlots: 9_000n, // the shortest the program takes, about an hour
  judgeSlots: 1_500n,
  total,
  token: { mint, source: buyerTokens, tokenProgram },
}));
const account = await connection.getAccountInfo(budget, "confirmed");
if (!account) throw new Error("the Budget account was not found after the open");
const { createdSlot } = decodeBudget(account.data);
console.log(`Budget ${budget.toBase58()} opened with ${total} base units of ${quote.metered.currency}: ${opened}`);

// 3. The calls. The first one needs a reserve: the provider says so, and the spender signs one for it to co-sign and send.
const named = { genesisHash: devnet, action: "call", budget, createdSlot, provider: payee };
const sha = (text) => createHash("sha256").update(text).digest("hex");
let verified = 0;
for (let n = 1; n <= calls; n += 1) {
  const body = bodyOf(n);
  const headers = await budgetRequestHeaders({ ...named, sequence: n, body }, signer(spender));
  let response = await post(body, headers);
  if (response.status === 402) {
    const refusal = await response.json();
    if (refusal.error?.code !== "budget_reservation_required") throw new Error(`call ${n} refused: ${JSON.stringify(refusal)}`);
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const reserve = await spenderSignedReserve({ offer: refusal.budget, budget, createdSlot, spender: spender.publicKey, amount: BigInt(refusal.budget.reservation), recentBlockhash: blockhash, signWithSpender: signer(spender) });
    console.log(`Reserving ${refusal.budget.reservation} base units for this provider.`);
    response = await post(body, { ...headers, "x402-budget-reserve": reserve });
  }
  const text = await response.text();
  if (response.status !== 200) throw new Error(`call ${n} failed (${response.status}): ${text}`);
  const m = JSON.parse(text).reddi.metered;
  console.log(`Call ${n}: ${m.inputTokens} in / ${m.outputTokens} out; cost ${m.budget.cost}, slice used ${m.budget.cumulativeCost} of ${m.budget.reserved} ${m.currency}.`);
  const signed = JSON.parse(Buffer.from(response.headers.get("x-reddi-provider-receipt") ?? "", "base64url").toString("utf8") || "null");
  const check = verifyReddiReceiptV2(signed, { providerId: offer.payee, requestHash: sha(body), responseHash: sha(text) });
  if (!check.ok) throw new Error(`the receipt of call ${n} did not verify: ${JSON.stringify(check.errors)}`);
  if (signed.receipt.budget?.address !== budget.toBase58()) throw new Error(`the receipt of call ${n} names another Budget`);
  verified += 1;
}
console.log(`Receipts: ${verified} signed by the provider, each naming this Budget.`);

// 4. Close the Budget. What no provider reserved comes straight back.
const closed = await send(closeBudgetInstruction({ programId, budget, createdSlot, signer: buyer.publicKey, payer: buyer.publicKey, token: { mint, refund: buyerTokens, tokenProgram } }));
console.log(`Budget closed: ${closed}`);
console.log("The provider now posts its total; it is paid, and the rest of its slice returned, after the dispute window.");
