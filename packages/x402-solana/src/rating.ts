/**
 * Ratings and judge attestations of a job paid through escrow (#841).
 *
 * Client side of the ten rating and attestation instructions of
 * `programs/pinocchio-escrow` and of the exits of a rated escrow. The program
 * README and `programs/pinocchio-escrow/interface/vectors.json` are the
 * interface; `tests/rating.test.ts` holds every builder and decoder here to
 * that file byte for byte.
 *
 * Nothing here signs or sends. Browser-safe: no `node:crypto`.
 *
 * A rating belongs to one escrow. The buyer opts in with `open_rating` in the
 * slot of the lock (normally the same transaction), which sets bit 0x02 of the
 * escrow's flag byte. From then on every exit of that escrow (release, claim,
 * settle, refund, decline) takes the rating account, writable, right after
 * the instruction's usual accounts.
 *
 * Consent: the seller agrees to be rated by `accept_rating`, or by being the
 * authority of a claim or settle. Nothing else counts: a release by the payer
 * opens the rating only when the rating account says `accepted`, whoever else
 * signs the transaction. A seller that has agreed then has to commit and
 * reveal within the windows. A rated exit that pays the seller nothing
 * closes the rating unrated.
 *
 * Jobs can share an address: once an escrow has ended, the same payer can lock
 * another job for the same payee under the same nonce, and the escrow and
 * rating addresses are the same. The rating's `opened_slot` (the slot of
 * `open_rating`) tells the jobs apart, so every exit of a rated escrow,
 * `accept_rating`, `commit_rating` and the commitment itself,
 * `attest_quality` and the consumer's `confirm_attestation` or
 * `dispute_attestation` all name it: every builder for them takes it as a
 * required `openedSlot`, read from the rating account (`decodeRatingAccount`)
 * or, for a decision on an attestation, from the attestation
 * (`decodeAttestationAccount`). Read it when the job is agreed or verified and
 * keep it with the job: re-reading it just before an exit would name
 * whichever job holds the address by then. The
 * program refuses another slot (`RatingJobMismatch`, 6051), and refuses any
 * exit of a rated escrow in the slot its rating was opened in
 * (`RatingJustOpened`, 6050): lock and `open_rating` go in one transaction,
 * and every exit in a later one.
 *
 * Seller claim transactions must not carry the payer's signature. If the
 * payer signs a transaction in which the payee claims, even only as its fee
 * payer, the program treats the payer as the authority: that is a release by
 * the payer, not the seller's claim, and without `accept_rating` the job
 * closes unrated. The seller pays its own fees.
 */
import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta, type Commitment } from '@solana/web3.js';
import {
  buildLockTokenEscrowInstruction,
  buildSettleTokenEscrowInstruction,
  decodeTokenEscrowAccount,
  escrowWindows,
  ESCROW_PROTOCOL_TREASURY,
  tokenEscrowAddresses,
  TOKEN_ESCROW_DISCRIMINATORS,
  type SettleTokenEscrowOptions,
  type TokenEscrowTerms,
} from './token-escrow';

/**
 * Anchor-style discriminators: the first 8 bytes of sha256("<kind>:<name>").
 * Fixed here so the module loads in a browser bundle; a test recomputes each.
 */
export const RATING_DISCRIMINATORS: Readonly<Record<string, readonly number[]>> = Object.freeze({
  'global:open_rating': [157, 85, 49, 13, 189, 9, 239, 134],
  'global:accept_rating': [52, 125, 50, 74, 155, 139, 111, 34],
  'global:commit_rating': [83, 41, 207, 225, 166, 6, 242, 45],
  'global:reveal_rating': [130, 180, 225, 105, 56, 97, 122, 52],
  'global:expire_rating': [91, 54, 39, 102, 225, 67, 94, 81],
  'global:close_rating': [144, 112, 209, 21, 165, 209, 129, 0],
  'global:attest_quality': [159, 141, 192, 125, 64, 144, 35, 80],
  'global:confirm_attestation': [82, 43, 20, 35, 143, 24, 28, 225],
  'global:dispute_attestation': [208, 61, 32, 203, 166, 52, 100, 35],
  'global:close_attestation': [249, 84, 133, 23, 48, 175, 252, 221],
  'global:lock_escrow': [55, 16, 5, 80, 13, 102, 206, 104],
  'global:lock_metered_escrow': [134, 129, 217, 67, 19, 31, 150, 94],
  'global:release_escrow': [146, 253, 129, 233, 20, 145, 181, 206],
  'global:settle_escrow': [22, 135, 160, 194, 23, 186, 124, 110],
  'global:cancel_escrow': [156, 203, 54, 179, 38, 72, 33, 21],
  'account:RatingAccount': [15, 40, 133, 180, 111, 241, 197, 228],
  'account:AttestationAccount': [247, 195, 134, 60, 216, 249, 121, 183],
  'account:EscrowAccount': [36, 69, 48, 18, 128, 225, 125, 135],
});

function disc(name: string): Buffer {
  const bytes = RATING_DISCRIMINATORS[name] ?? TOKEN_ESCROW_DISCRIMINATORS[name];
  if (!bytes) throw new Error(`unknown discriminator ${name}`);
  return Buffer.from(bytes);
}

/** Slots a party has to commit after the paid exit, and to reveal after the second commitment: about 7 days each. */
export const RATING_COMMIT_SLOTS = 1_512_000n;
export const RATING_REVEAL_SLOTS = 1_512_000n;
/** Slots after which a judge may close an attestation the consumer never resolved. */
export const ATTESTATION_RESOLUTION_SLOTS = 1_512_000n;

export const RATING_ACCOUNT_LEN = 270;
export const ATTESTATION_ACCOUNT_LEN = 127;

// ── Escrow flag byte ─────────────────────────────────────────────────────────

/** Bits of an escrow's flag byte, the byte that has always held `metered`. */
export const ESCROW_FLAG_METERED = 0x01;
export const ESCROW_FLAG_RATED = 0x02;
/** Set by `open_delivery` (see `./delivery`): every exit takes the delivery account, and the payee is paid only after a checked delivery. */
export const ESCROW_FLAG_DELIVERY = 0x04;
/** Offset of the flag byte in a token escrow account. */
export const TOKEN_ESCROW_FLAG_OFFSET = 202;
/** Offset of the flag byte in a SOL escrow account that stores windows and no PER session key. */
export const SOL_ESCROW_FLAG_OFFSET = 132;

export interface EscrowFlags {
  metered: boolean;
  rated: boolean;
  deliveryChecked: boolean;
  /** Bits this version does not know: anything but metered, rated and delivery-checked. Nonzero means a later program set them; refuse the escrow. */
  unknownBits: number;
}

/** Every flag bit this version knows. */
export const KNOWN_ESCROW_FLAGS = ESCROW_FLAG_METERED | ESCROW_FLAG_RATED | ESCROW_FLAG_DELIVERY;

/** Reads the flag byte. Test the bits: a rated metered escrow stores 3, so comparing the byte with 1 is wrong. */
export function escrowFlags(flagByte: number): EscrowFlags {
  return { metered: (flagByte & ESCROW_FLAG_METERED) !== 0, rated: (flagByte & ESCROW_FLAG_RATED) !== 0, deliveryChecked: (flagByte & ESCROW_FLAG_DELIVERY) !== 0, unknownBits: flagByte & ~KNOWN_ESCROW_FLAGS & 0xff };
}

const startsWith = (data: Uint8Array, prefix: Buffer) => data.length >= prefix.length && prefix.every((byte, i) => data[i] === byte);

/**
 * Kind and flags of an escrow account of the program, SOL or token, from its
 * data. Undefined when the bytes are neither. Reads both the current layouts
 * (165 and 219 bytes) and the earlier ones without windows (149 and 203).
 */
export function escrowAccountFlags(data: Uint8Array): ({ kind: 'sol' | 'token' } & EscrowFlags) | undefined {
  if (startsWith(data, disc('account:TokenEscrowAccount'))) {
    if (data.length !== 219 && data.length !== 203) return undefined;
    return { kind: 'token', ...escrowFlags(data[TOKEN_ESCROW_FLAG_OFFSET]) };
  }
  if (startsWith(data, disc('account:EscrowAccount'))) {
    if (data.length !== 165 && data.length !== 149) return undefined;
    // delegated_to_per, then the session key as an option: a tag byte and, when 1, 32 bytes. Then bump, then flags.
    const tagOffset = data.length === 165 ? 130 : 114;
    const tag = data[tagOffset];
    if (tag !== 0 && tag !== 1) return undefined;
    return { kind: 'sol', ...escrowFlags(data[tagOffset + 2 + (tag === 1 ? 32 : 0)]) };
  }
  return undefined;
}

/** True when the escrow account data (SOL or token) has the rated bit set. False for bytes that are not an escrow. */
export function isRatedEscrow(data: Uint8Array): boolean {
  return escrowAccountFlags(data)?.rated === true;
}

// ── Addresses ────────────────────────────────────────────────────────────────

/** The rating account of an escrow: `["rating", escrow]`. */
export function ratingPda(escrow: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('rating'), escrow.toBuffer()], programId)[0];
}

/** The attestation account of an escrow's job: `["attestation", escrow]`. */
export function attestationPda(escrow: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('attestation'), escrow.toBuffer()], programId)[0];
}

/** The agent record of a wallet: `["agent", owner]`. The address is passed whether or not the wallet is registered. */
export function agentPda(owner: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('agent'), owner.toBuffer()], programId)[0];
}

/** A SOL escrow: `["escrow", payer, 16-byte nonce]`. */
export function solEscrowPda(payer: PublicKey, nonce: Uint8Array, programId: PublicKey): PublicKey {
  if (nonce.length !== 16) throw new Error('nonce must be 16 bytes');
  return PublicKey.findProgramAddressSync([Buffer.from('escrow'), payer.toBuffer(), Buffer.from(nonce)], programId)[0];
}

// ── Commitment ───────────────────────────────────────────────────────────────

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74,
  0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d,
  0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e,
  0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256, synchronous and without `node:crypto`, so the commitment can be made in a browser. A test checks it against Node's. */
export function sha256(message: Uint8Array): Uint8Array {
  const length = message.length;
  const padded = new Uint8Array((((length + 8) >> 6) + 1) << 6);
  padded.set(message);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  view.setUint32(padded.length - 4, (length << 3) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  h.forEach((word, i) => outView.setUint32(i * 4, word));
  return out;
}

function assertScore(score: number, what = 'score'): void {
  if (!Number.isInteger(score) || score < 1 || score > 10) throw new Error(`${what} must be a whole number from 1 to 10`);
}

function bytes32(value: Uint8Array, what: string): Buffer {
  if (value.length !== 32) throw new Error(`${what} must be 32 bytes`);
  return Buffer.from(value);
}

/**
 * The rating's `opened_slot` as eight little-endian bytes. Required, and a
 * bigint: the program refuses a slot other than the one on the rating account
 * now at the address (`RatingJobMismatch`, 6051).
 */
function openedSlotBytes(openedSlot: bigint): Buffer {
  if (typeof openedSlot !== 'bigint' || openedSlot < 0n || openedSlot > 0xffffffffffffffffn) {
    throw new Error("openedSlot must be the rating account's opened_slot, as a u64 bigint");
  }
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(openedSlot);
  return out;
}

/**
 * The commitment a party makes with `commit_rating`:
 * sha256(rating address ‖ opened_slot, u64 LE ‖ signer address ‖ score byte ‖ 32-byte salt).
 * `openedSlot` is the rating account's `openedSlot`, so a commitment made for
 * one job cannot be opened for a later job at the same address. Keep the
 * score and the salt: `reveal_rating` needs both, and a party that commits
 * and cannot reveal loses reputation. Use a fresh random salt per rating.
 */
export function ratingCommitment(rating: PublicKey, openedSlot: bigint, signer: PublicKey, score: number, salt: Uint8Array): Uint8Array {
  assertScore(score);
  const slot = openedSlotBytes(openedSlot);
  return sha256(Buffer.concat([rating.toBuffer(), slot, signer.toBuffer(), Buffer.from([score]), bytes32(salt, 'salt')]));
}

// ── Rating and attestation instructions ──────────────────────────────────────

const meta = (pubkey: PublicKey, isWritable = false, isSigner = false): AccountMeta => ({ pubkey, isWritable, isSigner });

interface OfEscrow {
  programId: PublicKey;
  /** The escrow the job was paid through. The rating and attestation addresses are derived from it. */
  escrow: PublicKey;
}

/**
 * `open_rating`: the payer opts the escrow in to rating. Only in the slot the
 * escrow was locked in, so send it in the lock's transaction, after the lock.
 * `judge` names the one wallet that may attest the job; leave it out for none.
 * The payer pays the rating account's rent, returned when the rating is closed.
 */
export function buildOpenRatingInstruction(input: OfEscrow & { payer: PublicKey; judge?: PublicKey }): TransactionInstruction {
  if (input.judge?.equals(input.payer)) throw new Error('the judge cannot be the payer');
  return new TransactionInstruction({
    programId: input.programId,
    data: Buffer.concat([disc('global:open_rating'), input.judge ? input.judge.toBuffer() : Buffer.alloc(32)]),
    keys: [meta(ratingPda(input.escrow, input.programId), true), meta(input.escrow, true), meta(input.payer, true, true), meta(SystemProgram.programId)],
  });
}

/**
 * `accept_rating`: the seller (the escrow's payee) agrees to the rating while
 * the escrow is still locked, so that a release by the payer opens it. A
 * seller that is itself the authority of the claim or settle agrees by that
 * and need not call this. Co-signing the payer's release is not agreement.
 * `openedSlot` names the job: the rating account's `openedSlot` as the seller
 * read it. Prefer `buildSellerAcceptRating`, which reads it and checks the job.
 */
export function buildAcceptRatingInstruction(input: OfEscrow & { specialist: PublicKey; openedSlot: bigint }): TransactionInstruction {
  return new TransactionInstruction({
    programId: input.programId,
    data: Buffer.concat([disc('global:accept_rating'), openedSlotBytes(input.openedSlot)]),
    keys: [meta(ratingPda(input.escrow, input.programId), true), meta(input.specialist, false, true)],
  });
}

/**
 * `commit_rating`: the consumer or the specialist commits to
 * `ratingCommitment(...)`. `openedSlot` names the job: the rating account's
 * `openedSlot`, the same one the commitment was made with. The program refuses
 * another (`RatingJobMismatch`, 6051) before storing anything.
 */
export function buildCommitRatingInstruction(input: OfEscrow & { signer: PublicKey; commitment: Uint8Array; openedSlot: bigint }): TransactionInstruction {
  const commitment = bytes32(input.commitment, 'commitment');
  if (commitment.every((byte) => byte === 0)) throw new Error('commitment must not be all zero');
  return new TransactionInstruction({
    programId: input.programId,
    data: Buffer.concat([disc('global:commit_rating'), commitment, openedSlotBytes(input.openedSlot)]),
    keys: [meta(ratingPda(input.escrow, input.programId), true), meta(input.signer, false, true)],
  });
}

interface RatingParties {
  /** The rating's consumer: the escrow's payer. */
  consumer: PublicKey;
  /** The rating's specialist: the escrow's payee. */
  specialist: PublicKey;
}

function ratingAgentMetas(input: OfEscrow & RatingParties): AccountMeta[] {
  return [meta(agentPda(input.specialist, input.programId), true), meta(agentPda(input.consumer, input.programId), true)];
}

/** `reveal_rating`: the signer (consumer or specialist) opens its commitment with the score and salt it committed to. */
export function buildRevealRatingInstruction(input: OfEscrow & RatingParties & { signer: PublicKey; score: number; salt: Uint8Array }): TransactionInstruction {
  assertScore(input.score);
  return new TransactionInstruction({
    programId: input.programId,
    data: Buffer.concat([disc('global:reveal_rating'), Buffer.from([input.score]), bytes32(input.salt, 'salt')]),
    keys: [meta(ratingPda(input.escrow, input.programId), true), meta(input.signer, false, true), ...ratingAgentMetas(input)],
  });
}

/** `expire_rating`: anyone may call it once the deadline of the phase the rating stopped in has passed. */
export function buildExpireRatingInstruction(input: OfEscrow & RatingParties & { caller: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: input.programId,
    data: disc('global:expire_rating'),
    keys: [meta(ratingPda(input.escrow, input.programId), true), meta(input.caller, false, true), ...ratingAgentMetas(input)],
  });
}

/** `close_rating`: the consumer closes a final (revealed or expired) rating and gets its rent back. */
export function buildCloseRatingInstruction(input: OfEscrow & { consumer: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: input.programId,
    data: disc('global:close_rating'),
    keys: [meta(ratingPda(input.escrow, input.programId), true), meta(input.consumer, true, true)],
  });
}

/** The five scores of an attestation, 1 to 10 each. */
export type AttestationScores = readonly [accuracy: number, completeness: number, relevance: number, format: number, latency: number];

/**
 * `attest_quality`: the judge the rating names records five scores for a paid
 * job. The judge must be registered as an attestation agent and pays the
 * attestation's rent. Must be made before the rating account is closed.
 * `openedSlot` names the job: the rating account's `openedSlot` as the judge read it.
 */
export function buildAttestQualityInstruction(input: OfEscrow & { judge: PublicKey; scores: AttestationScores; openedSlot: bigint }): TransactionInstruction {
  if (input.scores.length !== 5) throw new Error('an attestation has five scores');
  input.scores.forEach((score) => assertScore(score, 'each attestation score'));
  return new TransactionInstruction({
    programId: input.programId,
    data: Buffer.concat([disc('global:attest_quality'), Buffer.from(input.scores), openedSlotBytes(input.openedSlot)]),
    keys: [
      meta(attestationPda(input.escrow, input.programId), true),
      meta(ratingPda(input.escrow, input.programId), true),
      meta(agentPda(input.judge, input.programId)),
      meta(input.judge, true, true),
      meta(SystemProgram.programId),
    ],
  });
}

interface AttestationDecision {
  judge: PublicKey;
  consumer: PublicKey;
  /**
   * Names the job: the attestation's `openedSlot`, as the consumer read it
   * with the scores it is deciding on. The program refuses another
   * (`RatingJobMismatch`, 6051).
   */
  openedSlot: bigint;
}

function resolveAttestation(name: string, input: OfEscrow & AttestationDecision): TransactionInstruction {
  return new TransactionInstruction({
    programId: input.programId,
    data: Buffer.concat([disc(name), openedSlotBytes(input.openedSlot)]),
    keys: [meta(attestationPda(input.escrow, input.programId), true), meta(agentPda(input.judge, input.programId), true), meta(input.consumer, false, true)],
  });
}

/** `confirm_attestation`: the consumer the attestation names confirms it, once. */
export function buildConfirmAttestationInstruction(input: OfEscrow & AttestationDecision): TransactionInstruction {
  return resolveAttestation('global:confirm_attestation', input);
}

/** `dispute_attestation`: the consumer the attestation names disputes it, once. */
export function buildDisputeAttestationInstruction(input: OfEscrow & AttestationDecision): TransactionInstruction {
  return resolveAttestation('global:dispute_attestation', input);
}

/** `close_attestation`: the judge gets the rent back once the attestation is resolved, or after the resolution window. */
export function buildCloseAttestationInstruction(input: OfEscrow & { judge: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: input.programId,
    data: disc('global:close_attestation'),
    keys: [meta(attestationPda(input.escrow, input.programId), true), meta(input.judge, true, true)],
  });
}

// ── Account decoders ─────────────────────────────────────────────────────────

/**
 * The program's custom error codes for ratings and attestations, by number.
 * 6010 to 6019 keep the numbers of the earlier program; 6033 to 6051 are new
 * with the escrow-bound rating, and 6052 and 6053 with exits that name their escrow. Held to the program's `error.rs` by a test.
 */
export const RATING_PROGRAM_ERRORS = {
  6010: 'AlreadyCommitted',
  6011: 'BothMustCommitFirst',
  6012: 'CommitmentMismatch',
  6013: 'InvalidScore',
  6014: 'NotExpired',
  6015: 'AlreadyFinalised',
  6016: 'NotAttestationAgent',
  6018: 'AttestationAlreadyResolved',
  6019: 'AttestationScoreOutOfRange',
  6033: 'RatingAccountRequired',
  6034: 'InvalidRatingAccount',
  6035: 'RatingNotAwaitingSettlement',
  6036: 'RatingOptInClosed',
  6037: 'AlreadyRated',
  6038: 'InvalidJudge',
  6039: 'JobNotPaid',
  6040: 'CommitDeadlinePassed',
  6041: 'RevealDeadlinePassed',
  6042: 'AlreadyRevealed',
  6043: 'EmptyCommitment',
  6044: 'RatingNotFinal',
  6045: 'RatedEscrowNotDelegable',
  6046: 'RatingAlreadyAccepted',
  6047: 'AttestationNotClosable',
  6048: 'AlreadyAttested',
  6049: 'JudgeNotActive',
  /** An exit of a rated escrow in the slot its rating was opened in. */
  6050: 'RatingJustOpened',
  /**
   * A rated exit, `accept_rating`, `commit_rating`, `attest_quality` or a
   * decision on an attestation named an `opened_slot` other than the job's (or
   * a rated exit named none): another job now holds the address.
   */
  6051: 'RatingJobMismatch',
  /** An exit of an escrow in the slot it was locked in. */
  6052: 'EscrowJustLocked',
  /**
   * An exit named a lock slot other than its escrow's (or none): it was
   * signed for an earlier escrow at the same address.
   */
  6053: 'EscrowInstanceMismatch',
} as const;
export type RatingProgramErrorName = (typeof RATING_PROGRAM_ERRORS)[keyof typeof RATING_PROGRAM_ERRORS];
/** The name of a rating or attestation error code, or undefined for any other code. */
export function ratingProgramErrorName(code: number): RatingProgramErrorName | undefined {
  return (RATING_PROGRAM_ERRORS as Record<number, RatingProgramErrorName>)[code];
}

export const RATING_STATES = ['awaiting_settlement', 'open', 'both_committed', 'revealed', 'expired'] as const;
/**
 * `awaiting_settlement`: opted in, escrow not yet paid. `open`: paid, waiting
 * for commitments. `both_committed`: waiting for reveals. `revealed` and
 * `expired` are final.
 */
export type RatingState = (typeof RATING_STATES)[number];

export interface RatingAccount {
  escrow: PublicKey;
  /** The escrow's payer. */
  consumer: PublicKey;
  /** The escrow's payee. */
  specialist: PublicKey;
  /** The one wallet that may attest the job, or undefined when the consumer named none. */
  judge?: PublicKey;
  /** The mint the job was paid in. Undefined for SOL, and for any escrow until the job is paid. */
  mint?: PublicKey;
  /** 32 bytes, or undefined until the consumer has committed. */
  consumerCommitment?: Uint8Array;
  /** 32 bytes, or undefined until the specialist has committed. */
  specialistCommitment?: Uint8Array;
  /** Amount paid out of the escrow before the protocol fee, in base units. Zero until paid. */
  paid: bigint;
  openedSlot: bigint;
  /** Slot of the paid exit; the commit deadline counts from it. */
  settledSlot: bigint;
  /** Slot of the second commitment; the reveal deadline counts from it. */
  committedSlot: bigint;
  state: RatingState;
  /** The consumer's score of the specialist, 1 to 10. Undefined until revealed. */
  consumerScore?: number;
  /** The specialist's score of the consumer, 1 to 10. Undefined until revealed. */
  specialistScore?: number;
  /** True once the specialist called `accept_rating`. False when it agreed by signing the paid exit instead. */
  accepted: boolean;
  /** True once the judge has attested the job. */
  attested: boolean;
  bump: number;
}

const key = (data: Buffer, offset: number) => new PublicKey(data.subarray(offset, offset + 32));
const optional32 = (data: Buffer, offset: number) => {
  const bytes = data.subarray(offset, offset + 32);
  return bytes.every((byte) => byte === 0) ? undefined : Uint8Array.from(bytes);
};
const optionalKey = (data: Buffer, offset: number) => {
  const bytes = optional32(data, offset);
  return bytes ? new PublicKey(bytes) : undefined;
};

/**
 * Reads a rating account. Throws when the bytes are not one: the wrong
 * discriminator, shorter than the layout (which includes the shorter record
 * of the archived Anchor program's `extended` build), or an unknown state.
 */
export function decodeRatingAccount(accountData: Uint8Array): RatingAccount {
  const data = Buffer.from(accountData.buffer, accountData.byteOffset, accountData.byteLength);
  if (data.length < RATING_ACCOUNT_LEN || !startsWith(data, disc('account:RatingAccount'))) throw new Error('invalid rating account layout');
  const state = RATING_STATES[data[264]];
  if (!state) throw new Error('unknown rating state');
  return {
    escrow: key(data, 8),
    consumer: key(data, 40),
    specialist: key(data, 72),
    judge: optionalKey(data, 104),
    mint: optionalKey(data, 136),
    consumerCommitment: optional32(data, 168),
    specialistCommitment: optional32(data, 200),
    paid: data.readBigUInt64LE(232),
    openedSlot: data.readBigUInt64LE(240),
    settledSlot: data.readBigUInt64LE(248),
    committedSlot: data.readBigUInt64LE(256),
    state,
    consumerScore: data[265] || undefined,
    specialistScore: data[266] || undefined,
    accepted: data[267] === 1,
    attested: data[268] === 1,
    bump: data[269],
  };
}

export const ATTESTATION_RESOLUTIONS = ['pending', 'confirmed', 'disputed'] as const;
export type AttestationResolution = (typeof ATTESTATION_RESOLUTIONS)[number];

export interface AttestationAccount {
  escrow: PublicKey;
  judge: PublicKey;
  consumer: PublicKey;
  /** Accuracy, completeness, relevance, format, latency. */
  scores: [number, number, number, number, number];
  resolution: AttestationResolution;
  /** Slot the attestation was made in; the judge may close an unresolved one after `ATTESTATION_RESOLUTION_SLOTS` from it. */
  createdSlot: bigint;
  bump: number;
  /** The slot the job's rating was opened in. `confirm_attestation` and `dispute_attestation` name it. */
  openedSlot: bigint;
}

/** Reads an attestation account. Throws when the bytes are not one. */
export function decodeAttestationAccount(accountData: Uint8Array): AttestationAccount {
  const data = Buffer.from(accountData.buffer, accountData.byteOffset, accountData.byteLength);
  if (data.length < ATTESTATION_ACCOUNT_LEN || !startsWith(data, disc('account:AttestationAccount'))) throw new Error('invalid attestation account layout');
  const resolution = ATTESTATION_RESOLUTIONS[data[109]];
  if (!resolution) throw new Error('unknown attestation resolution');
  return {
    escrow: key(data, 8),
    judge: key(data, 40),
    consumer: key(data, 72),
    scores: [data[104], data[105], data[106], data[107], data[108]],
    resolution,
    createdSlot: data.readBigUInt64LE(110),
    bump: data[118],
    openedSlot: data.readBigUInt64LE(119),
  };
}

// ── Exits of a rated escrow ──────────────────────────────────────────────────

/** How many accounts each exit instruction takes before the rating account. */
const EXIT_ACCOUNTS: readonly (readonly [name: string, usual: number])[] = [
  ['global:release_escrow', 5],
  ['global:settle_escrow', 5],
  ['global:cancel_escrow', 4],
  ['global:release_token_escrow', 9],
  ['global:settle_token_escrow', 9],
  ['global:cancel_token_escrow', 7],
];

/** Data length of each exit without the job's `opened_slot`: the selector, and `actual` for a settle. */
const EXIT_DATA_LEN: Readonly<Record<string, number>> = {
  'global:release_escrow': 8,
  'global:settle_escrow': 16,
  'global:cancel_escrow': 8,
  'global:release_token_escrow': 8,
  'global:settle_token_escrow': 16,
  'global:cancel_token_escrow': 8,
};

/**
 * Makes an exit of an escrow (release, claim, settle, refund or decline, SOL
 * or token) into the form the program takes: the escrow's lock slot
 * (`createdSlot`, u64 LE) after the instruction's data, and for a rated
 * escrow the rating account right after the usual accounts, writable. The
 * escrow is the instruction's first account.
 *
 * The slot names the escrow. An address is used again when a payer locks
 * with the same nonce after its earlier escrow ended, and no escrow ends in
 * the slot it was locked in, so an exit signed for one escrow is refused for
 * the next one at that address (`EscrowInstanceMismatch`, 6053) and an exit
 * in the lock slot is refused (`EscrowJustLocked`, 6052). A rated escrow's
 * rating is opened in its lock slot, so its `openedSlot` is the same slot;
 * a rated exit naming another is refused (`RatingJobMismatch`, 6051), and one
 * without the rating account (`RatingAccountRequired`, 6033).
 *
 * Read `rated` and `createdSlot` from the escrow account. Throws for an
 * instruction that is not one of the six exits, lacks its usual accounts or
 * already carries more data, or when the slot is missing.
 */
export function withRatingAccount(exit: TransactionInstruction, rated: boolean, createdSlot: bigint | undefined): TransactionInstruction {
  const found = EXIT_ACCOUNTS.find(([name]) => startsWith(exit.data, disc(name)));
  if (found === undefined) throw new Error('not an escrow exit instruction');
  const [name, usual] = found;
  if (exit.keys.length < usual) throw new Error('the exit instruction is missing some of its usual accounts');
  if (createdSlot === undefined) throw new Error("an exit names its escrow: pass the escrow account's createdSlot (for a rated escrow, its rating's openedSlot, the same slot)");
  if (exit.data.length !== EXIT_DATA_LEN[name]) throw new Error('the exit instruction already carries more data than its own');
  const data = Buffer.concat([exit.data, openedSlotBytes(createdSlot)]);
  if (!rated) return new TransactionInstruction({ programId: exit.programId, data, keys: [...exit.keys] });
  const rating = ratingPda(exit.keys[0].pubkey, exit.programId);
  return new TransactionInstruction({
    programId: exit.programId,
    data,
    keys: [...exit.keys.slice(0, usual), meta(rating, true), ...exit.keys.slice(usual)],
  });
}

/**
 * `buildSettleTokenEscrowInstruction` in the form the program takes: the
 * same release, claim, settle, refund or decline, naming the escrow by its
 * lock slot, with the rating account added when `rated` is true. Read
 * `rated` and `createdSlot` from the escrow account
 * (`decodeTokenEscrowAccount(...)`); a rated escrow's `openedSlot` is the
 * same slot and may be passed instead.
 */
export function buildTokenEscrowExitInstruction(
  terms: TokenEscrowTerms,
  exit: { rated: boolean; createdSlot?: bigint; openedSlot?: bigint; refund?: boolean; authority?: PublicKey; options?: SettleTokenEscrowOptions },
): TransactionInstruction {
  return withRatingAccount(buildSettleTokenEscrowInstruction(terms, exit.refund ?? false, exit.authority ?? terms.payer, exit.options ?? {}), exit.rated, exit.createdSlot ?? exit.openedSlot);
}

export interface SolEscrowTerms {
  programId: PublicKey;
  payer: PublicKey;
  payee: PublicKey;
  /** Lamports. For a metered escrow, the buyer's authorised maximum. */
  amount: bigint;
  nonce: Uint8Array;
  metered?: boolean;
  /** Defaults to `DEFAULT_CLAIM_WINDOW_SLOTS`. */
  claimWindowSlots?: bigint;
  /** Defaults to `DEFAULT_CANCEL_WINDOW_SLOTS`. */
  cancelWindowSlots?: bigint;
}

function u64(value: bigint, what: string): Buffer {
  if (value <= 0n || value > 0xffffffffffffffffn) throw new Error(`${what} must be a positive u64`);
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

/** `lock_escrow` or, with `metered`, `lock_metered_escrow`: the payer locks SOL for the payee. */
export function buildLockSolEscrowInstruction(t: SolEscrowTerms): TransactionInstruction {
  if (t.payee.equals(t.payer)) throw new Error('the payee cannot be the payer');
  const { claimWindowSlots, cancelWindowSlots } = escrowWindows(t);
  const windows = Buffer.alloc(16);
  windows.writeBigUInt64LE(claimWindowSlots);
  windows.writeBigUInt64LE(cancelWindowSlots, 8);
  return new TransactionInstruction({
    programId: t.programId,
    data: Buffer.concat([disc(t.metered ? 'global:lock_metered_escrow' : 'global:lock_escrow'), u64(t.amount, 'amount'), Buffer.from(t.nonce), windows]),
    keys: [meta(solEscrowPda(t.payer, t.nonce, t.programId), true), meta(t.payer, true, true), meta(t.payee), meta(SystemProgram.programId)],
  });
}

interface SolEscrowExit {
  programId: PublicKey;
  escrow: PublicKey;
  payer: PublicKey;
  payee: PublicKey;
  /** Whether the escrow's rated bit is set; read it from the escrow account. Adds the rating account. */
  rated?: boolean;
  /** The escrow account's `created_slot`, naming the escrow. One of this and `openedSlot` is required. */
  createdSlot?: bigint;
  /** A rated escrow's rating `opened_slot`, which is its `created_slot`. */
  openedSlot?: bigint;
  /** Defaults to the protocol treasury fixed in the program. */
  treasury?: PublicKey;
}

/**
 * `release_escrow`: pays the whole locked amount, less the fee. `signer` is
 * who signs: the payer (any time) or the payee (a claim, once the claim
 * window has elapsed).
 *
 * Rated escrow, released by the payer: the rating opens only if the seller
 * called `accept_rating` first. Otherwise the money moves as usual and the
 * rating account is closed, so the job is never rated. Check
 * `payerReleaseOpensRating` before releasing, or leave the seller to claim.
 */
export function buildReleaseSolEscrowInstruction(input: SolEscrowExit & { signer?: 'payer' | 'payee' }): TransactionInstruction {
  const signer = input.signer ?? 'payer';
  return withRatingAccount(
    new TransactionInstruction({
      programId: input.programId,
      data: disc('global:release_escrow'),
      keys: [
        meta(input.escrow, true),
        meta(input.payer, true, signer === 'payer'),
        meta(input.payee, true, signer === 'payee'),
        meta(input.treasury ?? ESCROW_PROTOCOL_TREASURY, true),
        meta(SystemProgram.programId),
      ],
    }),
    input.rated === true,
    input.createdSlot ?? input.openedSlot,
  );
}

/** `settle_escrow`: the payee settles a metered escrow at `actual` lamports, at most the maximum; the rest returns to the payer. */
export function buildSettleSolEscrowInstruction(input: SolEscrowExit & { actual: bigint }): TransactionInstruction {
  return withRatingAccount(
    new TransactionInstruction({
      programId: input.programId,
      data: Buffer.concat([disc('global:settle_escrow'), u64(input.actual, 'settled amount')]),
      keys: [meta(input.escrow, true), meta(input.payer, true), meta(input.payee, true, true), meta(input.treasury ?? ESCROW_PROTOCOL_TREASURY, true), meta(SystemProgram.programId)],
    }),
    input.rated === true,
    input.createdSlot ?? input.openedSlot,
  );
}

/**
 * `cancel_escrow`: everything back to the payer, no fee. `authority` signs:
 * the payee at any time (decline), or the payer once the cancel window has
 * elapsed (refund). A rated escrow's rating account is closed.
 */
export function buildCancelSolEscrowInstruction(input: Omit<SolEscrowExit, 'payee' | 'treasury'> & { authority: PublicKey }): TransactionInstruction {
  return withRatingAccount(
    new TransactionInstruction({
      programId: input.programId,
      data: disc('global:cancel_escrow'),
      keys: [meta(input.escrow, true), meta(input.authority, false, true), meta(input.payer, true), meta(SystemProgram.programId)],
    }),
    input.rated === true,
    input.createdSlot ?? input.openedSlot,
  );
}

// ── Buyer and seller helpers ─────────────────────────────────────────────────

export interface RatedLock {
  /**
   * The lock, then `open_rating`. Both go into one transaction, in this order,
   * signed by the payer. Put no exit of the escrow in that transaction: the
   * program refuses an exit in the slot the rating was opened in (6050).
   */
  instructions: [TransactionInstruction, TransactionInstruction];
  escrow: PublicKey;
  rating: PublicKey;
}

/**
 * Buyer: lock a token escrow and opt it in to rating in one transaction.
 * `open_rating` is accepted only in the slot of the lock, so the two must not
 * be split. Use a fresh nonce per job. The payer also pays the rating
 * account's rent, returned at `close_rating`, on a refund, or on a release
 * the seller never agreed to have rated.
 *
 * On a fixed-price job, do not release before the seller has agreed: read the
 * rating account and release only when `payerReleaseOpensRating` is true, or
 * leave the seller to claim. A release without the seller's agreement pays
 * the seller and closes the job unrated.
 */
export function buildRatedTokenEscrowLock(terms: TokenEscrowTerms, options: { judge?: PublicKey } = {}): RatedLock & { vault: PublicKey } {
  const { escrow, vault } = tokenEscrowAddresses(terms);
  if (options.judge?.equals(terms.payee)) throw new Error('the judge cannot be the payee');
  const open = buildOpenRatingInstruction({ programId: terms.programId, escrow, payer: terms.payer, judge: options.judge });
  return { instructions: [buildLockTokenEscrowInstruction(terms), open], escrow, vault, rating: open.keys[0].pubkey };
}

/** Buyer: lock a SOL escrow and opt it in to rating in one transaction. See `buildRatedTokenEscrowLock`. */
export function buildRatedSolEscrowLock(terms: SolEscrowTerms, options: { judge?: PublicKey } = {}): RatedLock {
  const escrow = solEscrowPda(terms.payer, terms.nonce, terms.programId);
  if (options.judge?.equals(terms.payee)) throw new Error('the judge cannot be the payee');
  const open = buildOpenRatingInstruction({ programId: terms.programId, escrow, payer: terms.payer, judge: options.judge });
  return { instructions: [buildLockSolEscrowInstruction(terms), open], escrow, rating: open.keys[0].pubkey };
}

/**
 * Buyer: whether a release by the payer now would open the rating. True only
 * while the escrow is unpaid and the seller has called `accept_rating`. When
 * false, a payer's release still pays the seller in full but closes the
 * rating account, and the job is never rated or attested; a buyer that wants
 * the rating waits for the seller to accept, or leaves the seller to claim or
 * settle (a paid exit the seller signs as the authority always opens it).
 */
export function payerReleaseOpensRating(rating: Pick<RatingAccount, 'state' | 'accepted'>): boolean {
  return rating.state === 'awaiting_settlement' && rating.accepted;
}

/**
 * Reads the rating account of an escrow, at `confirmed` unless told
 * otherwise. Undefined when there is none: the job was never opted in, was
 * refunded, was released without the seller's agreement, or the rating was
 * closed. Throws when the account is not this program's or is not a rating,
 * and on RPC errors.
 */
export async function readRatingAccount(
  connection: EscrowAccountReader,
  escrow: PublicKey,
  programId: PublicKey,
  commitment: 'confirmed' | 'finalized' = 'confirmed',
): Promise<RatingAccount | undefined> {
  const account = await connection.getAccountInfo(ratingPda(escrow, programId), commitment);
  if (!account) return undefined;
  if (!account.owner.equals(programId)) throw new Error('rating account is not held by the escrow program');
  const rating = decodeRatingAccount(account.data);
  if (!rating.escrow.equals(escrow)) throw new Error('rating account names another escrow');
  return rating;
}

/** The part of a `Connection` the buyer and seller helpers use. */
export interface EscrowAccountReader {
  getAccountInfo(address: PublicKey, commitment?: Commitment): Promise<{ owner: PublicKey; data: Uint8Array } | null>;
}

export type EscrowRatingStatus =
  | {
      ok: true;
      kind: 'sol' | 'token';
      metered: boolean;
      /** True when the buyer opted this job in to rating. Every exit must then carry `rating`. */
      rated: boolean;
      /** The rating account's address. An account exists there only while `rated` is true. */
      rating: PublicKey;
    }
  | { ok: false; reason: 'not_found' | 'wrong_owner' | 'not_an_escrow' };

/**
 * Seller: tells whether an escrow is rated, before serving. Reads the escrow
 * at `confirmed` commitment: opting in is only possible in the slot of the
 * lock, so a read that sees that whole slot is final on this point, and a
 * `processed` read may not be. Do not pass a weaker commitment.
 *
 * A seller that serves a rated job and is the authority of its settle or
 * claim has agreed to be rated: it must then commit and reveal within the
 * windows or lose reputation. Its claim transaction must not carry the
 * payer's signature (see the note at the top of this file). A seller that does not want that declines the job
 * (`cancel` as the payee, which also needs the rating account).
 *
 * RPC errors are thrown, not turned into "not rated".
 */
export async function readEscrowRatingStatus(
  connection: EscrowAccountReader,
  escrow: PublicKey,
  programId: PublicKey,
  commitment: 'confirmed' | 'finalized' = 'confirmed',
): Promise<EscrowRatingStatus> {
  const account = await connection.getAccountInfo(escrow, commitment);
  if (!account) return { ok: false, reason: 'not_found' };
  if (!account.owner.equals(programId)) return { ok: false, reason: 'wrong_owner' };
  const flags = escrowAccountFlags(account.data);
  if (!flags) return { ok: false, reason: 'not_an_escrow' };
  return { ok: true, ...flags, rating: ratingPda(escrow, programId) };
}

/** Why `buildSellerAcceptRating` refused to build `accept_rating`. */
export type SellerAcceptRatingRefusal =
  | 'escrow_not_found'
  | 'escrow_wrong_owner'
  | 'not_an_escrow'
  | 'escrow_not_locked'
  | 'escrow_not_rated'
  | 'not_the_payee'
  | 'rating_not_found'
  | 'rating_wrong_owner'
  | 'rating_mismatch'
  | 'rating_not_awaiting_settlement'
  | 'already_accepted'
  | 'opened_slot_mismatch'
  | 'judge_mismatch'
  | 'amount_mismatch'
  | 'mint_mismatch'
  | 'unknown_escrow_flags';

export class SellerAcceptRatingError extends Error {
  constructor(readonly reason: SellerAcceptRatingRefusal, message: string) {
    super(message);
    this.name = 'SellerAcceptRatingError';
  }
}

/** What the seller agrees to when it signs `accept_rating`. */
export interface SellerAcceptRating {
  /** `accept_rating`, naming the job by `openedSlot`. The seller signs it. */
  instruction: TransactionInstruction;
  rating: PublicKey;
  /** The rating account's `opened_slot`: the job this acceptance is for. */
  openedSlot: bigint;
  /** The escrow's payer, who will rate the seller. */
  consumer: PublicKey;
  /** The judge who may attest the job, or undefined for none. */
  judge?: PublicKey;
  kind: 'sol' | 'token';
  /** The amount locked in the escrow, in lamports or token base units. */
  amount: bigint;
  /** The token escrow's mint; undefined for SOL. */
  mint?: PublicKey;
}

/**
 * What the seller expects of the job. Each field given is checked against the
 * chain; a mismatch refuses. `judge: null` and `mint: null` expect none (no
 * judge; a SOL escrow).
 */
export interface SellerAcceptRatingExpectations {
  openedSlot?: bigint;
  judge?: PublicKey | null;
  amount?: bigint;
  mint?: PublicKey | null;
}

const refuse = (reason: SellerAcceptRatingRefusal, message: string): never => {
  throw new SellerAcceptRatingError(reason, message);
};

const sameOptionalKey = (a: PublicKey | undefined, b: PublicKey | null) => (b === null ? a === undefined : a !== undefined && a.equals(b));

/**
 * Seller: checks the escrow and rating account data it has read (the
 * accounts at `escrow` and at its rating address, both held by the program)
 * and builds
 * `accept_rating` for that job. Throws `SellerAcceptRatingError` when the
 * escrow is not a locked, rated escrow payable to `seller`, when the rating
 * is not this escrow's, is past settlement or already accepted, or when any
 * of `expected` (opened slot, judge, amount, mint) differs from what was read.
 * `buildSellerAcceptRating` reads the two accounts and calls this.
 */
export function sellerAcceptRatingFromAccounts(input: {
  programId: PublicKey;
  escrow: PublicKey;
  seller: PublicKey;
  escrowData: Uint8Array;
  ratingData: Uint8Array;
  expected?: SellerAcceptRatingExpectations;
}): SellerAcceptRating {
  const flags = escrowAccountFlags(input.escrowData);
  if (!flags) return refuse('not_an_escrow', 'the escrow account is not an escrow of this program');
  if (flags.unknownBits !== 0) return refuse('unknown_escrow_flags', 'the escrow carries options this version does not know, so its exits may need accounts this version never sends');
  const data = Buffer.from(input.escrowData.buffer, input.escrowData.byteOffset, input.escrowData.byteLength);
  let payer: PublicKey, payee: PublicKey, amount: bigint, status: number, mint: PublicKey | undefined;
  if (flags.kind === 'token') {
    const token = decodeTokenEscrowAccount(data);
    ({ payer, payee, amount, status, mint } = token);
  } else {
    // SOL escrow: discriminator, payer, payee, amount, 16-byte nonce, status.
    payer = key(data, 8);
    payee = key(data, 40);
    amount = data.readBigUInt64LE(72);
    status = data[96];
    mint = undefined;
  }
  if (status !== 0) refuse('escrow_not_locked', 'the escrow is no longer locked');
  if (!flags.rated) refuse('escrow_not_rated', 'the escrow is not opted in to rating');
  if (!payee.equals(input.seller)) refuse('not_the_payee', 'the seller is not the escrow\'s payee');
  const rating = decodeRatingAccount(input.ratingData);
  if (!rating.escrow.equals(input.escrow) || !rating.consumer.equals(payer) || !rating.specialist.equals(payee)) {
    refuse('rating_mismatch', 'the rating account does not name this escrow and its parties');
  }
  if (rating.state !== 'awaiting_settlement') refuse('rating_not_awaiting_settlement', 'the escrow has been paid: there is nothing to accept');
  if (rating.accepted) refuse('already_accepted', 'the seller has already accepted this rating');
  const expected = input.expected ?? {};
  if (expected.openedSlot !== undefined && expected.openedSlot !== rating.openedSlot) {
    refuse('opened_slot_mismatch', `the rating at this address was opened in slot ${rating.openedSlot}, not ${expected.openedSlot}: another job holds it`);
  }
  if (expected.judge !== undefined && !sameOptionalKey(rating.judge, expected.judge)) refuse('judge_mismatch', 'the rating names another judge');
  if (expected.amount !== undefined && expected.amount !== amount) refuse('amount_mismatch', `the escrow holds ${amount}, not ${expected.amount}`);
  if (expected.mint !== undefined && !sameOptionalKey(mint, expected.mint)) refuse('mint_mismatch', 'the escrow is in another currency');
  return {
    instruction: buildAcceptRatingInstruction({ programId: input.programId, escrow: input.escrow, specialist: input.seller, openedSlot: rating.openedSlot }),
    rating: ratingPda(input.escrow, input.programId),
    openedSlot: rating.openedSlot,
    consumer: rating.consumer,
    ...(rating.judge ? { judge: rating.judge } : {}),
    kind: flags.kind,
    amount,
    ...(mint ? { mint } : {}),
  };
}

/**
 * Seller: `accept_rating` for a rated escrow that is still locked, for a
 * seller that expects the payer to release (fixed-price jobs). Not needed
 * when the seller settles or claims itself. `seller` is the escrow's payee
 * and signs.
 *
 * Reads the escrow and its rating account (at `confirmed` unless told
 * otherwise) and returns the instruction with what the seller agrees to:
 * the job's `openedSlot`, consumer, judge, amount and mint. The instruction
 * names that `openedSlot`, so it is refused for any later job that takes the
 * same address (6051). Pass `expected` to refuse a job that is not the one
 * the seller agreed to serve; see `sellerAcceptRatingFromAccounts` for every
 * refusal. RPC errors are thrown.
 */
export async function buildSellerAcceptRating(
  connection: EscrowAccountReader,
  input: {
    programId: PublicKey;
    escrow: PublicKey;
    seller: PublicKey;
    expected?: SellerAcceptRatingExpectations;
    commitment?: 'confirmed' | 'finalized';
  },
): Promise<SellerAcceptRating> {
  const commitment = input.commitment ?? 'confirmed';
  const escrowAccount = await connection.getAccountInfo(input.escrow, commitment);
  if (!escrowAccount) return refuse('escrow_not_found', 'no escrow at this address');
  if (!escrowAccount.owner.equals(input.programId)) refuse('escrow_wrong_owner', 'the escrow account is not held by the escrow program');
  const ratingAccount = await connection.getAccountInfo(ratingPda(input.escrow, input.programId), commitment);
  if (!ratingAccount) return refuse('rating_not_found', 'no rating account: the job was not opted in, or has ended');
  if (!ratingAccount.owner.equals(input.programId)) refuse('rating_wrong_owner', 'the rating account is not held by the escrow program');
  return sellerAcceptRatingFromAccounts({ ...input, escrowData: escrowAccount.data, ratingData: ratingAccount.data });
}
