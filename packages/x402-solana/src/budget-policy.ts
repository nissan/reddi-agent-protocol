export type BudgetPolicyAmount = bigint | number | string;

export type BudgetPolicyReasonCode =
  | 'allowed'
  | 'budget_policy_missing'
  | 'invalid_quote'
  | 'malformed_limit'
  | 'request_amount_exceeds_limit'
  | 'session_budget_exceeded'
  | 'source_budget_exceeded'
  | 'specialist_budget_exceeded'
  | 'asset_network_budget_exceeded'
  | 'call_count_exceeded'
  | 'unsupported_asset_network';

export type BudgetPolicyAssetNetwork = {
  asset: string;
  network: string;
};

export type BudgetAmountLimit = {
  /** Maximum spend in the asset's smallest unit. */
  maxAmount: BudgetPolicyAmount;
  note?: string;
};

export type BudgetAssetNetworkLimit = BudgetPolicyAssetNetwork & BudgetAmountLimit;

export type BudgetCallCountLimit = {
  maxCalls: number;
  note?: string;
};

export type BudgetPolicy = {
  schemaVersion: 'reddi.budget-policy.v1';
  limits: {
    perRequest?: BudgetAmountLimit;
    perSession?: BudgetAmountLimit;
    perSource?: Record<string, BudgetAmountLimit>;
    perSpecialist?: Record<string, BudgetAmountLimit>;
    perAssetNetwork?: BudgetAssetNetworkLimit[];
    callCount?: BudgetCallCountLimit;
  };
};

export type BudgetPolicyUsage = {
  sessionSpent?: BudgetPolicyAmount;
  sourceSpent?: Record<string, BudgetPolicyAmount>;
  specialistSpent?: Record<string, BudgetPolicyAmount>;
  assetNetworkSpent?: Record<string, BudgetPolicyAmount>;
  callCount?: number;
};

export type BudgetPolicyQuote = BudgetPolicyAssetNetwork & {
  /** Quoted spend in the asset's smallest unit. */
  amount: BudgetPolicyAmount;
  source?: string;
  specialist?: string;
};

export type BudgetRemaining = {
  perRequest?: string;
  perSession?: string;
  perSource?: string;
  perSpecialist?: string;
  perAssetNetwork?: string;
  callCount?: number;
};

export type BudgetPolicyDecision = {
  schemaVersion: 'reddi.budget-policy-decision.v1';
  allowed: boolean;
  reasonCodes: BudgetPolicyReasonCode[];
  quotedAmount: {
    amount: string;
    asset: string;
    network: string;
    source?: string;
    specialist?: string;
  } | null;
  remainingBudget: BudgetRemaining;
  auditNotes: string[];
};

type EvaluationState = {
  reasonCodes: BudgetPolicyReasonCode[];
  remainingBudget: BudgetRemaining;
  auditNotes: string[];
};

export function evaluateBudgetPolicy(input: {
  policy?: BudgetPolicy | null;
  quote: BudgetPolicyQuote;
  usage?: BudgetPolicyUsage;
}): BudgetPolicyDecision {
  const state: EvaluationState = { reasonCodes: [], remainingBudget: {}, auditNotes: [] };
  const quoted = normalizeQuote(input.quote, state);

  if (!input.policy) {
    state.reasonCodes.push('budget_policy_missing');
    state.auditNotes.push('Denied: budget policy is required before buyer preflight can authorize spend.');
    return decision(false, state, quoted);
  }

  if (!quoted) return decision(false, state, null);

  if (input.policy.schemaVersion !== 'reddi.budget-policy.v1') {
    malformed(state, 'policy.schemaVersion must be reddi.budget-policy.v1');
    return decision(false, state, quoted);
  }

  if (!isPlainObject(input.policy.limits)) {
    malformed(state, 'policy.limits must be a plain object');
    return decision(false, state, quoted);
  }

  const usage = input.usage ?? {};
  checkPerRequest(input.policy.limits.perRequest, quoted.amount, state);
  checkPerSession(input.policy.limits.perSession, quoted.amount, usage.sessionSpent, state);
  checkSourceLimit('perSource', input.policy.limits.perSource, quoted.source, quoted.amount, usage.sourceSpent, state);
  checkSourceLimit('perSpecialist', input.policy.limits.perSpecialist, quoted.specialist, quoted.amount, usage.specialistSpent, state);
  checkAssetNetworkLimit(input.policy.limits.perAssetNetwork, quoted, usage.assetNetworkSpent, state);
  checkCallCount(input.policy.limits.callCount, usage.callCount, state);

  const allowed = state.reasonCodes.length === 0;
  if (allowed) {
    state.reasonCodes.push('allowed');
    state.auditNotes.push('Allowed: quoted spend is within all configured local buyer budget limits.');
  }
  return decision(allowed, state, quoted);
}

function normalizeQuote(quote: BudgetPolicyQuote, state: EvaluationState): (Omit<BudgetPolicyQuote, 'amount'> & { amount: bigint }) | null {
  const amount = normalizeAmount(quote.amount);
  if (amount === undefined || amount <= 0n || !quote.asset || !quote.network) {
    state.reasonCodes.push('invalid_quote');
    state.auditNotes.push('Denied: quote must include a positive integer amount, asset, and network.');
    return null;
  }
  return {
    amount,
    asset: normalizeAsset(quote.asset),
    network: normalizeNetwork(quote.network),
    source: quote.source,
    specialist: quote.specialist,
  };
}

function checkPerRequest(limit: BudgetAmountLimit | undefined, amount: bigint, state: EvaluationState): void {
  if (!limit) return;
  const max = normalizeLimit(limit, 'perRequest', state);
  if (max === undefined) return;
  const remaining = max - amount;
  state.remainingBudget.perRequest = stringifyRemaining(remaining);
  if (remaining < 0n) {
    state.reasonCodes.push('request_amount_exceeds_limit');
    state.auditNotes.push(`Denied: request quote ${amount} exceeds per-request limit ${max}.`);
  }
}

function checkPerSession(limit: BudgetAmountLimit | undefined, amount: bigint, spent: BudgetPolicyAmount | undefined, state: EvaluationState): void {
  if (!limit) return;
  const max = normalizeLimit(limit, 'perSession', state);
  const used = normalizeUsage(spent, 'sessionSpent', state);
  if (max === undefined || used === undefined) return;
  const remaining = max - used - amount;
  state.remainingBudget.perSession = stringifyRemaining(remaining);
  if (remaining < 0n) {
    state.reasonCodes.push('session_budget_exceeded');
    state.auditNotes.push(`Denied: session spend ${used} plus quote ${amount} exceeds session limit ${max}.`);
  }
}

function checkSourceLimit(
  kind: 'perSource' | 'perSpecialist',
  limits: Record<string, BudgetAmountLimit> | undefined,
  id: string | undefined,
  amount: bigint,
  usage: Record<string, BudgetPolicyAmount> | undefined,
  state: EvaluationState,
): void {
  if (!limits) return;
  if (!isPlainObject(limits)) {
    malformed(state, `${kind} must be a plain object keyed by source or specialist id`);
    return;
  }
  if (!id) return;
  const key = id;
  const limit = limits[key];
  if (!limit) return;
  const max = normalizeLimit(limit, `${kind}.${key}`, state);
  const used = normalizeUsage(usage?.[key], `${kind}.${key}.spent`, state);
  if (max === undefined || used === undefined) return;
  const remaining = max - used - amount;
  if (kind === 'perSource') state.remainingBudget.perSource = stringifyRemaining(remaining);
  else state.remainingBudget.perSpecialist = stringifyRemaining(remaining);
  if (remaining < 0n) {
    state.reasonCodes.push(kind === 'perSource' ? 'source_budget_exceeded' : 'specialist_budget_exceeded');
    state.auditNotes.push(`Denied: ${kind} spend ${used} plus quote ${amount} exceeds limit ${max} for ${key}.`);
  }
}

function checkAssetNetworkLimit(
  limits: BudgetAssetNetworkLimit[] | undefined,
  quote: Omit<BudgetPolicyQuote, 'amount'> & { amount: bigint },
  usage: Record<string, BudgetPolicyAmount> | undefined,
  state: EvaluationState,
): void {
  if (!limits) return;
  if (!Array.isArray(limits) || limits.length === 0) {
    malformed(state, 'perAssetNetwork must be a non-empty array');
    return;
  }
  for (const limit of limits) {
    if (!isPlainObject(limit)) {
      malformed(state, 'perAssetNetwork entries must be plain objects');
      return;
    }
    if (typeof limit.asset !== 'string' || typeof limit.network !== 'string') {
      malformed(state, 'perAssetNetwork entries must include string asset and network');
      return;
    }
  }
  const matches = limits.filter((limit) => normalizeAsset(limit.asset) === quote.asset && normalizeNetwork(limit.network) === quote.network);
  if (matches.length === 0) {
    state.reasonCodes.push('unsupported_asset_network');
    state.auditNotes.push(`Denied: ${quote.asset} on ${quote.network} is not in the local budget policy asset/network allowlist.`);
    return;
  }
  const max = normalizeLimit(matches[0], `perAssetNetwork.${quote.asset}.${quote.network}`, state);
  const used = normalizeUsage(usage?.[assetNetworkKey(quote.asset, quote.network)], `perAssetNetwork.${quote.asset}.${quote.network}.spent`, state);
  if (max === undefined || used === undefined) return;
  const remaining = max - used - quote.amount;
  state.remainingBudget.perAssetNetwork = stringifyRemaining(remaining);
  if (remaining < 0n) {
    state.reasonCodes.push('asset_network_budget_exceeded');
    state.auditNotes.push(`Denied: ${quote.asset}/${quote.network} spend ${used} plus quote ${quote.amount} exceeds limit ${max}.`);
  }
}

function checkCallCount(limit: BudgetCallCountLimit | undefined, usedCalls: number | undefined, state: EvaluationState): void {
  if (!limit) return;
  if (!isPlainObject(limit)) {
    malformed(state, 'callCount must be a plain object');
    return;
  }
  if (!Number.isInteger(limit.maxCalls) || limit.maxCalls < 0) {
    malformed(state, 'callCount.maxCalls must be a non-negative integer');
    return;
  }
  const used = usedCalls ?? 0;
  if (!Number.isInteger(used) || used < 0) {
    malformed(state, 'usage.callCount must be a non-negative integer');
    return;
  }
  const remaining = limit.maxCalls - used - 1;
  state.remainingBudget.callCount = Math.max(0, remaining);
  if (remaining < 0) {
    state.reasonCodes.push('call_count_exceeded');
    state.auditNotes.push(`Denied: call count ${used} plus this call exceeds limit ${limit.maxCalls}.`);
  }
}

function normalizeLimit(limit: BudgetAmountLimit, path: string, state: EvaluationState): bigint | undefined {
  if (!isPlainObject(limit)) {
    malformed(state, `${path} must be a plain object`);
    return undefined;
  }
  const amount = normalizeAmount(limit.maxAmount);
  if (amount === undefined || amount < 0n) {
    malformed(state, `${path}.maxAmount must be a non-negative integer amount`);
    return undefined;
  }
  return amount;
}

function normalizeUsage(amount: BudgetPolicyAmount | undefined, path: string, state: EvaluationState): bigint | undefined {
  if (amount === undefined) return 0n;
  const normalized = normalizeAmount(amount);
  if (normalized === undefined || normalized < 0n) {
    malformed(state, `${path} must be a non-negative integer amount`);
    return undefined;
  }
  return normalized;
}

function normalizeAmount(amount: BudgetPolicyAmount): bigint | undefined {
  if (typeof amount === 'bigint') return amount;
  if (typeof amount === 'number') {
    if (!Number.isSafeInteger(amount)) return undefined;
    return BigInt(amount);
  }
  if (typeof amount === 'string' && /^\d+$/.test(amount)) return BigInt(amount);
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function decision(
  allowed: boolean,
  state: EvaluationState,
  quote: (Omit<BudgetPolicyQuote, 'amount'> & { amount: bigint }) | null,
): BudgetPolicyDecision {
  return {
    schemaVersion: 'reddi.budget-policy-decision.v1',
    allowed,
    reasonCodes: dedupeReasons(state.reasonCodes),
    quotedAmount: quote ? {
      amount: String(quote.amount),
      asset: quote.asset,
      network: quote.network,
      source: quote.source,
      specialist: quote.specialist,
    } : null,
    remainingBudget: state.remainingBudget,
    auditNotes: state.auditNotes,
  };
}

function malformed(state: EvaluationState, note: string): void {
  state.reasonCodes.push('malformed_limit');
  state.auditNotes.push(`Denied: ${note}.`);
}

function stringifyRemaining(value: bigint): string {
  return String(value < 0n ? 0n : value);
}

function dedupeReasons(reasons: BudgetPolicyReasonCode[]): BudgetPolicyReasonCode[] {
  return Array.from(new Set(reasons));
}

export function assetNetworkKey(asset: string, network: string): string {
  return `${normalizeAsset(asset)}:${normalizeNetwork(network)}`;
}

function normalizeAsset(asset: string): string {
  return asset.trim().toUpperCase();
}

function normalizeNetwork(network: string): string {
  return network.trim().toLowerCase();
}
