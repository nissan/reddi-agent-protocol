import {
  assetNetworkKey,
  evaluateBudgetPolicy,
  type BudgetPolicy,
} from '../src/budget-policy';

const basePolicy: BudgetPolicy = {
  schemaVersion: 'reddi.budget-policy.v1',
  limits: {
    perRequest: { maxAmount: '100000' },
    perSession: { maxAmount: '500000' },
    perSource: {
      'source:planning': { maxAmount: '250000' },
    },
    perSpecialist: {
      'specialist:coder': { maxAmount: '300000' },
    },
    perAssetNetwork: [
      { asset: 'USDC', network: 'solana-devnet', maxAmount: '400000' },
    ],
    callCount: { maxCalls: 5 },
  },
};

const quote = {
  amount: '50000',
  asset: 'USDC',
  network: 'solana-devnet',
  source: 'source:planning',
  specialist: 'specialist:coder',
};

describe('local buyer budget policy evaluator', () => {
  it('denies when a budget policy is missing', () => {
    const decision = evaluateBudgetPolicy({ policy: null, quote });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain('budget_policy_missing');
    expect(decision.quotedAmount?.amount).toBe('50000');
    expect(decision.auditNotes.join(' ')).toContain('budget policy is required');
  });

  it('denies malformed limits without throwing', () => {
    const decision = evaluateBudgetPolicy({
      policy: {
        schemaVersion: 'reddi.budget-policy.v1',
        limits: {
          perRequest: { maxAmount: '1.5' },
          callCount: { maxCalls: 1.2 },
        },
      },
      quote,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain('malformed_limit');
    expect(decision.auditNotes.length).toBeGreaterThanOrEqual(2);
  });

  it('denies unsupported policy schema versions instead of authorizing spend', () => {
    const decision = evaluateBudgetPolicy({
      policy: {
        ...basePolicy,
        // @ts-expect-error exercising runtime fail-closed validation
        schemaVersion: 'reddi.budget-policy.v2',
      },
      quote,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain('malformed_limit');
    expect(decision.auditNotes.join(' ')).toContain('policy.schemaVersion');
  });

  it('denies array policy limits instead of treating them as empty limits', () => {
    const decision = evaluateBudgetPolicy({
      policy: {
        schemaVersion: 'reddi.budget-policy.v1',
        // @ts-expect-error exercising runtime fail-closed validation
        limits: [],
      },
      quote,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain('malformed_limit');
    expect(decision.auditNotes.join(' ')).toContain('policy.limits');
  });

  it('denies non-plain policy limits instead of treating them as empty limits', () => {
    class LimitEnvelope {
      perRequest = { maxAmount: '100000' };
    }
    const probes = [
      new LimitEnvelope(),
      new Date(),
      Object.create(null),
    ];

    for (const limits of probes) {
      const decision = evaluateBudgetPolicy({
        policy: {
          schemaVersion: 'reddi.budget-policy.v1',
          limits,
        },
        quote,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reasonCodes).toContain('malformed_limit');
      expect(decision.auditNotes.join(' ')).toContain('policy.limits');
    }
  });

  it('denies malformed nested limit maps instead of ignoring them', () => {
    const decision = evaluateBudgetPolicy({
      policy: {
        schemaVersion: 'reddi.budget-policy.v1',
        limits: {
          // @ts-expect-error exercising runtime fail-closed validation
          perSource: new Date(),
        },
      },
      quote,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain('malformed_limit');
    expect(decision.auditNotes.join(' ')).toContain('perSource');
  });

  it('denies malformed asset-network entries without throwing', () => {
    const probes = [
      new Date(),
      Object.create(null),
      { asset: 123, network: 'solana-devnet', maxAmount: '100000' },
    ];

    for (const entry of probes) {
      const decision = evaluateBudgetPolicy({
        policy: {
          schemaVersion: 'reddi.budget-policy.v1',
          limits: {
            perAssetNetwork: [entry],
          },
        },
        quote,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reasonCodes).toContain('malformed_limit');
      expect(decision.auditNotes.join(' ')).toContain('perAssetNetwork');
    }
  });

  it('denies over-spend at request, session, source, specialist, and asset-network levels', () => {
    const decision = evaluateBudgetPolicy({
      policy: basePolicy,
      quote: { ...quote, amount: '150000' },
      usage: {
        sessionSpent: '400000',
        sourceSpent: { 'source:planning': '150000' },
        specialistSpent: { 'specialist:coder': '200000' },
        assetNetworkSpent: { [assetNetworkKey('USDC', 'solana-devnet')]: '300000' },
      },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toEqual(expect.arrayContaining([
      'request_amount_exceeds_limit',
      'session_budget_exceeded',
      'source_budget_exceeded',
      'specialist_budget_exceeded',
      'asset_network_budget_exceeded',
    ]));
    expect(decision.remainingBudget.perRequest).toBe('0');
    expect(decision.remainingBudget.perSession).toBe('0');
    expect(decision.remainingBudget.perSource).toBe('0');
    expect(decision.remainingBudget.perSpecialist).toBe('0');
    expect(decision.remainingBudget.perAssetNetwork).toBe('0');
  });

  it('denies when the local call-count budget is exhausted', () => {
    const decision = evaluateBudgetPolicy({
      policy: basePolicy,
      quote,
      usage: { callCount: 5 },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain('call_count_exceeded');
    expect(decision.remainingBudget.callCount).toBe(0);
  });

  it('denies unsupported asset/network pairs', () => {
    const decision = evaluateBudgetPolicy({
      policy: basePolicy,
      quote: { ...quote, asset: 'SOL', network: 'solana-mainnet-beta' },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain('unsupported_asset_network');
    expect(decision.quotedAmount).toMatchObject({ asset: 'SOL', network: 'solana-mainnet-beta' });
  });

  it('allows a quote within every configured local budget and reports remaining budget', () => {
    const decision = evaluateBudgetPolicy({
      policy: basePolicy,
      quote,
      usage: {
        sessionSpent: '100000',
        sourceSpent: { 'source:planning': '25000' },
        specialistSpent: { 'specialist:coder': '50000' },
        assetNetworkSpent: { [assetNetworkKey('usdc', 'SOLANA-DEVNET')]: '100000' },
        callCount: 2,
      },
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCodes).toEqual(['allowed']);
    expect(decision.quotedAmount).toEqual({
      amount: '50000',
      asset: 'USDC',
      network: 'solana-devnet',
      source: 'source:planning',
      specialist: 'specialist:coder',
    });
    expect(decision.remainingBudget).toEqual({
      perRequest: '50000',
      perSession: '350000',
      perSource: '175000',
      perSpecialist: '200000',
      perAssetNetwork: '250000',
      callCount: 2,
    });
    expect(decision.auditNotes.join(' ')).toContain('Allowed');
  });
});
