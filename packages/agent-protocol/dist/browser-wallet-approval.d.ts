import { AUDD_ASSET, AUDD_DECIMALS, SOLANA_DEVNET_CAIP2, SPL_TOKEN_PROGRAM_ID } from './audd-rail-config.js';
import type { ReddiPaymentEligibilityLabel, ReddiPaymentEnvironmentLabel } from './payment-records.js';
export declare const BROWSER_WALLET_APPROVAL_SCHEMA_VERSION: "reddi.browser-wallet.single-use-approval.v1";
export declare const BROWSER_WALLET_APPROVAL_VALIDATION_SCHEMA_VERSION: "reddi.browser-wallet.approval-validation.v1";
export declare const BROWSER_WALLET_TIER1_LOCAL_HARNESS_SCHEMA_VERSION: "reddi.browser-wallet.tier1-local-harness-contract.v1";
export declare const BROWSER_WALLET_IDENTITY_COPY_GUARD_SCHEMA_VERSION: "reddi.browser-wallet.identity-copy-guard.v1";
export declare const CANONICAL_DEVNET_USDC_MINT: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
declare const LOOPBACK_DYNAMIC_SENTINEL: "dynamic-loopback";
export type BrowserWalletApprovalValidationErrorCode = 'malformed_browser_wallet_approval' | 'missing_browser_wallet_approval_field' | 'unknown_browser_wallet_approval_field' | 'invalid_browser_wallet_approval_schema' | 'expired_browser_wallet_approval' | 'non_single_use_browser_wallet_approval' | 'unknown_browser_wallet_provider' | 'mainnet_browser_wallet_rejected' | 'production_browser_wallet_rejected' | 'custody_browser_wallet_rejected' | 'settlement_finality_rejected' | 'overly_broad_browser_wallet_approval' | 'non_canonical_browser_wallet_identity' | 'contradictory_browser_wallet_approval' | 'official_audd_devnet_unavailable' | 'secret_material_rejected' | 'ai_faucet_rejected';
export type BrowserWalletApprovalValidationError = {
    code: BrowserWalletApprovalValidationErrorCode;
    path: string;
    message: string;
};
export type BrowserWalletApprovalValidationResult<T = BrowserWalletSingleUseApprovalRecord> = {
    ok: true;
    record: T;
    warnings: string[];
} | {
    ok: false;
    errors: BrowserWalletApprovalValidationError[];
    warnings: string[];
};
export type BrowserWalletProgramIds = {
    escrow: string;
    registry: string;
    reputation: string;
    attestation: string;
};
export type BrowserWalletTrustedFutureAuddDevnetIdentity = {
    approvalRef: string;
    sourceUrl: string;
    sourceRetrievedAt: string;
    sourceSha256?: string;
    mint: string;
    decimals: typeof AUDD_DECIMALS;
    tokenProgram: typeof SPL_TOKEN_PROGRAM_ID;
};
export type BrowserWalletApprovalValidationOptions = {
    now?: string | Date;
    trustedDevnetProgramIds?: BrowserWalletProgramIds;
    allowFuturePartnerConfirmedAuddDevnet?: boolean;
    trustedFutureAuddDevnetIdentity?: BrowserWalletTrustedFutureAuddDevnetIdentity;
};
export type BrowserWalletProviderSource = {
    kind: 'official-docs' | 'browser-extension-store' | 'operator-ui';
    url: string;
    retrievedAt: string;
    sha256?: string;
};
export type BrowserWalletSingleUseApprovalRecord = {
    schemaVersion: typeof BROWSER_WALLET_APPROVAL_SCHEMA_VERSION;
    status: 'approved';
    approvalId: string;
    approver: string;
    approvedAt: string;
    expiresAt: string;
    usage: {
        scope: 'single-use';
        approvedUseCount: 1;
        consumedUseCount: 0;
        nonce: string;
        reusePolicy: 'fresh-approval-required';
    };
    provider: {
        name: 'Phantom';
        version: string;
        source: BrowserWalletProviderSource;
        devnetSupport: 'verified-official-docs';
    };
    browserProfile: {
        id: string;
        isolation: 'dedicated-disposable';
        syncDisabled: true;
        primaryProfile: false;
        onlyApprovedExtension: string;
        automatedExtensionInstall: false;
        deleteAfterRun: true;
    };
    wallet: {
        publicKey: string;
        secretMaterial: false;
        productionSeedImported: false;
        custody: 'human-controlled-devnet-only';
    };
    network: {
        rapAlias: 'solana-devnet';
        caip2: typeof SOLANA_DEVNET_CAIP2;
        cluster: 'devnet';
        rpcHttp: string;
        rpcWs?: string;
    };
    uiAction: {
        route: string;
        action: 'connect-only' | 'register-agent' | 'x402-devnet-usdc-payment';
        executionMode: 'manual-human-browser-wallet';
        defaultOff: true;
        exactOnce: true;
        devnetActionAvailableByDefault: false;
    };
    programs: {
        target: 'legacy-anchor';
        framework: 'anchor';
        source: 'resolved-network-profile';
        ids: BrowserWalletProgramIds;
        submissionReady: true;
    };
    funding: {
        source: 'human-capped-devnet';
        sourceRef: string;
        humanApproved: true;
        aiFaucetUse: false;
        autoTopUp: false;
        maxBalanceSol: number;
    };
    caps: {
        perActionBaseUnits: string;
        perSessionBaseUnits: string;
        maxFeeLamports: string;
        maxActions: 1;
    };
    retryPolicy: {
        allowed: boolean;
        maxRetries: number;
        countsAgainstCaps: true;
    };
    asset: {
        symbol: 'SOL' | 'USDC' | typeof AUDD_ASSET | 'AUDD_TEST' | 'LOCAL_AUDD_TEST';
        railEnvironment: ReddiPaymentEnvironmentLabel;
        mint: string | null;
        tokenProgram: string | null;
        decimals: number;
        source: 'devnet-sol-fee' | 'existing-gated-devnet-usdc-lane' | 'partner-confirmed-audd-devnet' | 'local-test-only';
        official: boolean;
        auddPartnerConfirmation?: {
            sourceUrl: string;
            sourceRetrievedAt: string;
            sourceSha256?: string;
            confirmedMint: string;
            confirmedDecimals: typeof AUDD_DECIMALS;
            confirmedTokenProgram: typeof SPL_TOKEN_PROGRAM_ID;
        };
        auddDevnetApprovalRef?: string;
    };
    evidence: {
        destination: string;
        redaction: {
            privateKeys: 'forbidden';
            seedPhrases: 'forbidden';
            signerArrays: 'forbidden';
            authHeaders: 'redact';
            cookies: 'redact';
            rawPaymentPayloads: 'redact';
            screenshots: 'redacted-only';
            includePublicKey: true;
            includeSignatures: 'devnet-only';
        };
    };
    rollback: {
        owner: string;
        disconnectRevoke: true;
        deleteBrowserProfile: true;
        deleteLocalState: true;
        preserveRedactedEvidence: true;
        incidentSuspend: true;
        freshApprovalRequired: true;
    };
    boundaries: {
        noMainnet: true;
        noProduction: true;
        noCustody: true;
        noSettlementFinality: true;
        noOfficialAuddDevnet: true;
        noLiveFunds: true;
        noAiFaucet: true;
        noPayShProduction: true;
        noAutomaticTopUp: true;
    };
};
export type BrowserWalletTier1LocalHarnessContract = {
    schemaVersion: typeof BROWSER_WALLET_TIER1_LOCAL_HARNESS_SCHEMA_VERSION;
    enabledByDefault: false;
    executionState: 'dormant-contract-only';
    network: {
        rapAlias: 'local-surfpool';
        caip2: null;
        rpcHttp: typeof LOOPBACK_DYNAMIC_SENTINEL;
        rpcWs: typeof LOOPBACK_DYNAMIC_SENTINEL;
        dynamicPorts: true;
        loopbackOnly: true;
        remoteDatasource: false;
        startupAirdrop: false;
        transactionModeBlockProduction: true;
    };
    browserIdentity: {
        kind: 'disposable-local-browser-identity';
        scope: 'per-run';
        publicKeyOnly: true;
        productionSeedImported: false;
        secretStorage: 'none-committed-public-prefixed-local-only-if-temporarily-used';
        profileIsolation: 'dedicated-disposable';
    };
    asset: {
        label: 'AUDD_TEST' | 'LOCAL_AUDD_TEST';
        environment: 'local-test-mint';
        mint: null;
        mintSource: 'per-run-generated-not-in-this-contract';
        tokenProgram: typeof SPL_TOKEN_PROGRAM_ID;
        decimals: typeof AUDD_DECIMALS;
        grantEligibility: 'non_eligible';
    };
    observation: {
        instruction: 'TransferChecked';
        source: 'local-validator';
        exactTransferChecked: true;
        exactlyOneMatchingTransfer: true;
        requiredFields: Array<'mint' | 'tokenProgram' | 'decimals' | 'payee' | 'destinationOwner' | 'amount' | 'memo' | 'signature' | 'instructionIndex'>;
        expectedTermsAreObservedEvidence: false;
    };
    railIdentity: {
        railEnvironment: 'local-test-mint';
        networkAlias: 'local-surfpool';
        caip2: null;
        asset: 'AUDD_TEST' | 'LOCAL_AUDD_TEST';
        tokenProgram: typeof SPL_TOKEN_PROGRAM_ID;
        decimals: typeof AUDD_DECIMALS;
        observationSource: 'local-validator';
        grantEligibility: 'non_eligible';
    };
    cleanup: {
        disconnectRevoke: true;
        deleteBrowserProfile: true;
        deleteLocalState: true;
        deleteKeyMaterial: true;
        redactEvidence: true;
        incidentSuspend: true;
        freshApprovalRequired: true;
    };
    prohibitedActions: string[];
};
export type BrowserWalletIdentityCopyGuardInput = {
    schemaVersion: typeof BROWSER_WALLET_IDENTITY_COPY_GUARD_SCHEMA_VERSION;
    railEnvironment: ReddiPaymentEnvironmentLabel;
    assetLabel: string;
    networkAlias: string;
    caip2?: string | null;
    mint?: string | null;
    tokenProgram?: string | null;
    decimals?: number | null;
    observationSource: 'expected-only' | 'parsed-transaction-fixture' | 'local-validator' | 'parsed-rpc-transaction';
    grantEligibility: ReddiPaymentEligibilityLabel;
    x402Export?: {
        state: 'expected' | 'observed';
        asset: string;
        networkAlias: string;
        caip2?: string | null;
        mint?: string | null;
        tokenProgram?: string | null;
        decimals?: number | null;
    };
    policy?: {
        grantEligibility: ReddiPaymentEligibilityLabel;
        operatorApprovalRef?: string;
        controlledLive: boolean;
    };
    receipt?: {
        claim: 'expected-only' | 'fixture-only' | 'observed-transfer-checked' | 'observed-settlement';
        observationStatus: 'not-observed' | 'fixture-observed' | 'local-observed' | 'rpc-observed';
        settlementFinality: boolean;
        controlledLiveEvidence: boolean;
    };
    copy?: {
        title?: string;
        summary?: string;
        badges?: string[];
        notes?: string[];
    };
};
export type BrowserWalletTier1LocalHarnessValidationResult = BrowserWalletApprovalValidationResult<BrowserWalletTier1LocalHarnessContract>;
export type BrowserWalletIdentityCopyGuardResult = BrowserWalletApprovalValidationResult<BrowserWalletIdentityCopyGuardInput>;
export declare function validateBrowserWalletApprovalRecord(input: unknown, options?: BrowserWalletApprovalValidationOptions): BrowserWalletApprovalValidationResult;
export declare function validateBrowserWalletTier1LocalHarnessContract(input: unknown): BrowserWalletTier1LocalHarnessValidationResult;
export declare function validateBrowserWalletIdentityCopyClaims(input: unknown): BrowserWalletIdentityCopyGuardResult;
export declare const DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT: BrowserWalletTier1LocalHarnessContract;
export {};
