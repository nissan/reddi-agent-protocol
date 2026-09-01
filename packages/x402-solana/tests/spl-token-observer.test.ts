import {
  SPL_MEMO_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  verifySplTransferCheckedObservation,
} from '../src/spl-token-observer';
import { buildX402Challenge, SolanaReceiptVerifier } from '../src/payment';
import { MemoryNonceReplayStore } from '../src/nonce';

const NETWORK = 'solana-devnet';
const SIGNATURE = 'fixtureAuddTransferCheckedSignature1111111111111111';
const MINT = 'AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw';
const PAYEE = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr';
const PAYER = '6uiQbwMor4UrWYiDtAJcgHKYW4vUaM3BUVChPgzdALse';
const SOURCE_TOKEN = 'source-audd-token-account-fixture';
const DEST_TOKEN = 'destination-audd-token-account-fixture';
const MEMO = 'reddi:pay:fixture-audd-intent';
const AMOUNT = '2500000';

const expected = {
  network: NETWORK,
  signature: SIGNATURE,
  mint: MINT,
  tokenProgram: SPL_TOKEN_PROGRAM_ID,
  payTo: PAYEE,
  amountBaseUnits: AMOUNT,
  destinationTokenAccount: DEST_TOKEN,
  authority: PAYER,
  decimals: 6,
  memo: MEMO,
  memoRequired: true,
  paymentIntentId: 'reddi.payment-intent:fixture-audd-intent',
};

function transferIx(overrides: Record<string, unknown> = {}): any {
  return {
    programId: SPL_TOKEN_PROGRAM_ID,
    program: 'spl-token',
    parsed: {
      type: 'transferChecked',
      info: {
        source: SOURCE_TOKEN,
        destination: DEST_TOKEN,
        mint: MINT,
        authority: PAYER,
        tokenAmount: {
          amount: AMOUNT,
          decimals: 6,
          uiAmountString: '2.5',
        },
        ...overrides,
      },
    },
  };
}

function memoIx(memo = MEMO) {
  return {
    programId: SPL_MEMO_PROGRAM_ID,
    program: 'spl-memo',
    parsed: memo,
  };
}

function parsedTransaction(overrides: {
  transferInfo?: Record<string, unknown>;
  transferProgramId?: string;
  owner?: string;
  mint?: string;
  amount?: string;
  decimals?: number;
  memo?: string | null;
  failed?: boolean;
  duplicate?: boolean;
  slot?: number;
  blockTime?: number;
  signatures?: string[];
} = {}) {
  const amount = overrides.amount ?? AMOUNT;
  const mint = overrides.mint ?? MINT;
  const decimals = overrides.decimals ?? 6;
  const ix = transferIx({
    mint,
    tokenAmount: { amount, decimals, uiAmountString: decimals === 6 ? '2.5' : '0.0025' },
    ...overrides.transferInfo,
  });
  ix.programId = overrides.transferProgramId ?? SPL_TOKEN_PROGRAM_ID;
  const instructions = overrides.memo === null ? [ix] : [ix, memoIx(overrides.memo ?? MEMO)];
  return {
    slot: overrides.slot ?? 443284058,
    blockTime: overrides.blockTime ?? 1785523200,
    meta: {
      err: overrides.failed ? { InstructionError: [0, 'Custom'] } : null,
      postTokenBalances: [
        {
          accountIndex: 1,
          mint,
          owner: overrides.owner ?? PAYEE,
          programId: overrides.transferProgramId ?? SPL_TOKEN_PROGRAM_ID,
          uiTokenAmount: { amount, decimals, uiAmountString: '2.5' },
        },
      ],
      innerInstructions: overrides.duplicate
        ? [{ index: 0, instructions: [transferIx({ mint, tokenAmount: { amount, decimals, uiAmountString: '2.5' } })] }]
        : [],
    },
    transaction: {
      signatures: overrides.signatures ?? [SIGNATURE],
      message: {
        accountKeys: [SOURCE_TOKEN, DEST_TOKEN],
        instructions,
      },
    },
  };
}

describe('SPL TransferChecked observation verifier', () => {
  it('verifies one exact AUDD TransferChecked payment from a parsed deterministic transaction fixture', async () => {
    const result = await verifySplTransferCheckedObservation({
      parsedTransaction: parsedTransaction(),
      expected,
      commitment: 'confirmed',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.observation.schemaVersion).toBe('reddi.svm-spl-transfer-checked-observation.v1');
      expect(result.observation.mint).toBe(MINT);
      expect(result.observation.tokenProgram).toBe(SPL_TOKEN_PROGRAM_ID);
      expect(result.observation.amountBaseUnits).toBe(AMOUNT);
      expect(result.observation.destinationTokenAccount).toBe(DEST_TOKEN);
      expect(result.observation.destinationOwner).toBe(PAYEE);
      expect(result.observation.memo).toBe(MEMO);
      expect(result.observation.evidence.grantEligible).toBe(false);
    }
  });

  it('rejects wrong mint, token program, payee owner, amount, decimals, authority, and destination', async () => {
    const cases = [
      { tx: parsedTransaction({ mint: 'WrongMint111111111111111111111111111111111' }), reason: 'wrong_mint' },
      { tx: parsedTransaction({ transferProgramId: 'TokenzQdBNbLqP5VEhdkAS6EP8pNJGvvnzQ74d7Gkwb' }), reason: 'wrong_token_program' },
      { tx: parsedTransaction({ owner: PAYER }), reason: 'wrong_payee' },
      { tx: parsedTransaction({ amount: '2499999' }), reason: 'wrong_amount' },
      { tx: parsedTransaction({ decimals: 9 }), reason: 'wrong_decimals' },
      { tx: parsedTransaction({ transferInfo: { authority: PAYEE } }), reason: 'wrong_authority' },
      { tx: parsedTransaction({ transferInfo: { destination: 'attacker-token-account' } }), reason: 'wrong_destination' },
    ];

    for (const { tx, reason } of cases) {
      const result = await verifySplTransferCheckedObservation({ parsedTransaction: tx, expected, commitment: 'confirmed' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(reason);
    }
  });

  it('rejects failed transactions, missing confirmation metadata, wrong signature, missing TransferChecked, and duplicate matches', async () => {
    const failed = await verifySplTransferCheckedObservation({ parsedTransaction: parsedTransaction({ failed: true }), expected, commitment: 'confirmed' });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.reason).toBe('failed_transaction');

    const missingConfirmation = await verifySplTransferCheckedObservation({ parsedTransaction: parsedTransaction({ slot: 0 }), expected, commitment: 'confirmed' });
    expect(missingConfirmation.ok).toBe(false);
    if (!missingConfirmation.ok) expect(missingConfirmation.reason).toBe('missing_confirmation_metadata');

    const wrongSignature = await verifySplTransferCheckedObservation({ parsedTransaction: parsedTransaction({ signatures: ['differentSignature1111111111111111111111111111'] }), expected, commitment: 'confirmed' });
    expect(wrongSignature.ok).toBe(false);
    if (!wrongSignature.ok) expect(wrongSignature.reason).toBe('wrong_signature');

    const noTransferChecked = await verifySplTransferCheckedObservation({
      parsedTransaction: {
        ...parsedTransaction(),
        transaction: { signatures: [SIGNATURE], message: { accountKeys: [SOURCE_TOKEN, DEST_TOKEN], instructions: [memoIx()] } },
      },
      expected,
      commitment: 'confirmed',
    });
    expect(noTransferChecked.ok).toBe(false);
    if (!noTransferChecked.ok) expect(noTransferChecked.reason).toBe('no_transfer_checked');

    const duplicate = await verifySplTransferCheckedObservation({ parsedTransaction: parsedTransaction({ duplicate: true }), expected, commitment: 'confirmed' });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.reason).toBe('duplicate_matching_transfer');
  });

  it('requires memo binding when requested and rejects mismatches', async () => {
    const missingMemo = await verifySplTransferCheckedObservation({ parsedTransaction: parsedTransaction({ memo: null }), expected, commitment: 'confirmed' });
    expect(missingMemo.ok).toBe(false);
    if (!missingMemo.ok) expect(missingMemo.reason).toBe('missing_memo');

    const wrongMemo = await verifySplTransferCheckedObservation({ parsedTransaction: parsedTransaction({ memo: 'reddi:pay:wrong-intent' }), expected, commitment: 'confirmed' });
    expect(wrongMemo.ok).toBe(false);
    if (!wrongMemo.ok) expect(wrongMemo.reason).toBe('memo_mismatch');
  });

  it('rejects replayed signatures using the supplied replay store', async () => {
    const replayStore = new MemoryNonceReplayStore();
    const first = await verifySplTransferCheckedObservation({ parsedTransaction: parsedTransaction(), expected, commitment: 'confirmed', replayStore });
    expect(first.ok).toBe(true);

    const second = await verifySplTransferCheckedObservation({ parsedTransaction: parsedTransaction(), expected, commitment: 'confirmed', replayStore });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('replay_detected');
  });

  it('bridges AUDD x402 receipts through SolanaReceiptVerifier without broadening legacy USDC semantics', async () => {
    const challenge = buildX402Challenge({
      network: 'solana-devnet',
      payTo: PAYEE,
      amount: AMOUNT,
      currency: 'AUDD',
      endpoint: 'https://seller.example.test/agent/task',
      nonce: 'audd-x402-bridge-001',
      memo: MEMO,
    });
    const verifier = new SolanaReceiptVerifier({
      allowRealPayment: true,
      auddMint: MINT,
      auddTokenProgram: SPL_TOKEN_PROGRAM_ID,
      connection: {
        async getParsedTransaction(signature) {
          expect(signature).toBe(SIGNATURE);
          return parsedTransaction();
        },
      },
    });

    const result = await verifier.verifyReceipt({
      network: 'solana-devnet',
      payTo: PAYEE,
      amount: AMOUNT,
      currency: 'AUDD',
      nonce: 'audd-x402-bridge-001',
      payer: PAYER,
      signature: SIGNATURE,
      destinationTokenAccount: DEST_TOKEN,
      mint: MINT,
    }, challenge);

    expect(result.ok).toBe(true);

    const noExplicitMintVerifier = new SolanaReceiptVerifier({
      allowRealPayment: true,
      connection: { async getParsedTransaction() { return parsedTransaction(); } },
    });
    const noExplicitMint = await noExplicitMintVerifier.verifyReceipt({
      network: 'solana-devnet',
      payTo: PAYEE,
      amount: AMOUNT,
      currency: 'AUDD',
      nonce: 'audd-x402-bridge-001',
      payer: PAYER,
      signature: SIGNATURE,
      destinationTokenAccount: DEST_TOKEN,
      mint: MINT,
    }, challenge);
    expect(noExplicitMint.ok).toBe(false);

    const wrongReceiptMint = await verifier.verifyReceipt({
      network: 'solana-devnet',
      payTo: PAYEE,
      amount: AMOUNT,
      currency: 'AUDD',
      nonce: 'audd-x402-bridge-001',
      payer: PAYER,
      signature: SIGNATURE,
      destinationTokenAccount: DEST_TOKEN,
      mint: 'WrongAuddMint1111111111111111111111111111111',
    }, challenge);
    expect(wrongReceiptMint.ok).toBe(false);
  });
});
