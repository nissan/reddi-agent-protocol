import { AUDD_ASSET, AUDD_DECIMALS, AUDD_DETERMINISTIC_FIXTURE_MINT, AUDD_OFFICIAL_SOLANA_MAINNET_MINT, SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_BETA_CAIP2, SPL_TOKEN_PROGRAM_ID, } from './audd-rail-config.js';
export const BROWSER_WALLET_APPROVAL_SCHEMA_VERSION = 'reddi.browser-wallet.single-use-approval.v1';
export const BROWSER_WALLET_APPROVAL_VALIDATION_SCHEMA_VERSION = 'reddi.browser-wallet.approval-validation.v1';
export const BROWSER_WALLET_TIER1_LOCAL_HARNESS_SCHEMA_VERSION = 'reddi.browser-wallet.tier1-local-harness-contract.v1';
export const BROWSER_WALLET_IDENTITY_COPY_GUARD_SCHEMA_VERSION = 'reddi.browser-wallet.identity-copy-guard.v1';
export const CANONICAL_DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const OFFICIAL_SOLANA_MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const REJECTED_MAINNET_MINTS = new Set([AUDD_OFFICIAL_SOLANA_MAINNET_MINT, OFFICIAL_SOLANA_MAINNET_USDC_MINT]);
const NON_LIVE_COPY_GUARD_RAIL_ENVIRONMENTS = new Set(['deterministic-fixture', 'local-test-mint', 'devnet-unverified']);
const SUPPORTED_DEVNET_BROWSER_WALLET_PROVIDERS = new Set(['Phantom']);
const BROWSER_WALLET_ALLOWED_ACTIONS = new Set(['connect-only', 'register-agent', 'x402-devnet-usdc-payment']);
const BROAD_STRING_PATTERN = /(^|[\s:/_-])(?:any|all|wildcard|default|latest|current|unknown|tbd|todo|production|prod|mainnet)([\s:/_-]|$)|\*/i;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,160}$/;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const NON_NEGATIVE_INTEGER_STRING = /^(0|[1-9]\d*)$/;
const LOOPBACK_DYNAMIC_SENTINEL = 'dynamic-loopback';
const DEFAULT_PLAYWRIGHT_FIXTURE_PUBLIC_KEY = '11111111111111111111111111111111';
const APPROVAL_TOP_LEVEL_KEYS = new Set([
    'schemaVersion',
    'status',
    'approvalId',
    'approver',
    'approvedAt',
    'expiresAt',
    'usage',
    'provider',
    'browserProfile',
    'wallet',
    'network',
    'uiAction',
    'programs',
    'funding',
    'caps',
    'retryPolicy',
    'asset',
    'evidence',
    'rollback',
    'boundaries',
]);
const USAGE_KEYS = new Set(['scope', 'approvedUseCount', 'consumedUseCount', 'nonce', 'reusePolicy']);
const PROVIDER_KEYS = new Set(['name', 'version', 'source', 'devnetSupport']);
const SOURCE_KEYS = new Set(['kind', 'url', 'retrievedAt', 'sha256']);
const BROWSER_PROFILE_KEYS = new Set([
    'id',
    'isolation',
    'syncDisabled',
    'primaryProfile',
    'onlyApprovedExtension',
    'automatedExtensionInstall',
    'deleteAfterRun',
]);
const WALLET_KEYS = new Set(['publicKey', 'secretMaterial', 'productionSeedImported', 'custody']);
const NETWORK_KEYS = new Set(['rapAlias', 'caip2', 'cluster', 'rpcHttp', 'rpcWs']);
const UI_ACTION_KEYS = new Set(['route', 'action', 'executionMode', 'defaultOff', 'exactOnce', 'devnetActionAvailableByDefault']);
const PROGRAMS_KEYS = new Set(['target', 'framework', 'source', 'ids', 'submissionReady']);
const PROGRAM_IDS_KEYS = new Set(['escrow', 'registry', 'reputation', 'attestation']);
const FUNDING_KEYS = new Set(['source', 'sourceRef', 'humanApproved', 'aiFaucetUse', 'autoTopUp', 'maxBalanceSol']);
const CAPS_KEYS = new Set(['perActionBaseUnits', 'perSessionBaseUnits', 'maxFeeLamports', 'maxActions']);
const RETRY_POLICY_KEYS = new Set(['allowed', 'maxRetries', 'countsAgainstCaps']);
const ASSET_KEYS = new Set([
    'symbol',
    'railEnvironment',
    'mint',
    'tokenProgram',
    'decimals',
    'source',
    'official',
    'auddPartnerConfirmation',
    'auddDevnetApprovalRef',
]);
const AUDD_PARTNER_CONFIRMATION_KEYS = new Set(['sourceUrl', 'sourceRetrievedAt', 'sourceSha256', 'confirmedMint', 'confirmedDecimals', 'confirmedTokenProgram']);
const EVIDENCE_KEYS = new Set(['destination', 'redaction']);
const REDACTION_KEYS = new Set([
    'privateKeys',
    'seedPhrases',
    'signerArrays',
    'authHeaders',
    'cookies',
    'rawPaymentPayloads',
    'screenshots',
    'includePublicKey',
    'includeSignatures',
]);
const ROLLBACK_KEYS = new Set([
    'owner',
    'disconnectRevoke',
    'deleteBrowserProfile',
    'deleteLocalState',
    'preserveRedactedEvidence',
    'incidentSuspend',
    'freshApprovalRequired',
]);
const BOUNDARY_KEYS = new Set([
    'noMainnet',
    'noProduction',
    'noCustody',
    'noSettlementFinality',
    'noOfficialAuddDevnet',
    'noLiveFunds',
    'noAiFaucet',
    'noPayShProduction',
    'noAutomaticTopUp',
]);
const TIER1_CONTRACT_KEYS = new Set([
    'schemaVersion',
    'enabledByDefault',
    'executionState',
    'network',
    'browserIdentity',
    'asset',
    'observation',
    'railIdentity',
    'cleanup',
    'prohibitedActions',
]);
const TIER1_NETWORK_KEYS = new Set(['rapAlias', 'caip2', 'rpcHttp', 'rpcWs', 'dynamicPorts', 'loopbackOnly', 'remoteDatasource', 'startupAirdrop', 'transactionModeBlockProduction']);
const TIER1_BROWSER_IDENTITY_KEYS = new Set(['kind', 'scope', 'publicKeyOnly', 'productionSeedImported', 'secretStorage', 'profileIsolation']);
const TIER1_ASSET_KEYS = new Set(['label', 'environment', 'mint', 'mintSource', 'tokenProgram', 'decimals', 'grantEligibility']);
const TIER1_OBSERVATION_KEYS = new Set(['instruction', 'source', 'exactTransferChecked', 'exactlyOneMatchingTransfer', 'requiredFields', 'expectedTermsAreObservedEvidence']);
const TIER1_RAIL_IDENTITY_KEYS = new Set(['railEnvironment', 'networkAlias', 'caip2', 'asset', 'tokenProgram', 'decimals', 'observationSource', 'grantEligibility']);
const TIER1_CLEANUP_KEYS = new Set(['disconnectRevoke', 'deleteBrowserProfile', 'deleteLocalState', 'deleteKeyMaterial', 'redactEvidence', 'incidentSuspend', 'freshApprovalRequired']);
const COPY_GUARD_KEYS = new Set([
    'schemaVersion',
    'railEnvironment',
    'assetLabel',
    'networkAlias',
    'caip2',
    'mint',
    'tokenProgram',
    'decimals',
    'observationSource',
    'grantEligibility',
    'x402Export',
    'policy',
    'receipt',
    'copy',
]);
const X402_EXPORT_KEYS = new Set(['state', 'asset', 'networkAlias', 'caip2', 'mint', 'tokenProgram', 'decimals']);
const POLICY_KEYS = new Set(['grantEligibility', 'operatorApprovalRef', 'controlledLive']);
const RECEIPT_KEYS = new Set(['claim', 'observationStatus', 'settlementFinality', 'controlledLiveEvidence']);
const OBSERVATION_SOURCE_RANK = {
    'expected-only': 0,
    'parsed-transaction-fixture': 1,
    'local-validator': 2,
    'parsed-rpc-transaction': 3,
};
const RECEIPT_OBSERVATION_STATUS_RANK = {
    'not-observed': 0,
    'fixture-observed': 1,
    'local-observed': 2,
    'rpc-observed': 3,
};
const RECEIPT_CLAIM_RANK = {
    'expected-only': 0,
    'fixture-only': 0,
    'observed-transfer-checked': 2,
    'observed-settlement': 3,
};
const COPY_KEYS = new Set(['title', 'summary', 'badges', 'notes']);
export function validateBrowserWalletApprovalRecord(input, options = {}) {
    const errors = [];
    const warnings = [
        'Validation is offline and default-off: it does not install extensions, inspect wallets, request faucet tokens, sign, simulate, submit, or observe transactions.',
    ];
    if (!isPlainObject(input)) {
        return { ok: false, errors: [error('malformed_browser_wallet_approval', '$', 'approval record must be an object')], warnings };
    }
    const record = input;
    rejectUnknownKeys(record, '$', APPROVAL_TOP_LEVEL_KEYS, errors);
    requireLiteral(record.schemaVersion, BROWSER_WALLET_APPROVAL_SCHEMA_VERSION, '$.schemaVersion', 'invalid_browser_wallet_approval_schema', errors);
    requireLiteral(record.status, 'approved', '$.status', 'malformed_browser_wallet_approval', errors);
    requireExactString(record.approvalId, '$.approvalId', errors);
    requireExactString(record.approver, '$.approver', errors);
    const approvedAtMs = validateTimestamp(record.approvedAt, '$.approvedAt', errors);
    const expiresAtMs = validateTimestamp(record.expiresAt, '$.expiresAt', errors);
    const nowMs = normalizeNow(options.now);
    if (expiresAtMs !== undefined && expiresAtMs <= nowMs) {
        errors.push(error('expired_browser_wallet_approval', '$.expiresAt', 'approval record is expired'));
    }
    if (approvedAtMs !== undefined && expiresAtMs !== undefined && approvedAtMs >= expiresAtMs) {
        errors.push(error('contradictory_browser_wallet_approval', '$.approvedAt', 'approvedAt must be earlier than expiresAt'));
    }
    validateUsage(record.usage, '$.usage', errors);
    const providerSourceRetrievedAtMs = validateProvider(record.provider, '$.provider', errors);
    if (providerSourceRetrievedAtMs !== undefined && approvedAtMs !== undefined && providerSourceRetrievedAtMs > approvedAtMs) {
        errors.push(error('contradictory_browser_wallet_approval', '$.provider.source.retrievedAt', 'provider source retrievedAt must be no later than approvedAt'));
    }
    validateBrowserProfile(record.browserProfile, record.provider?.name, '$.browserProfile', errors);
    validateWallet(record.wallet, '$.wallet', errors);
    validateNetwork(record.network, '$.network', errors);
    validateUiAction(record.uiAction, '$.uiAction', errors);
    validatePrograms(record.programs, '$.programs', errors);
    validateFunding(record.funding, '$.funding', errors);
    validateCaps(record.caps, '$.caps', errors);
    validateRetryPolicy(record.retryPolicy, '$.retryPolicy', errors);
    validateAsset(record.asset, record.uiAction?.action, Boolean(options.allowFuturePartnerConfirmedAuddDevnet), '$.asset', errors);
    validateEvidence(record.evidence, '$.evidence', errors);
    validateRollback(record.rollback, '$.rollback', errors);
    validateBoundaries(record.boundaries, '$.boundaries', errors);
    if (record.network?.rapAlias === 'solana-devnet' && record.network?.caip2 !== SOLANA_DEVNET_CAIP2) {
        errors.push(error('non_canonical_browser_wallet_identity', '$.network.caip2', 'network CAIP-2 identity must match the canonical Solana Devnet reference'));
    }
    if (record.asset?.symbol === 'USDC' && record.uiAction?.action !== 'x402-devnet-usdc-payment') {
        errors.push(error('contradictory_browser_wallet_approval', '$.asset.symbol', 'USDC may only be approved for the gated x402 Devnet USDC action'));
    }
    if (record.uiAction?.action === 'x402-devnet-usdc-payment' && record.asset?.symbol !== 'USDC') {
        errors.push(error('contradictory_browser_wallet_approval', '$.uiAction.action', 'x402 Devnet USDC action must approve USDC only'));
    }
    return errors.length === 0 ? { ok: true, record, warnings } : { ok: false, errors: uniqueErrors(errors), warnings };
}
export function validateBrowserWalletTier1LocalHarnessContract(input) {
    const errors = [];
    const warnings = [
        'Tier 1 local browser harness validation is a dormant contract check only: it creates no mint, keypair, signature, blockhash, transaction, validator state, or token balance.',
    ];
    if (!isPlainObject(input)) {
        return { ok: false, errors: [error('malformed_browser_wallet_approval', '$', 'Tier 1 contract must be an object')], warnings };
    }
    const contract = input;
    rejectUnknownKeys(contract, '$', TIER1_CONTRACT_KEYS, errors);
    requireLiteral(contract.schemaVersion, BROWSER_WALLET_TIER1_LOCAL_HARNESS_SCHEMA_VERSION, '$.schemaVersion', 'invalid_browser_wallet_approval_schema', errors);
    requireLiteral(contract.enabledByDefault, false, '$.enabledByDefault', 'production_browser_wallet_rejected', errors);
    requireLiteral(contract.executionState, 'dormant-contract-only', '$.executionState', 'production_browser_wallet_rejected', errors);
    if (!isPlainObject(contract.network)) {
        errors.push(error('missing_browser_wallet_approval_field', '$.network', 'Tier 1 network contract is required'));
    }
    else {
        rejectUnknownKeys(contract.network, '$.network', TIER1_NETWORK_KEYS, errors);
        requireLiteral(contract.network.rapAlias, 'local-surfpool', '$.network.rapAlias', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.network.caip2, null, '$.network.caip2', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.network.rpcHttp, LOOPBACK_DYNAMIC_SENTINEL, '$.network.rpcHttp', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.network.rpcWs, LOOPBACK_DYNAMIC_SENTINEL, '$.network.rpcWs', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.network.dynamicPorts, true, '$.network.dynamicPorts', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.network.loopbackOnly, true, '$.network.loopbackOnly', 'mainnet_browser_wallet_rejected', errors);
        requireLiteral(contract.network.remoteDatasource, false, '$.network.remoteDatasource', 'mainnet_browser_wallet_rejected', errors);
        requireLiteral(contract.network.startupAirdrop, false, '$.network.startupAirdrop', 'ai_faucet_rejected', errors);
        requireLiteral(contract.network.transactionModeBlockProduction, true, '$.network.transactionModeBlockProduction', 'non_canonical_browser_wallet_identity', errors);
    }
    if (!isPlainObject(contract.browserIdentity)) {
        errors.push(error('missing_browser_wallet_approval_field', '$.browserIdentity', 'Tier 1 browser identity contract is required'));
    }
    else {
        rejectUnknownKeys(contract.browserIdentity, '$.browserIdentity', TIER1_BROWSER_IDENTITY_KEYS, errors);
        requireLiteral(contract.browserIdentity.kind, 'disposable-local-browser-identity', '$.browserIdentity.kind', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.browserIdentity.scope, 'per-run', '$.browserIdentity.scope', 'non_single_use_browser_wallet_approval', errors);
        requireLiteral(contract.browserIdentity.publicKeyOnly, true, '$.browserIdentity.publicKeyOnly', 'secret_material_rejected', errors);
        requireLiteral(contract.browserIdentity.productionSeedImported, false, '$.browserIdentity.productionSeedImported', 'secret_material_rejected', errors);
        requireLiteral(contract.browserIdentity.secretStorage, 'none-committed-public-prefixed-local-only-if-temporarily-used', '$.browserIdentity.secretStorage', 'secret_material_rejected', errors);
        requireLiteral(contract.browserIdentity.profileIsolation, 'dedicated-disposable', '$.browserIdentity.profileIsolation', 'non_canonical_browser_wallet_identity', errors);
    }
    if (!isPlainObject(contract.asset)) {
        errors.push(error('missing_browser_wallet_approval_field', '$.asset', 'Tier 1 asset contract is required'));
    }
    else {
        rejectUnknownKeys(contract.asset, '$.asset', TIER1_ASSET_KEYS, errors);
        if (contract.asset.label !== 'AUDD_TEST' && contract.asset.label !== 'LOCAL_AUDD_TEST') {
            errors.push(error('non_canonical_browser_wallet_identity', '$.asset.label', 'Tier 1 local mint label must be AUDD_TEST or LOCAL_AUDD_TEST'));
        }
        requireLiteral(contract.asset.environment, 'local-test-mint', '$.asset.environment', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.asset.mint, null, '$.asset.mint', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.asset.mintSource, 'per-run-generated-not-in-this-contract', '$.asset.mintSource', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.asset.tokenProgram, SPL_TOKEN_PROGRAM_ID, '$.asset.tokenProgram', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.asset.decimals, AUDD_DECIMALS, '$.asset.decimals', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.asset.grantEligibility, 'non_eligible', '$.asset.grantEligibility', 'non_canonical_browser_wallet_identity', errors);
    }
    if (!isPlainObject(contract.observation)) {
        errors.push(error('missing_browser_wallet_approval_field', '$.observation', 'Tier 1 observation contract is required'));
    }
    else {
        rejectUnknownKeys(contract.observation, '$.observation', TIER1_OBSERVATION_KEYS, errors);
        requireLiteral(contract.observation.instruction, 'TransferChecked', '$.observation.instruction', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.observation.source, 'local-validator', '$.observation.source', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.observation.exactTransferChecked, true, '$.observation.exactTransferChecked', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.observation.exactlyOneMatchingTransfer, true, '$.observation.exactlyOneMatchingTransfer', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.observation.expectedTermsAreObservedEvidence, false, '$.observation.expectedTermsAreObservedEvidence', 'settlement_finality_rejected', errors);
        const required = new Set(contract.observation.requiredFields);
        for (const field of ['mint', 'tokenProgram', 'decimals', 'payee', 'destinationOwner', 'amount', 'signature', 'instructionIndex']) {
            if (!required.has(field)) {
                errors.push(error('non_canonical_browser_wallet_identity', '$.observation.requiredFields', 'TransferChecked observation contract is missing a required identity field'));
            }
        }
    }
    if (!isPlainObject(contract.railIdentity)) {
        errors.push(error('missing_browser_wallet_approval_field', '$.railIdentity', 'Tier 1 rail identity contract is required'));
    }
    else {
        rejectUnknownKeys(contract.railIdentity, '$.railIdentity', TIER1_RAIL_IDENTITY_KEYS, errors);
        requireLiteral(contract.railIdentity.railEnvironment, 'local-test-mint', '$.railIdentity.railEnvironment', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.railIdentity.networkAlias, 'local-surfpool', '$.railIdentity.networkAlias', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.railIdentity.caip2, null, '$.railIdentity.caip2', 'non_canonical_browser_wallet_identity', errors);
        if (contract.railIdentity.asset !== 'AUDD_TEST' && contract.railIdentity.asset !== 'LOCAL_AUDD_TEST') {
            errors.push(error('non_canonical_browser_wallet_identity', '$.railIdentity.asset', 'Tier 1 rail identity must use the local test AUDD label'));
        }
        requireLiteral(contract.railIdentity.tokenProgram, SPL_TOKEN_PROGRAM_ID, '$.railIdentity.tokenProgram', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.railIdentity.decimals, AUDD_DECIMALS, '$.railIdentity.decimals', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.railIdentity.observationSource, 'local-validator', '$.railIdentity.observationSource', 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(contract.railIdentity.grantEligibility, 'non_eligible', '$.railIdentity.grantEligibility', 'non_canonical_browser_wallet_identity', errors);
    }
    if (!isPlainObject(contract.cleanup)) {
        errors.push(error('missing_browser_wallet_approval_field', '$.cleanup', 'Tier 1 cleanup contract is required'));
    }
    else {
        rejectUnknownKeys(contract.cleanup, '$.cleanup', TIER1_CLEANUP_KEYS, errors);
        requireLiteral(contract.cleanup.disconnectRevoke, true, '$.cleanup.disconnectRevoke', 'custody_browser_wallet_rejected', errors);
        requireLiteral(contract.cleanup.deleteBrowserProfile, true, '$.cleanup.deleteBrowserProfile', 'custody_browser_wallet_rejected', errors);
        requireLiteral(contract.cleanup.deleteLocalState, true, '$.cleanup.deleteLocalState', 'custody_browser_wallet_rejected', errors);
        requireLiteral(contract.cleanup.deleteKeyMaterial, true, '$.cleanup.deleteKeyMaterial', 'secret_material_rejected', errors);
        requireLiteral(contract.cleanup.redactEvidence, true, '$.cleanup.redactEvidence', 'secret_material_rejected', errors);
        requireLiteral(contract.cleanup.incidentSuspend, true, '$.cleanup.incidentSuspend', 'production_browser_wallet_rejected', errors);
        requireLiteral(contract.cleanup.freshApprovalRequired, true, '$.cleanup.freshApprovalRequired', 'non_single_use_browser_wallet_approval', errors);
    }
    if (!Array.isArray(contract.prohibitedActions) || contract.prohibitedActions.length < 8) {
        errors.push(error('missing_browser_wallet_approval_field', '$.prohibitedActions', 'Tier 1 contract must enumerate prohibited live actions'));
    }
    else {
        const prohibitedText = contract.prohibitedActions.join('\n').toLowerCase();
        for (const term of ['mainnet', 'devnet rpc', 'faucet', 'keypair', 'signature', 'blockhash', 'transaction', 'balance']) {
            if (!prohibitedText.includes(term)) {
                errors.push(error('non_canonical_browser_wallet_identity', '$.prohibitedActions', 'Tier 1 prohibited-action list is missing a required boundary'));
            }
        }
    }
    return errors.length === 0 ? { ok: true, record: contract, warnings } : { ok: false, errors: uniqueErrors(errors), warnings };
}
export function validateBrowserWalletIdentityCopyClaims(input) {
    const errors = [];
    const warnings = [
        'Identity/copy validation is deterministic and offline: it inspects supplied evidence rows/copy only and never treats expected terms as observed evidence.',
    ];
    if (!isPlainObject(input)) {
        return { ok: false, errors: [error('malformed_browser_wallet_approval', '$', 'identity/copy guard input must be an object')], warnings };
    }
    const row = input;
    rejectUnknownKeys(row, '$', COPY_GUARD_KEYS, errors);
    requireLiteral(row.schemaVersion, BROWSER_WALLET_IDENTITY_COPY_GUARD_SCHEMA_VERSION, '$.schemaVersion', 'invalid_browser_wallet_approval_schema', errors);
    if (!NON_LIVE_COPY_GUARD_RAIL_ENVIRONMENTS.has(String(row.railEnvironment))) {
        errors.push(error(isPaymentEnvironment(row.railEnvironment) ? 'mainnet_browser_wallet_rejected' : 'non_canonical_browser_wallet_identity', '$.railEnvironment', 'browser-wallet safety rows are non-live only: railEnvironment must be deterministic-fixture, local-test-mint, or devnet-unverified'));
    }
    requireExactString(row.assetLabel, '$.assetLabel', errors);
    requireExactString(row.networkAlias, '$.networkAlias', errors);
    validateOptionalExactString(row.mint, '$.mint', errors);
    if (row.tokenProgram !== undefined && row.tokenProgram !== null)
        requireLiteral(row.tokenProgram, SPL_TOKEN_PROGRAM_ID, '$.tokenProgram', 'non_canonical_browser_wallet_identity', errors);
    if (row.decimals !== undefined && row.decimals !== null && row.decimals !== AUDD_DECIMALS) {
        errors.push(error('non_canonical_browser_wallet_identity', '$.decimals', 'AUDD-family copy guard rows must use six decimals'));
    }
    if (!['expected-only', 'parsed-transaction-fixture', 'local-validator', 'parsed-rpc-transaction'].includes(String(row.observationSource))) {
        errors.push(error('non_canonical_browser_wallet_identity', '$.observationSource', 'observation source is not canonical'));
    }
    if (!isPaymentEligibility(row.grantEligibility)) {
        errors.push(error('non_canonical_browser_wallet_identity', '$.grantEligibility', 'grant eligibility label is not canonical'));
    }
    validateCopyNested(row.x402Export, '$.x402Export', X402_EXPORT_KEYS, errors);
    validateCopyNested(row.policy, '$.policy', POLICY_KEYS, errors);
    validateCopyNested(row.receipt, '$.receipt', RECEIPT_KEYS, errors);
    validateCopyNested(row.copy, '$.copy', COPY_KEYS, errors);
    validateCopyGuardNestedShapes(row, errors);
    if (row.x402Export)
        validateCanonicalX402Export(row, errors);
    if (row.policy) {
        if (row.policy.grantEligibility !== row.grantEligibility) {
            errors.push(error('contradictory_browser_wallet_approval', '$.policy.grantEligibility', 'policy grant eligibility must match the row label'));
        }
        if (row.policy.controlledLive) {
            errors.push(error('non_canonical_browser_wallet_identity', '$.policy.controlledLive', 'browser-wallet safety rows must not carry a controlled-live policy claim'));
        }
    }
    if (row.receipt)
        validateReceiptBoundary(row, errors);
    if (row.grantEligibility !== 'non_eligible') {
        errors.push(error('non_canonical_browser_wallet_identity', '$.grantEligibility', 'browser-wallet safety rows must be non_eligible'));
    }
    if (String(row.assetLabel).toUpperCase() === AUDD_ASSET && row.railEnvironment !== 'deterministic-fixture' && row.railEnvironment !== 'devnet-unverified') {
        errors.push(error('non_canonical_browser_wallet_identity', '$.assetLabel', 'local non-live rows must use AUDD_TEST or LOCAL_AUDD_TEST, not official AUDD'));
    }
    if (row.railEnvironment === 'local-test-mint' && !['AUDD_TEST', 'LOCAL_AUDD_TEST'].includes(String(row.assetLabel))) {
        errors.push(error('non_canonical_browser_wallet_identity', '$.assetLabel', 'local-test-mint rows must use the local test AUDD label'));
    }
    if (row.railEnvironment === 'devnet-unverified' && String(row.assetLabel).toUpperCase() === AUDD_ASSET) {
        errors.push(error('official_audd_devnet_unavailable', '$.assetLabel', 'official AUDD Devnet evidence is unavailable without partner confirmation and separate approval'));
    }
    if (row.railEnvironment === 'deterministic-fixture' && row.mint !== AUDD_DETERMINISTIC_FIXTURE_MINT) {
        errors.push(error('non_canonical_browser_wallet_identity', '$.mint', 'deterministic AUDD fixture rows must use the fixture sentinel only'));
    }
    if (typeof row.mint === 'string' && REJECTED_MAINNET_MINTS.has(row.mint)) {
        errors.push(error('mainnet_browser_wallet_rejected', '$.mint', 'browser-wallet safety rows must not name an official Solana mainnet mint'));
    }
    if (row.railEnvironment === 'local-test-mint' && row.mint === AUDD_DETERMINISTIC_FIXTURE_MINT) {
        errors.push(error('non_canonical_browser_wallet_identity', '$.mint', 'local test mint rows must not reuse the deterministic AUDD fixture mint'));
    }
    if (row.receipt?.claim === 'observed-settlement') {
        errors.push(error('settlement_finality_rejected', '$.receipt', 'browser-wallet safety rows must not claim observed settlement'));
    }
    const copyText = collectCopyText(row.copy).join('\n');
    if (copyText) {
        const forbidden = forbiddenCopyMatches(copyText);
        for (const match of forbidden) {
            errors.push(error(match.code, '$.copy', match.message));
        }
    }
    return errors.length === 0 ? { ok: true, record: row, warnings } : { ok: false, errors: uniqueErrors(errors), warnings };
}
export const DORMANT_TIER1_LOCAL_BROWSER_HARNESS_CONTRACT = {
    schemaVersion: BROWSER_WALLET_TIER1_LOCAL_HARNESS_SCHEMA_VERSION,
    enabledByDefault: false,
    executionState: 'dormant-contract-only',
    network: {
        rapAlias: 'local-surfpool',
        caip2: null,
        rpcHttp: LOOPBACK_DYNAMIC_SENTINEL,
        rpcWs: LOOPBACK_DYNAMIC_SENTINEL,
        dynamicPorts: true,
        loopbackOnly: true,
        remoteDatasource: false,
        startupAirdrop: false,
        transactionModeBlockProduction: true,
    },
    browserIdentity: {
        kind: 'disposable-local-browser-identity',
        scope: 'per-run',
        publicKeyOnly: true,
        productionSeedImported: false,
        secretStorage: 'none-committed-public-prefixed-local-only-if-temporarily-used',
        profileIsolation: 'dedicated-disposable',
    },
    asset: {
        label: 'AUDD_TEST',
        environment: 'local-test-mint',
        mint: null,
        mintSource: 'per-run-generated-not-in-this-contract',
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        decimals: AUDD_DECIMALS,
        grantEligibility: 'non_eligible',
    },
    observation: {
        instruction: 'TransferChecked',
        source: 'local-validator',
        exactTransferChecked: true,
        exactlyOneMatchingTransfer: true,
        requiredFields: ['mint', 'tokenProgram', 'decimals', 'payee', 'destinationOwner', 'amount', 'memo', 'signature', 'instructionIndex'],
        expectedTermsAreObservedEvidence: false,
    },
    railIdentity: {
        railEnvironment: 'local-test-mint',
        networkAlias: 'local-surfpool',
        caip2: null,
        asset: 'AUDD_TEST',
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        decimals: AUDD_DECIMALS,
        observationSource: 'local-validator',
        grantEligibility: 'non_eligible',
    },
    cleanup: {
        disconnectRevoke: true,
        deleteBrowserProfile: true,
        deleteLocalState: true,
        deleteKeyMaterial: true,
        redactEvidence: true,
        incidentSuspend: true,
        freshApprovalRequired: true,
    },
    prohibitedActions: [
        'no mainnet endpoint, wallet, token, transaction, or funding source',
        'no Devnet RPC or hosted provider endpoint in Tier 1',
        'no Solana faucet request or startup airdrop',
        'no committed keypair, signer array, seed phrase, or reusable wallet file',
        'no signature generation in this dormant contract task',
        'no blockhash generation in this dormant contract task',
        'no transaction creation, simulation, submission, or confirmation in this dormant contract task',
        'no token balance, mint address, validator state, or local ledger artifact generated by this contract',
    ],
};
function validateUsage(value, path, errors) {
    if (!isPlainObject(value)) {
        errors.push(error('missing_browser_wallet_approval_field', path, 'single-use metadata is required'));
        return;
    }
    rejectUnknownKeys(value, path, USAGE_KEYS, errors);
    requireLiteral(value.scope, 'single-use', `${path}.scope`, 'non_single_use_browser_wallet_approval', errors);
    requireLiteral(value.approvedUseCount, 1, `${path}.approvedUseCount`, 'non_single_use_browser_wallet_approval', errors);
    requireLiteral(value.consumedUseCount, 0, `${path}.consumedUseCount`, 'non_single_use_browser_wallet_approval', errors);
    requireExactString(value.nonce, `${path}.nonce`, errors);
    requireLiteral(value.reusePolicy, 'fresh-approval-required', `${path}.reusePolicy`, 'non_single_use_browser_wallet_approval', errors);
}
function validateProvider(value, path, errors) {
    if (!isPlainObject(value)) {
        errors.push(error('missing_browser_wallet_approval_field', path, 'wallet provider metadata is required'));
        return;
    }
    rejectUnknownKeys(value, path, PROVIDER_KEYS, errors);
    if (typeof value.name !== 'string' || !SUPPORTED_DEVNET_BROWSER_WALLET_PROVIDERS.has(value.name)) {
        errors.push(error('unknown_browser_wallet_provider', `${path}.name`, 'provider is not in the current Devnet browser-wallet allowlist'));
    }
    requireExactString(value.version, `${path}.version`, errors);
    if (value.devnetSupport !== 'verified-official-docs') {
        errors.push(error('non_canonical_browser_wallet_identity', `${path}.devnetSupport`, 'provider Devnet support must be verified from official docs for this browser build'));
    }
    if (!isPlainObject(value.source)) {
        errors.push(error('missing_browser_wallet_approval_field', `${path}.source`, 'provider source is required'));
        return undefined;
    }
    rejectUnknownKeys(value.source, `${path}.source`, SOURCE_KEYS, errors);
    if (!['official-docs', 'browser-extension-store', 'operator-ui'].includes(String(value.source.kind))) {
        errors.push(error('non_canonical_browser_wallet_identity', `${path}.source.kind`, 'provider source kind is not canonical'));
    }
    requireHttpsUrl(value.source.url, `${path}.source.url`, errors);
    const retrievedAtMs = validateTimestamp(value.source.retrievedAt, `${path}.source.retrievedAt`, errors);
    validateOptionalHash(value.source.sha256, `${path}.source.sha256`, errors);
    return retrievedAtMs;
}
function validateBrowserProfile(value, providerName, path, errors) {
    if (!isPlainObject(value)) {
        errors.push(error('missing_browser_wallet_approval_field', path, 'isolated browser profile metadata is required'));
        return;
    }
    rejectUnknownKeys(value, path, BROWSER_PROFILE_KEYS, errors);
    if (typeof value.id !== 'string' || !value.id.startsWith('browser-profile:') || hasBroadString(value.id) || value.id.includes('..')) {
        errors.push(error('non_canonical_browser_wallet_identity', `${path}.id`, 'browser profile id must be a dedicated non-broad identifier'));
    }
    requireLiteral(value.isolation, 'dedicated-disposable', `${path}.isolation`, 'non_canonical_browser_wallet_identity', errors);
    requireLiteral(value.syncDisabled, true, `${path}.syncDisabled`, 'custody_browser_wallet_rejected', errors);
    requireLiteral(value.primaryProfile, false, `${path}.primaryProfile`, 'custody_browser_wallet_rejected', errors);
    requireLiteral(value.onlyApprovedExtension, providerName, `${path}.onlyApprovedExtension`, 'contradictory_browser_wallet_approval', errors);
    requireLiteral(value.automatedExtensionInstall, false, `${path}.automatedExtensionInstall`, 'production_browser_wallet_rejected', errors);
    requireLiteral(value.deleteAfterRun, true, `${path}.deleteAfterRun`, 'custody_browser_wallet_rejected', errors);
}
function validateWallet(value, path, errors) {
    if (!isPlainObject(value)) {
        errors.push(error('missing_browser_wallet_approval_field', path, 'wallet public identity metadata is required'));
        return;
    }
    rejectUnknownKeys(value, path, WALLET_KEYS, errors);
    if (!isValidSolanaPublicKey(value.publicKey) || value.publicKey === DEFAULT_PLAYWRIGHT_FIXTURE_PUBLIC_KEY) {
        errors.push(error('non_canonical_browser_wallet_identity', `${path}.publicKey`, 'wallet must provide one exact non-fixture Solana public key'));
    }
    requireLiteral(value.secretMaterial, false, `${path}.secretMaterial`, 'secret_material_rejected', errors);
    requireLiteral(value.productionSeedImported, false, `${path}.productionSeedImported`, 'secret_material_rejected', errors);
    requireLiteral(value.custody, 'human-controlled-devnet-only', `${path}.custody`, 'custody_browser_wallet_rejected', errors);
}
function validateNetwork(value, path, errors) {
    if (!isPlainObject(value)) {
        errors.push(error('missing_browser_wallet_approval_field', path, 'network identity is required'));
        return;
    }
    rejectUnknownKeys(value, path, NETWORK_KEYS, errors);
    if (value.rapAlias === 'solana-mainnet-beta' || value.caip2 === SOLANA_MAINNET_BETA_CAIP2 || value.cluster === 'mainnet-beta') {
        errors.push(error('mainnet_browser_wallet_rejected', path, 'mainnet browser-wallet approvals are not supported'));
    }
    requireLiteral(value.rapAlias, 'solana-devnet', `${path}.rapAlias`, 'non_canonical_browser_wallet_identity', errors);
    requireLiteral(value.caip2, SOLANA_DEVNET_CAIP2, `${path}.caip2`, 'non_canonical_browser_wallet_identity', errors);
    requireLiteral(value.cluster, 'devnet', `${path}.cluster`, 'non_canonical_browser_wallet_identity', errors);
    requireHttpsUrl(value.rpcHttp, `${path}.rpcHttp`, errors);
    validateOptionalWssUrl(value.rpcWs, `${path}.rpcWs`, errors);
}
function validateUiAction(value, path, errors) {
    if (!isPlainObject(value)) {
        errors.push(error('missing_browser_wallet_approval_field', path, 'exact UI action is required'));
        return;
    }
    rejectUnknownKeys(value, path, UI_ACTION_KEYS, errors);
    if (typeof value.route !== 'string' || !value.route.startsWith('/') || hasBroadString(value.route) || value.route.includes('..')) {
        errors.push(error('overly_broad_browser_wallet_approval', `${path}.route`, 'UI route must be one exact non-broad route'));
    }
    if (typeof value.action !== 'string' || !BROWSER_WALLET_ALLOWED_ACTIONS.has(value.action)) {
        errors.push(error('non_canonical_browser_wallet_identity', `${path}.action`, 'UI action is not in the browser-wallet Devnet allowlist'));
    }
    requireLiteral(value.executionMode, 'manual-human-browser-wallet', `${path}.executionMode`, 'production_browser_wallet_rejected', errors);
    requireLiteral(value.defaultOff, true, `${path}.defaultOff`, 'production_browser_wallet_rejected', errors);
    requireLiteral(value.exactOnce, true, `${path}.exactOnce`, 'non_single_use_browser_wallet_approval', errors);
    requireLiteral(value.devnetActionAvailableByDefault, false, `${path}.devnetActionAvailableByDefault`, 'production_browser_wallet_rejected', errors);
    if (value.action === 'register-agent' && value.route !== '/register') {
        errors.push(error('contradictory_browser_wallet_approval', `${path}.route`, 'register-agent action must target the /register route'));
    }
}
function validatePrograms(value, path, errors) {
    if (!isPlainObject(value)) {
        errors.push(error('missing_browser_wallet_approval_field', path, 'program identity metadata is required'));
        return;
    }
    rejectUnknownKeys(value, path, PROGRAMS_KEYS, errors);
    requireLiteral(value.target, 'legacy-anchor', `${path}.target`, 'production_browser_wallet_rejected', errors);
    requireLiteral(value.framework, 'anchor', `${path}.framework`, 'production_browser_wallet_rejected', errors);
    requireLiteral(value.source, 'resolved-network-profile', `${path}.source`, 'non_canonical_browser_wallet_identity', errors);
    requireLiteral(value.submissionReady, true, `${path}.submissionReady`, 'production_browser_wallet_rejected', errors);
    if (!isPlainObject(value.ids)) {
        errors.push(error('missing_browser_wallet_approval_field', `${path}.ids`, 'exact program ids are required'));
        return;
    }
    rejectUnknownKeys(value.ids, `${path}.ids`, PROGRAM_IDS_KEYS, errors);
    for (const key of PROGRAM_IDS_KEYS) {
        if (!isValidSolanaPublicKey(value.ids[key])) {
            errors.push(error('non_canonical_browser_wallet_identity', `${path}.ids.${key}`, 'program id must be an exact 32-byte Solana public key'));
        }
    }
}
function validateFunding(value, path, errors) {
    if (!isPlainObject(value)) {
        errors.push(error('missing_browser_wallet_approval_field', path, 'funding source and balance cap are required'));
        return;
    }
    rejectUnknownKeys(value, path, FUNDING_KEYS, errors);
    requireLiteral(value.source, 'human-capped-devnet', `${path}.source`, 'ai_faucet_rejected', errors);
    requireExactString(value.sourceRef, `${path}.sourceRef`, errors);
    requireLiteral(value.humanApproved, true, `${path}.humanApproved`, 'ai_faucet_rejected', errors);
    requireLiteral(value.aiFaucetUse, false, `${path}.aiFaucetUse`, 'ai_faucet_rejected', errors);
    requireLiteral(value.autoTopUp, false, `${path}.autoTopUp`, 'ai_faucet_rejected', errors);
    if (typeof value.maxBalanceSol !== 'number' || !Number.isFinite(value.maxBalanceSol) || value.maxBalanceSol <= 0 || value.maxBalanceSol > 2) {
        errors.push(error('overly_broad_browser_wallet_approval', `${path}.maxBalanceSol`, 'maximum Devnet SOL balance at risk must be positive and capped at or below 2 SOL'));
    }
}
function validateCaps(value, path, errors) {
    if (!isPlainObject(value)) {
        errors.push(error('missing_browser_wallet_approval_field', path, 'per-action and per-session caps are required'));
        return;
    }
    rejectUnknownKeys(value, path, CAPS_KEYS, errors);
    const perAction = parseBaseUnits(value.perActionBaseUnits, `${path}.perActionBaseUnits`, errors);
    const perSession = parseBaseUnits(value.perSessionBaseUnits, `${path}.perSessionBaseUnits`, errors);
    parseBaseUnits(value.maxFeeLamports, `${path}.maxFeeLamports`, errors);
    requireLiteral(value.maxActions, 1, `${path}.maxActions`, 'non_single_use_browser_wallet_approval', errors);
    if (perAction !== undefined && perSession !== undefined && perSession < perAction) {
        errors.push(error('contradictory_browser_wallet_approval', `${path}.perSessionBaseUnits`, 'session cap must be greater than or equal to per-action cap'));
    }
}
function validateRetryPolicy(value, path, errors) {
    if (!isPlainObject(value)) {
        errors.push(error('missing_browser_wallet_approval_field', path, 'retry policy is required'));
        return;
    }
    rejectUnknownKeys(value, path, RETRY_POLICY_KEYS, errors);
    if (typeof value.allowed !== 'boolean') {
        errors.push(error('malformed_browser_wallet_approval', `${path}.allowed`, 'retry allowed flag must be boolean'));
    }
    const maxRetries = value.maxRetries;
    if (!Number.isInteger(maxRetries) || typeof maxRetries !== 'number' || maxRetries < 0) {
        errors.push(error('malformed_browser_wallet_approval', `${path}.maxRetries`, 'retry count must be a non-negative integer'));
    }
    else if (value.allowed === false && maxRetries !== 0) {
        errors.push(error('contradictory_browser_wallet_approval', `${path}.maxRetries`, 'disabled retries must have maxRetries set to 0'));
    }
    else if (value.allowed === true && (maxRetries < 1 || maxRetries > 2)) {
        errors.push(error('overly_broad_browser_wallet_approval', `${path}.maxRetries`, 'enabled retries must be explicitly bounded to one or two attempts'));
    }
    requireLiteral(value.countsAgainstCaps, true, `${path}.countsAgainstCaps`, 'contradictory_browser_wallet_approval', errors);
}
function validateAsset(value, action, allowFuturePartnerConfirmedAuddDevnet, path, errors) {
    if (!isPlainObject(value)) {
        errors.push(error('missing_browser_wallet_approval_field', path, 'asset identity is required'));
        return;
    }
    rejectUnknownKeys(value, path, ASSET_KEYS, errors);
    if (typeof value.mint === 'string' && REJECTED_MAINNET_MINTS.has(value.mint)) {
        errors.push(error('mainnet_browser_wallet_rejected', `${path}.mint`, 'official Solana mainnet mints are never valid for a Devnet browser-wallet approval'));
    }
    if (!['SOL', 'USDC', 'AUDD', 'AUDD_TEST', 'LOCAL_AUDD_TEST'].includes(String(value.symbol))) {
        errors.push(error('non_canonical_browser_wallet_identity', `${path}.symbol`, 'asset symbol is not canonical for browser-wallet approval'));
        return;
    }
    if (value.symbol === 'SOL') {
        requireLiteral(value.railEnvironment, 'devnet-unverified', `${path}.railEnvironment`, 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(value.mint, null, `${path}.mint`, 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(value.tokenProgram, null, `${path}.tokenProgram`, 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(value.decimals, 9, `${path}.decimals`, 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(value.source, 'devnet-sol-fee', `${path}.source`, 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(value.official, false, `${path}.official`, 'official_audd_devnet_unavailable', errors);
        return;
    }
    if (value.symbol === 'USDC') {
        requireLiteral(value.railEnvironment, 'devnet-unverified', `${path}.railEnvironment`, 'non_canonical_browser_wallet_identity', errors);
        if (value.mint !== CANONICAL_DEVNET_USDC_MINT) {
            errors.push(error('non_canonical_browser_wallet_identity', `${path}.mint`, 'USDC approval must name the canonical Devnet USDC mint of the existing gated lane'));
        }
        requireLiteral(value.tokenProgram, SPL_TOKEN_PROGRAM_ID, `${path}.tokenProgram`, 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(value.decimals, 6, `${path}.decimals`, 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(value.source, 'existing-gated-devnet-usdc-lane', `${path}.source`, 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(value.official, false, `${path}.official`, 'official_audd_devnet_unavailable', errors);
        if (action !== 'x402-devnet-usdc-payment') {
            errors.push(error('contradictory_browser_wallet_approval', `${path}.symbol`, 'USDC asset requires the x402 Devnet USDC UI action'));
        }
        return;
    }
    if (value.symbol === 'AUDD_TEST' || value.symbol === 'LOCAL_AUDD_TEST') {
        errors.push(error('non_canonical_browser_wallet_identity', `${path}.symbol`, 'local AUDD test mints are Tier 1 only and cannot be approved for a Devnet browser-wallet action'));
        return;
    }
    // Official AUDD Devnet is deliberately unavailable by default. The dormant
    // future shape below must still fail unless the caller deliberately enables a
    // future partner-confirmed flow after a separate approval exists. Even then,
    // the asset row must be bound exactly to the partner-confirmed Devnet rail
    // identity so a mainnet or unrelated mint cannot be smuggled through.
    const partnerConfirmation = isPlainObject(value.auddPartnerConfirmation) ? value.auddPartnerConfirmation : undefined;
    const futureAuddShape = Boolean(partnerConfirmation)
        && typeof value.auddDevnetApprovalRef === 'string'
        && value.railEnvironment === 'devnet-unverified'
        && value.source === 'partner-confirmed-audd-devnet'
        && value.official === false;
    if (!futureAuddShape || !allowFuturePartnerConfirmedAuddDevnet) {
        errors.push(error('official_audd_devnet_unavailable', path, 'official AUDD Devnet browser-wallet action is unavailable without future partner confirmation and separate approval'));
    }
    if (partnerConfirmation) {
        rejectUnknownKeys(partnerConfirmation, `${path}.auddPartnerConfirmation`, AUDD_PARTNER_CONFIRMATION_KEYS, errors);
        requireHttpsUrl(partnerConfirmation.sourceUrl, `${path}.auddPartnerConfirmation.sourceUrl`, errors);
        validateTimestamp(partnerConfirmation.sourceRetrievedAt, `${path}.auddPartnerConfirmation.sourceRetrievedAt`, errors);
        validateOptionalHash(partnerConfirmation.sourceSha256, `${path}.auddPartnerConfirmation.sourceSha256`, errors);
        if (!isValidSolanaPublicKey(partnerConfirmation.confirmedMint)) {
            errors.push(error('non_canonical_browser_wallet_identity', `${path}.auddPartnerConfirmation.confirmedMint`, 'future AUDD Devnet partner confirmation must name an exact mint'));
        }
        else if (REJECTED_MAINNET_MINTS.has(partnerConfirmation.confirmedMint)) {
            errors.push(error('mainnet_browser_wallet_rejected', `${path}.auddPartnerConfirmation.confirmedMint`, 'an official Solana mainnet mint is never a partner-confirmed Devnet mint'));
        }
        requireLiteral(partnerConfirmation.confirmedDecimals, AUDD_DECIMALS, `${path}.auddPartnerConfirmation.confirmedDecimals`, 'non_canonical_browser_wallet_identity', errors);
        requireLiteral(partnerConfirmation.confirmedTokenProgram, SPL_TOKEN_PROGRAM_ID, `${path}.auddPartnerConfirmation.confirmedTokenProgram`, 'non_canonical_browser_wallet_identity', errors);
    }
    requireExactString(value.auddDevnetApprovalRef, `${path}.auddDevnetApprovalRef`, errors);
    if (!isValidSolanaPublicKey(value.mint)) {
        errors.push(error('non_canonical_browser_wallet_identity', `${path}.mint`, 'future AUDD Devnet asset must name the exact partner-confirmed Devnet mint'));
    }
    else if (partnerConfirmation && isValidSolanaPublicKey(partnerConfirmation.confirmedMint) && value.mint !== partnerConfirmation.confirmedMint) {
        errors.push(error('contradictory_browser_wallet_approval', `${path}.mint`, 'future AUDD Devnet asset mint must exactly match the partner-confirmed mint'));
    }
    requireLiteral(value.railEnvironment, 'devnet-unverified', `${path}.railEnvironment`, 'non_canonical_browser_wallet_identity', errors);
    requireLiteral(value.source, 'partner-confirmed-audd-devnet', `${path}.source`, 'non_canonical_browser_wallet_identity', errors);
    requireLiteral(value.official, false, `${path}.official`, 'official_audd_devnet_unavailable', errors);
    if (partnerConfirmation && partnerConfirmation.confirmedTokenProgram === SPL_TOKEN_PROGRAM_ID) {
        requireLiteral(value.tokenProgram, partnerConfirmation.confirmedTokenProgram, `${path}.tokenProgram`, 'non_canonical_browser_wallet_identity', errors);
    }
    else {
        requireLiteral(value.tokenProgram, SPL_TOKEN_PROGRAM_ID, `${path}.tokenProgram`, 'non_canonical_browser_wallet_identity', errors);
    }
    if (partnerConfirmation && partnerConfirmation.confirmedDecimals === AUDD_DECIMALS) {
        requireLiteral(value.decimals, partnerConfirmation.confirmedDecimals, `${path}.decimals`, 'non_canonical_browser_wallet_identity', errors);
    }
    else {
        requireLiteral(value.decimals, AUDD_DECIMALS, `${path}.decimals`, 'non_canonical_browser_wallet_identity', errors);
    }
}
function validateEvidence(value, path, errors) {
    if (!isPlainObject(value)) {
        errors.push(error('missing_browser_wallet_approval_field', path, 'evidence destination and redaction policy are required'));
        return;
    }
    rejectUnknownKeys(value, path, EVIDENCE_KEYS, errors);
    if (typeof value.destination !== 'string' || hasBroadString(value.destination) || value.destination.includes('..') || value.destination.startsWith('/')) {
        errors.push(error('overly_broad_browser_wallet_approval', `${path}.destination`, 'evidence destination must be one exact repo-relative path'));
    }
    else if (!value.destination.startsWith('artifacts/browser-wallet-devnet/') && !value.destination.startsWith('.tmp/browser-wallet-devnet/')) {
        errors.push(error('non_canonical_browser_wallet_identity', `${path}.destination`, 'browser wallet evidence must use the browser-wallet-devnet evidence namespace'));
    }
    if (!isPlainObject(value.redaction)) {
        errors.push(error('missing_browser_wallet_approval_field', `${path}.redaction`, 'evidence redaction policy is required'));
        return;
    }
    rejectUnknownKeys(value.redaction, `${path}.redaction`, REDACTION_KEYS, errors);
    requireLiteral(value.redaction.privateKeys, 'forbidden', `${path}.redaction.privateKeys`, 'secret_material_rejected', errors);
    requireLiteral(value.redaction.seedPhrases, 'forbidden', `${path}.redaction.seedPhrases`, 'secret_material_rejected', errors);
    requireLiteral(value.redaction.signerArrays, 'forbidden', `${path}.redaction.signerArrays`, 'secret_material_rejected', errors);
    requireLiteral(value.redaction.authHeaders, 'redact', `${path}.redaction.authHeaders`, 'secret_material_rejected', errors);
    requireLiteral(value.redaction.cookies, 'redact', `${path}.redaction.cookies`, 'secret_material_rejected', errors);
    requireLiteral(value.redaction.rawPaymentPayloads, 'redact', `${path}.redaction.rawPaymentPayloads`, 'secret_material_rejected', errors);
    requireLiteral(value.redaction.screenshots, 'redacted-only', `${path}.redaction.screenshots`, 'secret_material_rejected', errors);
    requireLiteral(value.redaction.includePublicKey, true, `${path}.redaction.includePublicKey`, 'non_canonical_browser_wallet_identity', errors);
    requireLiteral(value.redaction.includeSignatures, 'devnet-only', `${path}.redaction.includeSignatures`, 'non_canonical_browser_wallet_identity', errors);
}
function validateRollback(value, path, errors) {
    if (!isPlainObject(value)) {
        errors.push(error('missing_browser_wallet_approval_field', path, 'rollback owner and actions are required'));
        return;
    }
    rejectUnknownKeys(value, path, ROLLBACK_KEYS, errors);
    requireExactString(value.owner, `${path}.owner`, errors);
    requireLiteral(value.disconnectRevoke, true, `${path}.disconnectRevoke`, 'custody_browser_wallet_rejected', errors);
    requireLiteral(value.deleteBrowserProfile, true, `${path}.deleteBrowserProfile`, 'custody_browser_wallet_rejected', errors);
    requireLiteral(value.deleteLocalState, true, `${path}.deleteLocalState`, 'custody_browser_wallet_rejected', errors);
    requireLiteral(value.preserveRedactedEvidence, true, `${path}.preserveRedactedEvidence`, 'secret_material_rejected', errors);
    requireLiteral(value.incidentSuspend, true, `${path}.incidentSuspend`, 'production_browser_wallet_rejected', errors);
    requireLiteral(value.freshApprovalRequired, true, `${path}.freshApprovalRequired`, 'non_single_use_browser_wallet_approval', errors);
}
function validateBoundaries(value, path, errors) {
    if (!isPlainObject(value)) {
        errors.push(error('missing_browser_wallet_approval_field', path, 'explicit claim boundaries are required'));
        return;
    }
    rejectUnknownKeys(value, path, BOUNDARY_KEYS, errors);
    requireLiteral(value.noMainnet, true, `${path}.noMainnet`, 'mainnet_browser_wallet_rejected', errors);
    requireLiteral(value.noProduction, true, `${path}.noProduction`, 'production_browser_wallet_rejected', errors);
    requireLiteral(value.noCustody, true, `${path}.noCustody`, 'custody_browser_wallet_rejected', errors);
    requireLiteral(value.noSettlementFinality, true, `${path}.noSettlementFinality`, 'settlement_finality_rejected', errors);
    requireLiteral(value.noOfficialAuddDevnet, true, `${path}.noOfficialAuddDevnet`, 'official_audd_devnet_unavailable', errors);
    requireLiteral(value.noLiveFunds, true, `${path}.noLiveFunds`, 'production_browser_wallet_rejected', errors);
    requireLiteral(value.noAiFaucet, true, `${path}.noAiFaucet`, 'ai_faucet_rejected', errors);
    requireLiteral(value.noPayShProduction, true, `${path}.noPayShProduction`, 'production_browser_wallet_rejected', errors);
    requireLiteral(value.noAutomaticTopUp, true, `${path}.noAutomaticTopUp`, 'ai_faucet_rejected', errors);
}
function validateCopyGuardNestedShapes(row, errors) {
    const x402 = row.x402Export;
    if (x402) {
        if (x402.state !== 'expected' && x402.state !== 'observed')
            errors.push(error('malformed_browser_wallet_approval', '$.x402Export.state', 'x402 export state is invalid'));
        requireExactString(x402.asset, '$.x402Export.asset', errors);
        requireExactString(x402.networkAlias, '$.x402Export.networkAlias', errors);
        validateOptionalExactString(x402.caip2, '$.x402Export.caip2', errors);
        validateOptionalExactString(x402.mint, '$.x402Export.mint', errors);
        if (x402.tokenProgram !== undefined && x402.tokenProgram !== null)
            requireLiteral(x402.tokenProgram, SPL_TOKEN_PROGRAM_ID, '$.x402Export.tokenProgram', 'non_canonical_browser_wallet_identity', errors);
        if (x402.decimals !== undefined && x402.decimals !== null && x402.decimals !== AUDD_DECIMALS)
            errors.push(error('non_canonical_browser_wallet_identity', '$.x402Export.decimals', 'x402 export decimals must match the row AUDD-family identity'));
    }
    const policy = row.policy;
    if (policy) {
        if (!isPaymentEligibility(policy.grantEligibility))
            errors.push(error('non_canonical_browser_wallet_identity', '$.policy.grantEligibility', 'policy grant eligibility is invalid'));
        validateOptionalExactString(policy.operatorApprovalRef, '$.policy.operatorApprovalRef', errors);
        if (typeof policy.controlledLive !== 'boolean')
            errors.push(error('malformed_browser_wallet_approval', '$.policy.controlledLive', 'policy controlledLive flag must be boolean'));
    }
    const receipt = row.receipt;
    if (receipt) {
        if (!['expected-only', 'fixture-only', 'observed-transfer-checked', 'observed-settlement'].includes(String(receipt.claim)))
            errors.push(error('malformed_browser_wallet_approval', '$.receipt.claim', 'receipt claim is invalid'));
        if (!['not-observed', 'fixture-observed', 'local-observed', 'rpc-observed'].includes(String(receipt.observationStatus)))
            errors.push(error('malformed_browser_wallet_approval', '$.receipt.observationStatus', 'receipt observation status is invalid'));
        if (typeof receipt.settlementFinality !== 'boolean')
            errors.push(error('malformed_browser_wallet_approval', '$.receipt.settlementFinality', 'receipt settlementFinality flag must be boolean'));
        if (typeof receipt.controlledLiveEvidence !== 'boolean')
            errors.push(error('malformed_browser_wallet_approval', '$.receipt.controlledLiveEvidence', 'receipt controlledLiveEvidence flag must be boolean'));
    }
    const copy = row.copy;
    if (copy) {
        if (copy.title !== undefined && typeof copy.title !== 'string')
            errors.push(error('malformed_browser_wallet_approval', '$.copy.title', 'copy title must be a string'));
        if (copy.summary !== undefined && typeof copy.summary !== 'string')
            errors.push(error('malformed_browser_wallet_approval', '$.copy.summary', 'copy summary must be a string'));
        validateStringArray(copy.badges, '$.copy.badges', errors);
        validateStringArray(copy.notes, '$.copy.notes', errors);
    }
}
function validateCanonicalX402Export(row, errors) {
    const x402 = row.x402Export;
    if (!x402)
        return;
    if (x402.asset !== row.assetLabel || x402.networkAlias !== row.networkAlias || x402.caip2 !== row.caip2 || x402.mint !== row.mint || x402.tokenProgram !== row.tokenProgram || x402.decimals !== row.decimals) {
        errors.push(error('non_canonical_browser_wallet_identity', '$.x402Export', 'x402 export identity must exactly match the row identity'));
    }
    if (x402.state === 'observed' && row.observationSource === 'expected-only') {
        errors.push(error('settlement_finality_rejected', '$.x402Export.state', 'expected-only terms cannot be exported as observed evidence'));
    }
}
function validateReceiptBoundary(row, errors) {
    const receipt = row.receipt;
    if (!receipt)
        return;
    const sourceRank = OBSERVATION_SOURCE_RANK[String(row.observationSource)] ?? -1;
    if ((RECEIPT_CLAIM_RANK[String(receipt.claim)] ?? Number.MAX_SAFE_INTEGER) > sourceRank) {
        errors.push(error('settlement_finality_rejected', '$.receipt.claim', 'receipt claim must not exceed the evidence the row observation source provides'));
    }
    if ((RECEIPT_OBSERVATION_STATUS_RANK[String(receipt.observationStatus)] ?? Number.MAX_SAFE_INTEGER) > sourceRank) {
        errors.push(error('settlement_finality_rejected', '$.receipt.observationStatus', 'receipt observation status must not exceed the row observation source'));
    }
    if (receipt.settlementFinality) {
        errors.push(error('settlement_finality_rejected', '$.receipt.settlementFinality', 'settlement finality is not available in browser-wallet safety rows'));
    }
    if (receipt.controlledLiveEvidence) {
        errors.push(error('non_canonical_browser_wallet_identity', '$.receipt.controlledLiveEvidence', 'browser-wallet safety rows must not carry controlled-live evidence'));
    }
}
function validateCopyNested(value, path, allowed, errors) {
    if (value === undefined)
        return;
    if (!isPlainObject(value)) {
        errors.push(error('malformed_browser_wallet_approval', path, 'nested copy guard object is malformed'));
        return;
    }
    rejectUnknownKeys(value, path, allowed, errors);
}
function forbiddenCopyMatches(text) {
    const matches = [];
    const clauses = splitCopyClaimClauses(text);
    if (clauses.some((clause) => hasAffirmativeClaim(clause, /official\s+AUDD|AUDD\s+official|official\s+Devnet\s+AUDD|AUDD\s+Devnet\s+official/i, /(?:not|never|no)\s+(?:an?\s+)?official\s+AUDD/i))) {
        matches.push({ code: 'official_audd_devnet_unavailable', message: 'copy must not describe browser-wallet safety rows as official AUDD' });
    }
    if (clauses.some((clause) => hasAffirmativeClaim(clause, /grant[-\s]?eligible|eligible\s+for\s+grant|grant\s+volume/i, /(?:not|never|no|non[_-])\s*grant[-\s]?eligible/i))) {
        matches.push({ code: 'non_canonical_browser_wallet_identity', message: 'copy must not describe browser-wallet safety rows as grant-eligible' });
    }
    if (clauses.some((clause) => /observed\s+settlement|settlement\s+observed|settlement\s+finality|final\s+settlement|settled\s+on/i.test(clause))) {
        matches.push({ code: 'settlement_finality_rejected', message: 'copy must not upgrade expected or safety evidence into observed settlement/finality' });
    }
    if (clauses.some((clause) => /controlled[-\s]?live|controlled\s+live\s+evidence/i.test(clause))) {
        matches.push({ code: 'non_canonical_browser_wallet_identity', message: 'copy must not describe browser-wallet safety rows as controlled-live evidence' });
    }
    return matches;
}
function splitCopyClaimClauses(text) {
    return text
        .split(/[\n.;,]+|\s+[–—-]\s+/u)
        .map((clause) => clause.trim())
        .filter((clause) => clause.length > 0);
}
function hasAffirmativeClaim(text, claimPattern, negatedPattern) {
    return claimPattern.test(text) && !negatedPattern.test(text);
}
function rejectUnknownKeys(value, path, allowed, errors) {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            errors.push(error('unknown_browser_wallet_approval_field', `${path}.${key}`, 'field is not part of the canonical browser-wallet safety schema'));
        }
    }
}
function requireLiteral(value, expected, path, code, errors) {
    if (value !== expected)
        errors.push(error(code, path, 'field does not match the required literal value'));
}
function requireExactString(value, path, errors) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        errors.push(error('missing_browser_wallet_approval_field', path, 'required exact string is missing'));
        return;
    }
    if (!ID_PATTERN.test(value) || hasBroadString(value)) {
        errors.push(error('overly_broad_browser_wallet_approval', path, 'string must be exact and non-broad'));
    }
}
function validateOptionalExactString(value, path, errors) {
    if (value === undefined || value === null)
        return;
    requireExactString(value, path, errors);
}
function validateStringArray(value, path, errors) {
    if (value === undefined)
        return;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        errors.push(error('malformed_browser_wallet_approval', path, 'field must be an array of strings when present'));
    }
}
function requireHttpsUrl(value, path, errors) {
    if (typeof value !== 'string' || hasBroadString(value) || /\s/.test(value)) {
        errors.push(error('overly_broad_browser_wallet_approval', path, 'URL must be exact and non-broad'));
        return;
    }
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
            errors.push(error('non_canonical_browser_wallet_identity', path, 'URL must be HTTPS without credentials or fragment'));
        }
        if (/mainnet|production|prod/i.test(url.hostname)) {
            errors.push(error('mainnet_browser_wallet_rejected', path, 'mainnet/production endpoints are rejected'));
        }
    }
    catch {
        errors.push(error('malformed_browser_wallet_approval', path, 'URL is malformed'));
    }
}
function validateOptionalWssUrl(value, path, errors) {
    if (value === undefined || value === null)
        return;
    if (typeof value !== 'string' || hasBroadString(value) || /\s/.test(value)) {
        errors.push(error('overly_broad_browser_wallet_approval', path, 'WebSocket URL must be exact and non-broad'));
        return;
    }
    try {
        const url = new URL(value);
        if (url.protocol !== 'wss:' || url.username || url.password || url.hash) {
            errors.push(error('non_canonical_browser_wallet_identity', path, 'WebSocket URL must be WSS without credentials or fragment'));
        }
        if (/mainnet|production|prod/i.test(url.hostname)) {
            errors.push(error('mainnet_browser_wallet_rejected', path, 'mainnet/production endpoints are rejected'));
        }
    }
    catch {
        errors.push(error('malformed_browser_wallet_approval', path, 'WebSocket URL is malformed'));
    }
}
function validateTimestamp(value, path, errors) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        errors.push(error('missing_browser_wallet_approval_field', path, 'timestamp is required'));
        return undefined;
    }
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
        errors.push(error('malformed_browser_wallet_approval', path, 'timestamp must be canonical UTC ISO-8601'));
        return undefined;
    }
    return parsed;
}
function validateOptionalHash(value, path, errors) {
    if (value === undefined)
        return;
    if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
        errors.push(error('malformed_browser_wallet_approval', path, 'hash must be sha256:<64 hex> when present'));
    }
}
function parseBaseUnits(value, path, errors) {
    if (typeof value !== 'string' || !NON_NEGATIVE_INTEGER_STRING.test(value)) {
        errors.push(error('malformed_browser_wallet_approval', path, 'cap must be a non-negative integer string in base units'));
        return undefined;
    }
    return BigInt(value);
}
function normalizeNow(now) {
    if (now instanceof Date && Number.isFinite(now.getTime()))
        return now.getTime();
    if (typeof now === 'string' && Number.isFinite(Date.parse(now)))
        return Date.parse(now);
    return Date.now();
}
function hasBroadString(value) {
    return BROAD_STRING_PATTERN.test(value.trim());
}
function collectCopyText(copy) {
    if (!copy)
        return [];
    return [copy.title, copy.summary, ...(copy.badges ?? []), ...(copy.notes ?? [])]
        .filter((value) => typeof value === 'string' && value.length > 0);
}
function isPaymentEnvironment(value) {
    return ['deterministic-fixture', 'local-test-mint', 'devnet-unverified', 'mainnet-gated', 'controlled-live'].includes(String(value));
}
function isPaymentEligibility(value) {
    return ['non_eligible', 'pending_partner_acceptance', 'eligible', 'excluded'].includes(String(value));
}
function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function isValidSolanaPublicKey(value) {
    if (typeof value !== 'string' || value.length < 32 || value.length > 44)
        return false;
    let leadingZeroBytes = 0;
    while (leadingZeroBytes < value.length && value[leadingZeroBytes] === '1')
        leadingZeroBytes += 1;
    let decoded = 0n;
    for (const char of value) {
        const digit = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'.indexOf(char);
        if (digit < 0)
            return false;
        decoded = decoded * 58n + BigInt(digit);
    }
    let significantBytes = 0;
    for (let remaining = decoded; remaining > 0n; remaining >>= 8n)
        significantBytes += 1;
    return leadingZeroBytes + significantBytes === 32;
}
function uniqueErrors(errors) {
    const seen = new Set();
    return errors.filter((item) => {
        const key = `${item.code}\u0000${item.path}\u0000${item.message}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function error(code, path, message) {
    return { code, path, message };
}
