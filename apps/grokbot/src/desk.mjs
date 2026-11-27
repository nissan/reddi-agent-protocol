// One hired provider, paid from the Budget: numbered calls signed by Grokbot's spender key, one reserve
// of the planned slice on the first call, and every answer's provider receipt checked before it is used.
import { createHash, createPrivateKey, sign as edSign } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { verifyReddiReceiptV2 } from "@redditech/agent-protocol/receipt-v2";
import budgetProvider from "@redditech/x402-solana/budget-provider";
import { DEVNET_GENESIS } from "./discover.mjs";
import { FREE_CALL_MAX_TOKENS } from "./plan.mjs";

const { budgetRequestHeaders, spenderSignedReserve } = budgetProvider;
const sha = (text) => createHash("sha256").update(text).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function ed25519Signer(keypair) {
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(keypair.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
  return (message) => new Uint8Array(edSign(null, Buffer.from(message), key));
}

/**
 * @param {object} o
 * @param {string} o.role
 * @param {{ endpointUrl: string, wallet: string, displayName: string }} o.listing
 * @param {import("@solana/web3.js").PublicKey} o.budget
 * @param {bigint} o.createdSlot
 * @param {import("@solana/web3.js").Keypair} o.spender
 * @param {bigint} o.slice the planned slice: the one reserve this desk gets
 * @param {() => Promise<string>} o.blockhash
 */
export function createDesk({ role, listing, budget, createdSlot, spender, slice, blockhash, fetchImpl = fetch, log = () => {}, wait = sleep, verifyReceipt = verifyReddiReceiptV2 }) {
  const endpoint = `${listing.endpointUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  const payee = new PublicKey(listing.wallet);
  const sign = ed25519Signer(spender);
  let sequence = 0;
  let reserved = false;
  const calls = [];

  async function call(instruction, maxTokens = FREE_CALL_MAX_TOKENS) {
    const body = JSON.stringify({ messages: [{ role: "user", content: JSON.stringify(instruction) }], max_tokens: maxTokens });
    sequence += 1;
    for (let attempt = 1; attempt <= 8; attempt++) {
      const headers = await budgetRequestHeaders({ genesisHash: DEVNET_GENESIS, action: "call", budget, createdSlot, provider: payee, sequence, body }, sign);
      let extra = {};
      let response = await post(body, headers);
      if (response.status === 402) {
        const refusal = await response.json();
        const code = refusal?.error?.code;
        // A reserve names the slice's total, not an increase, so sending it again after one that did not land is safe.
        if (code !== "budget_reservation_required") throw new Error(`${listing.displayName} refused call ${sequence}: ${code}: ${refusal?.error?.message ?? ""}`);
        const offer = refusal.budget;
        if (offer?.payee !== listing.wallet) throw new Error(`${listing.displayName} asked for a reserve to another wallet`);
        if (BigInt(offer.minReservation) > slice) throw new Error(`${listing.displayName} wants at least ${offer.minReservation}, above its planned slice ${slice}`);
        const reserve = await spenderSignedReserve({ offer, budget, createdSlot, spender: spender.publicKey, amount: slice, recentBlockhash: await blockhash(), signWithSpender: sign });
        extra = { "x402-budget-reserve": reserve };
        log({ event: "reserve", role, amount: slice.toString() });
        response = await post(body, { ...headers, ...extra });
      }
      if (response.status === 409 || response.status === 429 || response.status === 503 || response.status === 502) {
        // Another call in flight, busy, or the model did not answer: nothing was charged; the same call number goes again.
        const after = Number(response.headers.get("retry-after")) || 5 * attempt;
        log({ event: "retry", role, sequence, status: response.status, detail: (await response.text()).slice(0, 200) });
        await wait(Math.min(after, 60) * 1000);
        continue;
      }
      const text = await response.text();
      if (response.status === 200 && extra["x402-budget-reserve"]) reserved = true;
      if (response.status !== 200) throw new Error(`${listing.displayName} call ${sequence} failed (${response.status}): ${text.slice(0, 300)}`);
      const signed = JSON.parse(Buffer.from(response.headers.get("x-reddi-provider-receipt") ?? "", "base64url").toString("utf8") || "null");
      const check = verifyReceipt(signed, { providerId: listing.wallet, requestHash: sha(body), responseHash: sha(text) });
      if (!check.ok) throw new Error(`the receipt of ${listing.displayName} call ${sequence} did not verify: ${JSON.stringify(check.errors)}`);
      if (signed.receipt.budget?.address !== budget.toBase58()) throw new Error(`the receipt of ${listing.displayName} call ${sequence} names another Budget`);
      const parsed = JSON.parse(text);
      const metered = parsed?.reddi?.metered;
      const content = JSON.parse(parsed?.choices?.[0]?.message?.content ?? "null");
      calls.push({ sequence, action: instruction.action, task: instruction.task ?? content?.task, cost: metered?.budget?.cost ?? "0", outputTokens: metered?.outputTokens ?? 0, receiptHash: signed.receiptHash ?? sha(JSON.stringify(signed.receipt)) });
      return { content, metered };
    }
    throw new Error(`${listing.displayName} call ${sequence} kept failing`);
  }

  function post(body, headers) {
    return fetchImpl(endpoint, { method: "POST", headers: { "content-type": "application/json", ...headers }, body, signal: AbortSignal.timeout(310_000) });
  }

  return {
    role,
    listing,
    calls,
    get reserved() {
      return reserved;
    },
    async start(job) {
      const { content } = await call({ action: "start", budget: budget.toBase58(), job });
      if (typeof content?.task !== "string") throw new Error(`${listing.displayName} gave no task id`);
      log({ event: "started", role, task: content.task, kind: content.kind });
      return content.task;
    },
    /** Status every `everyS` seconds (each call is free) until ready; throws if it failed. */
    async waitReady(task, { everyS = 20, maxMinutes = 45 } = {}) {
      const until = Date.now() + maxMinutes * 60_000;
      let last = "";
      while (Date.now() < until) {
        const { content } = await call({ action: "status", task });
        const line = `${content.status} ${content.stage ?? ""} ${content.progress ?? ""}`.trim();
        if (line !== last) log({ event: "status", role, task, status: content.status, stage: content.stage, progress: content.progress, eta_s: content.eta_s });
        last = line;
        if (content.status === "ready") return;
        if (["failed", "refused", "cancelled"].includes(content.status)) throw new Error(`${listing.displayName} task ${task} ${content.status}: ${content.error}`);
        await wait(everyS * 1000);
      }
      throw new Error(`${listing.displayName} task ${task} was not ready after ${maxMinutes} minutes`);
    },
    async collect(task, maxTokens) {
      const { content, metered } = await call({ action: "collect", task }, maxTokens);
      log({ event: "collected", role, task, billed: content.billed, cost: metered?.budget?.cost });
      return content;
    },
  };
}
