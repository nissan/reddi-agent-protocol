/**
 * @jest-environment node
 */
import { generateKeyPairSync, sign as nodeSign } from "crypto";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  BUDGET_DISCRIMINATORS,
  BUDGET_FLAG_CLOSED,
  BUDGET_FLAG_P256_SPENDER,
  budgetAddress,
  compressP256PublicKey,
  p256SpenderAddress,
  reservationAddress,
} from "@redditech/x402-solana/budget";
import { ed25519Sign } from "@redditech/x402-solana/ed25519";
import { activateSpender, relayAuthorizationMessage } from "@/lib/budget/custody";
import type { SpenderSigner } from "@/lib/budget/kms";
import {
  BUDGET_DISPUTE_SLOTS,
  BUDGET_OPEN_SLOTS,
  BUDGET_TOKENS,
  budgetAgentKey,
  budgetProviders,
  budgetStatus,
  buildBudgetAction,
  defaultBudgetJudge,
  DEVNET_USDC_MINT,
  prepareBudget,
  startBudget,
  type BudgetReader,
} from "@/lib/budget/page";
import { GENESIS_HASH, MemoryBudgetCustodyStore } from "@/lib/budget/store";
import { SANDBOX_PROVIDERS } from "@/lib/sandbox/catalog";

const PROGRAM = Keypair.generate().publicKey;
const NOW_MS = Date.UTC(2026, 10, 25, 4, 0, 0);
const CREATED = BigInt(9_000_000);
const BLOCKHASH = Keypair.generate().publicKey.toBase58();
const ENV = { BUDGET_OPS_EMAIL: "ops@example.com", RESEND_API_KEY: "re_test", BUDGET_ALERT_FROM: "alerts@example.com" };

function kms(): SpenderSigner {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { publicKey: compressP256PublicKey(publicKey.export({ format: "der", type: "spki" }).subarray(-65)), sign: async (m) => Uint8Array.from(nodeSign("sha256", m, privateKey)) };
}

const providers = budgetProviders();
const [A, B] = providers;

function deps(signer: SpenderSigner | undefined = kms()) {
  return { store: new MemoryBudgetCustodyStore(), signer, sender: { email: async () => "sent" as const, webhook: async () => "sent" as const }, env: ENV, nowMs: NOW_MS };
}

function u64(v: bigint) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

/** A Budget account's bytes, laid out as `decodeBudget` reads them. */
function budgetBytes(o: { payer: PublicKey; spender: PublicKey; judge?: PublicKey; mint?: PublicKey; total: bigint; unreserved: bigint; allowlist: PublicKey[]; closedSlot?: bigint; flags: number }): Uint8Array {
  const data = Buffer.alloc(349);
  Buffer.from(BUDGET_DISCRIMINATORS["account:Budget"]).copy(data, 0);
  o.payer.toBuffer().copy(data, 8);
  o.spender.toBuffer().copy(data, 40);
  if (o.judge) o.judge.toBuffer().copy(data, 72);
  if (o.mint) o.mint.toBuffer().copy(data, 104);
  u64(CREATED).copy(data, 152);
  u64(BUDGET_OPEN_SLOTS).copy(data, 160);
  u64(BUDGET_DISPUTE_SLOTS).copy(data, 168);
  u64(BUDGET_OPEN_SLOTS).copy(data, 176);
  u64(o.total).copy(data, 184);
  u64(o.unreserved).copy(data, 192);
  u64(o.total / BigInt(2)).copy(data, 200);
  o.allowlist.forEach((k, i) => k.toBuffer().copy(data, 208 + 32 * i));
  u64(o.closedSlot ?? BigInt(0)).copy(data, 336);
  data[346] = o.flags;
  return data;
}

const STATES = { open: 0, posted: 1, disputed: 2, paid: 3 } as const;
function reservationBytes(o: { budget: PublicKey; payee: PublicKey; reserved: bigint; final?: bigint; postedSlot?: bigint; disputedSlot?: bigint; state: keyof typeof STATES; waived?: boolean; created?: bigint }): Uint8Array {
  const data = Buffer.alloc(147);
  Buffer.from(BUDGET_DISCRIMINATORS["account:Reservation"]).copy(data, 0);
  o.budget.toBuffer().copy(data, 8);
  u64(o.created ?? CREATED).copy(data, 40);
  o.payee.toBuffer().copy(data, 48);
  o.payee.toBuffer().copy(data, 80);
  u64(o.reserved).copy(data, 112);
  u64(o.final ?? BigInt(0)).copy(data, 120);
  u64(o.postedSlot ?? BigInt(0)).copy(data, 128);
  u64(o.disputedSlot ?? BigInt(0)).copy(data, 136);
  data[144] = STATES[o.state];
  data[145] = o.waived ? 1 : 0;
  return data;
}

function fakeChain(accounts: Map<string, Uint8Array>, slot: bigint): BudgetReader & { latestBlockhash(): Promise<string>; genesisHash(): Promise<string> } {
  return {
    async readAccount(address) {
      const data = accounts.get(address.toBase58());
      return data ? { owner: PROGRAM, data } : null;
    },
    async reservations() {
      throw new Error("an allowlisted Budget is read slice by slice");
    },
    async slot() {
      return slot;
    },
    async latestBlockhash() {
      return BLOCKHASH;
    },
    async genesisHash() {
      return GENESIS_HASH["solana-devnet"];
    },
  };
}

describe("Budget page: prepare", () => {
  const payer = Keypair.generate();
  const base = { payer: payer.publicKey.toBase58(), token: "SOL", total: "33333334", providerIds: [A.id, B.id], email: "me@example.com" };

  it("offers only text providers that take real devnet payments", () => {
    expect(providers.length).toBeGreaterThan(0);
    const sol = providers.filter((p) => p.token === "SOL");
    const catalog = SANDBOX_PROVIDERS.filter((p) => sol.some((s) => s.id === p.id));
    expect(catalog).toHaveLength(sol.length);
    expect(catalog.every((p) => !p.simulatedOnly && !p.studio && !p.media && p.behaviour !== "offline")).toBe(true);
  });

  it("defaults to $5 in each token", () => {
    expect(BUDGET_TOKENS.USDC.defaultTotal).toBe(BigInt(5_000_000));
    expect(BUDGET_TOKENS.SOL.defaultTotal).toBeGreaterThan(BigInt(0));
  });

  it("answers with the exact authorization the relay checks, for a fresh Budget address", () => {
    const prepared = prepareBudget(base, PROGRAM, NOW_MS);
    if (!prepared.ok) throw new Error(prepared.message);
    const { terms } = prepared;
    expect(terms.issuedAt).toBe(Math.floor(NOW_MS / 1000));
    expect(prepared.budget).toBe(budgetAddress(payer.publicKey, Buffer.from(terms.nonce, "hex"), PROGRAM).toBase58());
    const expected = relayAuthorizationMessage({
      network: "solana-devnet",
      payer: base.payer,
      budget: prepared.budget,
      providers: [A.payee, B.payee],
      maxReserve: BigInt(16_666_667),
      contact: { email: "me@example.com" },
      issuedAt: terms.issuedAt,
    });
    expect(Buffer.from(prepared.message, "base64").equals(Buffer.from(expected))).toBe(true);
    // A second prepare picks another nonce.
    const again = prepareBudget(base, PROGRAM, NOW_MS);
    expect(again.ok && again.terms.nonce).not.toBe(terms.nonce);
  });

  it.each([
    [{ providerIds: [] }, "providers_required"],
    [{ providerIds: providers.slice(0, 5).map((p) => p.id).concat(["x", "y", "z", "w"]) }, "too_many_providers"],
    [{ providerIds: ["splice-line"] }, "unknown_provider"],
    [{ email: "" }, "contact_required"],
    [{ email: "not an email" }, "contact_required"],
    [{ total: "0" }, "invalid_amount"],
    [{ total: "500000001" }, "amount_too_large"],
    [{ token: "USDC", total: "100000001" }, "amount_too_large"],
    [{ token: "AUDD" }, "invalid_token"],
    [{ payer: "nope" }, "invalid_payer"],
  ])("refuses %j", (change, code) => {
    const prepared = prepareBudget({ ...base, ...change }, PROGRAM, NOW_MS);
    expect(prepared.ok ? "ok" : prepared.code).toBe(code);
  });
});

describe("Budget page: start", () => {
  const payer = Keypair.generate();

  // RAP's own providers are paid in USDC; they come from settings.
  const usdc = [1, 2].map((n) => ({ id: `rap-usdc-${n}`, name: `RAP ${n}`, url: `https://providers.example/${n}`, payee: Keypair.generate().publicKey.toBase58(), inputPerMillionUsd: "1", outputPerMillionUsd: "2" }));
  const USDC_ENV = { BUDGET_USDC_PROVIDERS: JSON.stringify(usdc) };

  async function started(token: "SOL" | "USDC" = "SOL", extra: Record<string, string> = {}) {
    const env = { ...USDC_ENV, ...extra };
    const ids = token === "SOL" ? [A.id, B.id] : usdc.map((p) => p.id);
    const prepared = prepareBudget({ payer: payer.publicKey.toBase58(), token, total: token === "SOL" ? "30000000" : "5000000", providerIds: ids, email: "me@example.com" }, PROGRAM, NOW_MS, env);
    if (!prepared.ok) throw new Error(prepared.message);
    const signature = Buffer.from(ed25519Sign(payer, Buffer.from(prepared.message, "base64"))).toString("base64");
    const d = deps();
    const result = await startBudget({ terms: prepared.terms, signature, programId: PROGRAM, blockhash: async () => BLOCKHASH, env }, d);
    return { prepared, result, d };
  }

  it("makes the relay's record and builds the P-256 open the payer signed for", async () => {
    const { prepared, result, d } = await started();
    if (!result.ok) throw new Error(result.message);
    expect(result.budget).toBe(prepared.budget);
    expect(result.record.status).toBe("pending");
    expect(result.agentSecret).toMatch(/^rap_budget_/);
    expect(budgetAgentKey(result.id, result.agentSecret)).toBe(`${result.agentSecret}.${result.id}`);
    const tx = Transaction.from(Buffer.from(result.transaction, "base64"));
    expect(tx.feePayer?.equals(payer.publicKey)).toBe(true);
    const open = tx.instructions.find((ix) => ix.programId.equals(PROGRAM))!;
    expect([...open.data.subarray(0, 8)]).toEqual(BUDGET_DISCRIMINATORS["global:open_budget"]);
    const data = open.data;
    expect(data.subarray(8, 24).toString("hex")).toBe(prepared.terms.nonce);
    expect(new PublicKey(data.subarray(24, 56)).equals(await p256SpenderAddress(d.signer!.publicKey))).toBe(true);
    expect(data.readBigUInt64LE(88)).toBe(BUDGET_OPEN_SLOTS);
    expect(data.readBigUInt64LE(96)).toBe(BUDGET_DISPUTE_SLOTS);
    expect(data.readBigUInt64LE(112)).toBe(BigInt(30_000_000));
    expect(data.readBigUInt64LE(120)).toBe(BigInt(15_000_000));
    expect(data[128] & BUDGET_FLAG_P256_SPENDER).toBe(BUDGET_FLAG_P256_SPENDER);
    expect(new PublicKey(data.subarray(129, 161)).toBase58()).toBe(A.payee);
    expect(new PublicKey(data.subarray(161, 193)).toBase58()).toBe(B.payee);
    // No judge set: none named.
    expect(new PublicKey(data.subarray(56, 88)).equals(PublicKey.default)).toBe(true);
  });

  it("names the RAP judge when one is set, and opens a USDC Budget from the payer's token account", async () => {
    const judge = Keypair.generate().publicKey.toBase58();
    expect(defaultBudgetJudge({ BUDGET_DEFAULT_JUDGE: judge })?.toBase58()).toBe(judge);
    expect(defaultBudgetJudge({ BUDGET_DEFAULT_JUDGE: "junk" })).toBeNull();
    const { result } = await started("USDC", { BUDGET_DEFAULT_JUDGE: judge });
    if (!result.ok) throw new Error(result.message);
    const open = Transaction.from(Buffer.from(result.transaction, "base64")).instructions.find((ix) => ix.programId.equals(PROGRAM))!;
    expect([...open.data.subarray(0, 8)]).toEqual(BUDGET_DISCRIMINATORS["global:open_token_budget"]);
    expect(new PublicKey(open.data.subarray(56, 88)).toBase58()).toBe(judge);
    expect(open.keys[3].pubkey.equals(DEVNET_USDC_MINT)).toBe(true);
    expect(new PublicKey(open.data.subarray(129, 161)).toBase58()).toBe(usdc[0].payee);
  });

  it("refuses a signature that is not the payer's, and makes no record", async () => {
    const prepared = prepareBudget({ payer: payer.publicKey.toBase58(), token: "SOL", total: "30000000", providerIds: [A.id], email: "me@example.com" }, PROGRAM, NOW_MS);
    if (!prepared.ok) throw new Error(prepared.message);
    const d = deps();
    const forged = Buffer.from(ed25519Sign(Keypair.generate(), Buffer.from(prepared.message, "base64"))).toString("base64");
    const result = await startBudget({ terms: prepared.terms, signature: forged, programId: PROGRAM, blockhash: async () => BLOCKHASH }, d);
    expect(result.ok ? "ok" : result.code).toBe("not_the_payer");
    expect(await d.store.byBudget(prepared.budget)).toBeUndefined();
  });

  it("refuses terms changed after signing (the payer signed for other providers)", async () => {
    const prepared = prepareBudget({ payer: payer.publicKey.toBase58(), token: "SOL", total: "30000000", providerIds: [A.id], email: "me@example.com" }, PROGRAM, NOW_MS);
    if (!prepared.ok) throw new Error(prepared.message);
    const signature = Buffer.from(ed25519Sign(payer, Buffer.from(prepared.message, "base64"))).toString("base64");
    const result = await startBudget({ terms: { ...prepared.terms, providerIds: [A.id, B.id] }, signature, programId: PROGRAM, blockhash: async () => BLOCKHASH }, deps());
    expect(result.ok ? "ok" : result.code).toBe("not_the_payer");
  });

  it("refuses when Budgets are not switched on", async () => {
    const prepared = prepareBudget({ payer: payer.publicKey.toBase58(), token: "SOL", total: "30000000", providerIds: [A.id], email: "me@example.com" }, PROGRAM, NOW_MS);
    if (!prepared.ok) throw new Error(prepared.message);
    const result = await startBudget({ terms: prepared.terms, signature: "x", programId: PROGRAM, blockhash: async () => BLOCKHASH }, { ...deps(), signer: undefined });
    expect(result.ok ? "ok" : result.code).toBe("custody_not_configured");
  });

  it("activates once the open is on chain as signed", async () => {
    const { prepared, result, d } = await started();
    if (!result.ok) throw new Error(result.message);
    const spender = await p256SpenderAddress(d.signer!.publicKey);
    const accounts = new Map([[prepared.budget, budgetBytes({ payer: payer.publicKey, spender, total: BigInt(30_000_000), unreserved: BigInt(30_000_000), allowlist: [new PublicKey(A.payee), new PublicKey(B.payee)], flags: BUDGET_FLAG_P256_SPENDER })]]);
    const activated = await activateSpender({ id: result.id, programId: PROGRAM }, { ...d, chain: fakeChain(accounts, CREATED + BigInt(10)) });
    expect(activated.ok).toBe(true);
  });
});

describe("Budget page: status and actions", () => {
  const payer = Keypair.generate();
  const spender = Keypair.generate().publicKey;
  const judge = Keypair.generate().publicKey;
  const budget = budgetAddress(payer.publicKey, new Uint8Array(16).fill(7), PROGRAM);
  const a = new PublicKey(A.payee);
  const b = new PublicKey(B.payee);

  function world(o: { closedSlot?: bigint; slot: bigint; sliceA: Parameters<typeof reservationBytes>[0]["state"]; waived?: boolean; mint?: PublicKey; judge?: PublicKey | null }) {
    const accounts = new Map<string, Uint8Array>();
    const closed = o.closedSlot !== undefined;
    accounts.set(
      budget.toBase58(),
      budgetBytes({ payer: payer.publicKey, spender, judge: o.judge === null ? undefined : (o.judge ?? judge), mint: o.mint, total: BigInt(30_000_000), unreserved: BigInt(20_000_000), allowlist: [a, b], closedSlot: o.closedSlot, flags: BUDGET_FLAG_P256_SPENDER | (closed ? BUDGET_FLAG_CLOSED : 0) }),
    );
    accounts.set(
      reservationAddress(budget, a, PROGRAM).toBase58(),
      reservationBytes({ budget, payee: a, reserved: BigInt(10_000_000), final: o.sliceA === "open" ? BigInt(0) : BigInt(4_000_000), postedSlot: o.sliceA === "open" ? BigInt(0) : CREATED + BigInt(100), disputedSlot: o.sliceA === "disputed" ? CREATED + BigInt(200) : BigInt(0), state: o.sliceA, waived: o.waived }),
    );
    // A slice left over from an earlier Budget at the same address is not shown.
    accounts.set(reservationAddress(budget, b, PROGRAM).toBase58(), reservationBytes({ budget, payee: b, reserved: BigInt(1), state: "open", created: CREATED - BigInt(1) }));
    return fakeChain(accounts, o.slot);
  }

  it("shows each provider's share and what can be done with it", async () => {
    const view = await budgetStatus(budget.toBase58(), PROGRAM, world({ slot: CREATED + BigInt(500), sliceA: "posted" }));
    expect(view).toBeDefined();
    expect(view!.token).toBe("SOL");
    expect(view!.closed).toBe(false);
    expect(view!.slices).toHaveLength(1);
    expect(view!.slices[0]).toMatchObject({ payee: A.payee, provider: { id: A.id }, reserved: "10000000", posted: "4000000", state: "posted", actions: ["approve", "dispute"] });
    expect(view!.providers.map((p) => p.id)).toEqual([A.id, B.id]);
  });

  it("is undefined for an address with no Budget", async () => {
    expect(await budgetStatus(Keypair.generate().publicKey.toBase58(), PROGRAM, world({ slot: CREATED, sliceA: "open" }))).toBeUndefined();
    expect(await budgetStatus("not-an-address", PROGRAM, world({ slot: CREATED, sliceA: "open" }))).toBeUndefined();
  });

  it.each([
    ["an approved post is paid at once", { slot: CREATED + BigInt(500), sliceA: "posted" as const, waived: true }, ["payout"]],
    ["no dispute without a judge", { slot: CREATED + BigInt(500), sliceA: "posted" as const, judge: null }, ["approve"]],
    ["after close, dispute until the window ends", { closedSlot: CREATED + BigInt(1_000), slot: CREATED + BigInt(2_000), sliceA: "posted" as const }, ["approve", "dispute"]],
    ["after the window, pay out", { closedSlot: CREATED + BigInt(1_000), slot: CREATED + BigInt(1_000) + BUDGET_DISPUTE_SLOTS, sliceA: "posted" as const }, ["payout"]],
    ["an unposted share after the window refunds", { closedSlot: CREATED + BigInt(1_000), slot: CREATED + BigInt(1_000) + BUDGET_DISPUTE_SLOTS, sliceA: "open" as const }, ["payout"]],
    ["disputed: wait for the judge", { closedSlot: CREATED + BigInt(1_000), slot: CREATED + BigInt(2_000), sliceA: "disputed" as const }, []],
    ["disputed past the judge window: refund", { closedSlot: CREATED + BigInt(1_000), slot: CREATED + BigInt(200) + BUDGET_OPEN_SLOTS, sliceA: "disputed" as const }, ["payout"]],
  ])("%s", async (_name, o, actions) => {
    const view = await budgetStatus(budget.toBase58(), PROGRAM, world(o));
    expect(view!.slices[0].actions).toEqual(actions);
  });

  it("builds approve, dispute and close for the payer only", async () => {
    const chain = world({ slot: CREATED + BigInt(500), sliceA: "posted" });
    for (const action of ["approve", "dispute"] as const) {
      const built = await buildBudgetAction({ budget: budget.toBase58(), payee: A.payee, action, account: payer.publicKey.toBase58(), programId: PROGRAM, chain });
      if (!built.ok) throw new Error(built.message);
      const ix = Transaction.from(Buffer.from(built.transaction, "base64")).instructions.find((i) => i.programId.equals(PROGRAM))!;
      expect([...ix.data.subarray(0, 8)]).toEqual(BUDGET_DISCRIMINATORS[action === "approve" ? "global:waive" : "global:dispute"]);
      expect(ix.keys[2].pubkey.equals(payer.publicKey)).toBe(true);
      expect(ix.keys[2].isSigner).toBe(true);
      const other = await buildBudgetAction({ budget: budget.toBase58(), payee: A.payee, action, account: Keypair.generate().publicKey.toBase58(), programId: PROGRAM, chain });
      expect(other.ok ? "ok" : other.code).toBe("not_the_payer");
    }
    const close = await buildBudgetAction({ budget: budget.toBase58(), payee: null, action: "close", account: payer.publicKey.toBase58(), programId: PROGRAM, chain });
    if (!close.ok) throw new Error(close.message);
    const ix = Transaction.from(Buffer.from(close.transaction, "base64")).instructions.find((i) => i.programId.equals(PROGRAM))!;
    expect([...ix.data.subarray(0, 8)]).toEqual(BUDGET_DISCRIMINATORS["global:close_budget"]);
  });

  it("refuses an action the share is not ready for, and a payout before its time", async () => {
    const chain = world({ slot: CREATED + BigInt(500), sliceA: "open" });
    const approve = await buildBudgetAction({ budget: budget.toBase58(), payee: A.payee, action: "approve", account: payer.publicKey.toBase58(), programId: PROGRAM, chain });
    expect(approve.ok ? "ok" : approve.code).toBe("not_now");
    const payout = await buildBudgetAction({ budget: budget.toBase58(), payee: A.payee, action: "payout", account: payer.publicKey.toBase58(), programId: PROGRAM, chain });
    expect(payout.ok ? "ok" : payout.code).toBe("not_now");
    const stale = await buildBudgetAction({ budget: budget.toBase58(), payee: B.payee, action: "payout", account: payer.publicKey.toBase58(), programId: PROGRAM, chain });
    expect(stale.ok ? "ok" : stale.code).toBe("slice_not_found");
  });

  it("lets anyone send a payout that is due, with the token accounts of a USDC Budget", async () => {
    const chain = world({ closedSlot: CREATED + BigInt(1_000), slot: CREATED + BigInt(1_000) + BUDGET_DISPUTE_SLOTS, sliceA: "posted", mint: DEVNET_USDC_MINT });
    const stranger = Keypair.generate().publicKey;
    const built = await buildBudgetAction({ budget: budget.toBase58(), payee: A.payee, action: "payout", account: stranger.toBase58(), programId: PROGRAM, chain });
    if (!built.ok) throw new Error(built.message);
    const tx = Transaction.from(Buffer.from(built.transaction, "base64"));
    expect(tx.feePayer?.equals(stranger)).toBe(true);
    const ix = tx.instructions.find((i) => i.programId.equals(PROGRAM))!;
    expect([...ix.data.subarray(0, 8)]).toEqual(BUDGET_DISCRIMINATORS["global:payout_token_budget"]);
    expect(ix.keys[5].pubkey.equals(DEVNET_USDC_MINT)).toBe(true);
  });
});
