import {
  buildX402Challenge,
  DemoPaymentVerifier,
  parseX402Header,
  sendPayment,
  isValidPaymentAddress,
  isValidSolanaPublicKey,
  SolanaReceiptVerifier,
  SOLANA_GENESIS_HASHES,
  DEFAULT_MAX_TRANSACTION_AGE_SECONDS,
  solAmountToLamports,
} from '../src/payment';
import {
  checkAndStoreNonce,
  clearNonces,
  getNonceCount,
  MemoryNonceReplayStore,
  DatabaseReplayStore,
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
      const result = await verifier.verifyReceipt({ network: 'solana-devnet', payTo: validAddress, amount: 0.001, currency: 'SOL', nonce: 'nonce-sol', payer: otherValidAddress, signature: 'sig-sol' }, solChallenge, new MemoryNonceReplayStore());
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
      const result = await verifier.verifyReceipt({ network: 'solana-devnet', payTo: validAddress, amount: '0.03', currency: 'USDC', nonce: challenge.nonce, payer: otherValidAddress, signature: 'sig-usdc', destinationTokenAccount: 'dest-token-account' }, challenge, new MemoryNonceReplayStore());
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

    describe('transaction age, network and exact SOL amounts', () => {
      const NOW = 1_800_000_000_000;
      const nowSeconds = NOW / 1000;
      const mainnetHash = SOLANA_GENESIS_HASHES['solana-mainnet-beta'];
      const devnetHash = SOLANA_GENESIS_HASHES['solana-devnet'];
      const solTx = (lamports: unknown, blockTime?: number | null) => ({
        blockTime,
        meta: { err: null },
        transaction: {
          message: {
            instructions: [
              {
                programId: { toString: () => '11111111111111111111111111111111' },
                parsed: { type: 'transfer', info: { source: otherValidAddress, destination: validAddress, lamports } },
              },
            ],
          },
        },
      });
      const solChallenge = (network: 'solana-devnet' | 'solana-mainnet-beta', amount: string | number, nonce: string) =>
        buildX402Challenge({ network, payTo: validAddress, amount, currency: 'SOL', endpoint: 'https://planning.example.test/v1/chat/completions', nonce });
      const solReceipt = (network: string, amount: string | number, nonce: string, signature = `sig-${nonce}`) =>
        ({ network, payTo: validAddress, amount, currency: 'SOL', nonce, payer: otherValidAddress, signature });
      const mainnetVerifier = (tx: unknown, extra: Record<string, unknown> = {}, genesis: string | null = mainnetHash) =>
        new SolanaReceiptVerifier({
          allowRealPayment: true,
          now: () => NOW,
          connection: {
            async getParsedTransaction() { return tx; },
            ...(genesis === null ? {} : { async getGenesisHash() { return genesis; } }),
          },
          ...extra,
        });

      it('accepts a recent mainnet payment from an endpoint that reports the mainnet genesis hash', async () => {
        const result = await mainnetVerifier(solTx(1_000_000, nowSeconds - 30))
          .verifyReceipt(solReceipt('solana-mainnet-beta', 0.001, 'age-ok'), solChallenge('solana-mainnet-beta', 0.001, 'age-ok'), new MemoryNonceReplayStore());
        expect(result.ok).toBe(true);
      });

      it('refuses a mainnet payment older than the default window', async () => {
        const store = new MemoryNonceReplayStore();
        const result = await mainnetVerifier(solTx(1_000_000, nowSeconds - DEFAULT_MAX_TRANSACTION_AGE_SECONDS - 1))
          .verifyReceipt(solReceipt('solana-mainnet-beta', 0.001, 'age-old'), solChallenge('solana-mainnet-beta', 0.001, 'age-old'), store);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.message).toContain('older than');
        expect(store.size).toBe(0);
      });

      it('accepts a mainnet payment exactly at the window edge', async () => {
        const result = await mainnetVerifier(solTx(1_000_000, nowSeconds - DEFAULT_MAX_TRANSACTION_AGE_SECONDS))
          .verifyReceipt(solReceipt('solana-mainnet-beta', 0.001, 'age-edge'), solChallenge('solana-mainnet-beta', 0.001, 'age-edge'), new MemoryNonceReplayStore());
        expect(result.ok).toBe(true);
      });

      it('refuses a mainnet payment with no block time, or one in the future', async () => {
        for (const blockTime of [undefined, null, nowSeconds + 600]) {
          const result = await mainnetVerifier(solTx(1_000_000, blockTime))
            .verifyReceipt(solReceipt('solana-mainnet-beta', 0.001, 'age-none'), solChallenge('solana-mainnet-beta', 0.001, 'age-none'), new MemoryNonceReplayStore());
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.reason).toBe('invalid_receipt');
        }
      });

      it('refuses a nonsensical age limit instead of treating it as no limit', async () => {
        for (const maxTransactionAgeSeconds of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
          const result = await mainnetVerifier(solTx(1_000_000, nowSeconds - 30), { maxTransactionAgeSeconds })
            .verifyReceipt(solReceipt('solana-mainnet-beta', 0.001, 'age-bad'), solChallenge('solana-mainnet-beta', 0.001, 'age-bad'), new MemoryNonceReplayStore());
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.reason).toBe('unsupported_receipt');
        }
      });

      it('applies the age limit on devnet only when one is configured', async () => {
        const old = solTx(1_000_000, nowSeconds - 5000);
        const off = await new SolanaReceiptVerifier({ allowRealPayment: true, now: () => NOW, connection: { async getParsedTransaction() { return old; } } })
          .verifyReceipt(solReceipt('solana-devnet', 0.001, 'dev-age-off'), solChallenge('solana-devnet', 0.001, 'dev-age-off'), new MemoryNonceReplayStore());
        expect(off.ok).toBe(true);
        const on = await new SolanaReceiptVerifier({ allowRealPayment: true, now: () => NOW, maxTransactionAgeSeconds: 600, connection: { async getParsedTransaction() { return old; } } })
          .verifyReceipt(solReceipt('solana-devnet', 0.001, 'dev-age-on'), solChallenge('solana-devnet', 0.001, 'dev-age-on'), new MemoryNonceReplayStore());
        expect(on.ok).toBe(false);
      });

      it('refuses a mainnet challenge settled through a devnet endpoint', async () => {
        const store = new MemoryNonceReplayStore();
        const result = await mainnetVerifier(solTx(1_000_000, nowSeconds - 30), {}, devnetHash)
          .verifyReceipt(solReceipt('solana-mainnet-beta', 0.001, 'net-wrong'), solChallenge('solana-mainnet-beta', 0.001, 'net-wrong'), store);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('wrong_network');
        expect(store.size).toBe(0);
      });

      it('refuses mainnet verification when the connection cannot report its genesis hash', async () => {
        const result = await mainnetVerifier(solTx(1_000_000, nowSeconds - 30), {}, null)
          .verifyReceipt(solReceipt('solana-mainnet-beta', 0.001, 'net-none'), solChallenge('solana-mainnet-beta', 0.001, 'net-none'), new MemoryNonceReplayStore());
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('unsupported_receipt');
      });

      it('does not let expectedGenesisHash replace the public mainnet hash', async () => {
        const result = await mainnetVerifier(solTx(1_000_000, nowSeconds - 30), { expectedGenesisHash: devnetHash }, devnetHash)
          .verifyReceipt(solReceipt('solana-mainnet-beta', 0.001, 'net-override'), solChallenge('solana-mainnet-beta', 0.001, 'net-override'), new MemoryNonceReplayStore());
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('unsupported_receipt');
      });

      it('checks the devnet genesis hash only when one is configured', async () => {
        const tx = solTx(1_000_000);
        const connection = { async getParsedTransaction() { return tx; }, async getGenesisHash() { return 'LocalValidatorGenesis'; } };
        const unchecked = await new SolanaReceiptVerifier({ allowRealPayment: true, connection })
          .verifyReceipt(solReceipt('solana-devnet', 0.001, 'dev-net-off'), solChallenge('solana-devnet', 0.001, 'dev-net-off'), new MemoryNonceReplayStore());
        expect(unchecked.ok).toBe(true);
        const checked = await new SolanaReceiptVerifier({ allowRealPayment: true, connection, expectedGenesisHash: devnetHash })
          .verifyReceipt(solReceipt('solana-devnet', 0.001, 'dev-net-on'), solChallenge('solana-devnet', 0.001, 'dev-net-on'), new MemoryNonceReplayStore());
        expect(checked.ok).toBe(false);
        if (!checked.ok) expect(checked.reason).toBe('wrong_network');
      });

      it('asks for the genesis hash again after a mismatch and remembers a match', async () => {
        let calls = 0;
        const answers = [devnetHash, mainnetHash];
        const verifier = new SolanaReceiptVerifier({
          allowRealPayment: true,
          now: () => NOW,
          connection: {
            async getParsedTransaction() { return solTx(1_000_000, nowSeconds - 30); },
            async getGenesisHash() { return answers[Math.min(calls++, 1)]; },
          },
        });
        const store = new MemoryNonceReplayStore();
        const first = await verifier.verifyReceipt(solReceipt('solana-mainnet-beta', 0.001, 'g1'), solChallenge('solana-mainnet-beta', 0.001, 'g1'), store);
        expect(first.ok).toBe(false);
        const second = await verifier.verifyReceipt(solReceipt('solana-mainnet-beta', 0.001, 'g2'), solChallenge('solana-mainnet-beta', 0.001, 'g2'), store);
        expect(second.ok).toBe(true);
        const third = await verifier.verifyReceipt(solReceipt('solana-mainnet-beta', 0.001, 'g3'), solChallenge('solana-mainnet-beta', 0.001, 'g3'), store);
        expect(third.ok).toBe(true);
        expect(calls).toBe(2);
      });

      it('converts SOL amounts to lamports exactly', () => {
        expect(solAmountToLamports(0.00051)).toBe(BigInt(510000));
        expect(solAmountToLamports('0.00051')).toBe(BigInt(510000));
        expect(solAmountToLamports(0.000000001)).toBe(BigInt(1));
        expect(solAmountToLamports('1')).toBe(BigInt(1_000_000_000));
        expect(solAmountToLamports('0.5')).toBe(BigInt(500_000_000));
        expect(solAmountToLamports('123456789.123456789')).toBe(BigInt('123456789123456789'));
        for (const bad of ['0', '0.0', '-1', '1e-3', '0.0000000001', ' 1', '1.', '.5', '', 'abc', 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.0000000001]) {
          expect(solAmountToLamports(bad)).toBeUndefined();
        }
      });

      it('accepts an exact SOL payment that floating point used to reject, and refuses one lamport short', async () => {
        const devVerifier = (lamports: unknown) => new SolanaReceiptVerifier({ allowRealPayment: true, connection: { async getParsedTransaction() { return solTx(lamports); } } });
        const exact = await devVerifier(510000)
          .verifyReceipt(solReceipt('solana-devnet', 0.00051, 'sol-exact'), solChallenge('solana-devnet', 0.00051, 'sol-exact'), new MemoryNonceReplayStore());
        expect(exact.ok).toBe(true);
        const short = await devVerifier(509999)
          .verifyReceipt(solReceipt('solana-devnet', 0.00051, 'sol-short'), solChallenge('solana-devnet', 0.00051, 'sol-short'), new MemoryNonceReplayStore());
        expect(short.ok).toBe(false);
        for (const lamports of ['510000.5', -510000, 1.5e6 + 0.5, null, 'abc']) {
          const odd = await devVerifier(lamports)
            .verifyReceipt(solReceipt('solana-devnet', 0.00051, 'sol-odd'), solChallenge('solana-devnet', 0.00051, 'sol-odd'), new MemoryNonceReplayStore());
          expect(odd.ok).toBe(false);
        }
      });
    });

    describe('receipt-to-transaction binding', () => {
      const usdcMint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
      const otherMint = 'So11111111111111111111111111111111111111112';
      const solTransaction = () => ({
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
      });
      const usdcTransaction = (instruction: Record<string, unknown>, balanceMint = usdcMint) => ({
        meta: { err: null, postTokenBalances: [{ accountIndex: 1, mint: balanceMint, owner: validAddress }] },
        transaction: {
          message: {
            accountKeys: ['source-token-account', 'dest-token-account'],
            instructions: [{ program: 'spl-token', parsed: instruction }],
          },
        },
      });
      const solChallengeFor = (nonce: string) => buildX402Challenge({
        network: 'solana-devnet',
        payTo: validAddress,
        amount: 0.001,
        currency: 'SOL',
        endpoint: 'https://planning.example.test/v1/chat/completions',
        nonce,
      });
      const solReceipt = (nonce: string, signature = 'sig-shared') => ({ network: 'solana-devnet', payTo: validAddress, amount: 0.001, currency: 'SOL', nonce, payer: otherValidAddress, signature });
      const usdcReceipt = (extra: Record<string, unknown> = {}) => ({ network: 'solana-devnet', payTo: validAddress, amount: '0.03', currency: 'USDC', nonce: challenge.nonce, payer: otherValidAddress, signature: 'sig-usdc', ...extra });
      const verifierFor = (transaction: unknown, mint?: string) => new SolanaReceiptVerifier({
        allowRealPayment: true,
        usdcMint: mint,
        connection: { async getParsedTransaction() { return transaction; } },
      });

      it('refuses a second challenge paid with an already-used transaction signature, even under a fresh nonce', async () => {
        const store = new MemoryNonceReplayStore();
        const verifier = verifierFor(solTransaction());
        const first = await verifier.verifyReceipt(solReceipt('nonce-one'), solChallengeFor('nonce-one'), store);
        expect(first.ok).toBe(true);
        const second = await verifier.verifyReceipt(solReceipt('nonce-two'), solChallengeFor('nonce-two'), store);
        expect(second.ok).toBe(false);
        if (!second.ok) {
          expect(second.reason).toBe('duplicate_nonce');
          expect(second.message).toMatch(/transaction signature/);
        }
      });

      it('accepts two different transactions for two challenges', async () => {
        const store = new MemoryNonceReplayStore();
        const verifier = verifierFor(solTransaction());
        expect((await verifier.verifyReceipt(solReceipt('nonce-one', 'sig-one'), solChallengeFor('nonce-one'), store)).ok).toBe(true);
        expect((await verifier.verifyReceipt(solReceipt('nonce-two', 'sig-two'), solChallengeFor('nonce-two'), store)).ok).toBe(true);
      });

      it('refuses a real receipt when no replay store is supplied', async () => {
        const result = await verifierFor(solTransaction()).verifyReceipt(solReceipt('nonce-one'), solChallengeFor('nonce-one'));
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe('unsupported_receipt');
          expect(result.message).toMatch(/replay store/);
        }
      });

      it('does not record a signature when the transaction fails to pay the challenge', async () => {
        const store = new MemoryNonceReplayStore();
        const verifier = verifierFor(solTransaction());
        const wrongPayer = await verifier.verifyReceipt({ ...solReceipt('nonce-one'), payer: validAddress }, solChallengeFor('nonce-one'), store);
        expect(wrongPayer.ok).toBe(false);
        expect(store.size).toBe(0);
        const rightful = await verifier.verifyReceipt(solReceipt('nonce-one'), solChallengeFor('nonce-one'), store);
        expect(rightful.ok).toBe(true);
      });

      it('reports an unconfigured USDC mint as unsupported instead of trusting the receipt mint', async () => {
        const transaction = usdcTransaction({ type: 'transferChecked', info: { mint: otherMint, authority: otherValidAddress, destination: 'dest-token-account', tokenAmount: { uiAmountString: '0.03' } } }, otherMint);
        const result = await verifierFor(transaction).verifyReceipt(usdcReceipt({ mint: otherMint }), challenge, new MemoryNonceReplayStore());
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe('unsupported_receipt');
          expect(result.message).toMatch(/usdcMint/);
        }
      });

      it('rejects a receipt that names a mint other than the configured USDC mint', async () => {
        const transaction = usdcTransaction({ type: 'transferChecked', info: { mint: otherMint, authority: otherValidAddress, destination: 'dest-token-account', tokenAmount: { uiAmountString: '0.03' } } }, otherMint);
        const result = await verifierFor(transaction, usdcMint).verifyReceipt(usdcReceipt({ mint: otherMint }), challenge, new MemoryNonceReplayStore());
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('invalid_receipt');
      });

      it('rejects a transfer of another mint even when the receipt names no mint', async () => {
        const transaction = usdcTransaction({ type: 'transferChecked', info: { mint: otherMint, authority: otherValidAddress, destination: 'dest-token-account', tokenAmount: { uiAmountString: '0.03' } } }, otherMint);
        const result = await verifierFor(transaction, usdcMint).verifyReceipt(usdcReceipt(), challenge, new MemoryNonceReplayStore());
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('invalid_receipt');
      });

      it('rejects an unchecked token transfer, which names no mint and reports raw base units', async () => {
        const transaction = usdcTransaction({ type: 'transfer', info: { authority: otherValidAddress, destination: 'dest-token-account', amount: '0.03' } });
        const result = await verifierFor(transaction, usdcMint).verifyReceipt(usdcReceipt(), challenge, new MemoryNonceReplayStore());
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('invalid_receipt');
      });
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

describe('DatabaseReplayStore', () => {
  const fakeDatabase = () => {
    const seen = new Set<string>();
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    return {
      calls,
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        const key = String(args.p_key);
        if (seen.has(key)) return { data: false, error: null };
        seen.add(key);
        return { data: true, error: null };
      },
    };
  };

  it('accepts a key once and refuses it afterwards, including from a second instance', async () => {
    const db = fakeDatabase();
    const first = new DatabaseReplayStore({ rpc: db.rpc });
    const second = new DatabaseReplayStore({ rpc: db.rpc });
    expect(await first.checkAndStore('x402:tx:solana-devnet:sig')).toBe(true);
    expect(await first.checkAndStore('x402:tx:solana-devnet:sig')).toBe(false);
    expect(await second.checkAndStore('x402:tx:solana-devnet:sig')).toBe(false);
    expect(db.calls[0]).toEqual({ fn: 'replay_check_and_store', args: { p_key: 'x402:tx:solana-devnet:sig' } });
  });

  it('calls a custom function name when one is given', async () => {
    const db = fakeDatabase();
    await new DatabaseReplayStore({ rpc: db.rpc, functionName: 'custom_fn' }).checkAndStore('k');
    expect(db.calls[0].fn).toBe('custom_fn');
  });

  it('fails closed on a database error, an unexpected answer or an empty key', async () => {
    const failing = new DatabaseReplayStore({ rpc: async () => ({ data: null, error: { message: 'connection refused: secret-host' } }) });
    await expect(failing.checkAndStore('k')).rejects.toThrow('replay store is unavailable');
    await expect(failing.checkAndStore('k')).rejects.not.toThrow('secret-host');
    for (const data of [null, undefined, 'true', 1, {}]) {
      const odd = new DatabaseReplayStore({ rpc: async () => ({ data, error: null }) });
      await expect(odd.checkAndStore('k')).rejects.toThrow('unexpected answer');
    }
    const db = fakeDatabase();
    await expect(new DatabaseReplayStore({ rpc: db.rpc }).checkAndStore('')).rejects.toThrow('non-empty');
    expect(db.calls.length).toBe(0);
  });

  it('does not accept a real payment when the replay store is down', async () => {
    const verifier = new SolanaReceiptVerifier({
      allowRealPayment: true,
      connection: {
        async getParsedTransaction() {
          return {
            meta: { err: null },
            transaction: { message: { instructions: [{ programId: { toString: () => '11111111111111111111111111111111' }, parsed: { type: 'transfer', info: { source: otherValidAddress, destination: validAddress, lamports: 1_000_000 } } }] } },
          };
        },
      },
    });
    const challenge = buildX402Challenge({ network: 'solana-devnet', payTo: validAddress, amount: 0.001, currency: 'SOL', endpoint: 'https://planning.example.test/v1/chat/completions', nonce: 'db-down' });
    const down = new DatabaseReplayStore({ rpc: async () => ({ data: null, error: { message: 'down' } }) });
    await expect(
      verifier.verifyReceipt({ network: 'solana-devnet', payTo: validAddress, amount: 0.001, currency: 'SOL', nonce: 'db-down', payer: otherValidAddress, signature: 'sig-db-down' }, challenge, down),
    ).rejects.toThrow('replay store is unavailable');
  });
});
