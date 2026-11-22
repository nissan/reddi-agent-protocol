import { Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { buildX402Challenge, nonceReplayKey, SolanaReceiptVerifier, transactionReplayKey } from '../src/payment';
import { checkAndStoreReplayKeys, DatabaseReplayStore, MemoryNonceReplayStore } from '../src/nonce';
import type { NonceReplayStore } from '../src/types';
import { withTokenBalances } from './support/token-balances';

const TOKEN = TOKEN_PROGRAM_ID.toBase58();
const provider = Keypair.generate().publicKey.toBase58();
const buyer = Keypair.generate().publicKey.toBase58();
const mint = Keypair.generate().publicKey.toBase58();
const endpoint = '/v1/chat/completions';

const paidTx = () => withTokenBalances({
  meta: { err: null, postTokenBalances: [{ accountIndex: 1, mint, owner: provider }] },
  transaction: { message: { accountKeys: ['buyer-ta', 'provider-ta'], instructions: [{ programId: TOKEN, parsed: { type: 'transferChecked', info: { mint, authority: buyer, destination: 'provider-ta', tokenAmount: { amount: '1000000', decimals: 6, uiAmountString: '1' } } } }] } },
});
const verifier = () => new SolanaReceiptVerifier({ payerProof: 'not-required', allowRealPayment: true, mints: { USDC: mint }, connection: { async getParsedTransaction() { return paidTx(); } } } as never);
const challenge = (nonce: string) => buildX402Challenge({ network: 'solana-devnet', payTo: provider, amount: '1', currency: 'USDC', endpoint, nonce });
const receipt = (nonce: string, signature: string) => ({ network: 'solana-devnet', payTo: provider, amount: '1', currency: 'USDC', nonce, payer: buyer, signature });

describe('replay keys for real payments', () => {
  it('stores the nonce in its own namespace, so it cannot block another payment\'s transaction key', async () => {
    const store = new MemoryNonceReplayStore();
    // An attacker pays honestly but names its nonce after the victim's transaction key.
    const victimKey = transactionReplayKey('solana-devnet', 'victim-sig');
    const attackerNonce = victimKey.replace(/[^A-Za-z0-9._:~-]/g, '');
    const attacker = await verifier().verifyReceipt(receipt(attackerNonce, 'attacker-sig'), challenge(attackerNonce), store);
    expect(attacker.ok).toBe(true);
    const victim = await verifier().verifyReceipt(receipt('victim-nonce', 'victim-sig'), challenge('victim-nonce'), store);
    expect(victim.ok).toBe(true);
  });

  it('stores both keys namespaced and together', async () => {
    const calls: string[][] = [];
    const store: NonceReplayStore = {
      checkAndStore: () => { throw new Error('single-key call not expected'); },
      checkAndStoreAll: (keys) => { calls.push(keys); return true; },
    };
    const result = await verifier().verifyReceipt(receipt('n-1', 'sig-1'), challenge('n-1'), store);
    expect(result.ok).toBe(true);
    expect(calls).toEqual([[transactionReplayKey('solana-devnet', 'sig-1'), nonceReplayKey('solana-devnet', provider, 'n-1')]]);
  });

  it('records nothing when one of the two keys was already used, so an honest retry still works', async () => {
    const store = new MemoryNonceReplayStore();
    store.checkAndStore(nonceReplayKey('solana-devnet', provider, 'used'));
    const refused = await verifier().verifyReceipt(receipt('used', 'sig-2'), challenge('used'), store);
    expect(refused).toMatchObject({ ok: false, reason: 'duplicate_nonce' });
    const retried = await verifier().verifyReceipt(receipt('fresh', 'sig-2'), challenge('fresh'), store);
    expect(retried.ok).toBe(true);
  });

  it('refuses nonces that are too long or carry other characters', async () => {
    for (const nonce of ['a'.repeat(129), 'has space', 'semi;colon', '']) {
      const result = await verifier().verifyReceipt(receipt(nonce, `sig-${nonce.length}`), { ...challenge('x'), nonce }, new MemoryNonceReplayStore());
      expect(result.ok).toBe(false);
    }
  });

  it('sends both keys to the database in one call', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const store = new DatabaseReplayStore({ rpc: async (fn, args) => { calls.push({ fn, args }); return { data: true, error: null }; } });
    expect(await checkAndStoreReplayKeys(store, ['a', 'b'])).toBe(true);
    expect(calls).toEqual([{ fn: 'replay_check_and_store_all', args: { p_keys: ['a', 'b'] } }]);
    await expect(checkAndStoreReplayKeys(store, ['a', 'a'])).rejects.toThrow('distinct');
    const down = new DatabaseReplayStore({ rpc: async () => ({ data: null, error: { status: 500 } }) });
    await expect(down.checkAndStoreAll(['a'])).rejects.toThrow('unavailable');
  });
});
