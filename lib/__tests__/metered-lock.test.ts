import { createHash } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { buildMeteredLock } from "@/lib/payments/metered-lock";
import { quoteMeteredBuy } from "@/lib/payments/metered-quote";

const PROGRAM = Keypair.generate().publicKey;
const PAYER = Keypair.generate().publicKey;
const PAYEE = Keypair.generate().publicKey;
const MINT = Keypair.generate().publicKey;
const NONCE = new Uint8Array(16).fill(7);
const disc = (name: string) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

function quote(currency = "USDC") {
  const q = quoteMeteredBuy({ prices: { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 }, currency, prompt: "x".repeat(400) });
  if (!q.ok) throw new Error(q.message);
  return q;
}

describe("metered lock (#794)", () => {
  it("locks the approved maximum with the metered instruction, from the buyer's account to the provider's", () => {
    const lock = buildMeteredLock({ quote: quote(), programId: PROGRAM, payer: PAYER, payee: PAYEE, mint: MINT, nonce: NONCE });
    expect(lock.ok).toBe(true);
    if (!lock.ok) return;
    const ix = lock.instruction;
    expect(ix.programId.equals(PROGRAM)).toBe(true);
    expect(ix.data.subarray(0, 8).equals(disc("lock_metered_token_escrow"))).toBe(true);
    expect(ix.data.readBigUInt64LE(8)).toBe(BigInt(1230));
    expect(lock.amountBaseUnits).toBe(BigInt(1230));
    expect(ix.keys[2]).toMatchObject({ isSigner: true });
    expect(ix.keys[2].pubkey.equals(PAYER)).toBe(true);
    expect(ix.keys[5].pubkey.equals(getAssociatedTokenAddressSync(MINT, PAYER, true, TOKEN_PROGRAM_ID))).toBe(true);
    expect(ix.keys[6].pubkey.equals(getAssociatedTokenAddressSync(MINT, PAYEE, true, TOKEN_PROGRAM_ID))).toBe(true);
    expect(ix.keys[0].pubkey.equals(lock.escrow)).toBe(true);
  });

  it("uses Token-2022 accounts for PYUSD", () => {
    const lock = buildMeteredLock({ quote: quote("PYUSD"), programId: PROGRAM, payer: PAYER, payee: PAYEE, mint: MINT, nonce: NONCE });
    expect(lock.ok).toBe(true);
    if (lock.ok) expect(lock.instruction.keys[7].pubkey.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
  });

  it("refuses a short nonce and a currency with no token program", () => {
    expect(buildMeteredLock({ quote: quote(), programId: PROGRAM, payer: PAYER, payee: PAYEE, mint: MINT, nonce: new Uint8Array(8) })).toMatchObject({ ok: false, reason: "invalid_nonce" });
    expect(buildMeteredLock({ quote: { ...quote(), currency: "SOL" }, programId: PROGRAM, payer: PAYER, payee: PAYEE, mint: MINT, nonce: NONCE })).toMatchObject({ ok: false, reason: "unsupported_currency" });
  });
});
