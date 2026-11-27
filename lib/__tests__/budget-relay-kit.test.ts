/**
 * @jest-environment node
 *
 * The relay against a provider-kit provider (#1206, audit 1079ce8 S7-claude-02):
 * the app's relay, custody and spender (a P-256 key, as the signer project
 * holds it in KMS) pay a provider run by the kit's own handler
 * (`packages/provider-kit/src`, the source of the published 0.4.0), on an
 * in-memory chain that applies each reserve the provider co-signs: the
 * agent's calls reserve a slice, are served, and the relay's answers, the
 * provider's receipts and its slice ledger agree.
 *
 * USDC only: the kit takes token currencies only (`price.currency: SOL is not
 * a token currency`), so a SOL Budget is paid by the sandbox desks, whose run
 * on the same P-256 path is in `budget-relay.test.ts`.
 */
jest.mock("@anthropic-ai/sdk", () => ({ __esModule: true, default: class {} }), { virtual: true });

import { createHash, createPrivateKey, generateKeyPairSync, sign as nodeSign } from "crypto";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { MemoryNonceReplayStore } from "@redditech/x402-solana";
import { BUDGET_DISCRIMINATORS, BUDGET_FLAG_P256_SPENDER, compressP256PublicKey, p256SpenderAddress, reservationAddress } from "@redditech/x402-solana/budget";
import { ed25519Sign } from "@redditech/x402-solana/ed25519";
import { verifyReddiReceiptV2 } from "@redditech/agent-protocol/receipt-v2";
import { activateSpender, approveAsSpender, signCallAsSpender, type CustodyDeps } from "@/lib/budget/custody";
import type { SpenderSigner } from "@/lib/budget/kms";
import { BUDGET_DISPUTE_SLOTS, BUDGET_OPEN_SLOTS, budgetProviders, prepareBudget, startBudget } from "@/lib/budget/page";
import { CHARGED_HEADER, SLICE_CALLS_HEADER, SLICE_COST_HEADER, relayBudgetCall, type RelayDeps } from "@/lib/budget/relay";
import { GENESIS_HASH, MemoryBudgetCustodyStore } from "@/lib/budget/store";

// The kit is its own package (ESM, its own dependencies and type check), so it is loaded untyped here:
// the app's `tsc` does not follow a `require`, and jest maps the kit's `./x.js` imports to its sources.
/* eslint-disable @typescript-eslint/no-require-imports */
const { createProviderHandler, PROVIDER_RECEIPT_HEADER } = require("../../packages/provider-kit/src/handler");
const { MemoryBudgetSliceStore } = require("../../packages/provider-kit/src/budgets");
const { ata, config, CURRENT_SLOT, fakeChain, provider, USDC } = require("../../packages/provider-kit/tests/helpers") as {
  ata: (owner: PublicKey, mint?: PublicKey) => PublicKey;
  config: (overrides: Record<string, unknown>) => unknown;
  CURRENT_SLOT: bigint;
  fakeChain: (escrow: null) => {
    accounts: Map<string, { owner: PublicKey; data: Uint8Array; lamports: bigint; executable: boolean }>;
    cosignAndSend?: (tx: Transaction) => Promise<string>;
  };
  provider: Keypair;
  USDC: PublicKey;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const PROGRAM = new PublicKey("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");
const CREATED = CURRENT_SLOT - BigInt(1_000);
const NOW_MS = Date.UTC(2026, 11, 5, 0, 0, 0);
const DEVNET = GENESIS_HASH["solana-devnet"];

function kms(): SpenderSigner {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    publicKey: compressP256PublicKey(publicKey.export({ format: "der", type: "spki" }).subarray(-65)),
    sign: async (m: Uint8Array) => Uint8Array.from(nodeSign("sha256", m, privateKey)),
  };
}

const pkcs8 = (k: Keypair) => createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(k.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });

function u64(v: bigint) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

function budgetBytes(o: { payer: PublicKey; spender: PublicKey; mint: PublicKey; total: bigint; unreserved: bigint; reservations: number }): Buffer {
  const data = Buffer.alloc(349);
  Buffer.from(BUDGET_DISCRIMINATORS["account:Budget"]).copy(data, 0);
  o.payer.toBuffer().copy(data, 8);
  o.spender.toBuffer().copy(data, 40);
  o.mint.toBuffer().copy(data, 104);
  u64(CREATED).copy(data, 152);
  u64(BUDGET_OPEN_SLOTS).copy(data, 160);
  u64(BUDGET_DISPUTE_SLOTS).copy(data, 168);
  u64(BUDGET_OPEN_SLOTS).copy(data, 176);
  u64(o.total).copy(data, 184);
  u64(o.unreserved).copy(data, 192);
  u64(o.total / BigInt(2)).copy(data, 200);
  provider.publicKey.toBuffer().copy(data, 208);
  data[344] = o.reservations;
  data[346] = BUDGET_FLAG_P256_SPENDER;
  return data;
}

function reservationBytes(o: { budget: PublicKey; payoutAccount: PublicKey; reserved: bigint }): Buffer {
  const data = Buffer.alloc(147);
  Buffer.from(BUDGET_DISCRIMINATORS["account:Reservation"]).copy(data, 0);
  o.budget.toBuffer().copy(data, 8);
  u64(CREATED).copy(data, 40);
  provider.publicKey.toBuffer().copy(data, 48);
  o.payoutAccount.toBuffer().copy(data, 80);
  u64(o.reserved).copy(data, 112);
  return data;
}

/** A Budget in `token` naming one kit provider, the relay's record of it, and that provider's handler on a shared chain. */
async function world(token: "USDC") {
  const total = BigInt(5_000_000);
  const kitConfig = config({ budgets: { enabled: true, minReservation: "0.01" } } as never);
  const entry = { id: "kit-provider", name: "Kit Provider", url: "https://kit.example/v1/chat/completions", payee: provider.publicKey.toBase58(), inputPerMillionUsd: "3", outputPerMillionUsd: "15" };
  const env = {
    BUDGET_OPS_EMAIL: "ops@example.com",
    RESEND_API_KEY: "re_test",
    BUDGET_ALERT_FROM: "alerts@example.com",
    BUDGET_USDC_PROVIDERS: JSON.stringify([entry]),
  };
  const kit = budgetProviders(env).find((p) => p.id === "kit-provider")!;
  expect(kit.token).toBe(token);

  const chain = fakeChain(null);
  const payer = Keypair.generate();
  const signer = kms();
  const store = new MemoryBudgetCustodyStore();
  const custodyChain = {
    slot: async () => CURRENT_SLOT,
    genesisHash: async () => DEVNET,
    readAccount: async (k: PublicKey) => {
      const found = chain.accounts.get(k.toBase58());
      return found ? { owner: found.owner, data: found.data } : null;
    },
  };
  const custody: CustodyDeps = { store, signer, sender: { email: async () => "sent", webhook: async () => "sent" }, env, nowMs: NOW_MS, chain: custodyChain };
  const prepared = prepareBudget({ payer: payer.publicKey.toBase58(), token, total: total.toString(), providerIds: [kit.id], email: "me@example.com" }, PROGRAM, NOW_MS, env);
  if (!prepared.ok) throw new Error(prepared.message);
  const started = await startBudget({ terms: prepared.terms, signature: Buffer.from(ed25519Sign(payer, Buffer.from(prepared.message, "base64"))).toString("base64"), programId: PROGRAM, blockhash: async () => Keypair.generate().publicKey.toBase58(), env }, custody);
  if (!started.ok) throw new Error(started.message);
  const budget = new PublicKey(started.budget);
  const spender = await p256SpenderAddress(signer.publicKey);
  const mint = USDC;
  chain.accounts.set(started.budget, { owner: PROGRAM, data: budgetBytes({ payer: payer.publicKey, spender, mint, total, unreserved: total, reservations: 0 }), lamports: 3_000_000n, executable: false });
  const activated = await activateSpender({ id: started.id, programId: PROGRAM }, custody);
  if (!activated.ok) throw new Error(activated.message);

  // The provider co-signs the spender-approved reserve; the chain applies it.
  const reserves: bigint[] = [];
  chain.cosignAndSend = async (tx: Transaction) => {
    tx.partialSign(provider);
    expect(tx.verifySignatures()).toBe(true);
    const ix = tx.instructions[tx.instructions.length - 1];
    const amount = Buffer.from(ix.data).readBigUInt64LE(16);
    const payoutAccount = ata(provider.publicKey, mint);
    chain.accounts.set(reservationAddress(budget, provider.publicKey, PROGRAM).toBase58(), { owner: PROGRAM, data: reservationBytes({ budget, payoutAccount, reserved: amount }), lamports: 1_500_000n, executable: false });
    const b = Buffer.from(chain.accounts.get(started.budget)!.data);
    b.writeBigUInt64LE(total - amount, 192);
    b[344] = 1;
    chain.accounts.set(started.budget, { ...chain.accounts.get(started.budget)!, data: b });
    reserves.push(amount);
    return "reserve-signature";
  };
  const slices = new MemoryBudgetSliceStore();
  const upstream = { calls: 0, async createChatCompletion() { upstream.calls += 1; return { id: "c", choices: [{ message: { role: "assistant", content: "hi" } }], usage: { prompt_tokens: 120, completion_tokens: 333 } }; } };
  const handler: (request: Request) => Promise<Response> = createProviderHandler(kitConfig, {
    chain,
    upstream,
    replayStore: new MemoryNonceReplayStore(),
    budgetSlices: slices,
    signMessage: (m: Uint8Array) => nodeSign(null, Buffer.from(m), pkcs8(provider)),
    now: () => new Date(NOW_MS),
    log: () => undefined,
  });

  const relay: RelayDeps = {
    store,
    programId: PROGRAM,
    env,
    async callProvider(_p, bodyText, headers) {
      const response = await handler(new Request(entry.url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: bodyText }));
      const out: Record<string, string> = {};
      response.headers.forEach((v, k) => (out[k] = v));
      return { status: response.status, headers: out, bodyText: await response.text() };
    },
    signCall: (input) => signCallAsSpender(input, custody),
    async reservedOnChain(budgetAddress, createdSlot, payee) {
      const found = chain.accounts.get(reservationAddress(new PublicKey(budgetAddress), new PublicKey(payee), PROGRAM).toBase58());
      return found && Buffer.from(found.data).readBigUInt64LE(40) === createdSlot ? Buffer.from(found.data).readBigUInt64LE(112) : BigInt(0);
    },
    nowMs: () => NOW_MS,
    approve: (input) => approveAsSpender({ id: input.id, auth: { agentSecret: input.agentSecret }, request: input.request, programId: PROGRAM }, custody),
    blockhash: async () => Keypair.generate().publicKey.toBase58(),
  };
  const call = (content: string) => relayBudgetCall({ key: `Bearer ${started.agentSecret}.${started.id}`, bodyText: JSON.stringify({ model: kit.model, messages: [{ role: "user", content }] }) }, relay);
  return { call, reserves, slices, started, payer, budget, upstream, total };
}

describe("Budget relay with a provider-kit provider: a USDC Budget on the P-256 path", () => {
  it("reserves what the kit offered, serves each call, and the answers, receipts and ledger agree", async () => {
    const w = await world("USDC");
    const answers = [];
    for (const content of ["first", "second", "third"]) {
      const answer = await w.call(content);
      expect(answer.status).toBe(200);
      // The body the relay forwarded: the model named as the provider's.
      answers.push({ answer, body: JSON.stringify({ model: "kit-provider", messages: [{ role: "user", content }] }) });
    }
    // One reserve, within what the kit accepted and the per-provider cap.
    expect(w.reserves).toHaveLength(1);
    expect(w.reserves[0]).toBeLessThanOrEqual(w.total / BigInt(2));
    expect(w.upstream.calls).toBe(3);

    const reservation = reservationAddress(w.budget, provider.publicKey, PROGRAM).toBase58();
    let last = BigInt(0);
    for (const [i, { answer, body }] of answers.entries()) {
      expect(answer.headers[CHARGED_HEADER]).toBe("true");
      expect(answer.headers[SLICE_CALLS_HEADER]).toBe(String(i + 1));
      const signed = JSON.parse(Buffer.from(answer.headers[PROVIDER_RECEIPT_HEADER], "base64url").toString("utf8"));
      const verified = verifyReddiReceiptV2(signed, {
        providerId: provider.publicKey.toBase58(),
        requestHash: createHash("sha256").update(body).digest("hex"),
        responseHash: createHash("sha256").update(answer.bodyText).digest("hex"),
        budget: { address: w.started.budget, createdSlot: CREATED.toString(), reservation },
        session: { escrow: reservation, payer: w.payer.publicKey.toBase58(), network: "solana-devnet" },
      });
      expect(verified.ok).toBe(true);
      const cost = BigInt(signed.receipt.session.cumulativeCost);
      // What the relay told the agent is what the provider signed.
      expect(answer.headers[SLICE_COST_HEADER]).toBe(cost.toString());
      expect(cost).toBeGreaterThan(last);
      last = cost;
    }
    // The provider's ledger, which its post will be made from, matches the last receipt.
    const slice = await w.slices.get(w.started.budget);
    expect(slice).toMatchObject({ sequence: 3, status: "open" });
    expect(BigInt(slice!.spent)).toBe(last);
    expect(last).toBeLessThanOrEqual(w.reserves[0]);
  });
});
