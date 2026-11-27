import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import {
  decodePauseState,
  isPausedError,
  PAUSE_ERRORS,
  PAUSE_SLOTS,
  PAUSE_STATE_LEN,
  pauseAccountMeta,
  pauseAddress,
  readPauseStatus,
  withPauseAccount,
} from '../src/pause';

const vectors = JSON.parse(readFileSync(join(__dirname, '../../../programs/pinocchio-escrow/interface/vectors.json'), 'utf8'));
const programId = new PublicKey(vectors.program_id);

function stateBytes(guardian: PublicKey, until: bigint): Buffer {
  const data = Buffer.alloc(PAUSE_STATE_LEN);
  guardian.toBuffer().copy(data, 8);
  data.writeBigUInt64LE(until, 40);
  data.writeBigUInt64LE(5n, 48);
  guardian.toBuffer().copy(data, 56);
  data[88] = 255;
  return data;
}

describe('emergency pause client', () => {
  it('derives the pause account the program uses', () => {
    expect(pauseAddress(programId).toBase58()).toBe(vectors.pause.address);
    expect(PAUSE_SLOTS).toBe(BigInt(vectors.pause.pause_slots));
    expect(PAUSE_ERRORS).toEqual(vectors.pause.errors);
    expect(pauseAccountMeta(programId)).toEqual({ pubkey: pauseAddress(programId), isSigner: false, isWritable: false });
  });

  it('appends the pause account once, last', () => {
    const ix = new TransactionInstruction({ programId, data: Buffer.alloc(8), keys: [{ pubkey: programId, isSigner: false, isWritable: false }] });
    withPauseAccount(ix);
    withPauseAccount(ix);
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([programId.toBase58(), vectors.pause.address]);
  });

  it('decodes the pause account and reads whether it is paused now', async () => {
    const guardian = new PublicKey(new Uint8Array(32).fill(7));
    expect(decodePauseState(stateBytes(guardian, 900n))).toEqual({ guardian, pausedUntilSlot: 900n, pausedAtSlot: 5n, lastBy: guardian });
    expect(() => decodePauseState(Buffer.alloc(10))).toThrow('not a pause account');
    const connection = (data: Buffer | null, slot: number) =>
      ({
        getAccountInfo: async () => (data ? { data, owner: programId } : null),
        getSlot: async () => slot,
      }) as never;
    expect(await readPauseStatus(connection(stateBytes(guardian, 900n), 899), programId)).toMatchObject({ paused: true, missing: false });
    expect(await readPauseStatus(connection(stateBytes(guardian, 900n), 900), programId)).toMatchObject({ paused: false, missing: false });
    // No account: the program refuses locks and payouts, so the client treats it as paused.
    expect(await readPauseStatus(connection(null, 1), programId)).toMatchObject({ paused: true, missing: true });
  });

  it('recognises the program refusing a call because it is paused', () => {
    expect(isPausedError(new Error('failed: custom program error: 0x17d5'))).toBe(true);
    expect(isPausedError('Program log: AnchorError occurred. Error Code: ProtocolPaused. Error Number: 6101.')).toBe(true);
    expect(isPausedError(new Error('custom program error: 0x17d6'))).toBe(false);
  });
});
