import { AUDD_ASSET, AUDD_DECIMALS, SPL_TOKEN_PROGRAM_ID, auddRailIdentityTargetsMainnet, caip2ForSolanaNetwork, canonicalSolanaNetworkAlias, deriveCanonicalAuddRailEnvironment, getAuddRailEnvironmentConfig, validateAuddRailIdentity, } from './audd-rail-config.js';
import { canonicalPaymentHash, createPaymentIntentDraft, } from './payment-records.js';
import { evaluateBuyerPaymentChallenge, PAYMENT_CHALLENGE_SCHEMA_VERSION, } from './buyer-seller.js';
export { AUDD_ASSET } from './audd-rail-config.js';
export const AUDD_PAYMENT_PLAN_SCHEMA_VERSION = 'reddi.audd-payment-plan.v1';
export const AUDD_X402_SVM_EXACT_PAYMENT_REQUIRED_SCHEMA_VERSION = 'reddi.audd-x402-svm-exact-payment-required.v1';
export const AUDD_X402_VERSION = 2;
export const AUDD_X402_SCHEME = 'exact';
export const AUDD_X402_PAYMENT_FLOW = 'upfront';
const CREDENTIAL_KEYS = new Set([
    'api_key',
    'apikey',
    'access_token',
    'auth',
    'authorization',
    'bearer',
    'credential',
    'password',
    'private_key',
    'secret',
    'signature',
    'sig',
    'token',
    'x-amz-signature',
    'x-goog-signature',
]);
function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function positiveAmount(value) {
    return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}
function positiveSafeInteger(value) {
    return Number.isSafeInteger(value) && Number(value) > 0;
}
function amountToBigInt(value) {
    return BigInt(value);
}
function normalized(value) {
    return value.trim().toLowerCase();
}
function hasOnlyNonEmptyStrings(value) {
    return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}
function containsCredentialMaterial(value, seen = new WeakSet()) {
    if (typeof value === 'string') {
        try {
            const url = new URL(value);
            if (url.username || url.password)
                return true;
            for (const [key, item] of url.searchParams.entries()) {
                if (CREDENTIAL_KEYS.has(normalized(key)))
                    return true;
                if (/bearer\s+[a-z0-9._-]+/i.test(item))
                    return true;
            }
        }
        catch {
            if (/bearer\s+[a-z0-9._-]+/i.test(value))
                return true;
        }
        return false;
    }
    if (Array.isArray(value)) {
        if (seen.has(value))
            return false;
        seen.add(value);
        return value.some((item) => containsCredentialMaterial(item, seen));
    }
    if (!isPlainObject(value))
        return false;
    if (seen.has(value))
        return false;
    seen.add(value);
    return Object.entries(value).some(([key, item]) => (CREDENTIAL_KEYS.has(normalized(key)) || containsCredentialMaterial(item, seen)));
}
function containsCircularReference(value, seen = new WeakSet()) {
    if (Array.isArray(value)) {
        if (seen.has(value))
            return true;
        seen.add(value);
        return value.some((item) => containsCircularReference(item, seen));
    }
    if (!isPlainObject(value))
        return false;
    if (seen.has(value))
        return true;
    seen.add(value);
    return Object.values(value).some((item) => containsCircularReference(item, seen));
}
function containsModelSpendAuthorization(value, seen = new WeakSet()) {
    if (Array.isArray(value)) {
        if (seen.has(value))
            return false;
        seen.add(value);
        return value.some((item) => containsModelSpendAuthorization(item, seen));
    }
    if (!isPlainObject(value))
        return false;
    if (seen.has(value))
        return false;
    seen.add(value);
    return Object.entries(value).some(([key, item]) => {
        const normalizedKey = normalized(key);
        if ((normalizedKey === 'modelmayauthorize' || normalizedKey === 'modelauthorizedspend') && item !== false)
            return true;
        if (normalizedKey === 'authorizationstate' && item === 'model_approved')
            return true;
        return containsModelSpendAuthorization(item, seen);
    });
}
function isPaymentChallenge(value) {
    if (!isPlainObject(value))
        return false;
    if (value.schemaVersion !== PAYMENT_CHALLENGE_SCHEMA_VERSION || value.status !== 402)
        return false;
    if (!['dry-run', 'fixture', 'live'].includes(String(value.mode)))
        return false;
    if (!isPlainObject(value.quote))
        return false;
    return positiveAmount(value.quote.amount)
        && isNonEmptyString(value.quote.asset)
        && isNonEmptyString(value.quote.network)
        && isNonEmptyString(value.quote.source)
        && isNonEmptyString(value.quote.specialist)
        && isNonEmptyString(value.payTo)
        && isNonEmptyString(value.nonce)
        && isNonEmptyString(value.endpoint);
}
function validatePolicyText(value) {
    if (!isPlainObject(value))
        return false;
    return ['no_charge_on_failure', 'refund_on_failure', 'manual_review'].includes(String(value.mode))
        && isNonEmptyString(value.description);
}
function validateRefundText(value) {
    if (!isPlainObject(value))
        return false;
    if (!['none', 'automatic', 'manual_review'].includes(String(value.mode)))
        return false;
    if (!isNonEmptyString(value.description))
        return false;
    return value.refundAddress === undefined || isNonEmptyString(value.refundAddress);
}
function validateAuthority(value) {
    if (value === undefined)
        return true;
    if (!isPlainObject(value))
        return false;
    return value.modelRole === 'draft_only'
        && ['model_draft', 'policy_approved', 'operator_approved'].includes(String(value.authorizationState))
        && typeof value.operatorApprovalRequired === 'boolean'
        && (value.operatorApprovalRef === undefined || isNonEmptyString(value.operatorApprovalRef))
        && (value.policyDecisionRef === undefined || isNonEmptyString(value.policyDecisionRef));
}
function isRailEnvironment(value) {
    return ['deterministic-fixture', 'local-test-mint', 'devnet-unverified', 'mainnet-gated'].includes(String(value));
}
function isPaymentEligibility(value) {
    return ['non_eligible', 'pending_partner_acceptance', 'eligible', 'excluded'].includes(String(value));
}
export function validateAuddSolanaPaymentPlan(value) {
    if (!isPlainObject(value))
        return false;
    if (value.schemaVersion !== AUDD_PAYMENT_PLAN_SCHEMA_VERSION)
        return false;
    if (value.asset !== AUDD_ASSET)
        return false;
    if (!isNonEmptyString(value.network))
        return false;
    if (value.caip2Network !== undefined && !isNonEmptyString(value.caip2Network))
        return false;
    if (!isNonEmptyString(value.mint))
        return false;
    if (value.tokenProgram !== undefined && !isNonEmptyString(value.tokenProgram))
        return false;
    if (value.decimals !== undefined && value.decimals !== AUDD_DECIMALS)
        return false;
    if (!isNonEmptyString(value.payee))
        return false;
    if (!isNonEmptyString(value.settlementAccount))
        return false;
    if (!positiveAmount(value.amount))
        return false;
    if (!isNonEmptyString(value.quoteExpiresAt) || Number.isNaN(Date.parse(value.quoteExpiresAt)))
        return false;
    if (!validatePolicyText(value.failurePolicy))
        return false;
    if (!validateRefundText(value.refundPolicy))
        return false;
    if (typeof value.evidenceRequired !== 'boolean')
        return false;
    if (!['dry-run', 'live'].includes(String(value.paymentMode)))
        return false;
    if (value.x402Version !== undefined && value.x402Version !== AUDD_X402_VERSION)
        return false;
    if (value.scheme !== undefined && value.scheme !== AUDD_X402_SCHEME)
        return false;
    if (value.paymentFlow !== undefined && value.paymentFlow !== AUDD_X402_PAYMENT_FLOW)
        return false;
    if (value.maxTimeoutSeconds !== undefined && !positiveSafeInteger(value.maxTimeoutSeconds))
        return false;
    if (value.memo !== undefined && (!isNonEmptyString(value.memo) || value.memo.length > 256))
        return false;
    if (value.railEnvironment !== undefined && !isRailEnvironment(value.railEnvironment))
        return false;
    if (value.eligibility !== undefined && !isPaymentEligibility(value.eligibility))
        return false;
    if (!validateAuthority(value.authority))
        return false;
    if (value.paymentIntentId !== undefined && !isNonEmptyString(value.paymentIntentId))
        return false;
    if (value.evidence !== undefined) {
        if (!isPlainObject(value.evidence))
            return false;
        if (typeof value.evidence.required !== 'boolean')
            return false;
        if (value.evidence.observationSchema !== undefined && !isNonEmptyString(value.evidence.observationSchema))
            return false;
        if (value.evidence.fixtureAndDevnetIneligible !== true)
            return false;
    }
    if (containsCircularReference(value))
        return false;
    return !containsCredentialMaterial(value) && !containsModelSpendAuthorization(value);
}
export function createAuddSolanaPaymentPlan(input) {
    const plan = {
        schemaVersion: AUDD_PAYMENT_PLAN_SCHEMA_VERSION,
        asset: AUDD_ASSET,
        ...input,
    };
    if (!validateAuddSolanaPaymentPlan(plan))
        throw new Error('invalid_audd_payment_plan');
    const derivedRail = deriveAuddRailEnvironment(plan);
    assertDeclaredRailMatchesDerived(plan.railEnvironment, derivedRail);
    if (derivedRail) {
        assertPlanIdentityMatchesRail(plan, derivedRail);
        assertPlanEligibilityMatchesRail(plan, derivedRail);
    }
    return plan;
}
export function createAuddX402SvmExactPaymentPlan(input) {
    const derivedRail = requireExportableRailEnvironmentForIdentity({
        network: input.network,
        caip2Network: input.caip2Network,
        mint: input.mint,
    });
    assertDeclaredRailMatchesDerived(input.railEnvironment, derivedRail);
    const caip2Network = input.caip2Network ?? caip2ForSolanaNetwork(input.network);
    if (!caip2Network)
        throw new Error('invalid_audd_x402_network');
    const railEnvironment = derivedRail;
    return createAuddSolanaPaymentPlan({
        ...input,
        caip2Network,
        tokenProgram: input.tokenProgram ?? SPL_TOKEN_PROGRAM_ID,
        decimals: AUDD_DECIMALS,
        x402Version: AUDD_X402_VERSION,
        scheme: AUDD_X402_SCHEME,
        paymentFlow: AUDD_X402_PAYMENT_FLOW,
        maxTimeoutSeconds: input.maxTimeoutSeconds ?? 60,
        railEnvironment,
        eligibility: input.eligibility ?? getAuddRailEnvironmentConfig(railEnvironment).grantEligibility,
        authority: input.authority ?? {
            modelRole: 'draft_only',
            authorizationState: 'model_draft',
            operatorApprovalRequired: railEnvironment !== 'deterministic-fixture',
        },
        evidence: input.evidence ?? {
            required: input.evidenceRequired,
            observationSchema: 'reddi.payment-observation.v1',
            fixtureAndDevnetIneligible: true,
        },
    });
}
export function createAuddPaymentChallenge(input) {
    const { paymentPlan, quote, payTo, policyMetadata, ...rest } = input;
    if (!validateAuddSolanaPaymentPlan(paymentPlan))
        throw new Error('invalid_audd_payment_plan');
    const challenge = {
        schemaVersion: PAYMENT_CHALLENGE_SCHEMA_VERSION,
        status: 402,
        ...rest,
        quote: {
            amount: paymentPlan.amount,
            asset: AUDD_ASSET,
            network: paymentPlan.network,
            source: quote?.source ?? '',
            specialist: quote?.specialist ?? '',
        },
        payTo: payTo ?? paymentPlan.payee,
        policyMetadata: {
            ...policyMetadata,
            auddPaymentPlan: paymentPlan,
        },
    };
    if (!isPaymentChallenge(challenge))
        throw new Error('invalid_payment_challenge');
    return challenge;
}
export function createAuddPaymentIntentDraft(input) {
    if (!validateAuddSolanaPaymentPlan(input.paymentPlan))
        throw new Error('invalid_audd_payment_plan');
    const plan = input.paymentPlan;
    requireExportableRailEnvironmentForPlan(plan);
    const caip2 = plan.caip2Network ?? caip2ForSolanaNetwork(plan.network);
    if (!caip2)
        throw new Error('invalid_audd_x402_network');
    const labels = input.labels ?? defaultLabelsForPlan(plan);
    assertLabelsMatchRail(plan, labels);
    const operatorApprovalRequired = operatorApprovalRequiredForPlan(plan);
    const memo = input.memo ?? plan.memo ?? deriveAuddMemo({ agreementId: input.agreementId, amount: plan.amount, mint: plan.mint, payTo: plan.payee });
    return createPaymentIntentDraft({
        labels,
        agreementId: input.agreementId,
        network: { caip2, rapAlias: plan.network },
        asset: {
            symbol: AUDD_ASSET,
            mint: plan.mint,
            tokenProgram: plan.tokenProgram ?? SPL_TOKEN_PROGRAM_ID,
            decimals: AUDD_DECIMALS,
            amountBaseUnits: plan.amount,
        },
        payTo: plan.payee,
        destinationTokenAccount: input.destinationTokenAccount ?? plan.settlementAccount,
        memo,
        evidenceRequired: plan.evidenceRequired,
        quoteExpiresAt: plan.quoteExpiresAt,
        expiresAt: plan.quoteExpiresAt,
        refundPolicy: plan.refundPolicy,
        createdAt: input.createdAt,
        policyDecisionRef: plan.authority?.policyDecisionRef,
        operatorApprovalRequired,
    });
}
export function createAuddX402SvmExactPaymentRequired(input) {
    const { paymentPlan: plan, paymentIntent } = input;
    if (!validateAuddSolanaPaymentPlan(plan))
        throw new Error('invalid_audd_payment_plan');
    const planTokenProgram = plan.tokenProgram ?? SPL_TOKEN_PROGRAM_ID;
    const planCaip2 = plan.caip2Network ?? caip2ForSolanaNetwork(plan.network);
    if (paymentIntent.asset.symbol !== AUDD_ASSET
        || paymentIntent.asset.amountBaseUnits !== plan.amount
        || paymentIntent.asset.mint !== plan.mint
        || paymentIntent.asset.tokenProgram !== planTokenProgram
        || paymentIntent.asset.decimals !== AUDD_DECIMALS
        || paymentIntent.payTo !== plan.payee
        || paymentIntent.network.rapAlias !== plan.network
        || (planCaip2 !== undefined && paymentIntent.network.caip2 !== planCaip2)
        || paymentIntent.destinationTokenAccount !== plan.settlementAccount) {
        throw new Error('audd_payment_intent_plan_mismatch');
    }
    assertLabelsMatchRail(plan, paymentIntent.labels);
    if (operatorApprovalRequiredForPlan(plan) && !paymentIntent.authorization.operatorApprovalRequired) {
        throw new Error('audd_payment_intent_operator_approval_mismatch');
    }
    const caip2 = planCaip2 ?? paymentIntent.network.caip2;
    const tokenProgram = planTokenProgram;
    const memo = paymentIntent.memo ?? plan.memo ?? deriveAuddMemo({ agreementId: paymentIntent.agreementId, amount: plan.amount, mint: plan.mint, payTo: plan.payee });
    const environment = paymentIntent.labels.environment;
    const eligibility = paymentIntent.labels.eligibility;
    const requirement = {
        schemaVersion: AUDD_X402_SVM_EXACT_PAYMENT_REQUIRED_SCHEMA_VERSION,
        x402Version: AUDD_X402_VERSION,
        resource: input.resource,
        accepts: [
            {
                scheme: AUDD_X402_SCHEME,
                network: caip2,
                amount: plan.amount,
                asset: plan.mint,
                payTo: plan.payee,
                maxTimeoutSeconds: input.maxTimeoutSeconds ?? plan.maxTimeoutSeconds ?? 60,
                extra: {
                    symbol: AUDD_ASSET,
                    decimals: AUDD_DECIMALS,
                    tokenProgram,
                    rapNetworkAlias: plan.network,
                    destinationTokenAccount: paymentIntent.destinationTokenAccount,
                    quoteExpiresAt: plan.quoteExpiresAt,
                    memo,
                    paymentFlow: AUDD_X402_PAYMENT_FLOW,
                    receiptRequired: true,
                    evidenceRequired: plan.evidenceRequired,
                    paymentIntentId: paymentIntent.id,
                    modelAuthority: 'draft_only',
                    operatorApprovalRequired: paymentIntent.authorization.operatorApprovalRequired,
                    refundPolicy: plan.refundPolicy,
                    failurePolicy: plan.failurePolicy,
                    environment,
                    eligibility,
                },
            },
        ],
        extensions: {
            reddi: {
                schemaVersion: AUDD_PAYMENT_PLAN_SCHEMA_VERSION,
                paymentIntentId: paymentIntent.id,
                legacyPlanCompatible: true,
                modelMayAuthorize: false,
                mainnetDisabledByDefault: true,
            },
        },
    };
    if (!validateAuddX402SvmExactPaymentRequired(requirement))
        throw new Error('invalid_audd_x402_svm_exact_payment_required');
    return requirement;
}
export function validateAuddX402SvmExactPaymentRequired(value) {
    if (!isPlainObject(value))
        return false;
    if (value.schemaVersion !== AUDD_X402_SVM_EXACT_PAYMENT_REQUIRED_SCHEMA_VERSION)
        return false;
    if (value.x402Version !== AUDD_X402_VERSION)
        return false;
    if (!isPlainObject(value.resource) || !isNonEmptyString(value.resource.url))
        return false;
    if (!Array.isArray(value.accepts) || value.accepts.length === 0)
        return false;
    if (!isPlainObject(value.extensions) || !isPlainObject(value.extensions.reddi))
        return false;
    const reddiExtension = value.extensions.reddi;
    if (reddiExtension.schemaVersion !== AUDD_PAYMENT_PLAN_SCHEMA_VERSION)
        return false;
    if (!isNonEmptyString(reddiExtension.paymentIntentId))
        return false;
    if (reddiExtension.legacyPlanCompatible !== true)
        return false;
    if (reddiExtension.modelMayAuthorize !== false)
        return false;
    if (reddiExtension.mainnetDisabledByDefault !== true)
        return false;
    return value.accepts.every((accept) => {
        if (!isPlainObject(accept))
            return false;
        if (accept.scheme !== AUDD_X402_SCHEME)
            return false;
        if (!isNonEmptyString(accept.network))
            return false;
        if (!positiveAmount(accept.amount))
            return false;
        if (!isNonEmptyString(accept.asset))
            return false;
        if (!isNonEmptyString(accept.payTo))
            return false;
        if (!positiveSafeInteger(accept.maxTimeoutSeconds))
            return false;
        if (!isPlainObject(accept.extra))
            return false;
        const extra = accept.extra;
        if (extra.symbol !== AUDD_ASSET)
            return false;
        if (extra.decimals !== AUDD_DECIMALS)
            return false;
        if (!isNonEmptyString(extra.tokenProgram))
            return false;
        if (!isNonEmptyString(extra.rapNetworkAlias))
            return false;
        if (extra.destinationTokenAccount !== undefined && !isNonEmptyString(extra.destinationTokenAccount))
            return false;
        if (!isNonEmptyString(extra.quoteExpiresAt) || Number.isNaN(Date.parse(extra.quoteExpiresAt)))
            return false;
        if (!isNonEmptyString(extra.memo) || extra.memo.length > 256)
            return false;
        if (extra.paymentFlow !== AUDD_X402_PAYMENT_FLOW)
            return false;
        if (extra.receiptRequired !== true)
            return false;
        if (typeof extra.evidenceRequired !== 'boolean')
            return false;
        if (extra.paymentIntentId !== reddiExtension.paymentIntentId)
            return false;
        if (extra.modelAuthority !== 'draft_only')
            return false;
        if (typeof extra.operatorApprovalRequired !== 'boolean')
            return false;
        if (!validateRefundText(extra.refundPolicy))
            return false;
        if (!validatePolicyText(extra.failurePolicy))
            return false;
        if (!isPaymentEligibility(extra.eligibility))
            return false;
        if (!isRailEnvironment(extra.environment))
            return false;
        const railEnvironment = extra.environment;
        const derivedRail = deriveAuddRailEnvironment({
            network: extra.rapNetworkAlias,
            caip2Network: accept.network,
            mint: accept.asset,
        });
        if (!derivedRail || derivedRail !== railEnvironment || derivedRail === 'local-test-mint')
            return false;
        if (!auddEligibilityMatchesRail(extra.eligibility, railEnvironment))
            return false;
        if (railEnvironment !== 'deterministic-fixture' && extra.operatorApprovalRequired !== true)
            return false;
        const identity = validateAuddRailIdentity({
            environment: railEnvironment,
            network: canonicalSolanaNetworkAlias(extra.rapNetworkAlias) ?? extra.rapNetworkAlias,
            caip2: accept.network,
            mint: accept.asset,
            tokenProgram: extra.tokenProgram,
            decimals: extra.decimals,
            enableGatedMainnet: true,
        });
        return identity.ok || !identity.reasonCodes.some((reason) => [
            'malformed_audd_rail_identity',
            'unknown_audd_rail_environment',
            'wrong_network',
            'wrong_caip2_network',
            'wrong_mint',
            'wrong_token_program',
            'wrong_decimals',
            'local_test_mint_required',
        ].includes(reason));
    });
}
function planFromChallenge(challenge) {
    const plan = isPlainObject(challenge.policyMetadata)
        ? challenge.policyMetadata.auddPaymentPlan
        : undefined;
    return validateAuddSolanaPaymentPlan(plan) ? plan : undefined;
}
function deny(reasonCode, auditNote, extras = {}) {
    return {
        allowed: false,
        reasonCodes: [reasonCode],
        auditNotes: [auditNote],
        ...extras,
    };
}
function adaptBuyerDecision(decision, plan, challenge) {
    if (decision.allowed) {
        const quoted = decision.policyDecision?.quotedAmount;
        const matchesAuddPlan = decision.policyDecision?.allowed === true
            && decision.policyDecision.approvalState === 'approved'
            && quoted !== null
            && quoted?.amount === plan.amount
            && quoted.asset.toUpperCase() === AUDD_ASSET
            && quoted.asset.toUpperCase() === challenge.quote.asset.toUpperCase()
            && quoted.network.toLowerCase() === plan.network.toLowerCase()
            && quoted.network.toLowerCase() === challenge.quote.network.toLowerCase()
            && quoted.source === challenge.quote.source
            && quoted.specialist === challenge.quote.specialist
            && decision.policyDecision.asset.toUpperCase() === AUDD_ASSET
            && decision.policyDecision.network.toLowerCase() === plan.network.toLowerCase();
        if (!matchesAuddPlan) {
            return {
                allowed: false,
                reasonCodes: ['budget_policy_malformed'],
                policyDecision: decision.policyDecision,
                paymentPlan: plan,
                auditNotes: ['Denied: buyer budget policy decision did not match the AUDD payment plan quote.'],
            };
        }
        return {
            allowed: true,
            reasonCodes: ['audd_payment_plan_allowed'],
            paymentProofRef: decision.paymentProofRef,
            policyDecision: decision.policyDecision,
            paymentPlan: plan,
            auditNotes: decision.auditNotes,
        };
    }
    const mapped = decision.reasonCodes.includes('budget_policy_malformed')
        ? 'budget_policy_malformed'
        : decision.reasonCodes.includes('budget_policy_denied')
            ? 'budget_policy_denied'
            : decision.reasonCodes.includes('live_payment_not_approved')
                ? 'live_payment_not_approved'
                : decision.reasonCodes.includes('unsupported_payment_rail')
                    ? 'unsupported_payment_rail'
                    : 'challenge_malformed';
    return {
        allowed: false,
        reasonCodes: [mapped],
        policyDecision: decision.policyDecision,
        paymentPlan: plan,
        auditNotes: decision.auditNotes,
    };
}
export function evaluateAuddPaymentPlanPreflight(challengeInput, options = {}) {
    if (!isPaymentChallenge(challengeInput)) {
        return deny('challenge_malformed', 'Denied: payment challenge is malformed.');
    }
    const challenge = challengeInput;
    const rawPlan = isPlainObject(challenge.policyMetadata)
        ? challenge.policyMetadata.auddPaymentPlan
        : undefined;
    if (rawPlan === undefined) {
        return deny('missing_audd_payment_plan', 'Denied: AUDD/Solana payment plan metadata is missing.');
    }
    if (containsCredentialMaterial(rawPlan)) {
        return deny('credential_leakage_rejected', 'Denied: AUDD/Solana payment plan includes credential-bearing material.');
    }
    if (containsModelSpendAuthorization(rawPlan)) {
        return deny('model_authorization_rejected', 'Denied: models may draft AUDD payment intents but must not authorize or sign spend.');
    }
    const plan = planFromChallenge(challenge);
    if (!plan) {
        return deny('payment_plan_malformed', 'Denied: AUDD/Solana payment plan metadata is malformed.');
    }
    if (challenge.quote.asset.toUpperCase() !== AUDD_ASSET) {
        return deny('wrong_asset', 'Denied: challenge quote asset is not AUDD.', { paymentPlan: plan });
    }
    if (challenge.quote.amount !== plan.amount || challenge.quote.network !== plan.network || challenge.payTo !== plan.payee) {
        return deny('quote_payment_plan_mismatch', 'Denied: challenge quote/payee does not match the AUDD payment plan.', { paymentPlan: plan });
    }
    if (challenge.mode !== plan.paymentMode) {
        return deny('quote_payment_plan_mismatch', 'Denied: challenge mode does not match the AUDD payment plan mode.', { paymentPlan: plan });
    }
    if (!hasOnlyNonEmptyStrings(options.allowedNetworks)) {
        return deny('buyer_policy_missing', 'Denied: buyer policy must declare allowed AUDD/Solana networks.', { paymentPlan: plan });
    }
    if (!hasOnlyNonEmptyStrings(options.allowedMints)) {
        return deny('buyer_policy_missing', 'Denied: buyer policy must declare allowed AUDD mints.', { paymentPlan: plan });
    }
    if (!hasOnlyNonEmptyStrings(options.allowedPayees)) {
        return deny('buyer_policy_missing', 'Denied: buyer policy must declare allowed AUDD payees.', { paymentPlan: plan });
    }
    if (!hasOnlyNonEmptyStrings(options.allowedSettlementAccounts)) {
        return deny('buyer_policy_missing', 'Denied: buyer policy must declare allowed AUDD settlement accounts.', { paymentPlan: plan });
    }
    if (options.requireEvidence !== true) {
        return deny('buyer_policy_missing', 'Denied: buyer policy must explicitly require evidence for AUDD payment plans.', { paymentPlan: plan });
    }
    if (!options.maxAmount && !options.evaluateBudgetPolicy) {
        return deny('buyer_policy_missing', 'Denied: buyer policy must declare max AUDD amount or provide a budget evaluator.', { paymentPlan: plan });
    }
    if (!options.allowedNetworks.some((network) => normalized(network) === normalized(plan.network))) {
        return deny('wrong_network', `Denied: ${plan.network} is not an allowed AUDD/Solana network.`, { paymentPlan: plan });
    }
    if (!options.allowedMints.some((mint) => normalized(mint) === normalized(plan.mint))) {
        return deny('wrong_mint', 'Denied: AUDD mint is not allowed by buyer policy.', { paymentPlan: plan });
    }
    if (options.allowedTokenPrograms !== undefined) {
        if (!hasOnlyNonEmptyStrings(options.allowedTokenPrograms)) {
            return deny('buyer_policy_missing', 'Denied: buyer policy token-program allowlist is malformed.', { paymentPlan: plan });
        }
        if (!plan.tokenProgram || !options.allowedTokenPrograms.some((program) => program === plan.tokenProgram)) {
            return deny('wrong_token_program', 'Denied: AUDD token program is not allowed by buyer policy.', { paymentPlan: plan });
        }
    }
    if (options.allowedCaip2Networks !== undefined) {
        if (!hasOnlyNonEmptyStrings(options.allowedCaip2Networks)) {
            return deny('buyer_policy_missing', 'Denied: buyer policy CAIP-2 allowlist is malformed.', { paymentPlan: plan });
        }
        if (!plan.caip2Network || !options.allowedCaip2Networks.some((network) => network === plan.caip2Network)) {
            return deny('wrong_network', 'Denied: AUDD x402 CAIP-2 network is not allowed by buyer policy.', { paymentPlan: plan });
        }
    }
    if (options.allowedRailEnvironments !== undefined) {
        if (!Array.isArray(options.allowedRailEnvironments) || !options.allowedRailEnvironments.every(isRailEnvironment)) {
            return deny('buyer_policy_missing', 'Denied: buyer policy AUDD rail-environment allowlist is malformed.', { paymentPlan: plan });
        }
        const canonicalRailEnvironment = deriveAuddRailEnvironment(plan);
        if (!canonicalRailEnvironment || !options.allowedRailEnvironments.includes(canonicalRailEnvironment)) {
            return deny('blocked_rail_environment', 'Denied: AUDD rail environment is not allowed by buyer policy.', { paymentPlan: plan });
        }
    }
    if (options.requireX402Exact) {
        const expectedCaip2 = caip2ForSolanaNetwork(plan.network);
        if (plan.x402Version !== AUDD_X402_VERSION || plan.scheme !== AUDD_X402_SCHEME || plan.paymentFlow !== AUDD_X402_PAYMENT_FLOW) {
            return deny('wrong_x402_scheme', 'Denied: AUDD payments must use x402 v2 SVM exact/upfront semantics.', { paymentPlan: plan });
        }
        if (!plan.tokenProgram || plan.decimals !== AUDD_DECIMALS || !plan.caip2Network || expectedCaip2 !== plan.caip2Network) {
            return deny('payment_plan_malformed', 'Denied: AUDD x402 exact plan must include matching CAIP-2 network, SPL token program, and six decimals.', { paymentPlan: plan });
        }
    }
    const railEnvironmentDecision = evaluateRailEnvironment(plan, options);
    if (railEnvironmentDecision)
        return railEnvironmentDecision;
    if (!options.allowedPayees.some((payee) => payee === plan.payee)) {
        return deny('missing_payee', 'Denied: AUDD payee is not allowed by buyer policy.', { paymentPlan: plan });
    }
    if (!options.allowedSettlementAccounts.some((account) => account === plan.settlementAccount)) {
        return deny('missing_payee', 'Denied: AUDD settlement account is not allowed by buyer policy.', { paymentPlan: plan });
    }
    const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
    if (Number.isNaN(now.getTime()) || Date.parse(plan.quoteExpiresAt) <= now.getTime()) {
        return deny('quote_expired', 'Denied: AUDD quote is expired.', { paymentPlan: plan });
    }
    if (options.requireEvidence && !plan.evidenceRequired) {
        return deny('evidence_required', 'Denied: buyer policy requires evidence for AUDD payment plans.', { paymentPlan: plan });
    }
    const effectiveEnvironment = deriveAuddRailEnvironment(plan);
    if (plan.eligibility === 'eligible' && (!effectiveEnvironment || effectiveEnvironment === 'deterministic-fixture' || effectiveEnvironment === 'local-test-mint' || effectiveEnvironment === 'devnet-unverified')) {
        return deny('grant_eligibility_blocked', 'Denied: fixture, local-test-mint, and devnet AUDD evidence cannot be grant-volume eligible.', { paymentPlan: plan });
    }
    if (options.approvalState !== 'approved') {
        return deny('operator_approval_required', 'Denied: AUDD/Solana payment plan requires explicit operator approval.', { paymentPlan: plan });
    }
    if (challenge.mode === 'live' && !options.approveLivePayment) {
        return deny('live_payment_not_approved', 'Denied: live AUDD/Solana payment remains disabled without explicit approval.', { paymentPlan: plan });
    }
    if (options.maxAmount && !positiveAmount(options.maxAmount)) {
        return deny('payment_plan_malformed', 'Denied: buyer maximum amount is malformed.', { paymentPlan: plan });
    }
    if (options.maxAmount && amountToBigInt(plan.amount) > amountToBigInt(options.maxAmount)) {
        return deny('amount_exceeds_max', 'Denied: AUDD payment plan amount exceeds buyer maximum.', { paymentPlan: plan });
    }
    const buyerDecision = evaluateBuyerPaymentChallenge(challenge, {
        allowedRails: [{ asset: AUDD_ASSET, network: plan.network }],
        approveLivePayment: options.approveLivePayment,
        paymentProofRef: options.paymentProofRef,
        evaluateBudgetPolicy: options.evaluateBudgetPolicy,
    });
    return adaptBuyerDecision(buyerDecision, plan, challenge);
}
function evaluateRailEnvironment(plan, options) {
    if (planTargetsMainnetAudd(plan) && !options.approveMainnetAudd) {
        return deny('mainnet_audd_disabled', 'Denied: official AUDD mainnet remains disabled by default and requires separate exact approval.', { paymentPlan: plan });
    }
    const environment = deriveAuddRailEnvironment(plan);
    if (!environment) {
        return deny('blocked_rail_environment', 'Denied: AUDD rail identity does not resolve to a configured rail environment.', { paymentPlan: plan });
    }
    if (plan.railEnvironment !== undefined && plan.railEnvironment !== environment) {
        return deny('blocked_rail_environment', 'Denied: declared AUDD rail environment does not match the canonical network/mint identity.', { paymentPlan: plan });
    }
    const identity = validateAuddRailIdentity({
        environment,
        network: canonicalSolanaNetworkAlias(plan.network) ?? plan.network,
        caip2: plan.caip2Network,
        mint: plan.mint,
        tokenProgram: plan.tokenProgram,
        decimals: plan.decimals,
        enableGatedMainnet: options.approveMainnetAudd,
    });
    if (plan.eligibility !== undefined && !auddEligibilityMatchesRail(plan.eligibility, environment)) {
        return deny('grant_eligibility_blocked', 'Denied: AUDD payment plan eligibility does not match the configured rail eligibility.', { paymentPlan: plan });
    }
    if (identity.ok)
        return undefined;
    if (identity.reasonCodes.includes('devnet_unverified_blocked')) {
        return deny('devnet_audd_unverified', 'Denied: no official AUDD devnet mint is configured or implied.', { paymentPlan: plan });
    }
    if (identity.reasonCodes.includes('mainnet_audd_disabled_by_default')) {
        return deny('mainnet_audd_disabled', 'Denied: official AUDD mainnet remains disabled by default and requires separate exact approval.', { paymentPlan: plan });
    }
    if (identity.reasonCodes.includes('wrong_mint')) {
        return deny('wrong_mint', 'Denied: AUDD mint does not match the configured rail identity.', { paymentPlan: plan });
    }
    if (identity.reasonCodes.includes('wrong_token_program')) {
        return deny('wrong_token_program', 'Denied: AUDD token program does not match the configured rail identity.', { paymentPlan: plan });
    }
    if (identity.reasonCodes.includes('wrong_network') || identity.reasonCodes.includes('wrong_caip2_network')) {
        return deny('wrong_network', 'Denied: AUDD network identity does not match the configured rail identity.', { paymentPlan: plan });
    }
    return deny('blocked_rail_environment', 'Denied: AUDD rail environment is not enabled for this payment plan.', { paymentPlan: plan });
}
function railIdentityTargetsMainnetAudd(identity) {
    return auddRailIdentityTargetsMainnet(identity);
}
export function deriveAuddRailEnvironment(identity) {
    return deriveCanonicalAuddRailEnvironment(identity);
}
function planTargetsMainnetAudd(plan) {
    return railIdentityTargetsMainnetAudd(plan);
}
function assertDeclaredRailMatchesDerived(declared, derived) {
    if (declared === undefined)
        return;
    if (!derived)
        throw new Error('audd_payment_plan_environment_undeclared');
    if (declared !== derived)
        throw new Error('audd_payment_plan_rail_environment_mismatch');
}
function assertPlanIdentityMatchesRail(plan, railEnvironment) {
    const identity = validateAuddRailIdentity({
        environment: railEnvironment,
        network: canonicalSolanaNetworkAlias(plan.network) ?? plan.network,
        caip2: plan.caip2Network,
        mint: plan.mint,
        tokenProgram: plan.tokenProgram,
        decimals: plan.decimals,
        enableGatedMainnet: true,
    });
    if (!identity.ok && identity.reasonCodes.some((reason) => [
        'malformed_audd_rail_identity',
        'unknown_audd_rail_environment',
        'wrong_network',
        'wrong_caip2_network',
        'wrong_mint',
        'wrong_token_program',
        'wrong_decimals',
        'local_test_mint_required',
    ].includes(reason))) {
        throw new Error('audd_payment_plan_rail_identity_mismatch');
    }
}
function assertPlanEligibilityMatchesRail(plan, railEnvironment) {
    if (plan.eligibility !== undefined && !auddEligibilityMatchesRail(plan.eligibility, railEnvironment)) {
        throw new Error('audd_payment_plan_label_eligibility_mismatch');
    }
}
function requireRailEnvironmentForPlan(plan) {
    const derived = deriveAuddRailEnvironment(plan);
    if (!derived)
        throw new Error('audd_payment_plan_environment_undeclared');
    assertDeclaredRailMatchesDerived(plan.railEnvironment, derived);
    assertPlanIdentityMatchesRail(plan, derived);
    return derived;
}
function requireExportableRailEnvironmentForIdentity(identity) {
    const derived = deriveAuddRailEnvironment(identity);
    if (!derived)
        throw new Error('audd_payment_plan_environment_undeclared');
    if (derived === 'local-test-mint')
        throw new Error('audd_payment_plan_local_test_mint_not_exportable');
    return derived;
}
function requireExportableRailEnvironmentForPlan(plan) {
    const railEnvironment = requireRailEnvironmentForPlan(plan);
    if (railEnvironment === 'local-test-mint')
        throw new Error('audd_payment_plan_local_test_mint_not_exportable');
    return railEnvironment;
}
function operatorApprovalRequiredForPlan(plan) {
    return requireExportableRailEnvironmentForPlan(plan) !== 'deterministic-fixture'
        || plan.authority?.operatorApprovalRequired === true;
}
export function auddLabelMatchesRail(environment, railEnvironment) {
    return environment === railEnvironment;
}
export function auddEligibilityMatchesRail(eligibility, railEnvironment) {
    return eligibility === getAuddRailEnvironmentConfig(railEnvironment).grantEligibility;
}
function assertLabelsMatchRail(plan, labels) {
    const railEnvironment = requireExportableRailEnvironmentForPlan(plan);
    if (!auddLabelMatchesRail(labels.environment, railEnvironment)) {
        throw new Error('audd_payment_plan_label_environment_mismatch');
    }
    if (!auddEligibilityMatchesRail(labels.eligibility, railEnvironment)) {
        throw new Error('audd_payment_plan_label_eligibility_mismatch');
    }
}
function defaultLabelsForPlan(plan) {
    const environment = requireExportableRailEnvironmentForPlan(plan);
    const eligibility = plan.eligibility ?? (environment === 'mainnet-gated' ? 'pending_partner_acceptance' : 'non_eligible');
    return { environment, eligibility };
}
function deriveAuddMemo(input) {
    const digest = canonicalPaymentHash({ auddMemo: input }).slice('sha256:'.length, 'sha256:'.length + 32);
    return `reddi:pay:${digest}`;
}
