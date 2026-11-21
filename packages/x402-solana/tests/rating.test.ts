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
  buildSettleSolEscrowInstruction,
  buildTokenEscrowExitInstruction,
  decodeAttestationAccount,
  decodeRatingAccount,
  escrowAccountFlags,
  escrowFlags,
  ESCROW_FLAG_METERED,
  ESCROW_FLAG_RATED,
  isRatedEscrow,
  payerReleaseOpensRating,
  RATING_ACCOUNT_LEN,
  RATING_DISCRIMINATORS,
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

interface VectorMeta { name: string; address: string; signer: boolean; writable: boolean }
interface VectorInstruction { name: string; data_hex: string; selector_hex: string; accounts: VectorMeta[] }
interface VectorAccount { name: string; address: string; length: number; data_hex: string }
interface Vectors {
  program_id: string;
  instructions: VectorInstruction[];
  accounts: VectorAccount[];
  commitment: { rating: string; signer: string; score: number; salt_hex: string; preimage_hex: string; sha256_hex: string };
  escrow_flag_byte: { metered: number; rated: number; sol_escrow_offset: number; token_escrow_offset: number };
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

/** Every instruction in the fixture, built by this package from addresses and values only. */
const built: Record<string, () => TransactionInstruction> = {
  open_rating: () => buildOpenRatingInstruction({ programId, escrow: named(instruction('open_rating'), 'escrow'), payer, judge: key(bs58FromHex(instruction('open_rating').data_hex.slice(16))) }),
  accept_rating: () => buildAcceptRatingInstruction({ programId, escrow: named(instruction('release_escrow'), 'escrow'), specialist: payee }),
  commit_rating: () => buildCommitRatingInstruction({ programId, escrow: named(instruction('open_rating'), 'escrow'), signer: payer, commitment: hex(vectors.commitment.sha256_hex) }),
  reveal_rating: () => buildRevealRatingInstruction({ programId, escrow: named(instruction('open_rating'), 'escrow'), signer: payer, consumer: payer, specialist: payee, score: vectors.commitment.score, salt }),
  expire_rating: () => buildExpireRatingInstruction({ programId, escrow: named(instruction('release_escrow'), 'escrow'), caller: judge, consumer: payer, specialist: payee }),
  close_rating: () => buildCloseRatingInstruction({ programId, escrow: named(instruction('open_rating'), 'escrow'), consumer: payer }),
  attest_quality: () => buildAttestQualityInstruction({ programId, escrow: named(instruction('open_rating'), 'escrow'), judge, scores: [9, 8, 10, 1, 7] }),
  confirm_attestation: () => buildConfirmAttestationInstruction({ programId, escrow: named(instruction('open_rating'), 'escrow'), judge, consumer: payer }),
  dispute_attestation: () => buildDisputeAttestationInstruction({ programId, escrow: named(instruction('release_escrow'), 'escrow'), judge, consumer: payer }),
  close_attestation: () => buildCloseAttestationInstruction({ programId, escrow: named(instruction('release_escrow'), 'escrow'), judge }),
  settle_escrow: () => buildSettleSolEscrowInstruction({ programId, escrow: named(instruction('settle_escrow'), 'escrow'), payer, payee, actual: 600_000n, rated: true }),
  release_escrow: () => buildReleaseSolEscrowInstruction({ programId, escrow: named(instruction('release_escrow'), 'escrow'), payer, payee, rated: true }),
  cancel_escrow: () => buildCancelSolEscrowInstruction({ programId, escrow: named(instruction('cancel_escrow'), 'escrow'), payer, authority: payee, rated: true }),
  release_token_escrow: () => buildTokenEscrowExitInstruction(tokenTerms(4, instruction('release_token_escrow')), { rated: true }),
  settle_token_escrow: () => buildTokenEscrowExitInstruction(tokenTerms(5, instruction('settle_token_escrow')), { rated: true, authority: payee, options: { actual: 250_000n } }),
  cancel_token_escrow: () => buildTokenEscrowExitInstruction(tokenTerms(6, instruction('cancel_token_escrow')), { rated: true, refund: true, authority: payee }),
};

function bs58FromHex(value: string): string {
  return new PublicKey(hex(value)).toBase58();
}

describe('rating and attestation interface vectors', () => {
  it('has a builder for every instruction in the fixture, and the fixture covers all ten instructions and six exits', () => {
    expect(vectors.instructions.map((entry) => entry.name).sort()).toEqual(Object.keys(built).sort());
  });

  it.each(vectors.instructions.map((entry) => entry.name))('%s matches the fixture: data bytes and ordered account metas', (name) => {
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

  it('is sha256(rating ‖ signer ‖ score ‖ salt), as the fixture gives it', () => {
    const preimage = Buffer.concat([key(commitment.rating).toBuffer(), key(commitment.signer).toBuffer(), Buffer.from([commitment.score]), salt]);
    expect(preimage.toString('hex')).toBe(commitment.preimage_hex);
    expect(Buffer.from(ratingCommitment(key(commitment.rating), key(commitment.signer), commitment.score, salt)).toString('hex')).toBe(commitment.sha256_hex);
  });

  it('changes with the rating, the signer, the score and the salt', () => {
    const base = Buffer.from(ratingCommitment(key(commitment.rating), payer, 9, salt)).toString('hex');
    const other = (value: Uint8Array) => Buffer.from(value).toString('hex');
    expect(other(ratingCommitment(key(commitment.rating), payee, 9, salt))).not.toBe(base);
    expect(other(ratingCommitment(payee, payer, 9, salt))).not.toBe(base);
    expect(other(ratingCommitment(key(commitment.rating), payer, 8, salt))).not.toBe(base);
    expect(other(ratingCommitment(key(commitment.rating), payer, 9, new Uint8Array(32)))).not.toBe(base);
  });

  it('refuses a score outside 1 to 10 and a salt that is not 32 bytes', () => {
    for (const score of [0, 11, 1.5, -1, Number.NaN]) expect(() => ratingCommitment(payer, payer, score, salt)).toThrow('1 to 10');
    expect(() => ratingCommitment(payer, payer, 5, new Uint8Array(31))).toThrow('32 bytes');
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
    expect(Buffer.from(rating.consumerCommitment!)).toEqual(Buffer.from(ratingCommitment(key(account('rating_both_committed').address), payer, 9, salt)));
    expect(rating.specialistCommitment).toHaveLength(32);
    expect(Buffer.from(rating.specialistCommitment!).toString('hex')).toBe('f0809e9d60ccb14196384b88ac44748e2ce62424438b3116c5a87dc8cc584905');
  });

  it('reads a revealed rating: both scores, attested', () => {
    expect(decoded('rating_revealed')).toMatchObject({ state: 'revealed', consumerScore: 9, specialistScore: 4, accepted: false, attested: true, paid: 600_000n });
  });

  it('reads an expired rating', () => {
    expect(decoded('rating_expired')).toMatchObject({ escrow: escrowB, state: 'expired', paid: 1_000_000n, settledSlot: 1040n, accepted: true, attested: true, consumerScore: undefined, specialistScore: undefined });
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
    expect(pending).toEqual({ escrow: named(instruction('open_rating'), 'escrow'), judge, consumer: payer, scores: [9, 8, 10, 1, 7], resolution: 'pending', createdSlot: 1040n, bump: 249 });
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
    expect({ metered: ESCROW_FLAG_METERED, rated: ESCROW_FLAG_RATED, sol_escrow_offset: SOL_ESCROW_FLAG_OFFSET, token_escrow_offset: TOKEN_ESCROW_FLAG_OFFSET }).toEqual(vectors.escrow_flag_byte);
    expect([0, 1, 2, 3].map(escrowFlags)).toEqual([
      { metered: false, rated: false }, { metered: true, rated: false }, { metered: false, rated: true }, { metered: true, rated: true },
    ]);
  });

  it('reads a rated metered SOL escrow, which stores 3', () => {
    expect(sol[SOL_ESCROW_FLAG_OFFSET]).toBe(3);
    expect(escrowAccountFlags(sol)).toEqual({ kind: 'sol', metered: true, rated: true });
    expect(isRatedEscrow(sol)).toBe(true);
  });

  it('reads a rated fixed-price token escrow, and the token decoder agrees', () => {
    expect(token[TOKEN_ESCROW_FLAG_OFFSET]).toBe(2);
    expect(escrowAccountFlags(token)).toEqual({ kind: 'token', metered: false, rated: true });
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
    expect(escrowAccountFlags(solData)).toEqual({ kind: 'sol', metered, rated });
  });

  it('reads the flags of an escrow written before windows were stored, and of a SOL escrow with a session key', () => {
    // Earlier SOL layout: 16 bytes shorter, the windows left out after created_slot.
    const legacySol = Buffer.concat([sol.subarray(0, 113), sol.subarray(129)]);
    expect(legacySol).toHaveLength(149);
    expect(escrowAccountFlags(legacySol)).toEqual({ kind: 'sol', metered: true, rated: true });
    const legacyToken = token.subarray(0, 203);
    expect(escrowAccountFlags(legacyToken)).toEqual({ kind: 'token', metered: false, rated: true });
    // With a session key (PER builds only) the flag byte sits 32 bytes later.
    const withSession = Buffer.from(sol);
    withSession[130] = 1;
    withSession.fill(9, 131, 163);
    withSession[163] = 255;
    withSession[164] = 1;
    expect(escrowAccountFlags(withSession)).toEqual({ kind: 'sol', metered: true, rated: false });
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

  it('leaves an unrated token exit exactly as buildSettleTokenEscrowInstruction builds it', () => {
    const cases: [boolean, PublicKey, { actual?: bigint }][] = [[false, payer, {}], [false, payee, { actual: 250_000n }], [true, payee, {}], [true, payer, {}]];
    for (const [refund, authority, options] of cases) {
      const today = buildSettleTokenEscrowInstruction(terms, refund, authority, options);
      const unrated = buildTokenEscrowExitInstruction(terms, { rated: false, refund, authority, options });
      expect(shape(unrated)).toEqual(shape(today));
      expect(bytes(unrated, authority)).toBe(bytes(today, authority));
      const rated = buildTokenEscrowExitInstruction(terms, { rated: true, refund, authority, options });
      expect(rated.data).toEqual(today.data);
      expect(shape(rated).accounts).toEqual([...shape(today).accounts, { address: instruction('settle_token_escrow').accounts[9].address, signer: false, writable: true }]);
    }
  });

  it('returns the same instruction object when the escrow is not rated', () => {
    const today = buildSettleTokenEscrowInstruction(terms, false, payee, { actual: 1n });
    expect(withRatingAccount(today, false)).toBe(today);
  });

  it('builds an unrated SOL settle, release and cancel with the usual accounts only', () => {
    const escrow = named(instruction('settle_escrow'), 'escrow');
    const settle = instruction('settle_escrow');
    const unratedSettle = buildSettleSolEscrowInstruction({ programId, escrow, payer, payee, actual: 600_000n });
    expect(shape(unratedSettle)).toEqual({ ...expected(settle), accounts: expected(settle).accounts.slice(0, 5) });
    expect(shape(buildSettleSolEscrowInstruction({ programId, escrow, payer, payee, actual: 600_000n, rated: false }))).toEqual(shape(unratedSettle));

    const release = instruction('release_escrow');
    expect(shape(buildReleaseSolEscrowInstruction({ programId, escrow: named(release, 'escrow'), payer, payee }))).toEqual({ ...expected(release), accounts: expected(release).accounts.slice(0, 5) });

    const cancel = instruction('cancel_escrow');
    expect(shape(buildCancelSolEscrowInstruction({ programId, escrow: named(cancel, 'escrow'), payer, authority: payee }))).toEqual({ ...expected(cancel), accounts: expected(cancel).accounts.slice(0, 4) });
  });

  it('marks who signs a SOL release: the payer, or the payee claiming', () => {
    const escrow = named(instruction('release_escrow'), 'escrow');
    const signers = (signer?: 'payer' | 'payee') => buildReleaseSolEscrowInstruction({ programId, escrow, payer, payee, signer }).keys.slice(1, 3).map((meta) => meta.isSigner);
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
      expect(escrowAccountFlags(solData)).toEqual({ kind: 'sol', rated, metered: (flag & 1) === 1 });
    });

    it.each([
      ['release_escrow (payer)', 5, () => buildReleaseSolEscrowInstruction({ programId, escrow: solEscrow, payer, payee, rated: isRatedEscrow(solData) })],
      ['release_escrow (payee claim)', 5, () => buildReleaseSolEscrowInstruction({ programId, escrow: solEscrow, payer, payee, signer: 'payee', rated: isRatedEscrow(solData) })],
      ['settle_escrow', 5, () => buildSettleSolEscrowInstruction({ programId, escrow: solEscrow, payer, payee, actual: 1n, rated: isRatedEscrow(solData) })],
      ['cancel_escrow (decline)', 4, () => buildCancelSolEscrowInstruction({ programId, escrow: solEscrow, payer, authority: payee, rated: isRatedEscrow(solData) })],
      ['cancel_escrow (refund)', 4, () => buildCancelSolEscrowInstruction({ programId, escrow: solEscrow, payer, authority: payer, rated: isRatedEscrow(solData) })],
    ] as const)('%s: the rating account is passed exactly when the escrow is rated', (_name, usual, build) => {
      const ix = build();
      expect(ix.keys).toHaveLength(usual + (rated ? 1 : 0));
      if (rated) expect(last(ix)).toEqual({ pubkey: solRating, isSigner: false, isWritable: true });
      else expect(ix.keys.some((meta) => meta.pubkey.equals(solRating))).toBe(false);
    });

    it.each([
      ['release_token_escrow (payer)', 9, { authority: payer }],
      ['release_token_escrow (payee claim)', 9, { authority: payee }],
      ['settle_token_escrow', 9, { authority: payee, options: { actual: 1n } }],
      ['cancel_token_escrow (decline)', 7, { authority: payee, refund: true }],
      ['cancel_token_escrow (refund)', 7, { authority: payer, refund: true }],
    ] as const)('%s: the rating account is passed exactly when the escrow is rated', (_name, usual, exit) => {
      const ix = buildTokenEscrowExitInstruction(tokenTermsOf, { ...exit, rated: decodeTokenEscrowAccount(tokenData).rated });
      expect(ix.keys).toHaveLength(usual + (rated ? 1 : 0));
      if (rated) expect(last(ix)).toEqual({ pubkey: tokenRating, isSigner: false, isWritable: true });
      else expect(ix.keys.some((meta) => meta.pubkey.equals(tokenRating))).toBe(false);
    });
  });

  it('puts the rating account right after the usual accounts, before any extra ones', () => {
    const extra = key('SysvarC1ock11111111111111111111111111111111');
    const today = buildSettleTokenEscrowInstruction(terms, false, payee, { actual: 1n });
    today.keys.push({ pubkey: extra, isSigner: false, isWritable: false });
    const rated = withRatingAccount(today, true);
    expect(rated.keys).toHaveLength(11);
    expect(rated.keys[9].pubkey.toBase58()).toBe(instruction('settle_token_escrow').accounts[9].address);
    expect(rated.keys[10].pubkey).toEqual(extra);
    expect(today.keys).toHaveLength(10);
  });

  it('refuses an instruction that is not an exit, or that lacks its usual accounts', () => {
    expect(() => withRatingAccount(buildLockTokenEscrowInstruction(terms), true)).toThrow('not an escrow exit instruction');
    expect(() => withRatingAccount(built.commit_rating(), true)).toThrow('not an escrow exit instruction');
    const short = buildSettleTokenEscrowInstruction(terms, false, payee, { actual: 1n });
    short.keys.pop();
    expect(() => withRatingAccount(short, true)).toThrow('missing');
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
    expect(() => buildCommitRatingInstruction({ programId, escrow, signer: payer, commitment: new Uint8Array(32) })).toThrow('all zero');
    expect(() => buildCommitRatingInstruction({ programId, escrow, signer: payer, commitment: new Uint8Array(31) })).toThrow('32 bytes');
    expect(() => buildRevealRatingInstruction({ programId, escrow, signer: payer, consumer: payer, specialist: payee, score: 0, salt })).toThrow('1 to 10');
    expect(() => buildRevealRatingInstruction({ programId, escrow, signer: payer, consumer: payer, specialist: payee, score: 5, salt: salt.subarray(1) })).toThrow('32 bytes');
    expect(() => buildAttestQualityInstruction({ programId, escrow, judge, scores: [1, 2, 3, 4, 11] })).toThrow('1 to 10');
    expect(() => buildAttestQualityInstruction({ programId, escrow, judge, scores: [1, 2, 3, 4] as unknown as [number, number, number, number, number] })).toThrow('five scores');
    expect(() => buildSettleSolEscrowInstruction({ programId, escrow, payer, payee, actual: 0n })).toThrow('positive u64');
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
    // One transaction, signed by the payer alone.
    const tx = new Transaction({ feePayer: payer, recentBlockhash: '11111111111111111111111111111111' }).add(...plan.instructions);
    expect(tx.compileMessage().header.numRequiredSignatures).toBe(1);
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
      ok: true, kind: 'sol', metered: true, rated: true, rating: key(instruction('open_rating').accounts[0].address),
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

  it('builds accept_rating for the seller', () => {
    expect(shape(buildSellerAcceptRating({ programId, escrow: named(instruction('release_escrow'), 'escrow'), seller: payee }))).toEqual(expected(instruction('accept_rating')));
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
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const { RATING_PROGRAM_ERRORS, ratingProgramErrorName } = require('../src/rating') as typeof import('../src/rating');
    const source = fs.readFileSync(path.join(__dirname, '../../../programs/pinocchio-escrow/program/src/error.rs'), 'utf8');
    const declared = new Map<number, string>();
    for (const m of source.matchAll(/^\s*(\w+) = (\d+), "/gm)) declared.set(Number(m[2]), m[1]);
    for (const [code, name] of Object.entries(RATING_PROGRAM_ERRORS)) expect(declared.get(Number(code))).toBe(name);
    for (let code = 6033; code <= 6049; code++) expect(ratingProgramErrorName(code)).toBe(declared.get(code));
    expect(ratingProgramErrorName(6049)).toBe('JudgeNotActive');
    expect(ratingProgramErrorName(6002)).toBeUndefined();
  });
});
