import { createHash } from "node:crypto";
import { Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { SOLANA_GENESIS_HASHES, tokenEscrowAddresses, treasuryTokenAccount, ESCROW_PROTOCOL_TREASURY } from "@reddi/x402-solana";
import type { ProviderChain } from "../src/chain.js";
import { parseProviderConfig, type ProviderConfig, type ProviderConfigFile } from "../src/config.js";

export const PROGRAM = new PublicKey("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");
export const USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const provider = Keypair.generate();
export const buyer = Keypair.generate().publicKey;
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

function tokenAccountBytes(mint: PublicKey, owner: PublicKey): Uint8Array {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  return data;
}

export interface FakeChain extends ProviderChain {
  accounts: Map<string, { owner: PublicKey; data: Uint8Array; lamports: bigint; executable: boolean }>;
  sent: TransactionInstruction[][];
  genesis: string;
  failSend: boolean;
  failReads: boolean;
}

/** A chain with the program deployed, a funded provider wallet with its USDC account, and a ready treasury. */
export function fakeChain(escrow: EscrowFields | null = {}): FakeChain {
  const accounts: FakeChain["accounts"] = new Map();
  const system = PublicKey.default;
  accounts.set(PROGRAM.toBase58(), { owner: system, data: new Uint8Array(36), lamports: 1n, executable: true });
  accounts.set(provider.publicKey.toBase58(), { owner: system, data: new Uint8Array(0), lamports: 50_000_000n, executable: false });
  accounts.set(ata(provider.publicKey).toBase58(), { owner: TOKEN_PROGRAM, data: tokenAccountBytes(USDC, provider.publicKey), lamports: 2_039_280n, executable: false });
  accounts.set(ESCROW_PROTOCOL_TREASURY.toBase58(), { owner: system, data: new Uint8Array(0), lamports: 2_000_000n, executable: false });
  accounts.set(ata(ESCROW_PROTOCOL_TREASURY).toBase58(), { owner: TOKEN_PROGRAM, data: tokenAccountBytes(USDC, ESCROW_PROTOCOL_TREASURY), lamports: 2_039_280n, executable: false });
  if (escrow) accounts.set(escrowAddress().toBase58(), { owner: PROGRAM, data: escrowBytes(escrow), lamports: 2_000_000n, executable: false });
  const chain: FakeChain = {
    accounts,
    sent: [],
    genesis: SOLANA_GENESIS_HASHES["solana-devnet"],
    failSend: false,
    failReads: false,
    readGenesisHash: async () => chain.genesis,
    readAccount: async (address) => {
      if (chain.failReads) throw new Error("rpc down");
      return accounts.get(address.toBase58()) ?? null;
    },
    readSlot: async () => CURRENT_SLOT,
    sendInstructions: async (instructions) => {
      if (chain.failSend) throw new Error("send failed");
      chain.sent.push(instructions);
      return SETTLE_SIGNATURE;
    },
  };
  return chain;
}

export const paymentHeader = () => JSON.stringify({ settlement: "metered-escrow", escrow: escrowAddress().toBase58(), payer: buyer.toBase58(), nonce: NONCE });
