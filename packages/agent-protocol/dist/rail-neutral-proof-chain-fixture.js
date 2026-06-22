import { createEvidenceArchiveRecord, } from './evidence-archive.js';
import { mppTempoReceiptShapeFixtures, } from './mpp-tempo-receipt-shapes.js';
import { payShSandboxEvidenceFixtures, } from './pay-sh-sandbox-evidence.js';
import { policyDecisionFromBudgetPolicyDecision } from './policy.js';
import { deriveRailNeutralPaymentReceipt, } from './rail-neutral-payment-receipts.js';
import { createReceiptEvidenceBinding, } from './receipt-evidence-binding.js';
import { createReddiReceipt, } from './receipts.js';
export const RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_SCHEMA_VERSION = 'reddi.rail-neutral-proof-chain-fixture.v1';
export const RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_GUARDRAILS = {
    fixtureOnly: true,
    rawPromptStored: false,
    rawOutputStored: false,
    credentialMaterialStored: false,
    walletSigning: false,
    rpcCall: false,
    providerCall: false,
    paidRequest: false,
    sandboxExecution: false,
    hostedRegistryWrite: false,
    marketplacePublication: false,
    trustUpgrade: false,
    reputationMutation: false,
    custodyClaim: false,
    settlementFinalityProof: false,
    livePayment: false,
};
const CREATED_AT = '2026-06-22T10:20:00.000Z';
const SPECIALIST_ID = 'pay-sh:reddi-x402-economic-demo';
const PAYER_ID = 'buyer:fixture';
export function createRailNeutralProofChainFixture(input) {
    const result = deriveRailNeutralPaymentReceipt(input.receiptInput, input.options);
    const refs = bindingRefsFromInput(input.receiptInput.fixture);
    if (!result.ok) {
        return blockedFixture(input.case, input.receiptInput.fixture, refs, result.errors);
    }
    const receipt = result.receipt;
    const createdAt = input.createdAt ?? CREATED_AT;
    const policyDecision = policyDecisionFromBudgetPolicyDecision({
        allowed: true,
        reasonCodes: ['allowed'],
        quotedAmount: {
            amount: receipt.payment.amount,
            asset: receipt.payment.asset,
            network: receipt.payment.network,
            source: receipt.source.sourceId,
            specialist: SPECIALIST_ID,
        },
        remainingBudget: { perRequest: receipt.payment.amount },
        auditNotes: ['Allowed by fixture-only rail-neutral proof-chain bridge.'],
    });
    const redactedReceipt = createReddiReceipt({
        schemaVersion: 'reddi.receipt.v1',
        job: { id: `job:${receipt.rail}:${receipt.case}`, type: 'fixture-only-rail-neutral-proof-chain' },
        source: {
            id: receipt.source.sourceId,
            type: receipt.source.kind,
            uri: receipt.source.catalogRef ?? receipt.source.fixtureRef ?? receipt.source.rawSnapshotRef,
        },
        payer: { id: PAYER_ID },
        specialist: { id: SPECIALIST_ID },
        protocol: { name: 'Reddi Agent Protocol', version: '0.1.0' },
        payment: {
            network: receipt.payment.network,
            asset: receipt.payment.asset,
            amount: receipt.payment.amount,
            paymentProofRef: receipt.payment.paymentProofRef,
        },
        requestHash: receipt.bindingRefs.requestHash,
        responseHash: receipt.bindingRefs.responseHash,
        evidenceRef: receipt.bindingRefs.evidenceRef,
        policyDecision,
        attestationStatus: 'not_requested',
        createdAt,
        metadata: {
            rail: receipt.rail,
            railNeutralReceiptSchema: receipt.schemaVersion,
            supportState: receipt.supportState,
            receiptRef: receipt.payment.receiptRef,
            quoteRef: refs.quoteRef,
            nonceRef: receipt.bindingRefs.nonceRef,
            recipientRef: receipt.bindingRefs.recipientRef,
            operatorApprovalRef: receipt.bindingRefs.operatorApprovalRef,
            claimBoundaryLabels: receipt.claimBoundary,
        },
    });
    const evidencePayload = {
        schemaVersion: RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_SCHEMA_VERSION,
        railNeutralReceipt: {
            schemaVersion: receipt.schemaVersion,
            rail: receipt.rail,
            case: receipt.case,
            supportState: receipt.supportState,
            sourceId: receipt.source.sourceId,
            payment: receipt.payment,
            bindingRefs: receipt.bindingRefs,
            claimBoundaryLabels: receipt.claimBoundary,
        },
        redaction: {
            rawPromptStored: false,
            rawOutputStored: false,
            credentialMaterialStored: false,
            providerResponseBodyStored: false,
            walletKeyStored: false,
            rpcUrlStored: false,
        },
    };
    const evidence = createEvidenceArchiveRecord({
        id: `evidence:${receipt.rail}:${receipt.case}`,
        receiptId: redactedReceipt.job.id,
        sourceId: receipt.source.sourceId,
        requestHash: receipt.bindingRefs.requestHash,
        responseHash: receipt.bindingRefs.responseHash,
        evidenceRef: receipt.bindingRefs.evidenceRef,
        evidencePayload,
        createdAt,
        metadata: {
            railNeutralReceiptSchema: receipt.schemaVersion,
            operatorApprovalRef: receipt.bindingRefs.operatorApprovalRef,
            fixtureOnly: true,
        },
    });
    const paymentPreflight = {
        allowed: true,
        reasonCodes: ['audd_payment_plan_allowed'],
        paymentProofRef: receipt.payment.paymentProofRef,
        policyDecision,
        paymentPlan: {
            schemaVersion: 'reddi.audd-payment-plan.v1',
            asset: receipt.payment.asset,
            network: receipt.payment.network,
            mint: 'fixture-mint:rail-neutral-usdc',
            payee: receipt.bindingRefs.recipientRef,
            settlementAccount: 'fixture-settlement:rail-neutral-proof-chain',
            amount: receipt.payment.amount,
            quoteExpiresAt: '2026-06-22T11:20:00.000Z',
            failurePolicy: { mode: 'no_charge_on_failure', description: 'Fixture bridge never charges.' },
            refundPolicy: { mode: 'manual_review', description: 'Fixture bridge has no live refund path.' },
            evidenceRequired: true,
            paymentMode: 'dry-run',
        },
        auditNotes: ['Structural fixture bridge for receipt/evidence binding; no AUDD or live payment path is invoked.'],
    };
    const binding = createReceiptEvidenceBinding({
        id: `binding:${receipt.rail}:${receipt.case}`,
        source: receipt.source,
        receipt: redactedReceipt,
        evidence,
        evidencePayload,
        paymentPreflight,
        createdAt,
    });
    return {
        schemaVersion: RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_SCHEMA_VERSION,
        case: input.case,
        status: 'binding_ready',
        sourceRef: sourceRefFromInput(input.receiptInput),
        railNeutralReceipt: receipt,
        redactedReceipt,
        evidence,
        binding,
        bindingRefs: {
            ...refs,
            paymentProofRef: receipt.payment.paymentProofRef,
            requestHash: receipt.bindingRefs.requestHash,
            responseHash: receipt.bindingRefs.responseHash,
            evidenceRef: receipt.bindingRefs.evidenceRef,
            nonceRef: receipt.bindingRefs.nonceRef,
            recipientRef: receipt.bindingRefs.recipientRef,
            operatorApprovalRef: receipt.bindingRefs.operatorApprovalRef,
        },
        claimBoundaryLabels: receipt.claimBoundary,
        guardrails: RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_GUARDRAILS,
    };
}
export const railNeutralProofChainFixtures = {
    payShSandboxSingleChargeBinding: createRailNeutralProofChainFixture({
        case: 'pay_sh_sandbox_single_charge_binding',
        receiptInput: { rail: 'pay-sh-sandbox', fixture: payShSandboxEvidenceFixtures.singleCharge },
    }),
    mppTempoUnsupportedNetwork: createRailNeutralProofChainFixture({
        case: 'mpp_tempo_unsupported_network',
        receiptInput: { rail: 'mpp-tempo', fixture: mppTempoReceiptShapeFixtures.tempoSingleChargeCandidate },
    }),
    unsupportedAssetNetwork: createRailNeutralProofChainFixture({
        case: 'unsupported_asset_network',
        receiptInput: { rail: 'pay-sh-sandbox', fixture: payShSandboxEvidenceFixtures.singleCharge },
        options: { networkOverride: 'base-mainnet' },
    }),
    malformedReceipt: createRailNeutralProofChainFixture({
        case: 'malformed_receipt',
        receiptInput: {
            rail: 'pay-sh-sandbox',
            fixture: {
                ...payShSandboxEvidenceFixtures.singleCharge,
                receipt: undefined,
            },
        },
    }),
    policyDenied: createRailNeutralProofChainFixture({
        case: 'policy_denied',
        receiptInput: { rail: 'pay-sh-sandbox', fixture: payShSandboxEvidenceFixtures.singleCharge },
        options: {
            policy: {
                allowed: false,
                reasonCodes: ['operator_denied'],
                auditNotes: ['Operator denied this fixture-only proof-chain bridge.'],
            },
        },
    }),
    livePathOverclaim: createRailNeutralProofChainFixture({
        case: 'live_path_overclaim',
        receiptInput: {
            rail: 'pay-sh-sandbox',
            fixture: {
                ...payShSandboxEvidenceFixtures.singleCharge,
                claimBoundary: [
                    'provider call performed with hosted registry write completed, trust upgrade performed, reputation mutation performed, settlement finality proven, custody accepted, and live Pay.sh activation',
                ],
            },
        },
    }),
};
function blockedFixture(fixtureCase, sourceFixture, refs, errors) {
    return {
        schemaVersion: RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_SCHEMA_VERSION,
        case: fixtureCase,
        status: 'blocked',
        sourceRef: sourceRefFromFixture(refs.sourceRef, sourceFixture),
        blockedBy: errors.map((item) => ({
            code: item.code,
            path: item.path,
            message: blockedMessage(item),
        })),
        bindingRefs: refs,
        claimBoundaryLabels: [
            'Fail-closed fixture state only.',
            'No Reddi receipt v1 settlement proof, custody, trust upgrade, reputation mutation, marketplace publication, provider execution, wallet signing, RPC, spend, sandbox execution, or live payment is claimed.',
        ],
        guardrails: RAIL_NEUTRAL_PROOF_CHAIN_FIXTURE_GUARDRAILS,
    };
}
function blockedMessage(error) {
    if (error.code === 'live_path_rejected') {
        return 'Rail-neutral proof-chain fixture rejected imported live-path overclaim text.';
    }
    return error.message;
}
function sourceRefFromInput(input) {
    const refs = bindingRefsFromInput(input.fixture);
    return sourceRefFromFixture(refs.sourceRef, input.fixture, input.rail);
}
function sourceRefFromFixture(sourceId, fixture, rail) {
    return {
        rail: rail ?? (isPayShSandboxEvidenceFixture(fixture) ? 'pay-sh-sandbox' : 'mpp-tempo'),
        case: fixture.case,
        sourceId,
        artifactPath: fixture.artifactPath,
    };
}
function bindingRefsFromInput(fixture) {
    if (isPayShSandboxEvidenceFixture(fixture))
        return {
            sourceRef: fixture.bindingRefs.source.sourceId,
            quoteRef: fixture.bindingRefs.quoteRef,
            paymentProofRef: fixture.bindingRefs.paymentProofRef,
            requestHash: fixture.bindingRefs.requestHash,
            responseHash: fixture.bindingRefs.responseHash,
            evidenceRef: fixture.bindingRefs.evidenceRef,
            nonceRef: fixture.bindingRefs.nonceRef,
            recipientRef: fixture.bindingRefs.recipientRef,
            operatorApprovalRef: fixture.bindingRefs.operatorApprovalRef,
        };
    return {
        sourceRef: fixture.bindingRefs.sourceId,
        paymentProofRef: fixture.bindingRefs.paymentProofRef,
        requestHash: fixture.bindingRefs.requestHash,
        responseHash: fixture.bindingRefs.responseHash,
        evidenceRef: fixture.bindingRefs.evidenceRef,
        nonceRef: fixture.bindingRefs.nonceRef,
        recipientRef: fixture.bindingRefs.recipientRef,
        operatorApprovalRef: fixture.bindingRefs.operatorApprovalRef,
    };
}
function isPayShSandboxEvidenceFixture(fixture) {
    return 'source' in fixture.bindingRefs;
}
