/**
 * Instruction selectors of the escrow program.
 *
 * Each is the first 8 bytes of SHA256("global:<ix_name>"), computed here from
 * the name. A name in this list is not a statement that a given build answers
 * it: `release_escrow_per` and `delegate_escrow` are not in the V1 program
 * build (post-V1, issue #839), and the rating and attestation instructions of
 * the V1 program take the data and accounts described in
 * programs/pinocchio-escrow/README.md, built by `@reddi/x402-solana` (rating
 * module), not by this package.
 */
import crypto from "crypto";

function disc(ixName: string): Buffer {
  return crypto.createHash("sha256").update(`global:${ixName}`).digest().subarray(0, 8);
}

export const DISCRIMINATORS = {
  lock_escrow: disc("lock_escrow"),
  release_escrow: disc("release_escrow"),
  release_escrow_per: disc("release_escrow_per"),
  delegate_escrow: disc("delegate_escrow"),
  cancel_escrow: disc("cancel_escrow"),
  register_agent: disc("register_agent"),
  update_agent: disc("update_agent"),
  deregister_agent: disc("deregister_agent"),
  commit_rating: disc("commit_rating"),
  reveal_rating: disc("reveal_rating"),
  expire_rating: disc("expire_rating"),
  attest_quality: disc("attest_quality"),
  confirm_attestation: disc("confirm_attestation"),
  dispute_attestation: disc("dispute_attestation"),
} as const;
