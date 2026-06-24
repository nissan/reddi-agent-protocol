import { type AuddPaymentPlanPreflightDecision, type AuddSolanaPaymentPlan } from './audd-payment-plan.js';
import { type SellerResponse } from './buyer-seller.js';
export declare const SELLER_WRAPPER_RAIL_FIXTURE_SCHEMA_VERSION: "reddi.seller-wrapper-rail-fixture.v1";
export type SellerWrapperRailState = 'fixture' | 'dry-run' | 'proof-metadata-only' | 'devnet-gated' | 'live-gated' | 'custody-supported' | 'unsupported';
export type SellerWrapperRailConfig = {
    id: string;
    asset: 'SOL' | 'USDC' | 'AUDD';
    network: string;
    state: SellerWrapperRailState;
    amountUnits: string;
    payee: string;
    settlementAccount?: string;
    evidenceRequired: boolean;
    approvalRequired: boolean;
    livePaymentApproved: false;
    custodySupported: boolean;
    notes: string[];
    auddPaymentPlan?: AuddSolanaPaymentPlan;
};
export type SellerWrapperEndpointFixture = {
    kind: 'mcp' | 'http-openapi';
    endpointId: string;
    displayName: string;
    transport: {
        url: string;
        auth: 'none';
    };
    rails: SellerWrapperRailConfig[];
};
export type SellerWrapperRailFixture = {
    schemaVersion: typeof SELLER_WRAPPER_RAIL_FIXTURE_SCHEMA_VERSION;
    issue: 529;
    sourceContract: {
        railParityIssue: 525;
        railParityPullRequest: 528;
        sellerWrapperIssue: 375;
    };
    endpoints: SellerWrapperEndpointFixture[];
    guardrails: {
        noSecrets: true;
        noLivePayment: true;
        noWalletSigning: true;
        noRpcCall: true;
        noCustodyClaim: true;
        noSettlementFinalityClaim: true;
    };
};
export type AuddSellerWrapperNoSpendFlow = {
    fixture: SellerWrapperRailFixture;
    auddRail: SellerWrapperRailConfig;
    preflight: AuddPaymentPlanPreflightDecision;
    sellerResponse: SellerResponse | undefined;
    guardrails: SellerWrapperRailFixture['guardrails'];
};
export declare const sellerWrapperRailFixture: SellerWrapperRailFixture;
export declare function sellerWrapperFixtureHasCredentialMaterial(value: unknown): boolean;
export declare function getSellerWrapperRail(fixture: SellerWrapperRailFixture, asset: SellerWrapperRailConfig['asset'], network: string): SellerWrapperRailConfig | undefined;
export declare function runAuddSellerWrapperNoSpendFlow(input?: {
    fixture?: SellerWrapperRailFixture;
    now?: string;
    approvalState?: 'approved' | 'denied' | 'requires_operator_approval';
    allowedMint?: string;
    allowedPayee?: string;
    allowedSettlementAccount?: string;
    approveLivePayment?: boolean;
    forceLiveChallenge?: boolean;
}): Promise<AuddSellerWrapperNoSpendFlow>;
