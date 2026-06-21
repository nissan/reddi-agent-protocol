import { createHash } from 'node:crypto';
export const MPP_TEMPO_RECEIPT_SHAPE_SCHEMA_VERSION = 'reddi.mpp-tempo-receipt-shape.v1';
export const MPP_TEMPO_RECEIPT_SHAPE_GUARDRAILS = {
    fixtureOnly: true,
    walletSigning: false,
    rpcCall: false,
    providerCall: false,
    livePayment: false,
    hostedRegistryWrite: false,
    trustUpgrade: false,
    reputationMutation: false,
};
const OPERATOR_APPROVAL_REF = 'github-issue:#455:fixture-only-approval';
const MPP_DOC_REF = 'https://docs.stripe.com/payments/machine/mpp';
const TEMPO_DOC_REF = 'https://docs.tempo.xyz/';
const PARALLEL_MPP_REF = 'https://docs.parallel.ai/integrations/agentic-payments';
export const mppTempoReceiptShapeSummaries = {
    tempoSingleChargeCandidate: {
        schema: 'reddi.mpp-tempo.fixture-summary.v1',
        case: 'mpp_single_charge_tempo_candidate',
        sourceRefs: [MPP_DOC_REF, TEMPO_DOC_REF, PARALLEL_MPP_REF],
        artifactPath: 'fixtures/payment/mpp-tempo/single-charge-candidate.json',
        challenge: {
            protocol: 'mpp',
            status: 402,
            intent: 'charge',
            paymentMethod: 'tempo-stablecoin',
            network: 'tempo',
            asset: 'USDC',
            amount: '1000',
            unit: 'microusd',
            endpoint: 'https://example.invalid/paid/search',
            nonce: 'mpp-tempo-nonce-single-charge',
            recipientRef: 'tempo:recipient:operator-approved-fixture',
        },
        receipt: {
            protocol: 'mpp',
            paymentMethod: 'tempo-stablecoin',
            network: 'tempo',
            asset: 'USDC',
            amount: '1000',
            status: 'success',
            nonce: 'mpp-tempo-nonce-single-charge',
            receiptRef: 'mpp-tempo-receipt:single-charge-fixture',
            settledAt: '2026-06-22T00:00:00.000Z',
        },
        claimBoundary: [
            'MPP Tempo single-charge fixture is a receipt-shape binding candidate only.',
            'No Tempo wallet, RPC, provider call, live payment, hosted registry write, trust upgrade, or reputation mutation is performed.',
        ],
    },
    tempoSessionProbe: {
        schema: 'reddi.mpp-tempo.fixture-summary.v1',
        case: 'mpp_session_probe',
        sourceRefs: [MPP_DOC_REF, TEMPO_DOC_REF],
        artifactPath: 'fixtures/payment/mpp-tempo/session-probe.json',
        challenge: {
            protocol: 'mpp',
            status: 402,
            intent: 'session',
            paymentMethod: 'tempo-stablecoin',
            network: 'tempo',
            asset: 'pathUSD',
            amount: '1000000',
            unit: 'base-units',
            endpoint: 'https://example.invalid/paid/session',
            nonce: 'mpp-tempo-nonce-session',
            recipientRef: 'tempo:recipient:operator-approved-fixture',
            sessionCap: '1000000',
        },
        claimBoundary: [
            'MPP Tempo session fixture records challenge shape only.',
            'RAP does not claim settlement, repeated-call authorization, wallet signing, provider execution, or live activation from this fixture.',
        ],
    },
    tempoSplitProbe: {
        schema: 'reddi.mpp-tempo.fixture-summary.v1',
        case: 'mpp_split_probe',
        sourceRefs: [MPP_DOC_REF, TEMPO_DOC_REF],
        artifactPath: 'fixtures/payment/mpp-tempo/split-probe.json',
        challenge: {
            protocol: 'mpp',
            status: 402,
            intent: 'charge',
            paymentMethod: 'tempo-stablecoin',
            network: 'tempo',
            asset: 'USDC',
            amount: '2000',
            unit: 'microusd',
            endpoint: 'https://example.invalid/paid/split',
            nonce: 'mpp-tempo-nonce-split',
            recipientRef: 'tempo:recipient:operator-approved-fixture',
            splitRecipients: ['tempo:recipient:downstream-specialist-fixture'],
        },
        claimBoundary: [
            'MPP Tempo split fixture records challenge metadata only.',
            'RAP does not claim split settlement, provider payment, trust upgrade, reputation mutation, or live activation from this fixture.',
        ],
    },
    tempoLiveReceiptUnsupported: {
        schema: 'reddi.mpp-tempo.fixture-summary.v1',
        case: 'tempo_live_receipt_unsupported',
        sourceRefs: [TEMPO_DOC_REF],
        artifactPath: 'fixtures/payment/mpp-tempo/live-receipt-unsupported.json',
        challenge: {
            protocol: 'mpp',
            status: 402,
            intent: 'charge',
            paymentMethod: 'tempo-stablecoin',
            network: 'tempo',
            asset: 'USDC',
            amount: '1000',
            unit: 'microusd',
            endpoint: 'https://example.invalid/live/paid/search',
            nonce: 'mpp-tempo-nonce-live-unsupported',
            recipientRef: 'tempo:recipient:operator-approved-fixture',
        },
        liveReceipt: {
            status: 'success',
            network: 'tempo',
            txHash: '0xlive-path-not-accepted-in-fixtures',
        },
        claimBoundary: [
            'Live Tempo receipts are unsupported in this fixture corpus.',
            'A future live lane needs explicit wallet, spend, verifier, and operator approval gates before RAP can accept live settlement claims.',
        ],
    },
};
export function createMppTempoReceiptShapeFixture(summary) {
    const result = deriveMppTempoReceiptShapeFixture(summary);
    if (!result.ok) {
        throw new Error(`invalid_mpp_tempo_receipt_shape:${result.errors.map((item) => `${item.code}:${item.path}`).join(',')}`);
    }
    return result.fixture;
}
export function deriveMppTempoReceiptShapeFixture(summary) {
    const errors = [];
    validateFixture(summary, errors);
    validateChallenge(summary.challenge, errors);
    validateNoLivePath(summary, errors);
    if (summary.case === 'tempo_live_receipt_unsupported') {
        errors.push(error('unsupported_live_rail', '$.liveReceipt', 'live Tempo receipts require a separate approved live verifier lane'));
    }
    else if (summary.case === 'mpp_single_charge_tempo_candidate') {
        validateReceipt(summary, errors);
    }
    else if (summary.receipt) {
        errors.push(error('malformed_receipt', '$.receipt', 'probe-only fixtures must not include receipt success claims'));
    }
    if (errors.length > 0)
        return { ok: false, errors };
    return {
        ok: true,
        fixture: {
            schemaVersion: MPP_TEMPO_RECEIPT_SHAPE_SCHEMA_VERSION,
            case: summary.case,
            supportState: summary.case === 'mpp_single_charge_tempo_candidate' ? 'binding_candidate' : 'probe_only',
            artifactPath: summary.artifactPath,
            challenge: summary.challenge,
            receipt: summary.receipt,
            bindingRefs: createBindingRefs(summary),
            guardrails: MPP_TEMPO_RECEIPT_SHAPE_GUARDRAILS,
            claimBoundary: summary.claimBoundary,
        },
    };
}
export const mppTempoReceiptShapeFixtures = {
    tempoSingleChargeCandidate: createMppTempoReceiptShapeFixture(mppTempoReceiptShapeSummaries.tempoSingleChargeCandidate),
    tempoSessionProbe: createMppTempoReceiptShapeFixture(mppTempoReceiptShapeSummaries.tempoSessionProbe),
    tempoSplitProbe: createMppTempoReceiptShapeFixture(mppTempoReceiptShapeSummaries.tempoSplitProbe),
};
function validateFixture(summary, errors) {
    if (!isPlainObject(summary)) {
        errors.push(error('malformed_fixture', '$', 'fixture summary must be an object'));
        return;
    }
    if (!isNonEmptyString(summary.schema)) {
        errors.push(error('malformed_fixture', '$.schema', 'schema is required'));
    }
    if (!['mpp_single_charge_tempo_candidate', 'mpp_session_probe', 'mpp_split_probe', 'tempo_live_receipt_unsupported'].includes(String(summary.case))) {
        errors.push(error('malformed_fixture', '$.case', 'unsupported fixture case'));
    }
    if (!Array.isArray(summary.sourceRefs) || summary.sourceRefs.length === 0 || !summary.sourceRefs.every(isNonEmptyString)) {
        errors.push(error('malformed_fixture', '$.sourceRefs', 'docs-backed source refs are required'));
    }
    if (!isNonEmptyString(summary.artifactPath)) {
        errors.push(error('malformed_fixture', '$.artifactPath', 'artifact path is required'));
    }
    if (!Array.isArray(summary.claimBoundary) || summary.claimBoundary.length === 0) {
        errors.push(error('malformed_fixture', '$.claimBoundary', 'claim boundary notes are required'));
    }
}
function validateChallenge(challenge, errors) {
    if (!isPlainObject(challenge)) {
        errors.push(error('malformed_challenge', '$.challenge', 'challenge must be an object'));
        return;
    }
    if (challenge.protocol !== 'mpp') {
        errors.push(error('unsupported_protocol', '$.challenge.protocol', 'challenge protocol must be mpp'));
    }
    if (challenge.status !== 402) {
        errors.push(error('malformed_challenge', '$.challenge.status', 'challenge status must be 402'));
    }
    if (!['charge', 'session'].includes(String(challenge.intent))) {
        errors.push(error('malformed_challenge', '$.challenge.intent', 'challenge intent must be charge or session'));
    }
    if (challenge.paymentMethod !== 'tempo-stablecoin') {
        errors.push(error('unsupported_payment_method', '$.challenge.paymentMethod', 'only Tempo stablecoin MPP fixtures are accepted'));
    }
    if (challenge.network !== 'tempo') {
        errors.push(error('unsupported_payment_method', '$.challenge.network', 'network must be tempo'));
    }
    if (!['USDC', 'pathUSD'].includes(String(challenge.asset))) {
        errors.push(error('unsupported_payment_method', '$.challenge.asset', 'asset must be USDC or pathUSD'));
    }
    if (!positiveAmount(challenge.amount)) {
        errors.push(error('malformed_challenge', '$.challenge.amount', 'amount must be a positive integer string'));
    }
    if (!['microusd', 'base-units'].includes(String(challenge.unit))) {
        errors.push(error('malformed_challenge', '$.challenge.unit', 'unit is unsupported'));
    }
    if (!isHttpsUrl(challenge.endpoint)) {
        errors.push(error('malformed_challenge', '$.challenge.endpoint', 'endpoint must be an HTTPS URL'));
    }
    if (!isNonEmptyString(challenge.nonce)) {
        errors.push(error('malformed_challenge', '$.challenge.nonce', 'nonce is required'));
    }
    if (!isNonEmptyString(challenge.recipientRef)) {
        errors.push(error('malformed_challenge', '$.challenge.recipientRef', 'recipient ref is required'));
    }
    if (challenge.intent === 'session' && !positiveAmount(challenge.sessionCap)) {
        errors.push(error('malformed_challenge', '$.challenge.sessionCap', 'session fixtures require a positive cap'));
    }
    if (challenge.splitRecipients && (!Array.isArray(challenge.splitRecipients) || challenge.splitRecipients.length === 0 || !challenge.splitRecipients.every(isNonEmptyString))) {
        errors.push(error('malformed_challenge', '$.challenge.splitRecipients', 'split recipients must be non-empty string refs'));
    }
}
function validateReceipt(summary, errors) {
    const { receipt, challenge } = summary;
    if (!isPlainObject(receipt)) {
        errors.push(error('malformed_receipt', '$.receipt', 'single-charge candidates require a receipt shape'));
        return;
    }
    if (receipt.protocol !== 'mpp') {
        errors.push(error('unsupported_protocol', '$.receipt.protocol', 'receipt protocol must be mpp'));
    }
    if (receipt.paymentMethod !== challenge.paymentMethod || receipt.network !== challenge.network || receipt.asset !== challenge.asset || receipt.amount !== challenge.amount || receipt.nonce !== challenge.nonce) {
        errors.push(error('receipt_challenge_mismatch', '$.receipt', 'receipt must bind method, network, asset, amount, and nonce to the challenge'));
    }
    if (receipt.status !== 'success') {
        errors.push(error('malformed_receipt', '$.receipt.status', 'receipt status must be success'));
    }
    if (!isNonEmptyString(receipt.receiptRef)) {
        errors.push(error('malformed_receipt', '$.receipt.receiptRef', 'receipt ref is required'));
    }
    if (!isNonEmptyString(receipt.settledAt) || Number.isNaN(Date.parse(receipt.settledAt))) {
        errors.push(error('malformed_receipt', '$.receipt.settledAt', 'settledAt must be an ISO timestamp'));
    }
}
function validateNoLivePath(summary, errors) {
    const serialized = JSON.stringify(summary).toLowerCase();
    const rejectedMarkers = [
        'wallet_private_key',
        'private_key',
        'rpc_url',
        'provider call completed',
        'provider call performed',
        'hosted-registry-write',
        'hosted registry write completed',
        'hosted registry write performed',
        'trust-upgrade',
        'trust upgrade completed',
        'trust upgrade performed',
        'reputation-mutation',
        'reputation mutation completed',
        'reputation mutation performed',
        'live payment completed',
        'live tempo payment accepted',
    ];
    for (const marker of rejectedMarkers) {
        if (serialized.includes(marker)) {
            errors.push(error('live_path_rejected', '$', `fixture contains rejected live-path marker: ${marker}`));
        }
    }
}
function createBindingRefs(summary) {
    return {
        sourceId: 'mpp-tempo:fixture-corpus',
        challengeRef: `mpp-tempo-challenge:${summary.challenge.nonce}`,
        paymentProofRef: summary.receipt?.receiptRef ?? `mpp-tempo-probe:${summary.case}:${hashJson(summary.challenge)}`,
        evidenceRef: `file://${summary.artifactPath}`,
        requestHash: hashJson(summary.challenge),
        responseHash: hashJson({
            receipt: summary.receipt ?? null,
            supportState: summary.case === 'mpp_single_charge_tempo_candidate' ? 'binding_candidate' : 'probe_only',
            claimBoundary: summary.claimBoundary,
        }),
        recipientRef: summary.challenge.recipientRef,
        nonceRef: `mpp-tempo-nonce:${summary.challenge.nonce}`,
        operatorApprovalRef: OPERATOR_APPROVAL_REF,
    };
}
function error(code, path, message) {
    return { code, path, message };
}
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
function isHttpsUrl(value) {
    if (!isNonEmptyString(value))
        return false;
    try {
        return new URL(value).protocol === 'https:';
    }
    catch {
        return false;
    }
}
function hashJson(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
