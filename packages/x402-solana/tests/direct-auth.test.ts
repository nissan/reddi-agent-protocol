import { createPrivateKey, sign as edSign } from 'crypto';
import { Keypair, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { buildX402Challenge, SolanaReceiptVerifier } from '../src/payment';
import { MemoryNonceReplayStore } from '../src/nonce';
import {
  directPaymentDelegationHeaderValue,
  directPaymentProofCheck,
  directPaymentProofHeaders,
  PAYMENT_DELEGATION_HEADER,
  PAYMENT_PROOF_HEADER,
} from '../src/direct-auth';

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const signer = (k: Keypair) => (m: Uint8Array) =>
  new Uint8Array(edSign(null, Buffer.from(m), createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(k.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8' })));
const headersOf = (h: Record<string, string>) => ({ get: (name: string) => h[name.toLowerCase()] ?? null });

const buyer = Keypair.generate();
const stranger = Keypair.generate();
const provider = Keypair.generate().publicKey.toBase58();
const TX = 'tx-signature-1';
const NOW = 1_800_000_000_000;
const body = JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] });

const challenge = (nonce: string) => buildX402Challenge({ network: 'solana-devnet', payTo: provider, amount: '0.001', currency: 'SOL', endpoint: '/v1/chat/completions', nonce });
const receipt = (nonce: string, payer = buyer.publicKey.toBase58()) => ({ network: 'solana-devnet', payTo: provider, amount: '0.001', currency: 'SOL', nonce, payer, signature: TX });
const solTx = (source = buyer.publicKey.toBase58(), signerKey = source) => ({
  meta: { err: null },
  transaction: { message: {
    accountKeys: [{ pubkey: signerKey, signer: true }, { pubkey: provider, signer: false }],
    instructions: [{ programId: SystemProgram.programId.toBase58(), parsed: { type: 'transfer', info: { source, destination: provider, lamports: 1_000_000 } } }],
  } },
});
const verifier = (parsed: unknown) => new SolanaReceiptVerifier({ allowRealPayment: true, connection: { async getParsedTransaction() { return parsed; } } } as never);
const proofFrom = async (k: Keypair, requestBody = body, delegation?: string) =>
  directPaymentProofHeaders({ network: 'solana-devnet', txSignature: TX, payTo: provider, body: requestBody, sign: signer(k), delegation });
const check = (h: Record<string, string>, requestBody = body) => directPaymentProofCheck({ headers: headersOf(h), body: requestBody, nowMs: NOW });

describe('direct payment payer proof', () => {
  it('refuses a receipt with no proof check, or naming no payer, by default', async () => {
    const store = new MemoryNonceReplayStore();
    const none = await verifier(solTx()).verifyReceipt(receipt('n1'), challenge('n1'), store);
    expect(none).toMatchObject({ ok: false, reason: 'payer_proof_required' });
    const { payer: _p, ...noPayer } = receipt('n1');
    const unnamed = await verifier(solTx()).verifyReceipt(noPayer, challenge('n1'), store, check(await proofFrom(buyer)));
    expect(unnamed).toMatchObject({ ok: false, reason: 'payer_proof_required' });
  });

  it('serves the payer, and a stranger presenting the same payment first burns nothing', async () => {
    const store = new MemoryNonceReplayStore();
    const missing = await verifier(solTx()).verifyReceipt(receipt('n2'), challenge('n2'), store, check({}));
    expect(missing).toMatchObject({ ok: false, reason: 'payer_proof_required' });
    const stolen = await verifier(solTx()).verifyReceipt(receipt('n2'), challenge('n2'), store, check(await proofFrom(stranger)));
    expect(stolen).toMatchObject({ ok: false, reason: 'payer_proof_invalid' });
    const own = await verifier(solTx()).verifyReceipt(receipt('n2'), challenge('n2'), store, check(await proofFrom(buyer)));
    expect(own.ok).toBe(true);
    const again = await verifier(solTx()).verifyReceipt(receipt('n3'), challenge('n3'), store, check(await proofFrom(buyer)));
    expect(again).toMatchObject({ ok: false, reason: 'duplicate_nonce' });
  });

  it('binds the proof to the body, the transaction and the payee', async () => {
    const store = new MemoryNonceReplayStore();
    const headers = await proofFrom(buyer);
    expect(await verifier(solTx()).verifyReceipt(receipt('n4'), challenge('n4'), store, check(headers, body + ' '))).toMatchObject({ reason: 'payer_proof_invalid' });
    const otherTx = await directPaymentProofHeaders({ network: 'solana-devnet', txSignature: 'another', payTo: provider, body, sign: signer(buyer) });
    expect(await verifier(solTx()).verifyReceipt(receipt('n4'), challenge('n4'), store, check(otherTx))).toMatchObject({ reason: 'payer_proof_invalid' });
    const otherPayee = await directPaymentProofHeaders({ network: 'solana-devnet', txSignature: TX, payTo: Keypair.generate().publicKey.toBase58(), body, sign: signer(buyer) });
    expect(await verifier(solTx()).verifyReceipt(receipt('n4'), challenge('n4'), store, check(otherPayee))).toMatchObject({ reason: 'payer_proof_invalid' });
  });

  it('will not let a stranger name themselves as payer of someone else\'s transfer', async () => {
    const store = new MemoryNonceReplayStore();
    const claimed = await verifier(solTx()).verifyReceipt(receipt('n5', stranger.publicKey.toBase58()), challenge('n5'), store, check(await proofFrom(stranger)));
    expect(claimed.ok).toBe(false);
    // A transfer whose source did not sign is refused too.
    const unsigned = await verifier(solTx(buyer.publicKey.toBase58(), Keypair.generate().publicKey.toBase58())).verifyReceipt(receipt('n5'), challenge('n5'), store, check(await proofFrom(buyer)));
    expect(unsigned).toMatchObject({ ok: false, reason: 'invalid_receipt' });
  });

  it('accepts a session key the payer delegated to this provider, and nothing looser', async () => {
    const sessionKey = Keypair.generate();
    const expiresAt = Math.floor(NOW / 1000) + 3600;
    const delegation = await directPaymentDelegationHeaderValue({ provider, sessionKey: sessionKey.publicKey.toBase58(), expiresAt }, signer(buyer));
    const ok = await verifier(solTx()).verifyReceipt(receipt('n6'), challenge('n6'), new MemoryNonceReplayStore(), check(await proofFrom(sessionKey, body, delegation)));
    expect(ok.ok).toBe(true);

    const cases: [string, string, Keypair][] = [
      ['payer_proof_expired', await directPaymentDelegationHeaderValue({ provider, sessionKey: sessionKey.publicKey.toBase58(), expiresAt: Math.floor(NOW / 1000) - 1 }, signer(buyer)), sessionKey],
      ['payer_proof_invalid', await directPaymentDelegationHeaderValue({ provider: Keypair.generate().publicKey.toBase58(), sessionKey: sessionKey.publicKey.toBase58(), expiresAt }, signer(buyer)), sessionKey],
      ['payer_proof_invalid', await directPaymentDelegationHeaderValue({ provider, sessionKey: sessionKey.publicKey.toBase58(), expiresAt }, signer(stranger)), sessionKey],
      ['payer_proof_invalid', await directPaymentDelegationHeaderValue({ provider, sessionKey: sessionKey.publicKey.toBase58(), expiresAt: Math.floor(NOW / 1000) + 8 * 24 * 3600 }, signer(buyer)), sessionKey],
      ['payer_proof_invalid', delegation, stranger],
      ['payer_proof_invalid', 'not base64!', sessionKey],
    ];
    for (const [reason, value, key] of cases) {
      const result = await verifier(solTx()).verifyReceipt(receipt('n7'), challenge('n7'), new MemoryNonceReplayStore(), check({ ...(await proofFrom(key)), [PAYMENT_DELEGATION_HEADER]: value }));
      expect(result).toMatchObject({ ok: false, reason });
    }
  });

  it('requires a token transfer to name the payer as its authority', async () => {
    const mint = Keypair.generate().publicKey.toBase58();
    const tokenTx = (authority?: string) => ({
      meta: { err: null, postTokenBalances: [{ accountIndex: 1, mint, owner: provider }] },
      transaction: { message: {
        accountKeys: [{ pubkey: buyer.publicKey.toBase58(), signer: true }, { pubkey: 'provider-ta', signer: false }],
        instructions: [{ programId: TOKEN_PROGRAM_ID.toBase58(), parsed: { type: 'transferChecked', info: { mint, destination: 'provider-ta', ...(authority ? { authority } : { multisigAuthority: buyer.publicKey.toBase58() }), tokenAmount: { amount: '1000000', uiAmountString: '1', decimals: 6 } } } }],
      } },
    });
    const usdc = (nonce: string) => buildX402Challenge({ network: 'solana-devnet', payTo: provider, amount: '1', currency: 'USDC', endpoint: '/v1/chat/completions', nonce });
    const usdcReceipt = (nonce: string) => ({ ...receipt(nonce), amount: '1', currency: 'USDC' });
    const tokenVerifier = (parsed: unknown) => new SolanaReceiptVerifier({ allowRealPayment: true, mints: { USDC: mint }, connection: { async getParsedTransaction() { return parsed; } } } as never);
    const headers = await proofFrom(buyer);
    expect((await tokenVerifier(tokenTx(buyer.publicKey.toBase58())).verifyReceipt(usdcReceipt('t1'), usdc('t1'), new MemoryNonceReplayStore(), check(headers))).ok).toBe(true);
    expect((await tokenVerifier(tokenTx()).verifyReceipt(usdcReceipt('t2'), usdc('t2'), new MemoryNonceReplayStore(), check(headers))).ok).toBe(false);
  });

  it('can be switched off only for a verifier that serves nothing', async () => {
    const ledger = new SolanaReceiptVerifier({ allowRealPayment: true, payerProof: 'not-required', connection: { async getParsedTransaction() { return solTx(); } } } as never);
    expect((await ledger.verifyReceipt(receipt('n8'), challenge('n8'), new MemoryNonceReplayStore())).ok).toBe(true);
    expect(PAYMENT_PROOF_HEADER).toBe('x402-payment-proof');
  });
});
