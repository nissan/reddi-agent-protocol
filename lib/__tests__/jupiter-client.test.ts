/**
 * Unit tests for lib/jupiter-client.ts
 *
 * BDD: Bucket F — Cross-Token Settlement
 * F1.5: getJupiterClient() returns a usable client even without API key
 * F1.6: getJupiterClient() returns singleton and honors env configuration
 */

import type { JupiterSwapV2Client } from '@reddi/x402-solana';

describe('getJupiterClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns a client instance when JUPITER_API_KEY is not set', async () => {
    delete process.env.JUPITER_API_KEY;
    const { getJupiterClient } = await import('../jupiter-client');
    const client = getJupiterClient();
    expect(client).not.toBeNull();
    expect(typeof client).toBe('object');
  });

  it('returns a client instance when JUPITER_API_KEY is set', async () => {
    process.env.JUPITER_API_KEY = 'test-key-123';
    const { getJupiterClient } = await import('../jupiter-client');
    const client = getJupiterClient();
    expect(client).not.toBeNull();
    expect(typeof client).toBe('object');
  });

  it('returns the same instance on repeated calls (singleton)', async () => {
    process.env.JUPITER_API_KEY = 'test-key-123';
    const { getJupiterClient } = await import('../jupiter-client');
    const c1 = getJupiterClient();
    const c2 = getJupiterClient();
    expect(c1).toBe(c2);
  });

  it('uses custom API and quote bases from env vars', async () => {
    process.env.JUPITER_API_KEY = 'test-key-123';
    process.env.JUPITER_API_BASE = 'https://custom.jup.ag/swap/v2';
    process.env.JUPITER_QUOTE_API_BASE = 'https://custom.jup.ag/swap/v1';
    const constructorOptions: Array<ConstructorParameters<typeof JupiterSwapV2Client>[0]> = [];
    jest.doMock('../../packages/x402-solana/src/index', () => ({
      JupiterSwapV2Client: class {
        constructor(options: ConstructorParameters<typeof JupiterSwapV2Client>[0]) {
          constructorOptions.push(options);
        }
      },
    }));
    try {
      const { getJupiterClient } = await import('../jupiter-client');
      getJupiterClient();
      expect(constructorOptions).toEqual([{
        apiBaseUrl: 'https://custom.jup.ag/swap/v2',
        quoteApiBaseUrl: 'https://custom.jup.ag/swap/v1',
        apiKey: 'test-key-123',
      }]);
    } finally {
      jest.dontMock('../../packages/x402-solana/src/index');
    }
  });

  it('getJupiterSlippageBps returns 50 by default', async () => {
    delete process.env.JUPITER_SLIPPAGE_BPS;
    const { getJupiterSlippageBps } = await import('../jupiter-client');
    expect(getJupiterSlippageBps()).toBe(50);
  });

  it('getJupiterSlippageBps reads from JUPITER_SLIPPAGE_BPS env var', async () => {
    process.env.JUPITER_SLIPPAGE_BPS = '100';
    const { getJupiterSlippageBps } = await import('../jupiter-client');
    expect(getJupiterSlippageBps()).toBe(100);
  });
});
