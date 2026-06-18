"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateBudgetPolicy = evaluateBudgetPolicy;
exports.assetNetworkKey = assetNetworkKey;
function evaluateBudgetPolicy(input) {
    const state = { reasonCodes: [], remainingBudget: {}, auditNotes: [] };
    const quoted = normalizeQuote(input.quote, state);
    if (!input.policy) {
        state.reasonCodes.push('budget_policy_missing');
        state.auditNotes.push('Denied: budget policy is required before buyer preflight can authorize spend.');
        return decision(false, state, quoted);
    }
    if (!quoted)
        return decision(false, state, null);
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
function normalizeQuote(quote, state) {
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
function checkPerRequest(limit, amount, state) {
    if (!limit)
        return;
    const max = normalizeLimit(limit, 'perRequest', state);
    if (max === undefined)
        return;
    const remaining = max - amount;
    state.remainingBudget.perRequest = stringifyRemaining(remaining);
    if (remaining < 0n) {
        state.reasonCodes.push('request_amount_exceeds_limit');
        state.auditNotes.push(`Denied: request quote ${amount} exceeds per-request limit ${max}.`);
    }
}
function checkPerSession(limit, amount, spent, state) {
    if (!limit)
        return;
    const max = normalizeLimit(limit, 'perSession', state);
    const used = normalizeUsage(spent, 'sessionSpent', state);
    if (max === undefined || used === undefined)
        return;
    const remaining = max - used - amount;
    state.remainingBudget.perSession = stringifyRemaining(remaining);
    if (remaining < 0n) {
        state.reasonCodes.push('session_budget_exceeded');
        state.auditNotes.push(`Denied: session spend ${used} plus quote ${amount} exceeds session limit ${max}.`);
    }
}
function checkSourceLimit(kind, limits, id, amount, usage, state) {
    if (!limits)
        return;
    if (!isPlainObject(limits)) {
        malformed(state, `${kind} must be a plain object keyed by source or specialist id`);
        return;
    }
    if (!id)
        return;
    const key = id;
    const limit = limits[key];
    if (!limit)
        return;
    const max = normalizeLimit(limit, `${kind}.${key}`, state);
    const used = normalizeUsage(usage?.[key], `${kind}.${key}.spent`, state);
    if (max === undefined || used === undefined)
        return;
    const remaining = max - used - amount;
    if (kind === 'perSource')
        state.remainingBudget.perSource = stringifyRemaining(remaining);
    else
        state.remainingBudget.perSpecialist = stringifyRemaining(remaining);
    if (remaining < 0n) {
        state.reasonCodes.push(kind === 'perSource' ? 'source_budget_exceeded' : 'specialist_budget_exceeded');
        state.auditNotes.push(`Denied: ${kind} spend ${used} plus quote ${amount} exceeds limit ${max} for ${key}.`);
    }
}
function checkAssetNetworkLimit(limits, quote, usage, state) {
    if (!limits)
        return;
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
    if (max === undefined || used === undefined)
        return;
    const remaining = max - used - quote.amount;
    state.remainingBudget.perAssetNetwork = stringifyRemaining(remaining);
    if (remaining < 0n) {
        state.reasonCodes.push('asset_network_budget_exceeded');
        state.auditNotes.push(`Denied: ${quote.asset}/${quote.network} spend ${used} plus quote ${quote.amount} exceeds limit ${max}.`);
    }
}
function checkCallCount(limit, usedCalls, state) {
    if (!limit)
        return;
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
function normalizeLimit(limit, path, state) {
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
function normalizeUsage(amount, path, state) {
    if (amount === undefined)
        return 0n;
    const normalized = normalizeAmount(amount);
    if (normalized === undefined || normalized < 0n) {
        malformed(state, `${path} must be a non-negative integer amount`);
        return undefined;
    }
    return normalized;
}
function normalizeAmount(amount) {
    if (typeof amount === 'bigint')
        return amount;
    if (typeof amount === 'number') {
        if (!Number.isSafeInteger(amount))
            return undefined;
        return BigInt(amount);
    }
    if (typeof amount === 'string' && /^\d+$/.test(amount))
        return BigInt(amount);
    return undefined;
}
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function decision(allowed, state, quote) {
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
function malformed(state, note) {
    state.reasonCodes.push('malformed_limit');
    state.auditNotes.push(`Denied: ${note}.`);
}
function stringifyRemaining(value) {
    return String(value < 0n ? 0n : value);
}
function dedupeReasons(reasons) {
    return Array.from(new Set(reasons));
}
function assetNetworkKey(asset, network) {
    return `${normalizeAsset(asset)}:${normalizeNetwork(network)}`;
}
function normalizeAsset(asset) {
    return asset.trim().toUpperCase();
}
function normalizeNetwork(network) {
    return network.trim().toLowerCase();
}
