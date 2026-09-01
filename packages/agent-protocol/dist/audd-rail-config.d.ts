import type { ReddiPaymentEligibilityLabel, ReddiPaymentEnvironmentLabel } from './payment-records.js';
export declare const AUDD_RAIL_CONFIG_SCHEMA_VERSION: "reddi.audd-rail-config.v1";
export declare const AUDD_ASSET: "AUDD";
export declare const AUDD_DECIMALS: 6;
export declare const AUDD_DETERMINISTIC_FIXTURE_MINT: "AUDDdev111111111111111111111111111111111111";
export declare const AUDD_OFFICIAL_SOLANA_MAINNET_MINT: "AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw";
export declare const SPL_TOKEN_PROGRAM_ID: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export declare const SOLANA_MAINNET_BETA_CAIP2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export declare const SOLANA_DEVNET_CAIP2: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export declare const SOLANA_TESTNET_CAIP2: "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z";
export type AuddRailEnvironment = 'deterministic-fixture' | 'local-test-mint' | 'devnet-unverified' | 'mainnet-gated';
export type AuddRailStatus = 'deterministic-fixture-only' | 'generated-local-test-mint' | 'unverified-blocked-devnet' | 'gated-mainnet-disabled-by-default';
export type AuddRailIdentityValidationReasonCode = 'audd_rail_identity_allowed' | 'malformed_audd_rail_identity' | 'unknown_audd_rail_environment' | 'wrong_network' | 'wrong_caip2_network' | 'wrong_mint' | 'wrong_token_program' | 'wrong_decimals' | 'local_test_mint_required' | 'devnet_unverified_blocked' | 'mainnet_audd_disabled_by_default';
export type AuddRailProvenance = {
    verifiedAt: string;
    confidence: 'fixture' | 'local-generated' | 'unverified' | 'verified-public-mainnet';
    sources: string[];
    facts: string[];
};
export type AuddRailEnvironmentConfig = {
    environment: AuddRailEnvironment;
    status: AuddRailStatus;
    networkAlias: string;
    caip2?: string;
    defaultEnabled: boolean;
    grantEligibility: ReddiPaymentEligibilityLabel;
    evidenceEnvironment: ReddiPaymentEnvironmentLabel;
    mint?: string;
    mints?: string[];
    mintPolicy?: string;
    tokenProgram?: string | null;
    decimals: typeof AUDD_DECIMALS;
    provenance: AuddRailProvenance[];
    activationRequires?: string[];
    notes: string[];
};
export type AuddRailConfig = {
    schemaVersion: typeof AUDD_RAIL_CONFIG_SCHEMA_VERSION;
    asset: typeof AUDD_ASSET;
    decimals: typeof AUDD_DECIMALS;
    tokenPrograms: {
        splToken: typeof SPL_TOKEN_PROGRAM_ID;
    };
    caip2Networks: {
        'solana-devnet': typeof SOLANA_DEVNET_CAIP2;
        'solana-mainnet-beta': typeof SOLANA_MAINNET_BETA_CAIP2;
        'solana-testnet': typeof SOLANA_TESTNET_CAIP2;
    };
    environments: Record<AuddRailEnvironment, AuddRailEnvironmentConfig>;
};
export type AuddRailIdentityInput = {
    environment: AuddRailEnvironment | string;
    network?: string;
    caip2?: string;
    mint?: string;
    tokenProgram?: string | null;
    decimals?: number;
    /** Explicit approval flag for identity validation only; it does not submit, sign, or activate live payments. */
    enableGatedMainnet?: boolean;
};
export type AuddRailIdentityRefInput = {
    network?: string;
    caip2Network?: string;
    mint?: string;
};
export type AuddRailIdentity = {
    asset: typeof AUDD_ASSET;
    environment: AuddRailEnvironment;
    status: AuddRailStatus;
    network: string;
    caip2?: string;
    mint?: string;
    tokenProgram?: string | null;
    decimals: typeof AUDD_DECIMALS;
    defaultEnabled: boolean;
    grantEligibility: ReddiPaymentEligibilityLabel;
    evidenceEnvironment: ReddiPaymentEnvironmentLabel;
    provenance: AuddRailProvenance[];
    activationRequires?: string[];
    notes: string[];
};
export type AuddRailIdentityValidationResult = {
    ok: true;
    identity: AuddRailIdentity;
    reasonCodes: ['audd_rail_identity_allowed'];
    auditNotes: string[];
} | {
    ok: false;
    identity?: AuddRailIdentity;
    reasonCodes: AuddRailIdentityValidationReasonCode[];
    auditNotes: string[];
};
export declare const AUDD_RAIL_CONFIG: AuddRailConfig;
export declare function isKnownAuddMint(mint: unknown): boolean;
export declare function canonicalSolanaNetworkAlias(network: unknown): string | undefined;
export declare function caip2ForSolanaNetwork(network: string): string | undefined;
export declare function networkAliasForCaip2(caip2: string): string | undefined;
export declare function getAuddRailEnvironmentConfig(environment: AuddRailEnvironment): AuddRailEnvironmentConfig;
export declare function auddRailIdentityTargetsMainnet(input: AuddRailIdentityRefInput): boolean;
export declare function deriveCanonicalAuddRailEnvironment(input: AuddRailIdentityRefInput): AuddRailEnvironment | undefined;
export declare function validateAuddRailIdentity(input: AuddRailIdentityInput): AuddRailIdentityValidationResult;
