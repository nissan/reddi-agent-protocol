/**
 * The commitment a party makes with `commit_rating` (programs/pinocchio-escrow/README.md,
 * "Ratings and attestations", step 4):
 *
 *   sha256(rating address ‖ opened_slot, u64 little-endian ‖ signer address ‖ score byte ‖ 32-byte salt)
 *
 * `opened_slot` is the rating account's own field: with the address it names the job, so a
 * commitment (and the salt behind it) made for one job cannot be opened for a later job that
 * reuses the same escrow and rating addresses. The hash is the client's `ratingCommitment`; this
 * name is kept so the app's call sites read as "the commitment for this job".
 */
import type { PublicKey } from "@solana/web3.js";
import { ratingCommitment } from "@redditech/x402-solana/rating";

export function jobRatingCommitment(rating: PublicKey, openedSlot: bigint, signer: PublicKey, score: number, salt: Uint8Array): Uint8Array {
  return ratingCommitment(rating, openedSlot, signer, score, salt);
}
