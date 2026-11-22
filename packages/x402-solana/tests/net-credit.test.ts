import { Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { buildX402Challenge, SolanaReceiptVerifier } from '../src/payment';
import { MemoryNonceReplayStore } from '../src/nonce';
import { withTokenBalances } from './support/token-balances';

// A token payment counts only for what stays with the payee (and the treasury):
// each account's balance after the transaction minus its balance before.
const TOKEN = TOKEN_PROGRAM_ID.toBase58();
const provider = Keypair.generate().publicKey.toBase58();
const buyer = Keypair.generate().publicKey.toBase58();
const treasury = Keypair.generate().publicKey.toBase58();
const mint = Keypair.generate().publicKey.toBase58();
const endpoint = '/v1/chat/completions';

const challenge = (nonce: string, withFee: boolean) =>
  buildX402Challenge({ network: 'solana-devnet', payTo: provider, amount: '1', currency: 'USDC', endpoint, nonce }, withFee ? { protocolFee: { treasury } } : {});
const receipt = (nonce: string) =>
  ({ network: 'solana-devnet', payTo: provider, amount: '1', currency: 'USDC', nonce, payer: buyer, signature: `sig-${nonce}` });
const transferChecked = (source: string, destination: string, units: string, authority = buyer) => ({
  programId: TOKEN,
  parsed: { type: 'transferChecked', info: { mint, source, authority, destination, tokenAmount: { amount: units, decimals: 6, uiAmountString: (Number(units) / 1e6).toString() } } },
});
const setOwner = (account: string, newAuthority: string, authority = buyer) => ({
  programId: TOKEN,
  parsed: { type: 'setAuthority', info: { account, authority, authorityType: 'accountOwner', newAuthority } },
});
const verifier = (tx: unknown, withFee: boolean) => new SolanaReceiptVerifier({
  payerProof: 'not-required',
  allowRealPayment: true,
  mints: { USDC: mint },
  ...(withFee ? { protocolFee: { treasury } } : {}),
  connection: { async getParsedTransaction() { return tx; } },
} as never);
const keys = ['buyer-ta', 'decoy-ta', 'provider-ta', 'treasury-ta'];
const amount = (units: string) => ({ amount: units, decimals: 6 });

/**
 * The decoy pattern: the payer creates its own account D, transfers the full
 * price into it (the matched instruction), takes all but one unit back, and
 * hands D to the payee. D ends owned by the payee holding dust.
 */
function decoyTransaction(): unknown {
  return {
    meta: {
      err: null,
      preTokenBalances: [{ accountIndex: 0, mint, owner: buyer, uiTokenAmount: amount('5000000') }],
      postTokenBalances: [
        { accountIndex: 0, mint, owner: buyer, uiTokenAmount: amount('4999999') },
        { accountIndex: 1, mint, owner: provider, uiTokenAmount: amount('1') },
      ],
    },
    transaction: { message: {
      accountKeys: keys,
      instructions: [
        transferChecked('buyer-ta', 'decoy-ta', '1000000'),
        transferChecked('decoy-ta', 'buyer-ta', '999999'),
        setOwner('decoy-ta', provider),
      ],
    } },
  };
}

describe('direct token payments are checked on net credit', () => {
  it('refuses the decoy account pattern without a fee', async () => {
    const result = await verifier(decoyTransaction(), false).verifyReceipt(receipt('decoy'), challenge('decoy', false), new MemoryNonceReplayStore());
    expect(result).toMatchObject({ ok: false, reason: 'invalid_receipt' });
  });

  it('refuses the decoy pattern with a fee, using a decoy for each leg', async () => {
    const tx = {
      meta: {
        err: null,
        preTokenBalances: [{ accountIndex: 0, mint, owner: buyer, uiTokenAmount: amount('5000000') }],
        postTokenBalances: [
          { accountIndex: 0, mint, owner: buyer, uiTokenAmount: amount('4999998') },
          { accountIndex: 1, mint, owner: provider, uiTokenAmount: amount('1') },
          { accountIndex: 2, mint, owner: treasury, uiTokenAmount: amount('1') },
        ],
      },
      transaction: { message: {
        accountKeys: ['buyer-ta', 'decoy-a', 'decoy-b'],
        instructions: [
          transferChecked('buyer-ta', 'decoy-a', '975000'),
          transferChecked('buyer-ta', 'decoy-b', '25000'),
          transferChecked('decoy-a', 'buyer-ta', '974999'),
          transferChecked('decoy-b', 'buyer-ta', '24999'),
          setOwner('decoy-a', provider),
          setOwner('decoy-b', treasury),
        ],
      } },
    };
    const result = await verifier(tx, true).verifyReceipt(receipt('decoy-fee'), challenge('decoy-fee', true), new MemoryNonceReplayStore());
    expect(result).toMatchObject({ ok: false, reason: 'invalid_receipt' });
  });

  it('refuses when the payee account is debited in the same transaction, even if the net still covers the price', async () => {
    // The payee account already held 10 units; 1 USDC arrives and 1 unit leaves.
    // The net (999,999) is short; a version where it is not short is refused for the debit alone.
    for (const out of ['1', '0']) {
      const base = withTokenBalances({
        meta: { err: null, postTokenBalances: [{ accountIndex: 2, mint, owner: provider }] },
        transaction: { message: { accountKeys: keys, instructions: [transferChecked('buyer-ta', 'provider-ta', '1000000')] } },
      }, 6, BigInt(10));
      const debit = { programId: TOKEN, parsed: { type: 'transfer', info: { source: 'provider-ta', destination: 'buyer-ta', authority: provider, amount: out } } };
      const tx = { ...base, meta: { ...base.meta, innerInstructions: [{ index: 0, instructions: [debit] }] } };
      const result = await verifier(tx, false).verifyReceipt(receipt(`debit-${out}`), challenge(`debit-${out}`, false), new MemoryNonceReplayStore());
      expect(result).toMatchObject({ ok: false, reason: 'invalid_receipt' });
    }
  });

  it('refuses when the payee account changed owner during the transaction', async () => {
    const tx = {
      meta: {
        err: null,
        preTokenBalances: [{ accountIndex: 2, mint, owner: buyer, uiTokenAmount: amount('0') }],
        postTokenBalances: [{ accountIndex: 2, mint, owner: provider, uiTokenAmount: amount('1000000') }],
      },
      transaction: { message: { accountKeys: keys, instructions: [transferChecked('buyer-ta', 'provider-ta', '1000000')] } },
    };
    const result = await verifier(tx, false).verifyReceipt(receipt('owner'), challenge('owner', false), new MemoryNonceReplayStore());
    expect(result).toMatchObject({ ok: false, reason: 'invalid_receipt' });
  });

  it('refuses a transaction whose balances cannot be read', async () => {
    const good = withTokenBalances({
      meta: { err: null, postTokenBalances: [{ accountIndex: 2, mint, owner: provider }] },
      transaction: { message: { accountKeys: keys, instructions: [transferChecked('buyer-ta', 'provider-ta', '1000000')] } },
    });
    const noPre = { ...good, meta: { ...good.meta, preTokenBalances: undefined } };
    const noAmount = { ...good, meta: { ...good.meta, postTokenBalances: [{ accountIndex: 2, mint, owner: provider, uiTokenAmount: { uiAmountString: '1' } }] } };
    for (const [name, tx] of [['no-pre', noPre], ['no-amount', noAmount]] as const) {
      const result = await verifier(tx, false).verifyReceipt(receipt(name), challenge(name, false), new MemoryNonceReplayStore());
      expect(result).toMatchObject({ ok: false, reason: 'invalid_receipt' });
    }
  });

  it('accepts an honest payment into an account that already held a balance', async () => {
    const tx = withTokenBalances({
      meta: { err: null, postTokenBalances: [{ accountIndex: 2, mint, owner: provider }, { accountIndex: 3, mint, owner: treasury }] },
      transaction: { message: { accountKeys: keys, instructions: [transferChecked('buyer-ta', 'provider-ta', '975000'), transferChecked('buyer-ta', 'treasury-ta', '25000')] } },
    }, 6, BigInt(42_000_000));
    const result = await verifier(tx, true).verifyReceipt(receipt('honest'), challenge('honest', true), new MemoryNonceReplayStore());
    expect(result).toMatchObject({ ok: true });
  });

  it('accepts an honest payment into a payee account created in the same transaction', async () => {
    const tx = withTokenBalances({
      meta: { err: null, postTokenBalances: [{ accountIndex: 2, mint, owner: provider }] },
      transaction: { message: { accountKeys: keys, instructions: [transferChecked('buyer-ta', 'provider-ta', '1000000')] } },
    });
    const created = { ...tx, meta: { ...tx.meta, preTokenBalances: [] } };
    const result = await verifier(created, false).verifyReceipt(receipt('created'), challenge('created', false), new MemoryNonceReplayStore());
    expect(result).toMatchObject({ ok: true });
  });
});
