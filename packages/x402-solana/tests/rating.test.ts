import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as index from '../src/index';
import {
  agentPda,
  attestationPda,
  ATTESTATION_ACCOUNT_LEN,
  buildAcceptRatingInstruction,
  buildAttestQualityInstruction,
  buildCancelSolEscrowInstruction,
  buildCloseAttestationInstruction,
  buildCloseRatingInstruction,
  buildCommitRatingInstruction,
  buildConfirmAttestationInstruction,
  buildDisputeAttestationInstruction,
  buildExpireRatingInstruction,
  buildLockSolEscrowInstruction,
  buildOpenRatingInstruction,
  buildRatedSolEscrowLock,
  buildRatedTokenEscrowLock,
  buildReleaseSolEscrowInstruction,
  buildRevealRatingInstruction,
  buildSellerAcceptRating,
  SellerAcceptRatingError,
  sellerAcceptRatingFromAccounts,
  buildSettleSolEscrowInstruction,
  buildTokenEscrowExitInstruction,
  decodeAttestationAccount,
  decodeRatingAccount,
  escrowAccountFlags,
  escrowFlags,
  ESCROW_FLAG_METERED,
  ESCROW_FLAG_RATED,
  ESCROW_FLAG_DELIVERY,
  isRatedEscrow,
  payerReleaseOpensRating,
  RATING_ACCOUNT_LEN,
  RATING_DISCRIMINATORS,
  RATING_PROGRAM_ERRORS,
  ratingProgramErrorName,
  RATING_STATES,
  ratingCommitment,
  ratingPda,
  readEscrowRatingStatus,
  readRatingAccount,
  sha256,
  SOL_ESCROW_FLAG_OFFSET,
  solEscrowPda,
  TOKEN_ESCROW_FLAG_OFFSET,
  withRatingAccount,
} from '../src/rating';
import { buildLockTokenEscrowInstruction, buildSettleTokenEscrowInstruction, decodeTokenEscrowAccount, type TokenEscrowTerms } from '../src/token-escrow';

const TOKEN_ESCROW_LOCK_SELECTOR = createHash('sha256').update('global:lock_metered_token_escrow').digest().subarray(0, 8).toString('hex');

interface VectorMeta { name: string; address: string; signer: boolean; writable: boolean }
interface VectorInstruction { name: string; data_hex: string; selector_hex: string; accounts: VectorMeta[] }
interface VectorAccount { name: string; address: string; length: number; data_hex: string }
interface Vectors {
  program_id: string;
  instructions: VectorInstruction[];
  accounts: VectorAccount[];
  commitment: { rating: string; signer: string; score: number; salt_hex: string; preimage_hex: string; sha256_hex: string };
  escrow_flag_byte: { metered: number; rated: number; delivery_checked: number; sol_escrow_offset: number; token_escrow_offset: number };
  rating_states: string[];
}

// The program's own fixture: equivalence/tests/interface_vectors.rs fails when it and the program disagree.
const vectors: Vectors = JSON.parse(readFileSync(join(__dirname, '../../../programs/pinocchio-escrow/interface/vectors.json'), 'utf8'));
const programId = new PublicKey(vectors.program_id);
const key = (address: string) => new PublicKey(address);
const hex = (value: string) => Buffer.from(value, 'hex');
const instruction = (name: string) => {
  const found = vectors.instructions.find((entry) => entry.name === name);
  if (!found) throw new Error(`no vector for ${name}`);
  return found;
};
const account = (name: string) => {
  const found = vectors.accounts.find((entry) => entry.name === name);
  if (!found) throw new Error(`no account vector for ${name}`);
  return found;
};
const named = (vector: VectorInstruction, name: string) => key(vector.accounts.find((meta) => meta.name === name)!.address);

/** Data as hex and the ordered account metas, in the fixture's own shape. */
const shape = (ix: TransactionInstruction) => ({
  programId: ix.programId.toBase58(),
  data: ix.data.toString('hex'),
  accounts: ix.keys.map((meta) => ({ address: meta.pubkey.toBase58(), signer: meta.isSigner, writable: meta.isWritable })),
});
const expected = (vector: VectorInstruction) => ({
  programId: vectors.program_id,
  data: vector.data_hex,
  accounts: vector.accounts.map(({ address, signer, writable }) => ({ address, signer, writable })),
});
const expectedOf = expected;

// The parties the fixture uses throughout.
const payer = key('AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9');
const payee = key('9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu');
const judge = key('EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1');
const salt = hex(vectors.commitment.salt_hex);

/** Terms of the fixture's token escrows: USDC, 1,000,000 base units, nonce of one repeated byte. */
const tokenTerms = (nonceByte: number, vector: VectorInstruction): TokenEscrowTerms => ({
  programId,
  tokenProgram: TOKEN_PROGRAM_ID,
  payer,
  payee,
  mint: named(vector, 'mint'),
  source: key('7porTR32j7zt69GG4AwoPQx3f3FL2RLpSDKGtPXWTeaQ'),
  recipient: key('7tj9biW3KRJ7EEWmVUGigHiouCTXhV2dzcyvwma7Cyu7'),
  amount: 1_000_000n,
  nonce: new Uint8Array(16).fill(nonceByte),
  metered: true,
});

/** The `opened_slot` of one of the fixture's rating accounts, as a party reads it before signing. */
const openedSlotOf = (name: string) => decodeRatingAccount(hex(account(name).data_hex)).openedSlot;

/** The `opened_slot` the fixture's attestations store. */
const attestedSlotOf = (name: string) => decodeAttestationAccount(hex(account(name).data_hex)).openedSlot;
/**
 * The `opened_slot` named by a fixture exit whose rating has no account vector:
 * the last eight bytes of its data (the README fixes where they go; these
 * jobs' slots are not otherwise in the fixture).
 */
const namedSlotOf = (name: string) => hex(instruction(name).data_hex).readBigUInt64LE(hex(instruction(name).data_hex).length - 8);

/** Every instruction in the fixture, built by this package from addresses and values only. */
const built: Record<string, () => TransactionInstruction> = {
  open_rating: () => buildOpenRatingInstruction({ programId, escrow: named(instruction('open_rating'), 'escrow'), payer, judge: key(bs58FromHex(instruction('open_rating').data_hex.slice(16))) }),
  accept_rating: () => buildAcceptRatingInstruction({ programId, escrow: named(instruction('release_escrow'), 'escrow'), specialist: payee, openedSlot: openedSlotOf('rating_awaiting_settlement_accepted') }),
  commit_rating: () => buildCommitRatingInstruction({ programId, escrow: named(instruction('open_rating'), 'escrow'), signer: payer, commitment: hex(vectors.commitment.sha256_hex), openedSlot: openedSlotOf('rating_open') }),
  reveal_rating: () => buildRevealRatingInstruction({ programId, escrow: named(instruction('open_rating'), 'escrow'), signer: payer, consumer: payer, specialist: payee, score: vectors.commitment.score, salt }),
  expire_rating: () => buildExpireRatingInstruction({ programId, escrow: named(instruction('release_escrow'), 'escrow'), caller: judge, consumer: payer, specialist: payee }),
  close_rating: () => buildCloseRatingInstruction({ programId, escrow: named(instruction('open_rating'), 'escrow'), consumer: payer }),
  attest_quality: () => buildAttestQualityInstruction({ programId, escrow: named(instruction('open_rating'), 'escrow'), judge, scores: [9, 8, 10, 1, 7], openedSlot: openedSlotOf('rating_open') }),
  confirm_attestation: () => buildConfirmAttestationInstruction({ programId, escrow: named(instruction('open_rating'), 'escrow'), judge, consumer: payer, openedSlot: attestedSlotOf('attestation_pending') }),
  dispute_attestation: () => buildDisputeAttestationInstruction({ programId, escrow: named(instruction('release_escrow'), 'escrow'), judge, consumer: payer, openedSlot: openedSlotOf('rating_awaiting_settlement_accepted') }),
  close_attestation: () => buildCloseAttestationInstruction({ programId, escrow: named(instruction('release_escrow'), 'escrow'), judge }),
  settle_escrow: () => buildSettleSolEscrowInstruction({ programId, escrow: named(instruction('settle_escrow'), 'escrow'), payer, payee, actual: 600_000n, rated: true, openedSlot: openedSlotOf('rating_open') }),
  release_escrow: () => buildReleaseSolEscrowInstruction({ programId, escrow: named(instruction('release_escrow'), 'escrow'), payer, payee, rated: true, openedSlot: openedSlotOf('rating_awaiting_settlement_accepted') }),
  cancel_escrow: () => buildCancelSolEscrowInstruction({ programId, escrow: named(instruction('cancel_escrow'), 'escrow'), payer, authority: payee, rated: true, openedSlot: namedSlotOf('cancel_escrow') }),
  release_token_escrow: () => buildTokenEscrowExitInstruction(tokenTerms(4, instruction('release_token_escrow')), { rated: true, openedSlot: namedSlotOf('release_token_escrow') }),
  settle_token_escrow: () => buildTokenEscrowExitInstruction(tokenTerms(5, instruction('settle_token_escrow')), { rated: true, openedSlot: namedSlotOf('settle_token_escrow'), authority: payee, options: { actual: 250_000n } }),
  cancel_token_escrow: () => buildTokenEscrowExitInstruction(tokenTerms(6, instruction('cancel_token_escrow')), { rated: true, openedSlot: namedSlotOf('cancel_token_escrow'), refund: true, authority: payee }),
};

function bs58FromHex(value: string): string {
  return new PublicKey(hex(value)).toBase58();
}

// The delivery instructions are held to the same fixture by tests/delivery.test.ts.
const ratingVectors = vectors.instructions.filter((entry) => !entry.name.endsWith('_delivery'));

describe('rating and attestation interface vectors', () => {
  it('has a builder for every instruction in the fixture, and the fixture covers all ten instructions and six exits', () => {
    expect(ratingVectors.map((entry) => entry.name).sort()).toEqual(Object.keys(built).sort());
  });

  it.each(ratingVectors.map((entry) => entry.name))('%s matches the fixture: data bytes and ordered account metas', (name) => {
    expect(shape(built[name]())).toEqual(expected(instruction(name)));
  });

  it.each(vectors.instructions)('$name starts with its selector, the first 8 bytes of sha256("global:<name>")', (vector) => {
    expect(vector.data_hex.startsWith(vector.selector_hex)).toBe(true);
    expect(createHash('sha256').update(`global:${vector.name}`).digest().subarray(0, 8).toString('hex')).toBe(vector.selector_hex);
  });

  it.each(Object.entries(RATING_DISCRIMINATORS))('%s is the first 8 bytes of its sha256', (name, bytes) => {
    expect([...createHash('sha256').update(name).digest().subarray(0, 8)]).toEqual(bytes);
  });

  it('derives the rating, attestation and agent addresses the fixture uses', () => {
    const open = instruction('open_rating');
    const escrow = named(open, 'escrow');
    expect(ratingPda(escrow, programId).toBase58()).toBe(named(open, 'rating').toBase58());
    expect(attestationPda(escrow, programId).toBase58()).toBe(named(instruction('attest_quality'), 'attestation').toBase58());
    expect(agentPda(judge, programId).toBase58()).toBe(named(instruction('attest_quality'), 'judge_agent').toBase58());
    expect(agentPda(payee, programId).toBase58()).toBe(named(instruction('reveal_rating'), 'specialist_agent').toBase58());
    expect(agentPda(payer, programId).toBase58()).toBe(named(instruction('reveal_rating'), 'consumer_agent').toBase58());
    for (const entry of vectors.accounts) {
      const data = hex(entry.data_hex);
      if (entry.name.startsWith('rating_')) expect(ratingPda(decodeRatingAccount(data).escrow, programId).toBase58()).toBe(entry.address);
      if (entry.name.startsWith('attestation_')) expect(attestationPda(decodeAttestationAccount(data).escrow, programId).toBase58()).toBe(entry.address);
    }
    const sol = account('sol_escrow_rated_metered');
    expect(solEscrowPda(payer, new Uint8Array(16).fill(7), programId).toBase58()).toBe(sol.address);
  });
});

describe('commitment hash', () => {
  const { commitment } = vectors;

  // The rating at the fixture's commitment address, as the parties read it: its opened slot is hashed in.
  const slot = decodeRatingAccount(hex(vectors.accounts.find((entry) => entry.address === commitment.rating && entry.name === 'rating_open')!.data_hex)).openedSlot;

  it('is sha256(rating ‖ opened_slot u64 LE ‖ signer ‖ score ‖ salt), as the fixture gives it', () => {
    expect(slot).toBe(1000n);
    const slotBytes = Buffer.alloc(8);
    slotBytes.writeBigUInt64LE(slot);
    const preimage = Buffer.concat([key(commitment.rating).toBuffer(), slotBytes, key(commitment.signer).toBuffer(), Buffer.from([commitment.score]), salt]);
    expect(createHash('sha256').update(preimage).digest('hex')).toBe(commitment.sha256_hex);
    expect(Buffer.from(ratingCommitment(key(commitment.rating), slot, key(commitment.signer), commitment.score, salt)).toString('hex')).toBe(commitment.sha256_hex);
    // And it is what the fixture's commit_rating carries, followed by the same opened slot.
    expect(instruction('commit_rating').data_hex.slice(16)).toBe(commitment.sha256_hex + slotBytes.toString('hex'));
  });

  it('changes with the rating, the opened slot, the signer, the score and the salt', () => {
    const base = Buffer.from(ratingCommitment(key(commitment.rating), slot, payer, 9, salt)).toString('hex');
    const other = (value: Uint8Array) => Buffer.from(value).toString('hex');
    expect(other(ratingCommitment(key(commitment.rating), slot, payee, 9, salt))).not.toBe(base);
    expect(other(ratingCommitment(payee, slot, payer, 9, salt))).not.toBe(base);
    // The same address, a later job: the commitment of the earlier one does not carry over.
    expect(other(ratingCommitment(key(commitment.rating), slot + 1n, payer, 9, salt))).not.toBe(base);
    expect(other(ratingCommitment(key(commitment.rating), slot, payer, 8, salt))).not.toBe(base);
    expect(other(ratingCommitment(key(commitment.rating), slot, payer, 9, new Uint8Array(32)))).not.toBe(base);
  });

  it('refuses a score outside 1 to 10, a salt that is not 32 bytes and an opened slot that is not a u64 bigint', () => {
    for (const score of [0, 11, 1.5, -1, Number.NaN]) expect(() => ratingCommitment(payer, slot, payer, score, salt)).toThrow('1 to 10');
    expect(() => ratingCommitment(payer, slot, payer, 5, new Uint8Array(31))).toThrow('32 bytes');
    for (const bad of [undefined, 1000, -1n, 1n << 64n]) expect(() => ratingCommitment(payer, bad as unknown as bigint, payer, 5, salt)).toThrow('openedSlot');
  });

  it('uses a sha256 that agrees with Node for every padding length', () => {
    for (let length = 0; length <= 200; length++) {
      const message = Buffer.from(Array.from({ length }, (_, i) => (i * 31 + length) & 0xff));
      expect(Buffer.from(sha256(message)).toString('hex')).toBe(createHash('sha256').update(message).digest('hex'));
    }
  });
});

describe('rating account decoder', () => {
  const decoded = (name: string) => decodeRatingAccount(hex(account(name).data_hex));
  const escrowA = named(instruction('open_rating'), 'escrow');
  const escrowB = named(instruction('release_escrow'), 'escrow');

  it('names the states as the fixture does, in order', () => {
    expect([...RATING_STATES]).toEqual(vectors.rating_states);
  });

  it('has an example of every state', () => {
    const states = vectors.accounts.filter((entry) => entry.name.startsWith('rating_')).map((entry) => decodeRatingAccount(hex(entry.data_hex)).state);
    expect(new Set(states)).toEqual(new Set(RATING_STATES));
    for (const entry of vectors.accounts.filter((each) => each.name.startsWith('rating_'))) expect(entry.length).toBe(RATING_ACCOUNT_LEN);
  });

  it('reads a rating awaiting settlement', () => {
    expect(decoded('rating_awaiting_settlement')).toEqual({
      escrow: escrowA, consumer: payer, specialist: payee, judge, mint: undefined,
      consumerCommitment: undefined, specialistCommitment: undefined,
      paid: 0n, openedSlot: 1000n, settledSlot: 0n, committedSlot: 0n,
      state: 'awaiting_settlement', consumerScore: undefined, specialistScore: undefined, accepted: false, attested: false, bump: 255,
    });
  });

  it('reads a rating the specialist accepted before settlement', () => {
    expect(decoded('rating_awaiting_settlement_accepted')).toMatchObject({ escrow: escrowB, state: 'awaiting_settlement', accepted: true, attested: false, openedSlot: 1040n, bump: 253 });
  });

  it('reads an open rating: paid amount and slot of the paid exit', () => {
    expect(decoded('rating_open')).toMatchObject({ state: 'open', paid: 600_000n, openedSlot: 1000n, settledSlot: 1010n, committedSlot: 0n, consumerCommitment: undefined, specialistCommitment: undefined });
  });

  it('reads a rating both have committed to', () => {
    const rating = decoded('rating_both_committed');
    expect(rating).toMatchObject({ state: 'both_committed', settledSlot: 1010n, committedSlot: 1030n, consumerScore: undefined, specialistScore: undefined });
    expect(Buffer.from(rating.consumerCommitment!).toString('hex')).toBe(vectors.commitment.sha256_hex);
    expect(Buffer.from(rating.consumerCommitment!)).toEqual(Buffer.from(ratingCommitment(key(account('rating_both_committed').address), rating.openedSlot, payer, 9, salt)));
    expect(rating.specialistCommitment).toHaveLength(32);
    // The specialist scored 4 with a salt of 0x51 bytes (equivalence/tests/interface_vectors.rs).
    expect(Buffer.from(rating.specialistCommitment!)).toEqual(Buffer.from(ratingCommitment(key(account('rating_both_committed').address), rating.openedSlot, payee, 4, new Uint8Array(32).fill(0x51))));
  });

  it('reads a revealed rating: both scores, attested', () => {
    expect(decoded('rating_revealed')).toMatchObject({ state: 'revealed', consumerScore: 9, specialistScore: 4, accepted: false, attested: true, paid: 600_000n });
  });

  it('reads an expired rating', () => {
    expect(decoded('rating_expired')).toMatchObject({ escrow: escrowB, state: 'expired', paid: 1_000_000n, settledSlot: 1041n, accepted: true, attested: true, consumerScore: undefined, specialistScore: undefined });
  });

  it('reads the judge as undefined when none was named and the mint once a token job is paid', () => {
    const data = hex(account('rating_open').data_hex);
    data.fill(0, 104, 136);
    payee.toBuffer().copy(data, 136);
    expect(decodeRatingAccount(data)).toMatchObject({ judge: undefined, mint: payee });
  });

  it('refuses bytes that are not a rating account', () => {
    const data = hex(account('rating_open').data_hex);
    expect(() => decodeRatingAccount(data.subarray(0, 269))).toThrow('invalid rating account layout');
    expect(() => decodeRatingAccount(hex(account('attestation_pending').data_hex))).toThrow('invalid rating account layout');
    // The archived Anchor program's record has the same discriminator and is 175 bytes.
    expect(() => decodeRatingAccount(data.subarray(0, 175))).toThrow('invalid rating account layout');
    const unknownState = Buffer.from(data);
    unknownState[264] = 5;
    expect(() => decodeRatingAccount(unknownState)).toThrow('unknown rating state');
  });

  it('reads from a view into a larger buffer', () => {
    const data = hex(account('rating_revealed').data_hex);
    const padded = Buffer.concat([Buffer.alloc(7, 0xee), data]);
    expect(decodeRatingAccount(new Uint8Array(padded.buffer, padded.byteOffset + 7, data.length))).toEqual(decodeRatingAccount(data));
  });
});

describe('attestation account decoder', () => {
  it('reads a pending and a confirmed attestation', () => {
    const pending = decodeAttestationAccount(hex(account('attestation_pending').data_hex));
    expect(pending).toEqual({ escrow: named(instruction('open_rating'), 'escrow'), judge, consumer: payer, scores: [9, 8, 10, 1, 7], resolution: 'pending', createdSlot: 1040n, bump: 249, openedSlot: 1000n });
    // The attestation names the job of the rating it was made for.
    expect(pending.openedSlot).toBe(openedSlotOf('rating_open'));
    expect(decodeAttestationAccount(hex(account('attestation_confirmed').data_hex))).toEqual({ ...pending, resolution: 'confirmed' });
    expect(account('attestation_pending').length).toBe(ATTESTATION_ACCOUNT_LEN);
  });

  it('reads a disputed one and refuses anything else', () => {
    const data = hex(account('attestation_pending').data_hex);
    data[109] = 2;
    expect(decodeAttestationAccount(data).resolution).toBe('disputed');
    data[109] = 3;
    expect(() => decodeAttestationAccount(data)).toThrow('unknown attestation resolution');
    expect(() => decodeAttestationAccount(data.subarray(0, 105))).toThrow('invalid attestation account layout');
    expect(() => decodeAttestationAccount(hex(account('rating_open').data_hex))).toThrow('invalid attestation account layout');
  });
});

describe('escrow flag byte', () => {
  const sol = hex(account('sol_escrow_rated_metered').data_hex);
  const token = hex(account('token_escrow_rated').data_hex);

  it('uses the fixture bits and offsets', () => {
    expect({ metered: ESCROW_FLAG_METERED, rated: ESCROW_FLAG_RATED, delivery_checked: ESCROW_FLAG_DELIVERY, sol_escrow_offset: SOL_ESCROW_FLAG_OFFSET, token_escrow_offset: TOKEN_ESCROW_FLAG_OFFSET }).toEqual(vectors.escrow_flag_byte);
    expect([0, 1, 2, 3].map(escrowFlags)).toEqual([
      { metered: false, rated: false }, { metered: true, rated: false }, { metered: false, rated: true }, { metered: true, rated: true },
    ].map((flags) => ({ ...flags, deliveryChecked: false })));
    expect(escrowFlags(7)).toEqual({ metered: true, rated: true, deliveryChecked: true });
  });

  it('reads a rated metered SOL escrow, which stores 3', () => {
    expect(sol[SOL_ESCROW_FLAG_OFFSET]).toBe(3);
    expect(escrowAccountFlags(sol)).toEqual({ kind: 'sol', metered: true, rated: true, deliveryChecked: false });
    expect(isRatedEscrow(sol)).toBe(true);
  });

  it('reads a rated fixed-price token escrow, and the token decoder agrees', () => {
    expect(token[TOKEN_ESCROW_FLAG_OFFSET]).toBe(2);
    expect(escrowAccountFlags(token)).toEqual({ kind: 'token', metered: false, rated: true, deliveryChecked: false });
    expect(decodeTokenEscrowAccount(token)).toMatchObject({ metered: false, rated: true, payer, payee, amount: 1_000_000n });
  });

  it.each([[0, false, false], [1, true, false], [2, false, true], [3, true, true]])('token escrow flag byte %d: metered %s, rated %s', (byte, metered, rated) => {
    const data = Buffer.from(token);
    data[TOKEN_ESCROW_FLAG_OFFSET] = byte;
    expect(decodeTokenEscrowAccount(data)).toMatchObject({ metered, rated });
    expect(escrowAccountFlags(data)).toMatchObject({ metered, rated });
    expect(isRatedEscrow(data)).toBe(rated);
    const solData = Buffer.from(sol);
    solData[SOL_ESCROW_FLAG_OFFSET] = byte;
    expect(escrowAccountFlags(solData)).toEqual({ kind: 'sol', metered, rated, deliveryChecked: false });
  });

  it('reads the flags of an escrow written before windows were stored, and of a SOL escrow with a session key', () => {
    // Earlier SOL layout: 16 bytes shorter, the windows left out after created_slot.
    const legacySol = Buffer.concat([sol.subarray(0, 113), sol.subarray(129)]);
    expect(legacySol).toHaveLength(149);
    expect(escrowAccountFlags(legacySol)).toEqual({ kind: 'sol', metered: true, rated: true, deliveryChecked: false });
    const legacyToken = token.subarray(0, 203);
    expect(escrowAccountFlags(legacyToken)).toEqual({ kind: 'token', metered: false, rated: true, deliveryChecked: false });
    // With a session key (PER builds only) the flag byte sits 32 bytes later.
    const withSession = Buffer.from(sol);
    withSession[130] = 1;
    withSession.fill(9, 131, 163);
    withSession[163] = 255;
    withSession[164] = 1;
    expect(escrowAccountFlags(withSession)).toEqual({ kind: 'sol', metered: true, rated: false, deliveryChecked: false });
  });

  it('answers undefined, and not rated, for bytes that are not an escrow', () => {
    expect(escrowAccountFlags(hex(account('rating_open').data_hex))).toBeUndefined();
    expect(escrowAccountFlags(sol.subarray(0, 150))).toBeUndefined();
    expect(escrowAccountFlags(new Uint8Array(0))).toBeUndefined();
    expect(isRatedEscrow(hex(account('rating_open').data_hex))).toBe(false);
  });
});

describe('exits of a rated and an unrated escrow', () => {
  const terms = tokenTerms(5, instruction('settle_token_escrow'));
  const bytes = (ix: TransactionInstruction, signerKey: PublicKey) => {
    const tx = new Transaction({ feePayer: signerKey, recentBlockhash: '11111111111111111111111111111111' }).add(ix);
    return tx.serializeMessage().toString('hex');
  };

  it('names an unrated token exit by its lock slot, with the accounts buildSettleTokenEscrowInstruction passes', () => {
    const cases: [boolean, PublicKey, { actual?: bigint }][] = [[false, payer, {}], [false, payee, { actual: 250_000n }], [true, payee, {}], [true, payer, {}]];
    for (const [refund, authority, options] of cases) {
      const today = buildSettleTokenEscrowInstruction(terms, refund, authority, options);
      const unrated = buildTokenEscrowExitInstruction(terms, { rated: false, createdSlot: 0x0102030405060708n, refund, authority, options });
      expect(unrated.data).toEqual(Buffer.concat([today.data, Buffer.from('0807060504030201', 'hex')]));
      expect(shape(unrated).accounts).toEqual(shape(today).accounts);
      expect(bytes(unrated, authority)).not.toBe(bytes(today, authority));
      const rated = buildTokenEscrowExitInstruction(terms, { rated: true, openedSlot: 0x0102030405060708n, refund, authority, options });
      expect(rated.data).toEqual(Buffer.concat([today.data, Buffer.from('0807060504030201', 'hex')]));
      expect(shape(rated).accounts).toEqual([...shape(today).accounts, { address: instruction('settle_token_escrow').accounts[9].address, signer: false, writable: true }]);
    }
  });

  it('leaves the instruction it is given unchanged, and adds no account when the escrow is not rated', () => {
    const today = buildSettleTokenEscrowInstruction(terms, false, payee, { actual: 1n });
    const before = shape(today);
    const unrated = withRatingAccount(today, false, 5n);
    expect(shape(today)).toEqual(before);
    expect(unrated.keys).toEqual(today.keys);
    expect(unrated.data.readBigUInt64LE(16)).toBe(5n);
  });

  it('builds an unrated SOL settle, release and cancel with the usual accounts, naming the escrow by its lock slot', () => {
    // The fixture's rated exit without the rating account; its opened slot is the escrow's lock slot, so the data is the same.
    const slotOf = (vector: VectorInstruction) => hex(vector.data_hex).readBigUInt64LE(hex(vector.data_hex).length - 8);
    const escrow = named(instruction('settle_escrow'), 'escrow');
    const settle = instruction('settle_escrow');
    const unratedSettle = buildSettleSolEscrowInstruction({ programId, escrow, payer, payee, actual: 600_000n, createdSlot: slotOf(settle) });
    expect(shape(unratedSettle)).toEqual({ ...expectedOf(settle), accounts: expectedOf(settle).accounts.slice(0, 5) });
    expect(shape(buildSettleSolEscrowInstruction({ programId, escrow, payer, payee, actual: 600_000n, rated: false, createdSlot: slotOf(settle) }))).toEqual(shape(unratedSettle));

    const release = instruction('release_escrow');
    expect(shape(buildReleaseSolEscrowInstruction({ programId, escrow: named(release, 'escrow'), payer, payee, createdSlot: slotOf(release) }))).toEqual({ ...expectedOf(release), accounts: expectedOf(release).accounts.slice(0, 5) });

    const cancel = instruction('cancel_escrow');
    expect(shape(buildCancelSolEscrowInstruction({ programId, escrow: named(cancel, 'escrow'), payer, authority: payee, createdSlot: slotOf(cancel) }))).toEqual({ ...expectedOf(cancel), accounts: expectedOf(cancel).accounts.slice(0, 4) });
  });

  it('marks who signs a SOL release: the payer, or the payee claiming', () => {
    const escrow = named(instruction('release_escrow'), 'escrow');
    const signers = (signer?: 'payer' | 'payee') => buildReleaseSolEscrowInstruction({ programId, escrow, payer, payee, signer, createdSlot: 1n }).keys.slice(1, 3).map((meta) => meta.isSigner);
    expect(signers()).toEqual([true, false]);
    expect(signers('payer')).toEqual([true, false]);
    expect(signers('payee')).toEqual([false, true]);
  });

  // The flag byte as stored: 0 neither, 1 metered, 2 rated, 3 metered and rated.
  describe.each([[0, false], [1, false], [2, true], [3, true]] as const)('escrow flag byte %i', (flag, rated) => {
    const tokenData = hex(account('token_escrow_rated').data_hex);
    tokenData[TOKEN_ESCROW_FLAG_OFFSET] = flag;
    const solData = hex(account('sol_escrow_rated_metered').data_hex);
    solData[SOL_ESCROW_FLAG_OFFSET] = flag;
    const solEscrow = key(account('sol_escrow_rated_metered').address);
    const solRating = ratingPda(solEscrow, programId);
    const tokenTermsOf = tokenTerms(4, instruction('release_token_escrow'));
    const tokenRating = ratingPda(key(account('token_escrow_rated').address), programId);
    const last = (ix: TransactionInstruction) => ix.keys[ix.keys.length - 1];

    it(`decodes rated ${rated} from both escrow kinds`, () => {
      expect(decodeTokenEscrowAccount(tokenData)).toMatchObject({ rated, metered: (flag & 1) === 1 });
      expect(escrowAccountFlags(solData)).toEqual({ kind: 'sol', rated, metered: (flag & 1) === 1, deliveryChecked: false });
    });

    it.each([
      ['release_escrow (payer)', 5, () => buildReleaseSolEscrowInstruction({ programId, escrow: solEscrow, payer, payee, rated: isRatedEscrow(solData), openedSlot: 1000n })],
      ['release_escrow (payee claim)', 5, () => buildReleaseSolEscrowInstruction({ programId, escrow: solEscrow, payer, payee, signer: 'payee', rated: isRatedEscrow(solData), openedSlot: 1000n })],
      ['settle_escrow', 5, () => buildSettleSolEscrowInstruction({ programId, escrow: solEscrow, payer, payee, actual: 1n, rated: isRatedEscrow(solData), openedSlot: 1000n })],
      ['cancel_escrow (decline)', 4, () => buildCancelSolEscrowInstruction({ programId, escrow: solEscrow, payer, authority: payee, rated: isRatedEscrow(solData), openedSlot: 1000n })],
      ['cancel_escrow (refund)', 4, () => buildCancelSolEscrowInstruction({ programId, escrow: solEscrow, payer, authority: payer, rated: isRatedEscrow(solData), openedSlot: 1000n })],
    ] as const)('%s: the rating account is passed exactly when the escrow is rated', (_name, usual, build) => {
      const ix = build();
      expect(ix.keys).toHaveLength(usual + (rated ? 1 : 0));
      if (rated) expect(last(ix)).toEqual({ pubkey: solRating, isSigner: false, isWritable: true });
      else expect(ix.keys.some((meta) => meta.pubkey.equals(solRating))).toBe(false);
      // The lock slot (a rated job's opened slot) is appended either way.
      const own = _name.startsWith('settle') ? 16 : 8;
      expect(ix.data).toHaveLength(own + 8);
      expect(ix.data.readBigUInt64LE(own)).toBe(1000n);
    });

    it.each([
      ['release_token_escrow (payer)', 9, { authority: payer }],
      ['release_token_escrow (payee claim)', 9, { authority: payee }],
      ['settle_token_escrow', 9, { authority: payee, options: { actual: 1n } }],
      ['cancel_token_escrow (decline)', 7, { authority: payee, refund: true }],
      ['cancel_token_escrow (refund)', 7, { authority: payer, refund: true }],
    ] as const)('%s: the rating account is passed exactly when the escrow is rated', (_name, usual, exit) => {
      const ix = buildTokenEscrowExitInstruction(tokenTermsOf, { ...exit, rated: decodeTokenEscrowAccount(tokenData).rated, openedSlot: 1000n });
      expect(ix.keys).toHaveLength(usual + (rated ? 1 : 0));
      const own = _name.startsWith('settle') ? 16 : 8;
      expect(ix.data).toHaveLength(own + 8);
      if (rated) expect(last(ix)).toEqual({ pubkey: tokenRating, isSigner: false, isWritable: true });
      else expect(ix.keys.some((meta) => meta.pubkey.equals(tokenRating))).toBe(false);
    });
  });

  it('puts the rating account right after the usual accounts, before any extra ones', () => {
    const extra = key('SysvarC1ock11111111111111111111111111111111');
    const today = buildSettleTokenEscrowInstruction(terms, false, payee, { actual: 1n });
    today.keys.push({ pubkey: extra, isSigner: false, isWritable: false });
    const rated = withRatingAccount(today, true, 5n);
    expect(rated.keys).toHaveLength(11);
    expect(rated.keys[9].pubkey.toBase58()).toBe(instruction('settle_token_escrow').accounts[9].address);
    expect(rated.keys[10].pubkey).toEqual(extra);
    expect(today.keys).toHaveLength(10);
  });

  it('refuses an instruction that is not an exit, or that lacks its usual accounts', () => {
    expect(() => withRatingAccount(buildLockTokenEscrowInstruction(terms), true, 5n)).toThrow('not an escrow exit instruction');
    expect(() => withRatingAccount(built.commit_rating(), true, 5n)).toThrow('not an escrow exit instruction');
    const short = buildSettleTokenEscrowInstruction(terms, false, payee, { actual: 1n });
    short.keys.pop();
    expect(() => withRatingAccount(short, true, 5n)).toThrow('missing');
  });

  it('requires the lock slot for every exit, rated or not, and refuses an exit that already carries one', () => {
    const settle = buildSettleTokenEscrowInstruction(terms, false, payee, { actual: 1n });
    for (const rated of [false, true]) {
      expect(() => withRatingAccount(settle, rated, undefined)).toThrow('createdSlot');
      expect(() => withRatingAccount(settle, rated, -1n)).toThrow('u64');
      expect(() => withRatingAccount(withRatingAccount(settle, rated, 5n), rated, 5n)).toThrow('more data');
      const escrow = named(instruction('settle_escrow'), 'escrow');
      expect(() => buildSettleSolEscrowInstruction({ programId, escrow, payer, payee, actual: 1n, rated })).toThrow('createdSlot');
      expect(() => buildReleaseSolEscrowInstruction({ programId, escrow, payer, payee, rated })).toThrow('createdSlot');
      expect(() => buildCancelSolEscrowInstruction({ programId, escrow, payer, authority: payee, rated })).toThrow('createdSlot');
      expect(() => buildTokenEscrowExitInstruction(terms, { rated, refund: true, authority: payee })).toThrow('createdSlot');
    }
    // A rated job's opened slot is its escrow's lock slot, so either name builds the same exit.
    expect(shape(buildTokenEscrowExitInstruction(terms, { rated: false, openedSlot: 5n, authority: payee, options: { actual: 1n } }))).toEqual(shape(buildTokenEscrowExitInstruction(terms, { rated: false, createdSlot: 5n, authority: payee, options: { actual: 1n } })));
  });
});

describe('instruction input checks', () => {
  const escrow = named(instruction('open_rating'), 'escrow');

  it('writes 32 zero bytes when no judge is named', () => {
    const ix = buildOpenRatingInstruction({ programId, escrow, payer });
    expect(ix.data.subarray(8)).toEqual(Buffer.alloc(32));
    expect(ix.data).toHaveLength(40);
  });

  it('refuses a judge that is the payer', () => {
    expect(() => buildOpenRatingInstruction({ programId, escrow, payer, judge: payer })).toThrow('judge');
  });

  it('refuses an empty or mis-sized commitment, a bad score and a bad salt', () => {
    expect(() => buildCommitRatingInstruction({ programId, escrow, signer: payer, commitment: new Uint8Array(32), openedSlot: 1000n })).toThrow('all zero');
    expect(() => buildCommitRatingInstruction({ programId, escrow, signer: payer, commitment: new Uint8Array(31), openedSlot: 1000n })).toThrow('32 bytes');
    expect(() => buildRevealRatingInstruction({ programId, escrow, signer: payer, consumer: payer, specialist: payee, score: 0, salt })).toThrow('1 to 10');
    expect(() => buildRevealRatingInstruction({ programId, escrow, signer: payer, consumer: payer, specialist: payee, score: 5, salt: salt.subarray(1) })).toThrow('32 bytes');
    expect(() => buildAttestQualityInstruction({ programId, escrow, judge, scores: [1, 2, 3, 4, 11], openedSlot: 1000n })).toThrow('1 to 10');
    expect(() => buildAttestQualityInstruction({ programId, escrow, judge, scores: [1, 2, 3, 4] as unknown as [number, number, number, number, number], openedSlot: 1000n })).toThrow('five scores');
    expect(() => buildSettleSolEscrowInstruction({ programId, escrow, payer, payee, actual: 0n })).toThrow('positive u64');
  });

  it('requires the opened slot, as a u64 bigint, in accept_rating, commit_rating, attest_quality and the decisions on an attestation', () => {
    const commitment = hex(vectors.commitment.sha256_hex);
    for (const bad of [undefined, 1000, -1n, 1n << 64n]) {
      const openedSlot = bad as unknown as bigint;
      expect(() => buildAcceptRatingInstruction({ programId, escrow, specialist: payee, openedSlot })).toThrow('openedSlot');
      expect(() => buildCommitRatingInstruction({ programId, escrow, signer: payer, commitment, openedSlot })).toThrow('openedSlot');
      expect(() => buildAttestQualityInstruction({ programId, escrow, judge, scores: [1, 2, 3, 4, 5], openedSlot })).toThrow('openedSlot');
      expect(() => buildConfirmAttestationInstruction({ programId, escrow, judge, consumer: payer, openedSlot })).toThrow('openedSlot');
      expect(() => buildDisputeAttestationInstruction({ programId, escrow, judge, consumer: payer, openedSlot })).toThrow('openedSlot');
    }
    expect(buildCommitRatingInstruction({ programId, escrow, signer: payer, commitment, openedSlot: 9n }).data).toHaveLength(48);
    expect(buildConfirmAttestationInstruction({ programId, escrow, judge, consumer: payer, openedSlot: 9n }).data).toHaveLength(16);
    // The slot is the last eight bytes of each.
    expect(buildAcceptRatingInstruction({ programId, escrow, specialist: payee, openedSlot: 0xfffffffffffffffen }).data.subarray(8).toString('hex')).toBe('feffffffffffffff');
    expect(buildAttestQualityInstruction({ programId, escrow, judge, scores: [1, 2, 3, 4, 5], openedSlot: 7n }).data).toHaveLength(21);
  });
});

describe('buyer helper: lock and opt in to rating in one transaction', () => {
  it('builds a token lock followed by open_rating for the same escrow', () => {
    const terms = tokenTerms(4, instruction('release_token_escrow'));
    const plan = buildRatedTokenEscrowLock(terms, { judge });
    expect(plan.instructions).toHaveLength(2);
    expect(shape(plan.instructions[0])).toEqual(shape(buildLockTokenEscrowInstruction(terms)));
    expect(shape(plan.instructions[1])).toEqual(shape(buildOpenRatingInstruction({ programId, escrow: plan.escrow, payer, judge })));
    expect(plan.escrow.toBase58()).toBe(account('token_escrow_rated').address);
    expect(plan.rating.toBase58()).toBe(instruction('release_token_escrow').accounts[9].address);
    expect(plan.instructions[1].keys[1].pubkey).toEqual(plan.instructions[0].keys[0].pubkey);
    // One transaction, signed by the payer alone, with no exit of the escrow in it (6050).
    const tx = new Transaction({ feePayer: payer, recentBlockhash: '11111111111111111111111111111111' }).add(...plan.instructions);
    expect(tx.compileMessage().header.numRequiredSignatures).toBe(1);
    expect(plan.instructions.map((ix) => ix.data.subarray(0, 8).toString('hex'))).toEqual([TOKEN_ESCROW_LOCK_SELECTOR, instruction('open_rating').selector_hex]);
  });

  it('builds a SOL metered lock followed by open_rating, at the fixture addresses', () => {
    const plan = buildRatedSolEscrowLock({ programId, payer, payee, amount: 1_000_000n, nonce: new Uint8Array(16).fill(7), metered: true }, { judge });
    expect(plan.escrow.toBase58()).toBe(account('sol_escrow_rated_metered').address);
    expect(shape(plan.instructions[1])).toEqual(expected(instruction('open_rating')));
    const lock = plan.instructions[0];
    expect(lock.data.toString('hex')).toBe(
      Buffer.concat([createHash('sha256').update('global:lock_metered_escrow').digest().subarray(0, 8), hex('40420f0000000000'), Buffer.alloc(16, 7), hex('dc05000000000000'), hex('9411000000000000')]).toString('hex'),
    );
    expect(shape(lock).accounts).toEqual([
      { address: plan.escrow.toBase58(), signer: false, writable: true },
      { address: payer.toBase58(), signer: true, writable: true },
      { address: payee.toBase58(), signer: false, writable: false },
      { address: SystemProgram.programId.toBase58(), signer: false, writable: false },
    ]);
    // The account the program then writes: payer, payee, amount, nonce and windows as locked.
    const stored = hex(account('sol_escrow_rated_metered').data_hex);
    expect(stored.subarray(8, 40)).toEqual(payer.toBuffer());
    expect(stored.subarray(40, 72)).toEqual(payee.toBuffer());
    expect(stored.subarray(72, 96)).toEqual(lock.data.subarray(8, 32));
    expect(stored.subarray(113, 129)).toEqual(lock.data.subarray(32, 48));
  });

  it('uses lock_escrow for a fixed-price SOL lock and refuses a judge that is the payee', () => {
    const terms = { programId, payer, payee, amount: 5n, nonce: new Uint8Array(16).fill(1) };
    expect(buildLockSolEscrowInstruction(terms).data.subarray(0, 8)).toEqual(createHash('sha256').update('global:lock_escrow').digest().subarray(0, 8));
    expect(() => buildRatedSolEscrowLock(terms, { judge: payee })).toThrow('judge');
    expect(() => buildRatedTokenEscrowLock(tokenTerms(4, instruction('release_token_escrow')), { judge: payee })).toThrow('judge');
    expect(() => buildLockSolEscrowInstruction({ ...terms, nonce: new Uint8Array(15) })).toThrow('16 bytes');
    expect(() => buildLockSolEscrowInstruction({ ...terms, claimWindowSlots: 10n, cancelWindowSlots: 5n })).toThrow('claim window');
  });
});

describe('buyer: releasing a rated fixed-price job', () => {
  const rating = (name: string) => decodeRatingAccount(hex(account(name).data_hex));

  it('a payer release opens the rating only once the seller has accepted, and only while the escrow is unpaid', () => {
    expect(payerReleaseOpensRating(rating('rating_awaiting_settlement'))).toBe(false);
    expect(payerReleaseOpensRating(rating('rating_awaiting_settlement_accepted'))).toBe(true);
    for (const name of ['rating_open', 'rating_both_committed', 'rating_revealed', 'rating_expired']) expect(payerReleaseOpensRating(rating(name))).toBe(false);
  });

  it('reads the rating account at confirmed, and answers undefined when there is none', async () => {
    const escrow = named(instruction('release_escrow'), 'escrow');
    const calls: unknown[][] = [];
    const connection = (result: { owner: PublicKey; data: Uint8Array } | null) => ({ getAccountInfo: async (...args: unknown[]) => { calls.push(args); return result; } });
    const found = await readRatingAccount(connection({ owner: programId, data: hex(account('rating_awaiting_settlement_accepted').data_hex) }), escrow, programId);
    expect(found).toMatchObject({ state: 'awaiting_settlement', accepted: true });
    expect(calls).toEqual([[ratingPda(escrow, programId), 'confirmed']]);
    await expect(readRatingAccount(connection(null), escrow, programId)).resolves.toBeUndefined();
    await expect(readRatingAccount(connection({ owner: SystemProgram.programId, data: hex(account('rating_open').data_hex) }), escrow, programId)).rejects.toThrow('not held by the escrow program');
    // The rating of another escrow, served at this escrow's rating address.
    await expect(readRatingAccount(connection({ owner: programId, data: hex(account('rating_open').data_hex) }), escrow, programId)).rejects.toThrow('another escrow');
  });
});

describe('seller helper', () => {
  const escrow = key(account('sol_escrow_rated_metered').address);
  const reader = (result: { owner: PublicKey; data: Uint8Array } | null) => {
    const calls: unknown[][] = [];
    return { calls, getAccountInfo: async (...args: unknown[]) => { calls.push(args); return result; } };
  };

  it('reads the escrow at confirmed commitment and reports a rated escrow with its rating address', async () => {
    const connection = reader({ owner: programId, data: hex(account('sol_escrow_rated_metered').data_hex) });
    await expect(readEscrowRatingStatus(connection, escrow, programId)).resolves.toEqual({
      ok: true, kind: 'sol', metered: true, rated: true, deliveryChecked: false, rating: key(instruction('open_rating').accounts[0].address),
    });
    expect(connection.calls).toEqual([[escrow, 'confirmed']]);
  });

  it('reports an escrow that is not rated', async () => {
    const data = hex(account('token_escrow_rated').data_hex);
    data[TOKEN_ESCROW_FLAG_OFFSET] = 1;
    const status = await readEscrowRatingStatus(reader({ owner: programId, data }), key(account('token_escrow_rated').address), programId);
    expect(status).toMatchObject({ ok: true, kind: 'token', metered: true, rated: false });
  });

  it('does not answer "not rated" for a missing account, another owner, another record or an RPC failure', async () => {
    await expect(readEscrowRatingStatus(reader(null), escrow, programId)).resolves.toEqual({ ok: false, reason: 'not_found' });
    await expect(readEscrowRatingStatus(reader({ owner: SystemProgram.programId, data: hex(account('sol_escrow_rated_metered').data_hex) }), escrow, programId)).resolves.toEqual({ ok: false, reason: 'wrong_owner' });
    await expect(readEscrowRatingStatus(reader({ owner: programId, data: hex(account('rating_open').data_hex) }), escrow, programId)).resolves.toEqual({ ok: false, reason: 'not_an_escrow' });
    await expect(readEscrowRatingStatus({ getAccountInfo: async () => { throw new Error('rpc down'); } }, escrow, programId)).rejects.toThrow('rpc down');
  });

});

describe('seller: accepting a rating', () => {
  // A rated escrow awaiting settlement, and its rating, as one job: the fixture's token escrow
  // and its accepted-rating example, with the rating pointed at that escrow and not yet accepted.
  const tokenEscrow = key(account('token_escrow_rated').address);
  const escrowData = () => hex(account('token_escrow_rated').data_hex);
  const ratingData = (edit: (data: Buffer) => void = () => {}) => {
    const data = hex(account('rating_awaiting_settlement_accepted').data_hex);
    tokenEscrow.toBuffer().copy(data, 8);
    data[267] = 0;
    edit(data);
    return data;
  };
  const mint = decodeTokenEscrowAccount(escrowData()).mint;
  const accounts = (escrow: Uint8Array | null, rating: Uint8Array | null, owner = programId) => {
    const calls: unknown[][] = [];
    const ratingAddress = ratingPda(tokenEscrow, programId);
    return {
      calls,
      getAccountInfo: async (address: PublicKey, commitment?: unknown) => {
        calls.push([address.toBase58(), commitment]);
        const data = address.equals(tokenEscrow) ? escrow : address.equals(ratingAddress) ? rating : null;
        return data ? { owner, data } : null;
      },
    };
  };
  const refusal = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(SellerAcceptRatingError);
      return (error as SellerAcceptRatingError).reason;
    }
    throw new Error('expected a refusal');
  };

  it('reads the escrow and the rating at confirmed, and returns accept_rating for the job it read with what the seller agrees to', async () => {
    const connection = accounts(escrowData(), ratingData());
    const result = await buildSellerAcceptRating(connection, { programId, escrow: tokenEscrow, seller: payee });
    expect(result).toEqual({
      instruction: expect.any(TransactionInstruction),
      rating: ratingPda(tokenEscrow, programId), openedSlot: 1040n, consumer: payer, judge, kind: 'token', amount: 1_000_000n, mint,
    });
    expect(shape(result.instruction)).toEqual(shape(buildAcceptRatingInstruction({ programId, escrow: tokenEscrow, specialist: payee, openedSlot: 1040n })));
    expect(connection.calls).toEqual([[tokenEscrow.toBase58(), 'confirmed'], [ratingPda(tokenEscrow, programId).toBase58(), 'confirmed']]);
    // With every expectation met, the same answer.
    await expect(buildSellerAcceptRating(connection, { programId, escrow: tokenEscrow, seller: payee, expected: { openedSlot: 1040n, judge, amount: 1_000_000n, mint }, commitment: 'finalized' })).resolves.toMatchObject({ openedSlot: 1040n });
    expect(connection.calls[connection.calls.length - 1]).toEqual([ratingPda(tokenEscrow, programId).toBase58(), 'finalized']);
  });

  it('builds the fixture\'s accept_rating byte for byte from a SOL escrow and its rating', () => {
    const solEscrow = named(instruction('release_escrow'), 'escrow');
    const solData = hex(account('sol_escrow_rated_metered').data_hex);
    const result = sellerAcceptRatingFromAccounts({ programId, escrow: solEscrow, seller: payee, escrowData: solData, ratingData: hex(account('rating_awaiting_settlement_accepted').data_hex).fill(0, 267, 268) });
    expect(shape(result.instruction)).toEqual(expected(instruction('accept_rating')));
    expect(result).toMatchObject({ kind: 'sol', amount: 1_000_000n, openedSlot: 1040n, judge });
    expect(result.mint).toBeUndefined();
  });

  it.each([
    ['opened_slot_mismatch', { openedSlot: 1000n }],
    ['judge_mismatch', { judge: payer }],
    ['judge_mismatch', { judge: null }],
    ['amount_mismatch', { amount: 999_999n }],
    ['mint_mismatch', { mint: null }],
    ['mint_mismatch', { mint: payer }],
  ] as const)('refuses on %s when the caller expected otherwise', async (reason, expectation) => {
    await expect(refusal(buildSellerAcceptRating(accounts(escrowData(), ratingData()), { programId, escrow: tokenEscrow, seller: payee, expected: expectation }))).resolves.toBe(reason);
  });

  it('expects no judge when told so and none is named', async () => {
    const connection = accounts(escrowData(), ratingData((data) => data.fill(0, 104, 136)));
    const result = await buildSellerAcceptRating(connection, { programId, escrow: tokenEscrow, seller: payee, expected: { judge: null } });
    expect(result.judge).toBeUndefined();
  });

  it('refuses a job it cannot or need not accept', async () => {
    const build = (escrow: Uint8Array | null, rating: Uint8Array | null, seller = payee, owner = programId) =>
      refusal(buildSellerAcceptRating(accounts(escrow, rating, owner), { programId, escrow: tokenEscrow, seller }));
    const withByte = (offset: number, value: number) => { const data = escrowData(); data[offset] = value; return data; };
    expect(await build(null, ratingData())).toBe('escrow_not_found');
    expect(await build(escrowData(), ratingData(), payee, SystemProgram.programId)).toBe('escrow_wrong_owner');
    expect(await build(hex(account('rating_open').data_hex), ratingData())).toBe('not_an_escrow');
    expect(await build(withByte(192, 1), ratingData())).toBe('escrow_not_locked');
    expect(await build(withByte(TOKEN_ESCROW_FLAG_OFFSET, 1), ratingData())).toBe('escrow_not_rated');
    expect(await build(escrowData(), ratingData(), judge)).toBe('not_the_payee');
    expect(await build(escrowData(), null)).toBe('rating_not_found');
    expect(await build(escrowData(), hex(account('rating_awaiting_settlement_accepted').data_hex))).toBe('rating_mismatch');
    expect(await build(escrowData(), ratingData((data) => { data[264] = 1; }))).toBe('rating_not_awaiting_settlement');
    expect(await build(escrowData(), ratingData((data) => { data[267] = 1; }))).toBe('already_accepted');
    await expect(buildSellerAcceptRating({ getAccountInfo: async () => { throw new Error('rpc down'); } }, { programId, escrow: tokenEscrow, seller: payee })).rejects.toThrow('rpc down');
  });

  it('rating_wrong_owner: a rating account another program holds', async () => {
    const ratingAddress = ratingPda(tokenEscrow, programId);
    const connection = { getAccountInfo: async (address: PublicKey) => (address.equals(ratingAddress) ? { owner: SystemProgram.programId, data: ratingData() } : { owner: programId, data: escrowData() }) };
    await expect(refusal(buildSellerAcceptRating(connection, { programId, escrow: tokenEscrow, seller: payee }))).resolves.toBe('rating_wrong_owner');
  });
});

describe('package surface', () => {
  it('exports the rating module from the package index', () => {
    expect(index.buildOpenRatingInstruction).toBe(buildOpenRatingInstruction);
    expect(index.ratingCommitment).toBe(ratingCommitment);
    expect(index.withRatingAccount).toBe(withRatingAccount);
  });
});

describe('program error names', () => {
  it('matches the program\'s error.rs for every rating and attestation code', () => {
    const source = readFileSync(join(__dirname, '../../../programs/pinocchio-escrow/program/src/error.rs'), 'utf8');
    const declared = new Map<number, string>();
    for (const m of source.matchAll(/^\s*(\w+) = (\d+), "/gm)) declared.set(Number(m[2]), m[1]);
    for (const [code, name] of Object.entries(RATING_PROGRAM_ERRORS)) expect(declared.get(Number(code))).toBe(name);
    for (let code = 6033; code <= 6053; code++) expect(ratingProgramErrorName(code)).toBe(declared.get(code));
    expect(ratingProgramErrorName(6049)).toBe('JudgeNotActive');
    expect(ratingProgramErrorName(6050)).toBe('RatingJustOpened');
    expect(ratingProgramErrorName(6051)).toBe('RatingJobMismatch');
    expect(ratingProgramErrorName(6052)).toBe('EscrowJustLocked');
    expect(ratingProgramErrorName(6053)).toBe('EscrowInstanceMismatch');
    expect(ratingProgramErrorName(6054)).toBeUndefined();
    expect(ratingProgramErrorName(6002)).toBeUndefined();
  });
});
