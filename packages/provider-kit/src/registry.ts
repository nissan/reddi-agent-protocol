/**
 * The on-chain registry record of a provider: one per owner wallet, at
 * [b"agent", owner] under the V1 program. Registering burns the registration
 * fee and pays the record's rent. Mirrors `register_agent` in
 * programs/pinocchio-escrow/program/src/instructions/registry.rs.
 */
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

/** sha256("global:register_agent")[0..8]. A test recomputes it. */
export const REGISTER_AGENT_DISCRIMINATOR = Uint8Array.of(135, 157, 66, 195, 2, 113, 175, 30);
/** Burned on registration: 0.01 SOL. */
export const AGENT_REGISTRATION_FEE_LAMPORTS = 10_000_000n;
export const AGENT_FEE_BURN_ADDRESS = new PublicKey("1nc1nerator11111111111111111111111111111111");
export const AGENT_MODEL_MAX_BYTES = 64;

export function agentAddress(programId: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("agent"), owner.toBuffer()], programId)[0];
}

/**
 * `register_agent` for a primary (serving) provider. The registry's own price
 * field is in lamports per call and is left at zero: a kit provider is priced
 * per token in its listing.
 */
export function buildRegisterAgentInstruction(programId: PublicKey, owner: PublicKey, model: string): TransactionInstruction {
  const modelBytes = Buffer.from(model, "utf8");
  if (modelBytes.length === 0 || modelBytes.length > AGENT_MODEL_MAX_BYTES) throw new Error(`the registry holds a model name of at most ${AGENT_MODEL_MAX_BYTES} bytes`);
  const data = Buffer.alloc(8 + 1 + 4 + modelBytes.length + 8 + 1);
  Buffer.from(REGISTER_AGENT_DISCRIMINATOR).copy(data, 0);
  data.writeUInt8(0, 8); // primary
  data.writeUInt32LE(modelBytes.length, 9);
  modelBytes.copy(data, 13);
  // rate_lamports (u64) and min_reputation (u8) stay zero.
  return new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: agentAddress(programId, owner), isWritable: true, isSigner: false },
      { pubkey: owner, isWritable: true, isSigner: true },
      { pubkey: AGENT_FEE_BURN_ADDRESS, isWritable: true, isSigner: false },
      { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
    ],
  });
}

/** The owner and model of a registry record, or undefined when the data is not one. */
export function readAgentRecord(data: Uint8Array): { owner: PublicKey; model: string } | undefined {
  const buffer = Buffer.from(data);
  if (buffer.length < 8 + 32 + 1 + 4) return undefined;
  const length = buffer.readUInt32LE(41);
  if (length > AGENT_MODEL_MAX_BYTES || 45 + length > buffer.length) return undefined;
  return { owner: new PublicKey(buffer.subarray(8, 40)), model: buffer.subarray(45, 45 + length).toString("utf8") };
}
