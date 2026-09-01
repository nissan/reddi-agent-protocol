import {
  buildX402Challenge,
  DemoPaymentVerifier,
  parseX402Header,
  sendPayment,
  isValidPaymentAddress,
  isValidSolanaPublicKey,
  SolanaReceiptVerifier,
} from '../src/payment';
import {
  checkAndStoreNonce,
  clearNonces,
  getNonceCount,
  MemoryNonceReplayStore,
} from '../src/nonce';
import { createX402Middleware, createX402Header } from '../src/middleware';

const validAddress = '3mL7kbtz3eK24vJ6wftjnLvhZrf93B71UEjB2DBDAddr';
const otherValidAddress = '6uiQbwMor4UrWYiDtAJcgHKYW4vUaM3BUVChPgzdALse';

describe('x402 Payment Module', () => {
  afterEach(() => {
    clearNonces();
  });

  describe('parseX402Header', () => {
    it('should parse valid x402-request header', () => {
      const header = JSON.stringify({ amount: 1000, currency: 'SOL', paymentAddress: validAddress, nonce: 'abc123' });
      const result = parseX402Header(header);
      expect(result.amount).toBe(1000);
      expect(result.currency).toBe('SOL');
      expect(result.paymentAddress).toBe(validAddress);
      expect(result.nonce).toBe('abc123');
    });

    it('should parse hosted x402 challenge shape with payTo and string amount', () => {
      const header = JSON.stringify({ version: '1', network: 'solana-devnet', payTo: validAddress, amount: '0.03', currency: 'USDC', endpoint: 'https://example.test/v1/chat/completions', nonce: 'abc123' });
      const result = parseX402Header(header);
      expect(result.amount).toBe(0.03);
      expect(result.currency).toBe('USDC');
      expect(result.paymentAddress).toBe(validAddress);
      expect(result.network).toBe('solana-devnet');
      expect(result.endpoint).toBe('https://example.test/v1/chat/completions');
    });

    it('should reject zero amount', () => {
      const header = JSON.stringify({ amount: 0, currency: 'SOL', paymentAddress: validAddress, nonce: 'abc123' });
      expect(() => parseX402Header(header)).toThrow('amount must be a positive number');
    });

    it('should reject negative amount', () => {
      const header = JSON.stringify({ amount: -100, currency: 'SOL', paymentAddress: validAddress, nonce: 'abc123' });
      expect(() => parseX402Header(header)).toThrow('amount must be a positive number');
    });

    it('should reject missing paymentAddress', () => {
      const header = JSON.stringify({ amount: 1000, currency: 'SOL', nonce: 'abc123' });
      expect(() => parseX402Header(header)).toThrow('paymentAddress is required');
    });

    it('should reject missing nonce', () => {
      const header = JSON.stringify({ amount: 1000, currency: 'SOL', paymentAddress: validAddress });
      expect(() => parseX402Header(header)).toThrow('nonce is required');
    });

    it('should reject invalid JSON', () => {
      expect(() => parseX402Header('{invalid json}')).toThrow('x402-request header is not valid JSON');
    });
  });

  describe('Nonce Store', () => {
    it('should accept first nonce', () => {
      expect(checkAndStoreNonce('nonce-1')).toBe(true);
    });

    it('should reject duplicate nonce', () => {
      checkAndStoreNonce('nonce-1');
      expect(checkAndStoreNonce('nonce-1')).toBe(false);
    });

    it('should accept different nonces', () => {
      checkAndStoreNonce('nonce-1');
      expect(checkAndStoreNonce('nonce-2')).toBe(true);
    });

    it('should allow re-acceptance after clearNonces', () => {
      checkAndStoreNonce('nonce-1');
      expect(getNonceCount()).toBe(1);
      clearNonces();
      expect(getNonceCount()).toBe(0);
      expect(checkAndStoreNonce('nonce-1')).toBe(true);
    });
  });

  describe('Payment Address Validation', () => {
    it('should validate correct Solana address', () => {
      expect(isValidPaymentAddress(validAddress)).toBe(true);
      expect(isValidSolanaPublicKey(validAddress)).toBe(true);
    });

    it('should reject address that is too short', () => {
      expect(isValidPaymentAddress('short')).toBe(false);
    });

    it('should reject address that is too long', () => {
      expect(isValidPaymentAddress('a'.repeat(50))).toBe(false);
    });

    it('should reject non-canonical 32-44 character strings', () => {
      expect(isValidPaymentAddress('a'.repeat(32))).toBe(false);
      expect(isValidPaymentAddress('O'.repeat(32))).toBe(false);
    });
  });

  describe('challenge builder and demo verifier', () => {
    const challenge = buildX402Challenge({
      network: 'solana-devnet',
      payTo: validAddress,
      amount: '0.03',
      currency: 'USDC',
      endpoint: 'https://planning.example.test/v1/chat/completions',
      nonce: 'nonce-123',
    });

    it('builds a strict Solana devnet challenge', () => {
      expect(challenge.version).toBe('1');
      expect(challenge.payTo).toBe(validAddress);
      expect(challenge.network).toBe('solana-devnet');
    });

    it('fails closed unless demo payments are explicitly enabled', async () => {
      const verifier = new DemoPaymentVerifier(false);
      const result = await verifier.verifyReceipt(`demo:${challenge.nonce}`, challenge);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('demo_payment_disabled');
    });

    it('accepts explicit demo receipts and stores nonce once', async () => {
      const verifier = new DemoPaymentVerifier(true);
      const store = new MemoryNonceReplayStore();
      const receipt = `demo:${challenge.nonce}`;
      const first = await verifier.verifyReceipt(receipt, challenge, store);
      expect(first.ok).toBe(true);
      const second = await verifier.verifyReceipt(receipt, challenge, store);
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.reason).toBe('duplicate_nonce');
    });

    it('rejects caller-authored structured demo receipts', async () => {
      const verifier = new DemoPaymentVerifier(true);
      const structured = await verifier.verifyReceipt({ demo: true, ...challenge }, challenge);
      expect(structured.ok).toBe(false);
      if (!structured.ok) expect(structured.reason).toBe('invalid_receipt');

      const structuredToken = await verifier.verifyReceipt({ demo: true, token: `demo:${challenge.nonce}`, nonce: challenge.nonce }, challenge);
      expect(structuredToken.ok).toBe(false);
      if (!structuredToken.ok) expect(structuredToken.reason).toBe('invalid_receipt');
    });

    it('rejects non-demo structured receipts in demo-only verifier', async () => {
      const verifier = new DemoPaymentVerifier(true);
      const unsigned = await verifier.verifyReceipt({ ...challenge, signature: 'caller-authored' }, challenge);
      expect(unsigned.ok).toBe(false);
      if (!unsigned.ok) expect(unsigned.reason).toBe('unsupported_receipt');
    });

    it('accepts a real SOL receipt when the parsed transaction satisfies the challenge', async () => {
      const solChallenge = buildX402Challenge({
        network: 'solana-devnet',
        payTo: validAddress,
        amount: 0.001,
        currency: 'SOL',
        endpoint: 'https://planning.example.test/v1/chat/completions',
        nonce: 'nonce-sol',
      });
      const verifier = new SolanaReceiptVerifier({
        allowRealPayment: true,
        connection: {
          async getParsedTransaction() {
            return {
              meta: { err: null },
              transaction: {
                message: {
                  instructions: [
                    {
                      programId: { toString: () => '11111111111111111111111111111111' },
                      parsed: { type: 'transfer', info: { source: otherValidAddress, destination: validAddress, lamports: 1_000_000 } },
                    },
                  ],
                },
              },
            };
          },
        },
      });
      const result = await verifier.verifyReceipt({ network: 'solana-devnet', payTo: validAddress, amount: 0.001, currency: 'SOL', nonce: 'nonce-sol', payer: otherValidAddress, signature: 'sig-sol' }, solChallenge);
      expect(result.ok).toBe(true);
    });

    it('accepts a real USDC receipt when the parsed token transfer pays a token account owned by the challenged payee', async () => {
      const mint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
      const verifier = new SolanaReceiptVerifier({
        allowRealPayment: true,
        usdcMint: mint,
        connection: {
          async getParsedTransaction() {
            return {
              meta: {
                err: null,
                postTokenBalances: [{ accountIndex: 1, mint, owner: validAddress, uiTokenAmount: { uiAmountString: '1.03' } }],
              },
              transaction: {
                message: {
                  accountKeys: [{ pubkey: { toString: () => 'source-token-account' } }, { pubkey: { toString: () => 'dest-token-account' } }],
                  instructions: [
                    {
                      program: 'spl-token',
                      parsed: { type: 'transferChecked', info: { mint, authority: otherValidAddress, destination: 'dest-token-account', tokenAmount: { uiAmountString: '0.03' } } },
                    },
                  ],
                },
              },
            };
          },
        },
      });
      const result = await verifier.verifyReceipt({ network: 'solana-devnet', payTo: validAddress, amount: '0.03', currency: 'USDC', nonce: challenge.nonce, payer: otherValidAddress, signature: 'sig-usdc', destinationTokenAccount: 'dest-token-account' }, challenge);
      expect(result.ok).toBe(true);
    });

    it('rejects a real USDC receipt when the transfer destination is not owned by the challenged payee', async () => {
      const mint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
      const verifier = new SolanaReceiptVerifier({
        allowRealPayment: true,
        usdcMint: mint,
        connection: {
          async getParsedTransaction() {
            return {
              meta: {
                err: null,
                postTokenBalances: [{ accountIndex: 1, mint, owner: otherValidAddress, uiTokenAmount: { uiAmountString: '1.03' } }],
              },
              transaction: {
                message: {
                  accountKeys: ['source-token-account', 'dest-token-account'],
                  instructions: [
                    {
                      program: 'spl-token',
                      parsed: { type: 'transferChecked', info: { mint, destination: 'dest-token-account', tokenAmount: { uiAmountString: '0.03' } } },
                    },
                  ],
                },
              },
            };
          },
        },
      });
      const result = await verifier.verifyReceipt({ network: 'solana-devnet', payTo: validAddress, amount: '0.03', currency: 'USDC', nonce: challenge.nonce, signature: 'sig-usdc' }, challenge);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('invalid_receipt');
    });

    it('rejects caller-supplied destinationTokenAccount unless it matches the on-chain instruction destination', async () => {
      const mint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
      const verifier = new SolanaReceiptVerifier({
        allowRealPayment: true,
        usdcMint: mint,
        connection: {
          async getParsedTransaction() {
            return {
              meta: { err: null, postTokenBalances: [{ accountIndex: 1, mint, owner: validAddress }] },
              transaction: {
                message: {
                  accountKeys: ['source-token-account', 'actual-dest-token-account'],
                  instructions: [
                    {
                      program: 'spl-token',
                      parsed: { type: 'transferChecked', info: { mint, destination: 'actual-dest-token-account', tokenAmount: { uiAmountString: '0.03' } } },
                    },
                  ],
                },
              },
            };
          },
        },
      });
      const result = await verifier.verifyReceipt({ network: 'solana-devnet', payTo: validAddress, amount: '0.03', currency: 'USDC', nonce: challenge.nonce, signature: 'sig-usdc', destinationTokenAccount: 'claimed-dest-token-account' }, challenge);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('invalid_receipt');
    });

    it('reports an unconfigured AUDD mint as an unsupported receipt rather than a bad buyer receipt', async () => {
      const auddChallenge = buildX402Challenge({
        network: 'solana-devnet',
        payTo: validAddress,
        amount: '2500000',
        currency: 'AUDD',
        endpoint: 'https://planning.example.test/v1/chat/completions',
        nonce: 'nonce-audd',
      });
      const verifier = new SolanaReceiptVerifier({
        allowRealPayment: true,
        connection: {
          async getParsedTransaction() {
            return { meta: { err: null }, slot: 443284058, transaction: { signatures: ['sig-audd'], message: { accountKeys: [], instructions: [] } } };
          },
        },
      });
      const result = await verifier.verifyReceipt(
        { network: 'solana-devnet', payTo: validAddress, amount: '2500000', currency: 'AUDD', nonce: 'nonce-audd', payer: otherValidAddress, signature: 'sig-audd' },
        auddChallenge,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('unsupported_receipt');
        expect(result.message).toMatch(/auddMint/);
      }
    });

    it('surfaces the observer failure reason when an AUDD transaction does not satisfy the challenge', async () => {
      const mint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
      const auddChallenge = buildX402Challenge({
        network: 'solana-devnet',
        payTo: validAddress,
        amount: '2500000',
        currency: 'AUDD',
        endpoint: 'https://planning.example.test/v1/chat/completions',
        nonce: 'nonce-audd-2',
      });
      const verifier = new SolanaReceiptVerifier({
        allowRealPayment: true,
        auddMint: mint,
        connection: {
          async getParsedTransaction() {
            return { meta: { err: null }, slot: 443284058, transaction: { signatures: ['sig-audd-2'], message: { accountKeys: [], instructions: [] } } };
          },
        },
      });
      const result = await verifier.verifyReceipt(
        { network: 'solana-devnet', payTo: validAddress, amount: '2500000', currency: 'AUDD', nonce: 'nonce-audd-2', payer: otherValidAddress, signature: 'sig-audd-2' },
        auddChallenge,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('invalid_receipt');
        expect(result.message).toMatch(/no_transfer_checked/);
      }
    });
  });

  describe('sendPayment', () => {
    it('should return receipt with matching amount and nonce', async () => {
      const request = { amount: 5000, currency: 'SOL', paymentAddress: validAddress, nonce: 'test-nonce-123' };
      const receipt = await sendPayment(request);
      expect(receipt.lamports).toBe(5000);
      expect(receipt.nonce).toBe('test-nonce-123');
      expect(receipt.txSignature).toBeDefined();
      expect(receipt.slot).toBeDefined();
    });
  });

  describe('Middleware Helper', () => {
    it('should create valid x402-request header', () => {
      const header = createX402Header(1000, validAddress, 'nonce-123');
      const parsed = parseX402Header(header);
      expect(parsed.amount).toBe(1000);
      expect(parsed.nonce).toBe('nonce-123');
    });
  });
});
