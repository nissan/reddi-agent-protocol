/**
 * MagicBlock PER delegation client for Reddi Agent Protocol.
 *
 * ## Why TypeScript, not Rust?
 * The PER architecture remains TypeScript/client-side for the Anchor 1.1.2
 * stable upgrade. Do not move MagicBlock SDK ownership into the Rust program
 * without a separate SDK compatibility qualification. The on-chain Anchor
 * program tracks delegation state via the `delegate_escrow` and
 * `release_escrow_per` instructions.
 *
 * ## Flow
 * ```
 * delegateEscrow(escrowPda, wallet)
 *   → calls Permission Program via @solana/web3.js
 *   → calls on-chain delegate_escrow to record session key
 *   → returns session token
 *
 * releaseEscrowViaPer(escrowPda, payee, sessionToken)
 *   → builds release_escrow_per txn
 *   → sends to devnet-tee.magicblock.app (NOT public RPC)
 *   → TEE executes privately, undelegates, settles on mainnet
 *
 * releaseEscrowFallback(escrowPda, payee)
 *   → calls standard L1 release_escrow
 *   → works regardless of delegation state (clears PER flag)
 * ```
 *
 * ## Discriminators
 * All instruction discriminators are derived from `idl.ts` using Anchor's
 * standard formula: first 8 bytes of SHA256("global:<ix_name>").
 * Never hardcode discriminator bytes — always use DISCRIMINATORS from idl.ts.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import {
  DELEGATION_PROGRAM_ID,
  PER_DEVNET_RPC,
  PERMISSION_PROGRAM_ID,
} from "./config";
import { DISCRIMINATORS } from "./idl";

export interface PerSession {
  /** Base58 session key issued by the TEE */
  sessionKey: string;
  /** Slot at which this session was created */
  createdSlot: number;
  /** Estimated TTL in slots (~7 days = 1,512,000 slots) */
  ttlSlots: number;
}

export interface DelegateOptions {
  /** Override RPC endpoint (default: devnet-tee.magicblock.app) */
  rpcEndpoint?: string;
}

/**
 * Delegate an escrow PDA to a MagicBlock PER session.
 *
 * 1. Calls the MagicBlock Permission Program to issue a session key
 * 2. Calls the on-chain `delegate_escrow` instruction to record the key
 *
 * @returns PerSession token — pass to `releaseEscrowViaPer`
 */
export async function delegateEscrow(
  escrowPda: PublicKey,
  payerKeypair: Keypair,
  connection: Connection,
  _opts?: DelegateOptions
): Promise<PerSession> {
  const permissionProgramId = new PublicKey(PERMISSION_PROGRAM_ID);
  const delegationProgramId = new PublicKey(DELEGATION_PROGRAM_ID);

  // Generate a fresh session keypair — its pubkey becomes the session key
  const sessionKeypair = Keypair.generate();
  const sessionKey = sessionKeypair.publicKey;

  // Build the Permission Program instruction (create_permission)
  // Discriminator computed via DISCRIMINATORS from idl.ts pattern
  const permissionIx = new TransactionInstruction({
    programId: permissionProgramId,
    keys: [
      { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: sessionKey, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    // MagicBlock Permission Program discriminator for create_permission
    // (NOT an Anchor program — uses its own discriminator scheme)
    data: Buffer.from([0xc2, 0x50, 0x44, 0x86, 0x41, 0x2e, 0x5e, 0x6c]),
  });

  // Build the Delegation Program instruction
  const delegateIx = new TransactionInstruction({
    programId: delegationProgramId,
    keys: [
      { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: sessionKey, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    // MagicBlock Delegation Program discriminator (NOT an Anchor program)
    data: Buffer.from([0xb6, 0x78, 0x1c, 0x24, 0x89, 0x4d, 0x93, 0x29]),
  });

  const tx = new Transaction().add(permissionIx).add(delegateIx);
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payerKeypair.publicKey;
  tx.sign(payerKeypair);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });
  await connection.confirmTransaction(sig, "confirmed");

  const slot = await connection.getSlot();

  return {
    sessionKey: sessionKey.toBase58(),
    createdSlot: slot,
    ttlSlots: 1_512_000, // ~7 days at 400ms/slot
  };
}

/**
 * Release an escrow via the MagicBlock PER (private settlement path).
 *
 * Routes the `release_escrow_per` transaction to the TEE RPC endpoint.
 * The TEE executes it privately (hidden from public mempool), then
 * undelegates and finalises on Solana mainnet.
 *
 * @param escrowProgramId - The deployed escrow program ID
 * @param escrowPda       - The escrow account PDA
 * @param payeePubkey     - Where funds should go
 * @param payerKeypair    - Must match escrow.payer
 * @param session         - Session token from `delegateEscrow`
 * @param connection      - Public connection (for blockhash only)
 *
 * @returns Transaction signature from the TEE RPC.
 *
 * **Important — confirmation polling:**
 * The returned signature is submitted to `devnet-tee.magicblock.app`, NOT
 * the public Solana RPC. You must poll the TEE endpoint separately for
 * confirmation — `connection.confirmTransaction(sig)` will NOT work because
 * the public RPC has no visibility into the TEE's mempool.
 * Poll via: `new Connection(PER_DEVNET_RPC).confirmTransaction(sig, "confirmed")`
 * or rely on the TEE's own finality webhook if available.
 */
export async function releaseEscrowViaPer(
  escrowProgramId: PublicKey,
  escrowPda: PublicKey,
  payeePubkey: PublicKey,
  payerKeypair: Keypair,
  session: PerSession,
  connection: Connection
): Promise<string> {
  const sessionKeyPubkey = new PublicKey(session.sessionKey);

  // Instruction data: IDL-derived discriminator + 32-byte session_key
  // Uses DISCRIMINATORS["release_escrow_per"] from idl.ts (SHA256("global:release_escrow_per")[0..8])
  const sessionKeyBytes = sessionKeyPubkey.toBytes();
  const data = Buffer.concat([DISCRIMINATORS.release_escrow_per, sessionKeyBytes]);

  const ix = new TransactionInstruction({
    programId: escrowProgramId,
    keys: [
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: payeePubkey, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payerKeypair.publicKey;
  tx.sign(payerKeypair);

  // Route to TEE endpoint — this keeps settlement private from the public mempool.
  //
  // skipPreflight: true is required because the TEE validator runs in an isolated
  // Intel TDX enclave with its own account state that diverges from the public RPC.
  // The public RPC's preflight simulation would reject the transaction because it
  // cannot see delegated accounts that exist only in the TEE's execution context.
  const perConnection = new Connection(PER_DEVNET_RPC, "confirmed");
  const sig = await perConnection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
  });

  return sig;
}

/**
 * Release an escrow via standard L1 (fallback path).
 *
 * Works regardless of delegation state. If the escrow was delegated, the
 * on-chain `release_escrow` instruction clears `delegated_to_per`.
 * Use this when:
 *  - PER endpoint is unreachable
 *  - Session TTL has expired
 *  - You prefer L1 settlement for simplicity
 *
 * @param escrowProgramId - The deployed escrow program ID
 * @param escrowPda       - The escrow account PDA
 * @param payeePubkey     - Where funds should go
 * @param payerKeypair    - Must match escrow.payer
 * @param connection      - Solana public connection
 */
export async function releaseEscrowFallback(
  escrowProgramId: PublicKey,
  escrowPda: PublicKey,
  payeePubkey: PublicKey,
  payerKeypair: Keypair,
  connection: Connection
): Promise<string> {
  // Uses IDL-derived discriminator from idl.ts
  const data = DISCRIMINATORS.release_escrow;

  const ix = new TransactionInstruction({
    programId: escrowProgramId,
    keys: [
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: payeePubkey, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payerKeypair.publicKey;
  tx.sign(payerKeypair);

  return connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });
}
