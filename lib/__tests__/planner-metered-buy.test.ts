jest.mock("server-only", () => ({}));

import { createHash } from "crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { tokenEscrowAddresses, treasuryTokenAccount, ESCROW_PROTOCOL_TREASURY } from "@redditech/x402-solana/token-escrow";
import { RATING_DISCRIMINATORS, ratingPda } from "@redditech/x402-solana/rating";
import { planMeteredBuy } from "@/lib/payments/metered-buy";
import { receiptHeaderForProvider } from "@/lib/payments/wallet-direct-payment";
import { verifyAndRecordMeteredCall } from "@/lib/jobs/metered-call";
import type { Listing } from "@/lib/listings/listing-store";

const PROGRAM = Keypair.generate().publicKey;
const PAYER = Keypair.generate().publicKey;
const PROVIDER = Keypair.generate().publicKey.toBase58();
const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const NONCE = new Uint8Array(16).fill(9);
const NONCE_HEX = Buffer.from(NONCE).toString("hex");
const LOCK_SIG = "3".repeat(88);
const SETTLE_SIG = "5".repeat(88);
const HASH = "a".repeat(64);
const PRICES = { inputPerMillionUsd: 3, outputPerMillionUsd: 15 };

function offer(overrides: Record<string, unknown> = {}) {
  return {
    settlement: "metered-escrow",
    currency: "USDC",
    inputPerMillion: "3",
    outputPerMillion: "15",
    maxOutputTokens: 1000,
    estimate: { inputTokens: 100, outputTokens: 1000 },
    minimumLockBaseUnits: "15300",
    escrowProgramId: PROGRAM.toBase58(),
    mint: USDC,
    payTo: PROVIDER,
    ...overrides,
  };
}

function plan(overrides: Record<string, unknown> = {}, maxSpendUsd?: number) {
  return planMeteredBuy({
    offer: offer(overrides),
    listing: { walletAddress: PROVIDER, prices: PRICES },
    network: "solana-devnet",
    programId: PROGRAM,
    payer: PAYER,
    prompt: "x".repeat(400),
    maxSpendUsd,
    nonce: NONCE,
  });
}

describe("planner metered buy (#794)", () => {
  it("quotes the estimate and locks twice it by default", () => {
    const p = plan();
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.quote).toMatchObject({ currency: "USDC", estimatedCost: "0.0153", maxCharge: "0.0306" });
    expect(p.instruction.programId.equals(PROGRAM)).toBe(true);
    expect(p.instruction.data.readBigUInt64LE(8)).toBe(BigInt(30600));
    expect(p.escrow).toBe(tokenEscrowAddresses({ programId: PROGRAM, payer: PAYER, nonce: NONCE }).escrow.toBase58());
    const receipt = p.receiptFor(LOCK_SIG);
    expect(receipt).toEqual({
      settlement: "metered-escrow", network: "solana-devnet", currency: "USDC", payTo: PROVIDER,
      payer: PAYER.toBase58(), nonce: NONCE_HEX, escrow: p.escrow, lockSignature: LOCK_SIG,
    });
    // The receipt is forwarded as the header the provider reads.
    const header = receiptHeaderForProvider(receipt);
    expect(header.ok).toBe(true);
    if (header.ok) {
      expect(JSON.parse(header.header)).toEqual({ settlement: "metered-escrow", escrow: p.escrow, payer: PAYER.toBase58(), nonce: NONCE_HEX });
      expect(header.signature).toBe(LOCK_SIG);
    }
  });

  it("uses the buyer's budget as the maximum", () => {
    const p = plan({}, 0.02);
    expect(p.ok && p.quote.maxCharge).toBe("0.02");
  });

  it("refuses a budget below the provider's minimum lock, and lifts the default maximum to it", () => {
    const low = plan({ minimumLockBaseUnits: "25000" }, 0.02);
    expect(low).toMatchObject({ ok: false, reason: "budget_below_minimum" });
    const lifted = plan({ minimumLockBaseUnits: "40000" });
    expect(lifted.ok && lifted.quote.maxCharge).toBe("0.04");
  });

  it.each([
    [{ payTo: Keypair.generate().publicKey.toBase58() }, "wrong_provider"],
    [{ escrowProgramId: Keypair.generate().publicKey.toBase58() }, "wrong_program"],
    [{ mint: Keypair.generate().publicKey.toBase58() }, "wrong_mint"],
    [{ outputPerMillion: "16" }, "price_above_listing"],
    [{ currency: "AUDD" }, "wrong_mint"],
    [{ settlement: "direct" }, "no_offer"],
  ])("refuses an offer that does not match the listing: %j", (overrides, reason) => {
    expect(plan(overrides)).toMatchObject({ ok: false, reason });
  });
});

describe("planner metered buy with rating (#842)", () => {
  const rated = (rating: { judge?: PublicKey } = {}, overrides: Record<string, unknown> = {}) =>
    planMeteredBuy({ offer: offer(overrides), listing: { walletAddress: PROVIDER, prices: PRICES }, network: "solana-devnet", programId: PROGRAM, payer: PAYER, prompt: "x".repeat(400), nonce: NONCE, rating });

  it("signs the lock alone when rating is off", () => {
    const p = plan();
    expect(p.ok && p.instructions).toHaveLength(1);
    expect(p.ok && p.rating).toBeUndefined();
  });

  it("adds open_rating right after the lock, in the same transaction, signed by the payer", () => {
    const p = rated();
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const { escrow } = tokenEscrowAddresses({ programId: PROGRAM, payer: PAYER, nonce: NONCE });
    expect(p.instructions).toHaveLength(2);
    expect(p.instructions[0]).toBe(p.instruction);
    const open = p.instructions[1];
    expect([...open.data.subarray(0, 8)]).toEqual(RATING_DISCRIMINATORS["global:open_rating"]);
    // No judge: 32 zero bytes.
    expect(open.data.subarray(8).every((byte) => byte === 0)).toBe(true);
    expect(open.keys.map((key) => key.pubkey.toBase58())).toEqual([ratingPda(escrow, PROGRAM).toBase58(), escrow.toBase58(), PAYER.toBase58(), "11111111111111111111111111111111"]);
    expect(open.keys[2]).toMatchObject({ isSigner: true, isWritable: true });
    expect(p.rating).toBe(ratingPda(escrow, PROGRAM).toBase58());
    // The receipt the provider sees is unchanged: it reads the rated bit from the escrow itself.
    expect(p.receiptFor(LOCK_SIG)).not.toHaveProperty("rated");
  });

  it("names the judge the buyer chose, and refuses the buyer or the provider as judge", () => {
    const judge = Keypair.generate().publicKey;
    const p = rated({ judge });
    expect(p.ok && new PublicKey(p.instructions[1].data.subarray(8, 40)).equals(judge)).toBe(true);
    expect(rated({ judge: new PublicKey(PROVIDER) })).toMatchObject({ ok: false, reason: "invalid_judge" });
    expect(rated({ judge: PAYER })).toMatchObject({ ok: false, reason: "invalid_judge" });
  });

  it("passes on what the provider's offer says about rated jobs", () => {
    expect(rated({}, { acceptsRatedEscrows: false })).toMatchObject({ ok: true, providerAcceptsRatedJobs: false });
    expect(rated({}, { acceptsRatedEscrows: true })).toMatchObject({ ok: true, providerAcceptsRatedJobs: true });
    const silent = rated();
    expect(silent.ok && "providerAcceptsRatedJobs" in silent).toBe(false);
  });
});

describe("metered job record (#794)", () => {
  const { escrow, vault } = tokenEscrowAddresses({ programId: PROGRAM, payer: PAYER, nonce: NONCE });
  const mint = new PublicKey(USDC);
  const recipient = getAssociatedTokenAddressSync(mint, new PublicKey(PROVIDER), true, TOKEN_PROGRAM_ID).toBase58();
  const treasury = treasuryTokenAccount({ mint, tokenProgram: TOKEN_PROGRAM_ID }).toBase58();
  const source = getAssociatedTokenAddressSync(mint, PAYER, true, TOKEN_PROGRAM_ID).toBase58();

  const listing: Listing = {
    wallet: PROVIDER, displayName: "Atlas", endpointUrl: "https://provider.example/v1", declaredModels: [], capabilities: {},
    pricePerCallBaseUnits: "0", priceInputPerMillionBaseUnits: "3000000", priceOutputPerMillionBaseUnits: "15000000", priceMint: USDC,
    network: "solana-devnet", status: "listed", healthStatus: "pass", lastSeenAt: null, updatedAt: null,
  };
  const receipt = { settlement: "metered-escrow", network: "solana-devnet", currency: "USDC", payTo: PROVIDER, payer: PAYER.toBase58(), nonce: NONCE_HEX, escrow: escrow.toBase58(), lockSignature: LOCK_SIG };

  function settleTx(opts: { provider?: number; fee?: number; vault?: number; err?: unknown; accounts?: string[]; payout?: string; payoutOwner?: string; blockTime?: number } = {}) {
    const payout = opts.payout ?? recipient;
    const keys = [PAYER.toBase58(), PROVIDER, escrow.toBase58(), vault.toBase58(), payout, treasury, source, USDC, PROGRAM.toBase58(), TOKEN_PROGRAM_ID.toBase58()];
    const index = (k: string) => keys.indexOf(k);
    const bal = (k: string, amount: number, owner?: string) => ({ accountIndex: index(k), mint: USDC, ...(owner ? { owner } : {}), uiTokenAmount: { amount: String(amount) } });
    const provider = opts.provider ?? 975;
    const fee = opts.fee ?? 25;
    const inVault = opts.vault ?? 30600;
    const payoutOwner = opts.payoutOwner ?? PROVIDER;
    return {
      ...(opts.blockTime !== undefined ? { blockTime: opts.blockTime } : {}),
      meta: {
        err: opts.err ?? null,
        preTokenBalances: [bal(vault.toBase58(), inVault), bal(payout, 100, payoutOwner), bal(treasury, 0)],
        postTokenBalances: [bal(payout, 100 + provider, payoutOwner), bal(treasury, fee)],
      },
      transaction: {
        message: {
          accountKeys: keys.map((pubkey) => ({ pubkey })),
          instructions: [{
            programId: PROGRAM.toBase58(),
            accounts: opts.accounts ?? [escrow.toBase58(), vault.toBase58(), PROVIDER, PAYER.toBase58(), USDC, payout, treasury, source, TOKEN_PROGRAM_ID.toBase58()],
            data: "x",
          }],
        },
      },
    };
  }

  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function base58(bytes: Uint8Array): string {
    let n = BigInt("0x" + (Buffer.from(bytes).toString("hex") || "0"));
    let out = "";
    while (n > BigInt(0)) {
      out = B58[Number(n % BigInt(58))] + out;
      n /= BigInt(58);
    }
    for (const b of bytes) {
      if (b !== 0) break;
      out = "1" + out;
    }
    return out;
  }

  /** The buyer's lock_metered_token_escrow transaction, which fixes the maximum. */
  function lockTx(opts: { amount?: number; nonce?: Uint8Array; err?: unknown } = {}) {
    const amount = Buffer.alloc(8);
    amount.writeBigUInt64LE(BigInt(opts.amount ?? 30600));
    const disc = createHash("sha256").update("global:lock_metered_token_escrow").digest().subarray(0, 8);
    const data = Buffer.concat([disc, amount, Buffer.from(opts.nonce ?? NONCE), Buffer.alloc(16)]);
    return {
      meta: { err: opts.err ?? null },
      transaction: {
        message: {
          instructions: [{
            programId: PROGRAM.toBase58(),
            accounts: [escrow.toBase58(), vault.toBase58(), PAYER.toBase58(), PROVIDER, USDC, source, recipient, TOKEN_PROGRAM_ID.toBase58(), "11111111111111111111111111111111"],
            data: base58(data),
          }],
        },
      },
    };
  }

  function deps(tx: unknown, lock: unknown = lockTx()) {
    const stored: Array<Record<string, unknown>> = [];
    return {
      stored,
      deps: {
        programId: PROGRAM,
        connection: { getParsedTransaction: jest.fn(async (signature: string) => (signature === LOCK_SIG ? lock : tx)) },
        url: "https://project.supabase.example",
        serviceKey: "service",
        fetchImpl: jest.fn(async (_url: string, init: { body?: string }) => {
          stored.push(JSON.parse(init.body ?? "{}"));
          return { ok: true, status: 201, json: async () => [{ id: "0b0e7c1e-7a57-4d0e-b3f0-1c2d3e4f5a6b" }] };
        }),
      },
    };
  }

  const call = (d: ReturnType<typeof deps>["deps"], overrides: Record<string, unknown> = {}) =>
    verifyAndRecordMeteredCall(
      { receipt, settleSignature: SETTLE_SIG, listing, profile: "devnet", requestHash: HASH, responseHash: HASH, declaredModel: "atlas", delivered: true, ...overrides },
      d,
    );

  it("records what the settle paid, with the 2.5% fee to the treasury", async () => {
    const d = deps(settleTx());
    const result = await call(d.deps);
    expect(result).toMatchObject({
      recorded: true,
      paid: { currency: "USDC", mint: USDC, amountBaseUnits: "1000", payer: PAYER.toBase58(), fee: { amount: "25", treasury: ESCROW_PROTOCOL_TREASURY.toBase58() }, maxAmountBaseUnits: "30600", refundedBaseUnits: "29600" },
    });
    expect(d.stored[0]).toMatchObject({ amount_base_units: "1000", tx_signature: SETTLE_SIG, mint: USDC, provider_wallet: PROVIDER, buyer_wallet: PAYER.toBase58() });
  });

  it.each([
    ["a failed settle", { err: { InstructionError: [0, "Custom"] } }, "settle_failed_on_chain"],
    ["a fee at neither scheduled rate", { fee: 10 }, "fee_mismatch"],
    ["a settle of another escrow", { accounts: [Keypair.generate().publicKey.toBase58(), vault.toBase58(), PROVIDER, PAYER.toBase58(), USDC, recipient, treasury, source, TOKEN_PROGRAM_ID.toBase58()] }, "settle_not_for_this_escrow"],
    ["a settle that paid the provider nothing", { provider: 0, fee: 0 }, "settle_paid_nothing"],
  ])("refuses %s", async (_label, opts, reason) => {
    const d = deps(settleTx(opts));
    expect(await call(d.deps)).toEqual({ recorded: false, reason });
    expect(d.stored).toHaveLength(0);
  });

  it("checks the fee at the rate in force at the settle's block time: 2.5% until 1 April 2027, then 5%", async () => {
    const SWITCH = 1_806_537_600; // 2027-04-01T00:00:00Z, LAUNCH_RATE_ENDS_UNIX in the escrow program
    const day = 24 * 3600;
    expect(await call(deps(settleTx({ blockTime: SWITCH - day })).deps)).toMatchObject({ recorded: true, paid: { fee: { amount: "25" } } });
    expect(await call(deps(settleTx({ blockTime: SWITCH - day, provider: 950, fee: 50 })).deps)).toEqual({ recorded: false, reason: "fee_mismatch" });
    expect(await call(deps(settleTx({ blockTime: SWITCH + day, provider: 950, fee: 50 })).deps)).toMatchObject({ recorded: true, paid: { fee: { amount: "50" } } });
    expect(await call(deps(settleTx({ blockTime: SWITCH + day })).deps)).toEqual({ recorded: false, reason: "fee_mismatch" });
    // Right at the switch the cluster clock and the block time may disagree, so either rate is accepted.
    expect(await call(deps(settleTx({ blockTime: SWITCH + 60 })).deps)).toMatchObject({ recorded: true });
  });

  it("refuses a charge above the lock, even when the vault held more", async () => {
    const d = deps(settleTx({ vault: 30600 }), lockTx({ amount: 500 }));
    expect(await call(d.deps)).toEqual({ recorded: false, reason: "settle_above_maximum" });
    expect(d.stored).toHaveLength(0);
  });

  it("takes the maximum from the lock, not the vault, and reports a donation apart (audit S7-Codex-05, C20)", async () => {
    const d = deps(settleTx({ vault: 30600 + 5000 }));
    expect(await call(d.deps)).toMatchObject({ recorded: true, paid: { maxAmountBaseUnits: "30600", refundedBaseUnits: "29600", surplusBaseUnits: "5000" } });
  });

  it.each([
    ["no lock transaction", null],
    ["a failed lock", lockTx({ err: { InstructionError: [0, "Custom"] } })],
    ["a lock for another nonce", lockTx({ nonce: new Uint8Array(16).fill(7) })],
  ])("refuses when the receipt's lock cannot be read back: %s", async (_label, lock) => {
    const d = deps(settleTx(), lock);
    expect(await call(d.deps)).toEqual({ recorded: false, reason: "lock_not_verified" });
  });

  it("refuses a receipt that names no lock transaction", async () => {
    const d = deps(settleTx());
    expect(await call(d.deps, { receipt: { ...receipt, lockSignature: undefined } })).toEqual({ recorded: false, reason: "lock_signature_missing" });
  });

  it("records a settle to the provider's own recovery account (audit S7-Codex-05, C20)", async () => {
    const recovery = Keypair.generate().publicKey.toBase58();
    const d = deps(settleTx({ payout: recovery }));
    expect(await call(d.deps)).toMatchObject({ recorded: true, paid: { amountBaseUnits: "1000" } });
  });

  it("refuses a settle to an account the provider does not own", async () => {
    const other = Keypair.generate().publicKey.toBase58();
    const d = deps(settleTx({ payout: Keypair.generate().publicKey.toBase58(), payoutOwner: other }));
    expect(await call(d.deps)).toEqual({ recorded: false, reason: "settle_not_for_this_escrow" });
  });

  it("records a rated job: the settle carries the escrow's rating account after the usual nine (#842)", async () => {
    const usual = [escrow.toBase58(), vault.toBase58(), PROVIDER, PAYER.toBase58(), USDC, recipient, treasury, source, TOKEN_PROGRAM_ID.toBase58()];
    const d = deps(settleTx({ accounts: [...usual, ratingPda(escrow, PROGRAM).toBase58()] }));
    expect(await call(d.deps)).toMatchObject({ recorded: true, paid: { amountBaseUnits: "1000" } });
    // A tenth account that is not this escrow's rating account is not this job's settle.
    const other = deps(settleTx({ accounts: [...usual, Keypair.generate().publicKey.toBase58()] }));
    expect(await call(other.deps)).toEqual({ recorded: false, reason: "settle_not_for_this_escrow" });
  });

  it("records a failed metered call only for the payer's own signed-in session (audit S5-claude-02, C5)", async () => {
    const anonymous = deps(settleTx());
    expect(await call(anonymous.deps, { delivered: false })).toEqual({ recorded: false, reason: "payer_not_proven" });
    expect(anonymous.stored).toHaveLength(0);
    const someoneElse = deps(settleTx());
    expect(await call(someoneElse.deps, { delivered: false, session: { userId: "u", wallet: PROVIDER } })).toEqual({ recorded: false, reason: "payer_not_proven" });
    const payer = deps(settleTx());
    expect(await call(payer.deps, { delivered: false, session: { userId: "0b0e7c1e-7a57-4d0e-b3f0-1c2d3e4f5a6c", wallet: PAYER.toBase58() } })).toMatchObject({ recorded: true });
    expect(payer.stored[0]).toMatchObject({ status: "failed" });
  });

  it("refuses a receipt whose escrow is not the one its payer and nonce name", async () => {
    const d = deps(settleTx());
    expect(await call(d.deps, { receipt: { ...receipt, escrow: Keypair.generate().publicKey.toBase58() } })).toEqual({ recorded: false, reason: "escrow_mismatch" });
  });

  it("refuses a missing settle signature and a receipt for another provider", async () => {
    const d = deps(settleTx());
    expect(await call(d.deps, { settleSignature: undefined })).toEqual({ recorded: false, reason: "settle_signature_missing" });
    expect(await call(d.deps, { receipt: { ...receipt, payTo: Keypair.generate().publicKey.toBase58() } })).toEqual({ recorded: false, reason: "wrong_provider" });
  });
});
