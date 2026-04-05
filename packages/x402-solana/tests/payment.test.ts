import {
  parseX402Header,
  sendPayment,
  isValidPaymentAddress,
} from '../src/payment';
import {
  checkAndStoreNonce,
  clearNonces,
  getNonceCount,
} from '../src/nonce';
import { createX402Middleware, createX402Header } from '../src/middleware';

describe('x402 Payment Module', () => {
  afterEach(() => {
    clearNonces(); // Clean up between tests
  });

  describe('parseX402Header', () => {
    it('should parse valid x402-request header', () => {
      const header = JSON.stringify({
        amount: 1000,
        currency: 'SOL',
        paymentAddress: 'BaDZtpgWpDx6H1y8Dga2cfyxs3RXj5y2fkBo7HoT2pdv',
        nonce: 'abc123',
      });

      const result = parseX402Header(header);
      expect(result.amount).toBe(1000);
      expect(result.currency).toBe('SOL');
      expect(result.paymentAddress).toBe('BaDZtpgWpDx6H1y8Dga2cfyxs3RXj5y2fkBo7HoT2pdv');
      expect(result.nonce).toBe('abc123');
    });

    it('should reject zero amount', () => {
      const header = JSON.stringify({
        amount: 0,
        currency: 'SOL',
        paymentAddress: 'BaDZtpgWpDx6H1y8Dga2cfyxs3RXj5y2fkBo7HoT2pdv',
        nonce: 'abc123',
      });

      expect(() => parseX402Header(header)).toThrow('amount must be a positive number');
    });

    it('should reject negative amount', () => {
      const header = JSON.stringify({
        amount: -100,
        currency: 'SOL',
        paymentAddress: 'BaDZtpgWpDx6H1y8Dga2cfyxs3RXj5y2fkBo7HoT2pdv',
        nonce: 'abc123',
      });

      expect(() => parseX402Header(header)).toThrow('amount must be a positive number');
    });

    it('should reject missing paymentAddress', () => {
      const header = JSON.stringify({
        amount: 1000,
        currency: 'SOL',
        nonce: 'abc123',
      });

      expect(() => parseX402Header(header)).toThrow('paymentAddress is required');
    });

    it('should reject missing nonce', () => {
      const header = JSON.stringify({
        amount: 1000,
        currency: 'SOL',
        paymentAddress: 'BaDZtpgWpDx6H1y8Dga2cfyxs3RXj5y2fkBo7HoT2pdv',
      });

      expect(() => parseX402Header(header)).toThrow('nonce is required');
    });

    it('should reject invalid JSON', () => {
      const header = '{invalid json}';
      expect(() => parseX402Header(header)).toThrow('x402-request header is not valid JSON');
    });
  });

  describe('Nonce Store', () => {
    it('should accept first nonce', () => {
      const result = checkAndStoreNonce('nonce-1');
      expect(result).toBe(true);
    });

    it('should reject duplicate nonce', () => {
      checkAndStoreNonce('nonce-1');
      const result = checkAndStoreNonce('nonce-1');
      expect(result).toBe(false);
    });

    it('should accept different nonces', () => {
      checkAndStoreNonce('nonce-1');
      const result = checkAndStoreNonce('nonce-2');
      expect(result).toBe(true);
    });

    it('should allow re-acceptance after clearNonces', () => {
      checkAndStoreNonce('nonce-1');
      expect(getNonceCount()).toBe(1);

      clearNonces();
      expect(getNonceCount()).toBe(0);

      const result = checkAndStoreNonce('nonce-1');
      expect(result).toBe(true);
    });
  });

  describe('Payment Address Validation', () => {
    it('should validate correct Solana address', () => {
      const address = 'BaDZtpgWpDx6H1y8Dga2cfyxs3RXj5y2fkBo7HoT2pdv';
      expect(isValidPaymentAddress(address)).toBe(true);
    });

    it('should reject address that is too short', () => {
      expect(isValidPaymentAddress('short')).toBe(false);
    });

    it('should reject address that is too long', () => {
      const tooLong = 'a'.repeat(50);
      expect(isValidPaymentAddress(tooLong)).toBe(false);
    });

    it('should accept 32-44 character addresses', () => {
      expect(isValidPaymentAddress('a'.repeat(32))).toBe(true);
      expect(isValidPaymentAddress('a'.repeat(44))).toBe(true);
    });
  });

  describe('sendPayment', () => {
    it('should return receipt with matching amount and nonce', async () => {
      const request = {
        amount: 5000,
        currency: 'SOL',
        paymentAddress: 'BaDZtpgWpDx6H1y8Dga2cfyxs3RXj5y2fkBo7HoT2pdv',
        nonce: 'test-nonce-123',
      };

      const receipt = await sendPayment(request);
      expect(receipt.lamports).toBe(5000);
      expect(receipt.nonce).toBe('test-nonce-123');
      expect(receipt.txSignature).toBeDefined();
      expect(receipt.slot).toBeDefined();
    });
  });

  describe('Middleware Helper', () => {
    it('should create valid x402-request header', () => {
      const header = createX402Header(1000, 'BaDZtpgWpDx6H1y8Dga2cfyxs3RXj5y2fkBo7HoT2pdv', 'nonce-123');
      const parsed = parseX402Header(header);
      expect(parsed.amount).toBe(1000);
      expect(parsed.nonce).toBe('nonce-123');
    });
  });
});
