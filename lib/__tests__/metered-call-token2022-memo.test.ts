// The job recorder against a Token-2022 (PYUSD, mainnet profile) metered settle shaped as the
// x402-solana SDK builds it: the usual nine accounts, the rating account on a rated job, then the
// SPL Memo program so a refund to an account that requires memos can land.
jest.mock("server-only", () => ({}));
import { createHash } from "crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { tokenEscrowAddresses, treasuryTokenAccount } from "@redditech/x402-solana/token-escrow";
import { ratingPda } from "@redditech/x402-solana/rating";
import { verifyAndRecordMeteredCall } from "@/lib/jobs/metered-call";
import type { Listing } from "@/lib/listings/listing-store";

const PROGRAM = Keypair.generate().publicKey;
const PAYER = Keypair.generate().publicKey;
const PROVIDER = Keypair.generate().publicKey.toBase58();
const PYUSD = "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo";
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const NONCE = new Uint8Array(16).fill(9);
const NONCE_HEX = Buffer.from(NONCE).toString("hex");
const LOCK_SIG = "3".repeat(88);
const SETTLE_SIG = "5".repeat(88);
const LOCK_SLOT = 4242;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = BigInt("0x" + (Buffer.from(bytes).toString("hex") || "0"));
  let out = "";
  while (n > BigInt(0)) { out = B58[Number(n % BigInt(58))] + out; n /= BigInt(58); }
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}
const disc = (name: string) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const u64 = (v: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };

const { escrow, vault } = tokenEscrowAddresses({ programId: PROGRAM, payer: PAYER, nonce: NONCE });
const mint = new PublicKey(PYUSD);
const T22 = TOKEN_2022_PROGRAM_ID.toBase58();
const recipient = getAssociatedTokenAddressSync(mint, new PublicKey(PROVIDER), true, TOKEN_2022_PROGRAM_ID).toBase58();
const treasury = treasuryTokenAccount({ mint, tokenProgram: TOKEN_2022_PROGRAM_ID }).toBase58();
const source = getAssociatedTokenAddressSync(mint, PAYER, true, TOKEN_2022_PROGRAM_ID).toBase58();
const listing: Listing = {
  wallet: PROVIDER, displayName: "Atlas", endpointUrl: "https://provider.example/v1", declaredModels: [], capabilities: {},
  pricePerCallBaseUnits: "0", priceInputPerMillionBaseUnits: "3000000", priceOutputPerMillionBaseUnits: "15000000", priceMint: PYUSD,
  adl: null, adlSource: null, network: "solana-mainnet", status: "listed", healthStatus: "pass", lastSeenAt: null, updatedAt: null,
};
const receipt = { settlement: "metered-escrow", network: "solana-mainnet-beta", currency: "PYUSD", payTo: PROVIDER, payer: PAYER.toBase58(), nonce: NONCE_HEX, escrow: escrow.toBase58(), lockSignature: LOCK_SIG };

function settleTx(trailing: string[]) {
  const keys = [PAYER.toBase58(), PROVIDER, escrow.toBase58(), vault.toBase58(), recipient, treasury, source, PYUSD, PROGRAM.toBase58(), T22, MEMO, ratingPda(escrow, PROGRAM).toBase58()];
  const i = (k: string) => keys.indexOf(k);
  const bal = (k: string, amount: number, owner?: string) => ({ accountIndex: i(k), mint: PYUSD, ...(owner ? { owner } : {}), uiTokenAmount: { amount: String(amount) } });
  return {
    blockTime: 1_790_000_000,
    meta: { err: null,
      preTokenBalances: [bal(vault.toBase58(), 30600), bal(recipient, 100, PROVIDER), bal(treasury, 0), bal(source, 7, PAYER.toBase58())],
      postTokenBalances: [bal(recipient, 1075, PROVIDER), bal(treasury, 25), bal(source, 7 + 29600, PAYER.toBase58())] },
    transaction: { message: { accountKeys: keys.map((pubkey) => ({ pubkey })), instructions: [{
      programId: PROGRAM.toBase58(),
      accounts: [escrow.toBase58(), vault.toBase58(), PROVIDER, PAYER.toBase58(), PYUSD, recipient, treasury, source, T22, ...trailing],
      data: base58(Buffer.concat([disc("settle_token_escrow"), u64(1000), u64(LOCK_SLOT)])),
    }] } },
  };
}
function lockTx() {
  const data = Buffer.concat([disc("lock_metered_token_escrow"), u64(30600), Buffer.from(NONCE), Buffer.alloc(16)]);
  return { slot: LOCK_SLOT, meta: { err: null }, transaction: { message: { instructions: [{ programId: PROGRAM.toBase58(), accounts: [escrow.toBase58(), vault.toBase58(), PAYER.toBase58(), PROVIDER, PYUSD, source, recipient, T22, "11111111111111111111111111111111"], data: base58(data) }] } } };
}
function deps(tx: unknown) {
  const stored: unknown[] = [];
  return { stored, deps: {
    programId: PROGRAM,
    connection: { getParsedTransaction: jest.fn(async (s: string) => (s === LOCK_SIG ? lockTx() : tx)) },
    url: "https://project.supabase.example", serviceKey: "service",
    fetchImpl: jest.fn(async (_u: string, init: { body?: string }) => { stored.push(JSON.parse(init.body ?? "{}")); return { ok: true, status: 201, json: async () => [{ id: "0b0e7c1e-7a57-4d0e-b3f0-1c2d3e4f5a6b" }] }; }),
  } };
}
const call = (d: ReturnType<typeof deps>["deps"]) => verifyAndRecordMeteredCall({ receipt, settleSignature: SETTLE_SIG, listing, profile: "mainnet", requestHash: "a".repeat(64), responseHash: "a".repeat(64), declaredModel: "atlas", delivered: true }, d as never);

describe("metered job record: Token-2022 settles carrying the SPL Memo program", () => {
  it("records a PYUSD settle without the memo program", async () => {
    expect(await call(deps(settleTx([])).deps)).toMatchObject({ recorded: true });
  });
  it("records the SDK's PYUSD settle carrying the memo program", async () => {
    const d = deps(settleTx([MEMO]));
    expect(await call(d.deps)).toMatchObject({ recorded: true });
    expect(d.stored).toHaveLength(1);
  });
  it("records a rated PYUSD settle with the rating account then the memo program", async () => {
    expect(await call(deps(settleTx([ratingPda(escrow, PROGRAM).toBase58(), MEMO])).deps)).toMatchObject({ recorded: true });
  });
  it("still refuses any other trailing account", async () => {
    const other = Keypair.generate().publicKey.toBase58();
    for (const trailing of [[other], [MEMO, other], [MEMO, ratingPda(escrow, PROGRAM).toBase58()], [MEMO, MEMO], [ratingPda(escrow, PROGRAM).toBase58(), other, MEMO]]) {
      const d = deps(settleTx(trailing));
      expect(await call(d.deps)).toEqual({ recorded: false, reason: "settle_not_for_this_escrow" });
      expect(d.stored).toHaveLength(0);
    }
  });
});
