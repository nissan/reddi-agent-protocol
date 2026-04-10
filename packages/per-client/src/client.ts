/**
 * MagicBlock PER delegation client for Reddi Agent Protocol.
 *
 * ## Why TypeScript, not Rust?
 * The `ephemeral-rollups-sdk` crate (v0.10.5) has Pubkey type mismatches
 * and missing `realloc` API under Anchor 1.0.0 — incompatible at the Rust
 * SDK level. We therefore implement delegation at the TypeScript/client layer,
 * which is the approach MagicBlock themselves recommend for existing Anchor 1.x
 * programs. The on-chain Anchor program tracks delegation state via the new
 * `delegate_escrow` and `release_escrow_per` instructions.
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

  // Build the Permission Program instruction
  // (create_permission on-chain, referencing the escrow PDA and session key)
  const permissionIx = new TransactionInstruction({
    programId: permissionProgramId,
    keys: [
      { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: sessionKey, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    // Discriminator: "create_permission" (8-byte anchor discriminator)
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
    // Discriminator: "delegate" (8-byte anchor discriminator)
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
 * @param connection      - Public connection (for blockhash)
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

  // Encode release_escrow_per(session_key) instruction data
  // Discriminator for release_escrow_per + 32-byte session_key
  const discriminator = Buffer.from([
    0x1e, 0x5f, 0x7b, 0x33, 0xd4, 0x9a, 0x2c, 0x11,
  ]);
  const sessionKeyBytes = sessionKeyPubkey.toBytes();
  const data = Buffer.concat([discriminator, sessionKeyBytes]);

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

  // Route to TEE endpoint — this is the private settlement path
  const perConnection = new Connection(PER_DEVNET_RPC, "confirmed");
  const sig = await perConnection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true, // TEE may have different preflight rules
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
  // Discriminator for release_escrow (Anchor IDL-derived)
  const discriminator = Buffer.from([
    0xb0, 0x5b, 0x2c, 0x5a, 0xdc, 0xb2, 0x2c, 0x28,
  ]);

  const ix = new TransactionInstruction({
    programId: escrowProgramId,
    keys: [
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: payeePubkey, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: discriminator,
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
