export declare const MPP_TEMPO_RECEIPT_SHAPE_SCHEMA_VERSION: "reddi.mpp-tempo-receipt-shape.v1";
export type MppTempoReceiptFixtureCase = 'mpp_single_charge_tempo_candidate' | 'mpp_session_probe' | 'mpp_split_probe' | 'tempo_live_receipt_unsupported';
export type MppTempoReceiptSupportState = 'binding_candidate' | 'probe_only' | 'unsupported_live_rail';
export type MppTempoPaymentMethod = 'tempo-stablecoin';
export type MppTempoChallengeShape = {
    protocol: 'mpp';
    status: 402;
    intent: 'charge' | 'session';
    paymentMethod: MppTempoPaymentMethod;
    network: 'tempo';
    asset: 'USDC' | 'pathUSD';
    amount: string;
    unit: 'microusd' | 'base-units';
    endpoint: string;
    nonce: string;
    recipientRef: string;
    sessionCap?: string;
    splitRecipients?: string[];
};
export type MppTempoReceiptShape = {
    protocol: 'mpp';
    paymentMethod: MppTempoPaymentMethod;
    network: 'tempo';
    asset: 'USDC' | 'pathUSD';
    amount: string;
    status: 'success';
    nonce: string;
    receiptRef: string;
    settledAt: string;
};
export type MppTempoFixtureSummary = {
    schema: string;
    case: MppTempoReceiptFixtureCase;
    sourceRefs: string[];
    artifactPath: string;
    challenge: MppTempoChallengeShape;
    receipt?: MppTempoReceiptShape;
    liveReceipt?: unknown;
    claimBoundary: string[];
};
export type MppTempoBindingRefs = {
    sourceId: 'mpp-tempo:fixture-corpus';
    challengeRef: string;
    paymentProofRef: string;
    evidenceRef: string;
    requestHash: string;
    responseHash: string;
    recipientRef: string;
    nonceRef: string;
    operatorApprovalRef: string;
};
export type MppTempoReceiptShapeFixture = {
    schemaVersion: typeof MPP_TEMPO_RECEIPT_SHAPE_SCHEMA_VERSION;
    case: MppTempoReceiptFixtureCase;
    supportState: MppTempoReceiptSupportState;
    artifactPath: string;
    challenge: MppTempoChallengeShape;
    receipt?: MppTempoReceiptShape;
    bindingRefs: MppTempoBindingRefs;
    guardrails: {
        fixtureOnly: true;
        walletSigning: false;
        rpcCall: false;
        providerCall: false;
        livePayment: false;
        hostedRegistryWrite: false;
        trustUpgrade: false;
        reputationMutation: false;
    };
    claimBoundary: string[];
};
export type MppTempoReceiptShapeErrorCode = 'malformed_fixture' | 'unsupported_protocol' | 'unsupported_payment_method' | 'malformed_challenge' | 'malformed_receipt' | 'receipt_challenge_mismatch' | 'live_path_rejected' | 'unsupported_live_rail';
export type MppTempoReceiptShapeError = {
    code: MppTempoReceiptShapeErrorCode;
    path: string;
    message: string;
};
export type MppTempoReceiptShapeResult = {
    ok: true;
    fixture: MppTempoReceiptShapeFixture;
} | {
    ok: false;
    errors: MppTempoReceiptShapeError[];
};
export declare const MPP_TEMPO_RECEIPT_SHAPE_GUARDRAILS: {
    readonly fixtureOnly: true;
    readonly walletSigning: false;
    readonly rpcCall: false;
    readonly providerCall: false;
    readonly livePayment: false;
    readonly hostedRegistryWrite: false;
    readonly trustUpgrade: false;
    readonly reputationMutation: false;
};
export declare const mppTempoReceiptShapeSummaries: {
    tempoSingleChargeCandidate: {
        schema: string;
        case: "mpp_single_charge_tempo_candidate";
        sourceRefs: string[];
        artifactPath: string;
        challenge: {
            protocol: "mpp";
            status: 402;
            intent: "charge";
            paymentMethod: "tempo-stablecoin";
            network: "tempo";
            asset: "USDC";
            amount: string;
            unit: "microusd";
            endpoint: string;
            nonce: string;
            recipientRef: string;
        };
        receipt: {
            protocol: "mpp";
            paymentMethod: "tempo-stablecoin";
            network: "tempo";
            asset: "USDC";
            amount: string;
            status: "success";
            nonce: string;
            receiptRef: string;
            settledAt: string;
        };
        claimBoundary: string[];
    };
    tempoSessionProbe: {
        schema: string;
        case: "mpp_session_probe";
        sourceRefs: string[];
        artifactPath: string;
        challenge: {
            protocol: "mpp";
            status: 402;
            intent: "session";
            paymentMethod: "tempo-stablecoin";
            network: "tempo";
            asset: "pathUSD";
            amount: string;
            unit: "base-units";
            endpoint: string;
            nonce: string;
            recipientRef: string;
            sessionCap: string;
        };
        claimBoundary: string[];
    };
    tempoSplitProbe: {
        schema: string;
        case: "mpp_split_probe";
        sourceRefs: string[];
        artifactPath: string;
        challenge: {
            protocol: "mpp";
            status: 402;
            intent: "charge";
            paymentMethod: "tempo-stablecoin";
            network: "tempo";
            asset: "USDC";
            amount: string;
            unit: "microusd";
            endpoint: string;
            nonce: string;
            recipientRef: string;
            splitRecipients: string[];
        };
        claimBoundary: string[];
    };
    tempoLiveReceiptUnsupported: {
        schema: string;
        case: "tempo_live_receipt_unsupported";
        sourceRefs: string[];
        artifactPath: string;
        challenge: {
            protocol: "mpp";
            status: 402;
            intent: "charge";
            paymentMethod: "tempo-stablecoin";
            network: "tempo";
            asset: "USDC";
            amount: string;
            unit: "microusd";
            endpoint: string;
            nonce: string;
            recipientRef: string;
        };
        liveReceipt: {
            status: string;
            network: string;
            txHash: string;
        };
        claimBoundary: string[];
    };
};
export declare function createMppTempoReceiptShapeFixture(summary: MppTempoFixtureSummary): MppTempoReceiptShapeFixture;
export declare function deriveMppTempoReceiptShapeFixture(summary: MppTempoFixtureSummary): MppTempoReceiptShapeResult;
export declare const mppTempoReceiptShapeFixtures: {
    readonly tempoSingleChargeCandidate: MppTempoReceiptShapeFixture;
    readonly tempoSessionProbe: MppTempoReceiptShapeFixture;
    readonly tempoSplitProbe: MppTempoReceiptShapeFixture;
};
