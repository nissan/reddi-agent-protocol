/**
 * @jest-environment node
 */
import { createHash, generateKeyPairSync, sign as nodeSign } from "crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BUDGET_DISCRIMINATORS, BUDGET_FLAG_P256_SPENDER, compressP256PublicKey, p256SpenderAddress } from "@redditech/x402-solana/budget";
import { BUDGET_SIGNATURE_HEADER, verifyPooledBudgetRequest } from "@redditech/x402-solana/budget-provider";
import { ed25519Sign } from "@redditech/x402-solana/ed25519";
import { activateSpender, signCallAsSpender, type CustodyDeps } from "@/lib/budget/custody";
import type { SpenderSigner } from "@/lib/budget/kms";
import { BUDGET_DISPUTE_SLOTS, BUDGET_OPEN_SLOTS, budgetProviders, prepareBudget, startBudget } from "@/lib/budget/page";
import { signCallViaSigner } from "@/lib/budget/signer-client";
import { handleSignCall, type SignerContext } from "@/lib/budget/signer-service";
import { GENESIS_HASH, MemoryBudgetCustodyStore } from "@/lib/budget/store";

const PROGRAM = Keypair.generate().publicKey;
const NOW_MS = Date.UTC(2026, 10, 25, 5, 0, 0);
const CREATED = BigInt(9_000_000);
const DEVNET = GENESIS_HASH["solana-devnet"];
const ENV = { BUDGET_OPS_EMAIL: "ops@example.com", RESEND_API_KEY: "re_test", BUDGET_ALERT_FROM: "alerts@example.com", BUDGET_SIGNER_URL: "https://signer.example", BUDGET_SIGNER_TOKEN: "t0ken" };
const [A, B, C] = budgetProviders();
const bodyHash = (body: string) => createHash("sha256").update(body).digest("hex");

function kms(): SpenderSigner & { calls: number } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const s = {
    calls: 0,
    publicKey: compressP256PublicKey(publicKey.export({ format: "der", type: "spki" }).subarray(-65)),
    sign: async (m: Uint8Array) => {
      s.calls += 1;
      return Uint8Array.from(nodeSign("sha256", m, privateKey));
    },
  };
  return s;
}

function u64(v: bigint) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

/** An open Budget record for providers A and B, as the Budget page makes it. */
async function openRecord(env: Record<string, string> = ENV) {
  const payer = Keypair.generate();
  const signer = kms();
  const deps: CustodyDeps = { store: new MemoryBudgetCustodyStore(), signer, sender: { email: async () => "sent", webhook: async () => "sent" }, env, nowMs: NOW_MS };
  const prepared = prepareBudget({ payer: payer.publicKey.toBase58(), token: "SOL", total: "30000000", providerIds: [A.id, B.id], email: "me@example.com" }, PROGRAM, NOW_MS);
  if (!prepared.ok) throw new Error(prepared.message);
  const started = await startBudget({ terms: prepared.terms, signature: Buffer.from(ed25519Sign(payer, Buffer.from(prepared.message, "base64"))).toString("base64"), programId: PROGRAM, blockhash: async () => Keypair.generate().publicKey.toBase58() }, deps);
  if (!started.ok) throw new Error(started.message);
  const spender = await p256SpenderAddress(signer.publicKey);
  const data = Buffer.alloc(349);
  Buffer.from(BUDGET_DISCRIMINATORS["account:Budget"]).copy(data, 0);
  payer.publicKey.toBuffer().copy(data, 8);
  spender.toBuffer().copy(data, 40);
  u64(CREATED).copy(data, 152);
  u64(BUDGET_OPEN_SLOTS).copy(data, 160);
  u64(BUDGET_DISPUTE_SLOTS).copy(data, 168);
  u64(BUDGET_OPEN_SLOTS).copy(data, 176);
  u64(BigInt(30_000_000)).copy(data, 184);
  new PublicKey(A.payTo).toBuffer().copy(data, 208);
  new PublicKey(B.payTo).toBuffer().copy(data, 240);
  data[346] = BUDGET_FLAG_P256_SPENDER;
  const chain = { slot: async () => CREATED + BigInt(5), genesisHash: async () => DEVNET, readAccount: async () => ({ owner: PROGRAM, data }) };
  const activated = await activateSpender({ id: started.id, programId: PROGRAM }, { ...deps, chain });
  if (!activated.ok) throw new Error(activated.message);
  return { deps, signer, started, spender, budget: started.budget };
}

describe("Budget calls: the spender signs one paid call", () => {
  it("signs a call the provider kit accepts, for a provider the payer named", async () => {
    const { deps, started, spender, budget } = await openRecord();
    const body = JSON.stringify({ model: A.model, messages: [{ role: "user", content: "hi" }] });
    const signed = await signCallAsSpender({ id: started.id, agentSecret: started.agentSecret, call: { payee: A.payTo, sequence: 1, bodyHash: bodyHash(body), action: "call" } }, deps);
    if (!signed.ok) throw new Error(signed.message);
    const header = Buffer.concat([Buffer.from(signed.publicKey), Buffer.from(signed.signature)]).toString("base64");
    const check = (over: Partial<Parameters<typeof verifyPooledBudgetRequest>[0]>) =>
      verifyPooledBudgetRequest({ genesisHash: DEVNET, action: "call", budget: new PublicKey(budget), createdSlot: CREATED, provider: new PublicKey(A.payTo), sequence: 1, body, spender, p256Spender: true, signatureHeader: header, ...over }).ok;
    expect(check({})).toBe(true);
    // The signature names the provider, the call number, the body and the Budget instance.
    expect(check({ provider: new PublicKey(B.payTo) })).toBe(false);
    expect(check({ sequence: 2 })).toBe(false);
    expect(check({ body: body + " " })).toBe(false);
    expect(check({ createdSlot: CREATED + BigInt(1) })).toBe(false);
    expect(BUDGET_SIGNATURE_HEADER).toBe("x402-budget-signature");
    const logged = (deps.store as MemoryBudgetCustodyStore & { uses: { purpose: string }[] }).uses;
    expect(logged.map((u) => u.purpose)).toEqual(["call"]);
  });

  it.each([
    ["a wrong secret", { agentSecret: "rap_budget_nope" }, "not_authorized"],
    ["a provider the payer did not name", { payee: () => C.payTo }, "unexpected_payee"],
    ["call 0", { sequence: 0 }, "invalid_sequence"],
    ["a malformed body hash", { bodyHash: "abc" }, "invalid_body_hash"],
  ])("refuses %s, and signs nothing", async (_name, change, code) => {
    const { deps, started, signer } = await openRecord();
    const call = { payee: A.payTo, sequence: 1, bodyHash: bodyHash("x"), action: "call" as const, ...("payee" in change ? { payee: (change.payee as () => string)() } : {}), ...("sequence" in change ? { sequence: change.sequence } : {}), ...("bodyHash" in change ? { bodyHash: change.bodyHash } : {}) };
    const signed = await signCallAsSpender({ id: started.id, agentSecret: "agentSecret" in change ? (change.agentSecret as string) : started.agentSecret, call }, deps);
    expect(signed.ok ? "ok" : signed.code).toBe(code);
    expect(signer.calls).toBe(0);
  });

  it("refuses while paused, and once the record is no longer open", async () => {
    const { deps, started } = await openRecord();
    const call = { payee: A.payTo, sequence: 1, bodyHash: bodyHash("x"), action: "call" as const };
    const paused = await signCallAsSpender({ id: started.id, agentSecret: started.agentSecret, call }, { ...deps, env: { ...ENV, BUDGET_SPENDING_PAUSED: "true" } });
    expect(paused.ok ? "ok" : paused.code).toBe("budgets_paused");
    const record = (await deps.store.byId(started.id))!;
    await deps.store.update({ ...record, status: "closed", version: record.version + 1 });
    const closed = await signCallAsSpender({ id: started.id, agentSecret: started.agentSecret, call }, deps);
    expect(closed.ok ? "ok" : closed.code).toBe("budget_not_open");
  });

  it("counts calls apart from approvals, and freezes a Budget past its call limit", async () => {
    const { deps, started } = await openRecord({ ...ENV, BUDGET_CALLS_MAX_PER_10_MIN: "3", BUDGET_SPENDER_MAX_USES_PER_10_MIN: "1" });
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      const ok = await signCallAsSpender({ id: started.id, agentSecret: started.agentSecret, call: { payee: A.payTo, sequence, bodyHash: bodyHash(String(sequence)), action: "call" } }, deps);
      expect(ok.ok).toBe(true);
    }
    // Three calls do not use up the one approval allowed.
    const approval = await deps.store.claimUse({ spenderId: started.id, purpose: "reserve", payee: A.payTo, messageSha256: "00", at: new Date(NOW_MS).toISOString() }, { perBudget: 1, perPayer: 60, global: 300 });
    expect(approval).toBe("ok");
    const fourth = await signCallAsSpender({ id: started.id, agentSecret: started.agentSecret, call: { payee: A.payTo, sequence: 4, bodyHash: bodyHash("4"), action: "call" } }, deps);
    expect(fourth.ok ? "ok" : fourth.code).toBe("key_overuse");
    expect((await deps.store.byId(started.id))!.status).toBe("frozen");
  });

  it("goes through the signer project, and the main app checks what comes back", async () => {
    const { deps, started, spender, budget } = await openRecord();
    const ctx: SignerContext = { custody: { ...deps, network: "solana-devnet" }, chain: {} as SignerContext["chain"], programId: PROGRAM, env: ENV };
    const viaHandler: typeof fetch = async (url, init) => handleSignCall(new Request(String(url), init as RequestInit), ctx);
    const expect_ = { budget, createdSlot: CREATED, spender: spender.toBase58(), network: "solana-devnet" as const };
    const call = { payee: A.payTo, sequence: 1, bodyHash: bodyHash("hello"), action: "call" as const };
    const signed = await signCallViaSigner({ id: started.id, agentSecret: started.agentSecret, call, expect: expect_ }, { env: ENV, fetchImpl: viaHandler });
    expect(signed.ok).toBe(true);
    // A signer answering for another Budget instance, or with a key that is not the spender, is not trusted.
    const other = await signCallViaSigner({ id: started.id, agentSecret: started.agentSecret, call: { ...call, sequence: 2 }, expect: { ...expect_, createdSlot: CREATED + BigInt(1) } }, { env: ENV, fetchImpl: viaHandler });
    expect(other.ok ? "ok" : other.code).toBe("signer_bad_answer");
    const wrongKey = await signCallViaSigner({ id: started.id, agentSecret: started.agentSecret, call: { ...call, sequence: 3 }, expect: { ...expect_, spender: Keypair.generate().publicKey.toBase58() } }, { env: ENV, fetchImpl: viaHandler });
    expect(wrongKey.ok ? "ok" : wrongKey.code).toBe("signer_bad_answer");
    const noToken = await handleSignCall(new Request("https://signer.example/api/v1/sign-call", { method: "POST", body: "{}" }), ctx);
    expect(noToken.status).toBe(401);
  });
});
