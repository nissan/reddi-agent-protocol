import { quoteMeteredCall, settleMeteredCall, tokenCostBaseUnits } from '../src/metered';
import { LAUNCH_RATE_ENDS_AT_MS } from '../src/payment';

// Times either side of the switch from the 2.5% launch rate to the standard 5%.
const LAUNCH = LAUNCH_RATE_ENDS_AT_MS - 1;
const STANDARD = LAUNCH_RATE_ENDS_AT_MS;

// An inference listing priced like most AI APIs: per million input and output tokens.
const usdc = { currency: 'USDC', inputPerMillion: '0.15', outputPerMillion: '0.6' };

describe('per-token pricing and metered settlement', () => {
  it('prices tokens per million and rounds the total up to the next base unit', () => {
    expect(tokenCostBaseUnits(usdc, { inputTokens: 1_000_000, outputTokens: 0 })).toBe(BigInt(150_000));
    expect(tokenCostBaseUnits(usdc, { inputTokens: 2_000, outputTokens: 1_000 })).toBe(BigInt(900));
    // 1 input token costs 0.15 base units, which rounds up to 1.
    expect(tokenCostBaseUnits(usdc, { inputTokens: 1, outputTokens: 0 })).toBe(BigInt(1));
    expect(tokenCostBaseUnits(usdc, { inputTokens: 0, outputTokens: 0 })).toBe(BigInt(0));
    expect(() => tokenCostBaseUnits(usdc, { inputTokens: -1, outputTokens: 0 })).toThrow('whole number');
    expect(() => tokenCostBaseUnits(usdc, { inputTokens: 1.5, outputTokens: 0 })).toThrow('whole number');
    expect(() => tokenCostBaseUnits({ ...usdc, inputPerMillion: '0.0000001' }, { inputTokens: 1, outputTokens: 0 })).toThrow('decimal places');
    expect(() => tokenCostBaseUnits({ ...usdc, currency: 'EURC' }, { inputTokens: 1, outputTokens: 0 })).toThrow('unsupported');
  });

  it('quotes an estimate and a buyer-authorised maximum that must cover it', () => {
    const quote = quoteMeteredCall(usdc, { inputTokens: 20_000, outputTokens: 10_000 }, '0.02', LAUNCH);
    expect(quote).toEqual({ currency: 'USDC', estimatedCost: '0.009', maxCharge: '0.02', estimatedFee: '0.000225' });
    expect(() => quoteMeteredCall(usdc, { inputTokens: 20_000, outputTokens: 10_000 }, '0.008', LAUNCH)).toThrow('at least the estimated cost');
  });

  it('settles the actual cost: 2.5% to the treasury, the rest to the provider, the unused maximum back to the buyer', () => {
    const settled = settleMeteredCall(usdc, { inputTokens: 18_000, outputTokens: 12_500 }, '0.02', LAUNCH);
    expect(settled).toMatchObject({
      actualCost: '0.0102', charged: '0.0102', fee: '0.000255', provider: '0.009945', refund: '0.0098', capped: false,
    });
    expect(settled.chargedBaseUnits).toBe(BigInt(10_200));
  });

  it('never charges above the authorised maximum', () => {
    const settled = settleMeteredCall(usdc, { inputTokens: 100_000, outputTokens: 100_000 }, '0.02', LAUNCH);
    expect(settled).toMatchObject({ actualCost: '0.075', charged: '0.02', fee: '0.0005', provider: '0.0195', refund: '0', capped: true });
  });

  it('caps the fee at 0.1 SOL for SOL and not for tokens', () => {
    const sol = { currency: 'SOL', inputPerMillion: '1', outputPerMillion: '1' };
    // 5,000,000 tokens at 1 SOL per million = 5 SOL; 2.5% would be 0.125 SOL.
    expect(settleMeteredCall(sol, { inputTokens: 5_000_000, outputTokens: 0 }, '6', LAUNCH)).toMatchObject({ charged: '5', fee: '0.1', provider: '4.9', refund: '1' });
    const big = { currency: 'USDC', inputPerMillion: '1000', outputPerMillion: '0' };
    expect(settleMeteredCall(big, { inputTokens: 1_000_000, outputTokens: 0 }, '1000', LAUNCH)).toMatchObject({ fee: '25', provider: '975' });
  });

  it('settles at 5% from the end of the launch rate, with the 0.1 SOL ceiling from 2 SOL', () => {
    expect(settleMeteredCall(usdc, { inputTokens: 18_000, outputTokens: 12_500 }, '0.02', STANDARD))
      .toMatchObject({ charged: '0.0102', fee: '0.00051', provider: '0.00969', refund: '0.0098' });
    expect(quoteMeteredCall(usdc, { inputTokens: 20_000, outputTokens: 10_000 }, '0.02', STANDARD).estimatedFee).toBe('0.00045');
    const sol = { currency: 'SOL', inputPerMillion: '1', outputPerMillion: '1' };
    expect(settleMeteredCall(sol, { inputTokens: 2_000_000, outputTokens: 0 }, '3', STANDARD)).toMatchObject({ charged: '2', fee: '0.1', provider: '1.9' });
  });
});
