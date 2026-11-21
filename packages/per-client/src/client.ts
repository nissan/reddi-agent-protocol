/**
 * MagicBlock PER delegation client for Reddi Agent Protocol.
 *
 * ## What this does, and what it does not
 * - `delegateEscrow` sends one transaction to MagicBlock's own Permission and
 *   Delegation programs. It does not call the escrow program.
 * - `releaseEscrowViaPer` builds the escrow program's `release_escrow_per`
 *   instruction and sends it to the TEE RPC endpoint.
 * - `releaseEscrowFallback` sends the escrow program's ordinary `release_escrow`
 *   on the public RPC.
 *
 * The PER tracking instructions of the escrow program (`delegate_escrow`,
 * `release_escrow_per`) are not in the V1 program build: they sit behind the
 * program's `per` feature, which is off by default and never used for a
 * mainnet build. Against the V1 build a `release_escrow_per` transaction
 * fails, and only `releaseEscrowFallback` settles. Integrating with
 * MagicBlock's service is post-V1 work (issue #839).
 *
 * ## Why TypeScript, not Rust?
 * PER stays at the TypeScript/client layer. Do not move MagicBlock SDK
 * ownership into the Rust program without a separate SDK compatibility
 * qualification.
 *
 * ## Discriminators
 * Escrow program selectors come from `idl.ts`: the first 8 bytes of
 * SHA256("global:<ix_name>"). The two MagicBlock program discriminators below
 * are those programs' own bytes.
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
  PROTOCOL_TREASURY,
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
 * One transaction with two instructions, both to MagicBlock's programs: the
 * Permission Program, then the Delegation Program, each naming a session key
 * generated here. The escrow program is not called, so nothing on the escrow
 * account records the session key: the escrow program's `delegate_escrow` is
 * not in the V1 build (post-V1, issue #839).
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
 * Not usable against the V1 program build, which does not answer
 * `release_escrow_per`: the transaction fails there. It needs a program built
 * with the `per` feature, which is unfinished post-V1 work (issue #839) and
 * never a mainnet build. Use `releaseEscrowFallback` with the V1 build.
 *
 * Routes the `release_escrow_per` transaction to the TEE RPC endpoint.
 * The TEE executes it privately (hidden from public mempool), then
 * undelegates and finalises back on the selected base Solana cluster. This is not a mainnet-readiness claim.
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
 * The escrow program's `release_escrow`, signed by the payer: no data after
 * the selector, and five accounts in this order: escrow (writable), payer
 * (signer, writable), payee (writable), protocol treasury (writable), System
 * program. The program pays the protocol fee to the treasury, so a release
 * without it is refused.
 *
 * This is the release of an escrow that is not opted in to rating. A rated
 * escrow also needs its rating account after these five and the rating's
 * opened slot after the selector; see `withRatingAccount` in
 * `@redditech/x402-solana`.
 */
export function buildReleaseEscrowInstruction(
  escrowProgramId: PublicKey,
  escrowPda: PublicKey,
  payeePubkey: PublicKey,
  payerPubkey: PublicKey,
  treasury: PublicKey = new PublicKey(PROTOCOL_TREASURY)
): TransactionInstruction {
  return new TransactionInstruction({
    programId: escrowProgramId,
    keys: [
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: payerPubkey, isSigner: true, isWritable: true },
      { pubkey: payeePubkey, isSigner: false, isWritable: true },
      { pubkey: treasury, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: DISCRIMINATORS.release_escrow,
  });
}

/**
 * Release an escrow via standard L1 (fallback path).
 *
 * The ordinary `release_escrow` of the escrow program, sent on the public
 * RPC. With the V1 program build this is the only release path in this
 * package. Use it when:
 *  - the program is the V1 build (no PER instructions)
 *  - PER endpoint is unreachable
 *  - Session TTL has expired
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
  const ix = buildReleaseEscrowInstruction(escrowProgramId, escrowPda, payeePubkey, payerKeypair.publicKey);

  const tx = new Transaction().add(ix);
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payerKeypair.publicKey;
  tx.sign(payerKeypair);

  return connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });
}
