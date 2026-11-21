/**
 * The commitment a party makes with `commit_rating` (programs/pinocchio-escrow/README.md,
 * "Ratings and attestations", step 4):
 *
 *   sha256(rating address ‖ opened_slot, u64 little-endian ‖ signer address ‖ score byte ‖ 32-byte salt)
 *
 * `opened_slot` is the rating account's own field: with the address it names the job, so a
 * commitment (and the salt behind it) made for one job cannot be opened for a later job that
 * reuses the same escrow and rating addresses.
 */
import type { PublicKey } from "@solana/web3.js";
import { sha256 } from "@reddi/x402-solana/rating";

export function jobRatingCommitment(rating: PublicKey, openedSlot: bigint, signer: PublicKey, score: number, salt: Uint8Array): Uint8Array {
  if (!Number.isInteger(score) || score < 1 || score > 10) throw new Error("score must be a whole number from 1 to 10");
  if (salt.length !== 32) throw new Error("salt must be 32 bytes");
  if (openedSlot < 0n || openedSlot > 0xffff_ffff_ffff_ffffn) throw new Error("opened slot out of range");
  const slot = Buffer.alloc(8);
  slot.writeBigUInt64LE(openedSlot);
  return sha256(Buffer.concat([rating.toBuffer(), slot, signer.toBuffer(), Buffer.from([score]), Buffer.from(salt)]));
}
