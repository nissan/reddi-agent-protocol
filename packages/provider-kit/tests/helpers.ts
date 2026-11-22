import { createHash } from "node:crypto";
import { Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { recordedInstruction, SOLANA_GENESIS_HASHES, tokenEscrowAddresses, treasuryTokenAccount, ESCROW_PROTOCOL_TREASURY, type SettlementRecord } from "@redditech/x402-solana";
import type { ProviderChain } from "../src/chain.js";
import { parseProviderConfig, type ProviderConfig, type ProviderConfigFile } from "../src/config.js";

export const PROGRAM = new PublicKey("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");
export const USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const provider = Keypair.generate();
export const buyerKeypair = Keypair.generate();
export const buyer = buyerKeypair.publicKey;
export const NONCE = "00112233445566778899aabbccddeeff";
export const CURRENT_SLOT = 1_000_000n;
export const SETTLE_SIGNATURE = "5".repeat(88);

export function configFile(overrides: Partial<ProviderConfigFile> = {}): ProviderConfigFile {
  return {
    name: "Test provider",
    description: "For tests.",
    network: "solana-devnet",
    wallet: provider.publicKey.toBase58(),
    publicUrl: "http://localhost:8787",
    model: "test/model-1",
    upstream: { mock: true },
    price: { currency: "USDC", inputPerMillion: "3", outputPerMillion: "15", maxOutputTokens: 500 },
    ...overrides,
  };
}

export function config(overrides: Partial<ProviderConfigFile> = {}, env: Record<string, string | undefined> = {}): ProviderConfig {
  const parsed = parseProviderConfig(configFile(overrides), env);
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.config;
}

const disc = createHash("sha256").update("account:TokenEscrowAccount").digest().subarray(0, 8);
export const ata = (owner: PublicKey, mint: PublicKey = USDC): PublicKey => treasuryTokenAccount({ mint, tokenProgram: TOKEN_PROGRAM }, owner);
export const escrowAddress = (payer: PublicKey = buyer): PublicKey => tokenEscrowAddresses({ programId: PROGRAM, payer, nonce: Buffer.from(NONCE, "hex") }).escrow;

export interface EscrowFields { amount?: bigint; payee?: PublicKey; metered?: boolean; status?: number; createdSlot?: bigint }
export function escrowBytes(f: EscrowFields = {}): Uint8Array {
  const owner = f.payee ?? provider.publicKey;
  const data = Buffer.alloc(219);
  disc.copy(data, 0);
  buyer.toBuffer().copy(data, 8);
  owner.toBuffer().copy(data, 40);
  USDC.toBuffer().copy(data, 72);
  ata(buyer).toBuffer().copy(data, 104);
  ata(owner).toBuffer().copy(data, 136);
  data.writeBigUInt64LE(f.amount ?? 20_000n, 168);
  Buffer.from(NONCE, "hex").copy(data, 176);
  data[192] = f.status ?? 0;
  data.writeBigUInt64LE(f.createdSlot ?? CURRENT_SLOT - 10n, 193);
  data[201] = 254;
  data[202] = f.metered === false ? 0 : 1;
  data.writeBigUInt64LE(1_500n, 203);
  data.writeBigUInt64LE(4_500n, 211);
  return data;
}

/** `state`: 0 uninitialised, 1 initialised, 2 frozen. */
export function tokenAccountBytes(mint: PublicKey, owner: PublicKey, state = 1): Uint8Array {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data[108] = state;
  return data;
}
export const tokenAccount = (owner: PublicKey, state = 1) => ({ owner: TOKEN_PROGRAM, data: tokenAccountBytes(USDC, owner, state), lamports: 2_039_280n, executable: false });

export interface FakeChain extends ProviderChain {
  accounts: Map<string, { owner: PublicKey; data: Uint8Array; lamports: bigint; executable: boolean }>;
  sent: TransactionInstruction[][];
  genesis: string;
  /** Fail this many sends, then succeed. `failSend` fails them all. */
  failSends: number;
  failSend: boolean;
  failReads: boolean;
  /** What reading the settle back returns. Unset: what the sent settle would move on chain. */
  settlement?: SettlementRecord | null | "unreadable";
  /** Tokens someone else sent to the vault, which the settle returns to the buyer. */
  donated: bigint;
  /** The next send lands on chain (the escrow closes) but reports failure. */
  landButReportFailure: boolean;
  /** Reads of the escrow account fail after a send was attempted. */
  failEscrowReadsAfterSend: boolean;
  attempts: number;
  landedMax?: bigint;
  /** Where a signature stands cannot be read (an RPC outage): `signatureState` answers `unknown`. */
  statusUnknown: boolean;
  /** Signatures that landed. */
  landed: Set<string>;
  /** Signed settles by signature. */
  signed: Map<string, TransactionInstruction[]>;
}

/** What the program does with a settle of `actual`: 2.5% rounded down to the treasury, the rest to the payee, the unused maximum back. */
function settledRecord(instructions: TransactionInstruction[], max: bigint, donated: bigint): SettlementRecord {
  const instruction = instructions[instructions.length - 1];
  const actual = instruction.data.readBigUInt64LE(8);
  const fee = (actual * 250n) / 10_000n;
  const row = (index: number, before: bigint, gain: bigint) => ({ account: instruction.keys[index].pubkey.toBase58(), mint: USDC.toBase58(), before, after: before + gain });
  return {
    failed: false,
    programIds: [instruction.programId.toBase58()],
    accounts: instruction.keys.map((k) => k.pubkey.toBase58()),
    tokenBalances: [row(5, 1_000n, actual - fee), row(6, 40n, fee), row(7, 0n, max - actual + donated)],
    instructions: instructions.map((ix) => recordedInstruction(ix)),
  };
}

/** A chain with the program deployed, a funded provider wallet with its USDC account, and a ready treasury. */
export function fakeChain(escrow: EscrowFields | null = {}): FakeChain {
  const accounts: FakeChain["accounts"] = new Map();
  const system = PublicKey.default;
  accounts.set(PROGRAM.toBase58(), { owner: system, data: new Uint8Array(36), lamports: 1n, executable: true });
  accounts.set(provider.publicKey.toBase58(), { owner: system, data: new Uint8Array(0), lamports: 50_000_000n, executable: false });
  accounts.set(ata(provider.publicKey).toBase58(), tokenAccount(provider.publicKey));
  accounts.set(ata(buyer).toBase58(), tokenAccount(buyer));
  accounts.set(ESCROW_PROTOCOL_TREASURY.toBase58(), { owner: system, data: new Uint8Array(0), lamports: 2_000_000n, executable: false });
  accounts.set(ata(ESCROW_PROTOCOL_TREASURY).toBase58(), tokenAccount(ESCROW_PROTOCOL_TREASURY));
  if (escrow) accounts.set(escrowAddress().toBase58(), { owner: PROGRAM, data: escrowBytes(escrow), lamports: 2_000_000n, executable: false });
  const chain: FakeChain = {
    accounts,
    sent: [],
    genesis: SOLANA_GENESIS_HASHES["solana-devnet"],
    failSends: 0,
    failSend: false,
    failReads: false,
    donated: 0n,
    landButReportFailure: false,
    failEscrowReadsAfterSend: false,
    attempts: 0,
    statusUnknown: false,
    landed: new Set(),
    signed: new Map(),
    readGenesisHash: async () => chain.genesis,
    readAccount: async (address) => {
      if (chain.failReads) throw new Error("rpc down");
      if (chain.failEscrowReadsAfterSend && chain.attempts > 0 && address.equals(escrowAddress())) throw new Error("rpc down");
      return accounts.get(address.toBase58()) ?? null;
    },
    readSlot: async () => CURRENT_SLOT,
    sendInstructions: async (instructions) => {
      if (chain.failSend) throw new Error("send failed");
      chain.sent.push(instructions);
      return `decline-${chain.sent.length}`;
    },
    signInstructions: async (instructions) => {
      // Later settles get other signatures of the same shape: 88 base58 characters.
      const signature = chain.signed.size === 0 ? SETTLE_SIGNATURE : "6789ABCDEFGH"[chain.signed.size - 1].repeat(88);
      chain.signed.set(signature, instructions);
      return { signature, transaction: Buffer.from(signature).toString("base64"), lastValidBlockHeight: 1_000 };
    },
    sendSigned: async (signed) => {
      const instructions = chain.signed.get(signed.signature);
      if (!instructions) throw new Error("unknown transaction");
      if (chain.landed.has(signed.signature)) return signed.signature;
      chain.attempts += 1;
      if (chain.landButReportFailure) {
        chain.landButReportFailure = false;
        chain.sent.push(instructions);
        chain.landed.add(signed.signature);
        chain.landedMax = Buffer.from(accounts.get(escrowAddress().toBase58())!.data).readBigUInt64LE(168);
        accounts.delete(escrowAddress().toBase58()); // a settle closes the escrow
        throw new Error("confirmation timed out");
      }
      if (chain.failSend) throw new Error("send failed");
      if (chain.failSends > 0) {
        chain.failSends -= 1;
        throw new Error("send failed");
      }
      chain.sent.push(instructions);
      chain.landed.add(signed.signature);
      return signed.signature;
    },
    signatureState: async (signature) => {
      if (chain.landed.has(signature)) return "landed";
      return chain.statusUnknown ? "unknown" : "expired";
    },
    readSettlement: async (signature) => {
      if (chain.settlement === "unreadable") throw new Error("rpc down");
      if (chain.settlement !== undefined) return chain.settlement;
      const instructions = chain.landed.has(signature) ? chain.signed.get(signature) : undefined;
      const escrowAccount = accounts.get(escrowAddress().toBase58());
      const max = chain.landedMax ?? (escrowAccount ? Buffer.from(escrowAccount.data).readBigUInt64LE(168) : 0n);
      return instructions ? settledRecord(instructions, max, chain.donated) : null;
    },
  };
  return chain;
}

export const paymentHeader = () => JSON.stringify({ settlement: "metered-escrow", escrow: escrowAddress().toBase58(), payer: buyer.toBase58(), nonce: NONCE });

const BUYER_PKCS8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(buyerKeypair.secretKey.subarray(0, 32))]);
/** The headers a buyer adds to a single paid call: the payer's own signature over this request (#866). */
export async function singleCallHeaders(body: string, nowMs: number, signer: Keypair = buyerKeypair): Promise<Record<string, string>> {
  const { createPrivateKey, sign } = await import("node:crypto");
  const { paidCallAuthHeaders } = await import("@redditech/x402-solana");
  const key = createPrivateKey({ key: signer === buyerKeypair ? BUYER_PKCS8 : Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(signer.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
  return paidCallAuthHeaders({ genesisHash: SOLANA_GENESIS_HASHES["solana-devnet"], escrow: escrowAddress().toBase58(), provider: provider.publicKey.toBase58(), body, payer: signer.publicKey.toBase58(), signWithPayer: (m) => new Uint8Array(sign(null, Buffer.from(m), key)), nowMs });
}
