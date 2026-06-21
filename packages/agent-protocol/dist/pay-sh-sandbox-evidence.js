import { createHash } from 'node:crypto';
export const PAY_SH_SANDBOX_EVIDENCE_SCHEMA_VERSION = 'reddi.pay-sh-sandbox-evidence.v1';
const PAY_SH_PROVIDER_SPEC = 'config/pay-sh/reddi-x402-economic-demo-provider.yml';
const PAY_SH_PROVIDER_SPEC_HASH = '77f48c499b1b335e297372b58d8746ffd8b54783d73188ebedff766371af49ef';
const PAY_SH_PROBE_BLOCKER = 'pay_sh_0_16_returns_402_after_payment';
const DEFAULT_QUOTE_REF = 'pay-sh:quote:reddi-x402-economic-demo:usd-0.01';
const DEFAULT_RECIPIENT_REF = 'pay-sh:recipient:operator-approved-demo';
const DEFAULT_NONCE_REF = 'pay-sh:nonce:fixture-20260507';
const DEFAULT_SESSION_REF = 'pay-sh:session:single-charge';
const DEFAULT_AUTHORIZATION_REF = 'pay-sh:authorization:operator-approval-required';
const OPERATOR_APPROVAL_REF = 'github-issue:#454:fixture-only-approval';
export const PAY_SH_SANDBOX_GUARDRAILS = {
    fixtureOnly: true,
    livePayShCall: false,
    walletSigning: false,
    rpcCall: false,
    providerCall: false,
    hostedRegistryWrite: false,
    marketplacePublication: false,
    trustUpgrade: false,
    reputationMutation: false,
};
export const payShSandboxEvidenceSummaries = {
    singleCharge: {
        schema: 'reddi-x402.pay-sh.compatibility-evidence.v1',
        mode: 'pay-sh-sandbox',
        case: 'single_charge',
        artifactPath: 'artifacts/pay-sh-reddi-x402/20260507T064842Z/SUMMARY.json',
        providerSpec: PAY_SH_PROVIDER_SPEC,
        providerSpecSha256: PAY_SH_PROVIDER_SPEC_HASH,
        url: 'http://127.0.0.1:1402/api/economic-demo/reddi-x402/pay-sh-smoke',
        plainCurl: {
            status: 402,
            paymentProtocol: 'mpp',
            challengeCount: 2,
            priceUsd: 0.01,
        },
        paySandboxCurl: {
            status: 200,
            bodyOk: true,
            receipt: {
                challengeId: 'pay-sh:challenge:20260507T064842Z:single-charge',
                method: 'solana',
                reference: '5QYP-pay-sh-sandbox-reference-redacted',
                status: 'success',
                timestamp: '2026-05-07T06:49:06.150216Z',
            },
        },
        decodedRequest: {
            quoteRef: DEFAULT_QUOTE_REF,
            recipient: DEFAULT_RECIPIENT_REF,
            nonce: DEFAULT_NONCE_REF,
            session: DEFAULT_SESSION_REF,
            authorizationRef: DEFAULT_AUTHORIZATION_REF,
        },
        claimBoundary: [
            'Pay.sh sandbox single-charge compatibility is fixture-backed only.',
            'No marketplace publication, wallet signing, RPC call, provider call, catalog submission, hosted registry write, trust upgrade, reputation mutation, or live Pay.sh call is performed.',
        ],
    },
    cappedSessionProbe: {
        schema: 'reddi-x402.pay-sh.phase3-extension-evidence.v1',
        mode: 'pay-sh-sandbox-extension',
        case: 'capped_session_probe',
        artifactPath: 'artifacts/pay-sh-reddi-x402/20260507T065805Z-session-splits/SUMMARY.json',
        providerSpec: PAY_SH_PROVIDER_SPEC,
        providerSpecSha256: PAY_SH_PROVIDER_SPEC_HASH,
        url: 'http://127.0.0.1:1402/api/economic-demo/reddi-x402/pay-sh-smoke',
        plainCurl: {
            status: 402,
            paymentProtocol: 'mpp',
            challengeCount: 1,
            priceUsd: 0.01,
        },
        paySandboxCurl: {
            status: 'blocked',
            error: 'Server returned 402 again after payment',
        },
        decodedRequest: {
            quoteRef: 'pay-sh:quote:reddi-x402-economic-demo:capped-session',
            recipient: DEFAULT_RECIPIENT_REF,
            nonce: 'pay-sh:nonce:fixture-20260507-session',
            session: 'pay-sh:session:capped-session-probe',
            authorizationRef: DEFAULT_AUTHORIZATION_REF,
        },
        claimBoundary: [
            'Capped session support is probe-only because Pay.sh 0.16 returned 402 after payment.',
            'No settlement, live activation, wallet signing, RPC call, provider call, hosted registry write, trust upgrade, or reputation mutation is claimed.',
        ],
    },
    splitPaymentProbe: {
        schema: 'reddi-x402.pay-sh.phase3-extension-evidence.v1',
        mode: 'pay-sh-sandbox-extension',
        case: 'split_payment_probe',
        artifactPath: 'artifacts/pay-sh-reddi-x402/20260507T065908Z-splits/SUMMARY.json',
        providerSpec: PAY_SH_PROVIDER_SPEC,
        providerSpecSha256: PAY_SH_PROVIDER_SPEC_HASH,
        url: 'http://127.0.0.1:1402/api/economic-demo/reddi-x402/pay-sh-smoke',
        plainCurl: {
            status: 402,
            paymentProtocol: 'mpp',
            challengeCount: 2,
            priceUsd: 0.01,
        },
        paySandboxCurl: {
            status: 'blocked',
            error: 'Server returned 402 again after payment',
        },
        decodedRequest: {
            quoteRef: 'pay-sh:quote:reddi-x402-economic-demo:split-payment',
            recipient: DEFAULT_RECIPIENT_REF,
            nonce: 'pay-sh:nonce:fixture-20260507-split',
            session: 'pay-sh:session:split-payment-probe',
            authorizationRef: DEFAULT_AUTHORIZATION_REF,
            splitRecipients: ['pay-sh:recipient:split-secondary-demo'],
        },
        claimBoundary: [
            'Split payment support is probe-only because Pay.sh 0.16 returned 402 after payment.',
            'No settlement, live activation, wallet signing, RPC call, provider call, hosted registry write, trust upgrade, or reputation mutation is claimed.',
        ],
    },
};
export function createPayShSandboxEvidenceFixture(summary) {
    const result = derivePayShSandboxEvidenceFixture(summary);
    if (!result.ok) {
        throw new Error(`invalid_pay_sh_sandbox_evidence:${result.errors.map((item) => `${item.code}:${item.path}`).join(',')}`);
    }
    return result.fixture;
}
export function derivePayShSandboxEvidenceFixture(summary) {
    const errors = [];
    validateSummaryShape(summary, errors);
    validateNoLivePath(summary, errors);
    validatePaymentChallenge(summary, errors);
    const isSingleCharge = summary.case === 'single_charge';
    if (isSingleCharge) {
        validateSingleCharge(summary, errors);
    }
    else {
        validateProbeOnly(summary, errors);
    }
    if (errors.length > 0)
        return { ok: false, errors };
    const bindingRefs = createBindingRefs(summary);
    const status = isSingleCharge ? 'proven_single_charge' : 'probe_only';
    return {
        ok: true,
        fixture: {
            schemaVersion: PAY_SH_SANDBOX_EVIDENCE_SCHEMA_VERSION,
            case: summary.case,
            status,
            blocker: isSingleCharge ? undefined : PAY_SH_PROBE_BLOCKER,
            artifactPath: summary.artifactPath,
            providerSpecRef: summary.providerSpec,
            providerSpecHash: `sha256:${summary.providerSpecSha256}`,
            sourceService: 'pay.sh',
            bindingRefs,
            receipt: isSingleCharge ? summary.paySandboxCurl.receipt : undefined,
            guardrails: PAY_SH_SANDBOX_GUARDRAILS,
            claimBoundary: summary.claimBoundary,
        },
    };
}
export const payShSandboxEvidenceFixtures = {
    singleCharge: createPayShSandboxEvidenceFixture(payShSandboxEvidenceSummaries.singleCharge),
    cappedSessionProbe: createPayShSandboxEvidenceFixture(payShSandboxEvidenceSummaries.cappedSessionProbe),
    splitPaymentProbe: createPayShSandboxEvidenceFixture(payShSandboxEvidenceSummaries.splitPaymentProbe),
};
function validateSummaryShape(summary, errors) {
    if (!isPlainObject(summary)) {
        errors.push(error('malformed_summary', '$', 'summary must be an object'));
        return;
    }
    if (!['pay-sh-sandbox', 'pay-sh-sandbox-extension'].includes(String(summary.mode))) {
        errors.push(error('unsupported_mode', '$.mode', 'summary must be a Pay.sh sandbox fixture'));
    }
    if (!['single_charge', 'capped_session_probe', 'split_payment_probe'].includes(String(summary.case))) {
        errors.push(error('malformed_summary', '$.case', 'summary case is unsupported'));
    }
    if (!isNonEmptyString(summary.artifactPath)) {
        errors.push(error('malformed_summary', '$.artifactPath', 'artifact path is required'));
    }
    if (!isNonEmptyString(summary.providerSpec) || !isSha256Hex(summary.providerSpecSha256)) {
        errors.push(error('missing_provider_spec', '$.providerSpecSha256', 'provider spec path and hash are required'));
    }
    if (!isNonEmptyString(summary.url)) {
        errors.push(error('malformed_summary', '$.url', 'fixture URL is required'));
    }
    if (!Array.isArray(summary.claimBoundary) || summary.claimBoundary.length === 0) {
        errors.push(error('malformed_summary', '$.claimBoundary', 'claim boundary notes are required'));
    }
}
function validateNoLivePath(summary, errors) {
    const serialized = JSON.stringify(summary).toLowerCase();
    const liveMarkers = [
        'mainnet',
        'live-payment-enabled',
        'wallet_private_key',
        'private_key',
        'rpc_url',
        'marketplace publication activated',
        'marketplace-publication activated',
        'provider call performed',
        'provider-call performed',
        'provider call completed',
        'provider-call completed',
        'catalog submission completed',
        'catalog-submission completed',
        'catalog submission performed',
        'catalog-submission performed',
        'hosted-registry-write',
        'hosted registry write completed',
        'hosted registry write performed',
        'trust-upgrade',
        'trust upgrade completed',
        'trust upgrade performed',
        'reputation-mutation',
        'reputation mutation completed',
        'reputation mutation performed',
        'live pay.sh activation',
        'live pay-sh activation',
    ];
    for (const marker of liveMarkers) {
        if (serialized.includes(marker)) {
            errors.push(error('live_path_rejected', '$', `fixture contains rejected live-path marker: ${marker}`));
        }
    }
}
function validatePaymentChallenge(summary, errors) {
    if (summary.plainCurl?.status !== 402) {
        errors.push(error('missing_payment_challenge', '$.plainCurl.status', 'plain curl must prove a 402 payment challenge'));
    }
    if (summary.plainCurl?.paymentProtocol !== 'mpp') {
        errors.push(error('missing_payment_challenge', '$.plainCurl.paymentProtocol', 'Pay.sh fixture must use the mpp payment protocol'));
    }
    if (!Number.isInteger(summary.plainCurl?.challengeCount) || summary.plainCurl.challengeCount <= 0) {
        errors.push(error('missing_payment_challenge', '$.plainCurl.challengeCount', 'at least one payment challenge is required'));
    }
}
function validateSingleCharge(summary, errors) {
    const receipt = summary.paySandboxCurl?.receipt;
    if (summary.mode !== 'pay-sh-sandbox') {
        errors.push(error('unsupported_mode', '$.mode', 'single-charge evidence must use pay-sh-sandbox mode'));
    }
    if (summary.paySandboxCurl?.status !== 200 || summary.paySandboxCurl.bodyOk !== true) {
        errors.push(error('malformed_receipt', '$.paySandboxCurl', 'single-charge evidence must include a successful sandbox retry'));
    }
    if (!receipt) {
        errors.push(error('malformed_receipt', '$.paySandboxCurl.receipt', 'successful sandbox retry must include a receipt'));
        return;
    }
    if (!isNonEmptyString(receipt.challengeId)) {
        errors.push(error('malformed_receipt', '$.paySandboxCurl.receipt.challengeId', 'receipt challenge id is required'));
    }
    if (receipt.method !== 'solana') {
        errors.push(error('malformed_receipt', '$.paySandboxCurl.receipt.method', 'receipt method must be solana'));
    }
    if (!isNonEmptyString(receipt.reference)) {
        errors.push(error('malformed_receipt', '$.paySandboxCurl.receipt.reference', 'receipt reference is required'));
    }
    if (receipt.status !== 'success') {
        errors.push(error('malformed_receipt', '$.paySandboxCurl.receipt.status', 'receipt status must be success'));
    }
    if (!isNonEmptyString(receipt.timestamp) || Number.isNaN(Date.parse(receipt.timestamp))) {
        errors.push(error('malformed_receipt', '$.paySandboxCurl.receipt.timestamp', 'receipt timestamp must be an ISO timestamp'));
    }
}
function validateProbeOnly(summary, errors) {
    if (summary.mode !== 'pay-sh-sandbox-extension') {
        errors.push(error('unsupported_mode', '$.mode', 'extension probes must use pay-sh-sandbox-extension mode'));
    }
    if (summary.paySandboxCurl?.status === 200 || summary.paySandboxCurl?.receipt) {
        errors.push(error('unexpected_success', '$.paySandboxCurl', 'probe-only fixtures must not claim successful settlement'));
    }
    if (summary.paySandboxCurl?.status !== 'blocked') {
        errors.push(error('missing_probe_blocker', '$.paySandboxCurl.status', 'probe-only fixtures must record a blocked retry'));
    }
    if (summary.paySandboxCurl?.error !== 'Server returned 402 again after payment') {
        errors.push(error('missing_probe_blocker', '$.paySandboxCurl.error', 'probe-only fixtures must preserve the Pay.sh 0.16 blocker'));
    }
}
function createBindingRefs(summary) {
    const decoded = summary.decodedRequest ?? {};
    const evidenceRef = `file://${summary.artifactPath}`;
    const receiptRef = summary.paySandboxCurl.receipt
        ? `pay-sh-sandbox-receipt:${summary.paySandboxCurl.receipt.challengeId}`
        : undefined;
    return {
        source: {
            kind: 'source-adapter',
            sourceId: 'pay-sh:reddi-x402:economic-demo',
            fixtureRef: summary.artifactPath,
            rawSnapshotRef: hashJson(summary),
        },
        paymentProofRef: receiptRef ?? `pay-sh-sandbox-probe:${summary.case}:${hashJson(summary.paySandboxCurl)}`,
        evidenceRef,
        requestHash: hashJson({
            providerSpec: summary.providerSpec,
            url: summary.url,
            plainCurl: summary.plainCurl,
            decodedRequest: summary.decodedRequest,
        }),
        responseHash: hashJson({
            paySandboxCurl: summary.paySandboxCurl,
            claimBoundary: summary.claimBoundary,
        }),
        quoteRef: decoded.quoteRef ?? DEFAULT_QUOTE_REF,
        recipientRef: decoded.recipient ?? DEFAULT_RECIPIENT_REF,
        nonceRef: decoded.nonce ?? DEFAULT_NONCE_REF,
        sessionRef: decoded.session ?? DEFAULT_SESSION_REF,
        authorizationRef: decoded.authorizationRef ?? DEFAULT_AUTHORIZATION_REF,
        receiptRef,
        operatorApprovalRef: OPERATOR_APPROVAL_REF,
    };
}
function error(code, path, message) {
    return { code, path, message };
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function isSha256Hex(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
function hashJson(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
