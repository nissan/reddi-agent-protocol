export const QUASAR_REGISTRY_COMPATIBILITY_SCHEMA_VERSION = 'reddi.quasar-registry-compatibility.v1';
const U64_MAX = 18446744073709551615n;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const QUASAR_AGENT_ACCOUNT_COMPATIBILITY = {
    discriminator: [20],
    dataSize: 153,
    pdaSeed: 'agent',
    modelMaxBytes: 64,
    onchainFieldNames: [
        'owner',
        'agentType',
        'model',
        'rateLamports',
        'minReputation',
        'active',
        'reputationScore',
        'jobsCompleted',
        'jobsFailed',
        'createdAt',
        'attestationAccuracy',
    ],
    offchainFieldNames: [
        'profileId',
        'listingId',
        'displayName',
        'summary',
        'description',
        'buyerPreview',
        'endpoint',
        'ardUrl',
        'catalogRefs',
        'sourceRefs',
        'authRequirements',
        'auddTerms',
        'evidenceRefs',
        'receiptRefs',
        'trustBadges',
        'providerTrustStatus',
        'capabilities',
        'tags',
        'groups',
        'riskDiagnostics',
        'reviewStates',
        'operatorApprovalEvidenceRef',
    ],
};
export function deriveQuasarRegistryCompatibility(input) {
    const registrationIntent = input.registrationIntent ?? 'metadata_only';
    const model = input.model ?? fallbackModel(input);
    const onchain = {
        owner: input.owner,
        agentType: deriveAgentType(input.role),
        model,
        rateLamports: input.nativeSolRateLamports === undefined ? undefined : toUnsignedIntegerString(input.nativeSolRateLamports),
        minReputation: input.minReputation ?? 0,
        active: registrationIntent === 'metadata_only' ? false : input.active === true,
        aggregates: normalizeAggregates(input.decodedAggregates),
    };
    const blockedReasons = blockedReasonsFor(input, onchain, registrationIntent);
    const registrationStatus = blockedReasons.length > 0
        ? 'blocked'
        : registrationIntent === 'metadata_only'
            ? 'metadata_only'
            : 'registerable';
    return {
        schemaVersion: QUASAR_REGISTRY_COMPATIBILITY_SCHEMA_VERSION,
        profileId: input.profileId,
        listingId: input.listingId,
        registrationStatus,
        account: QUASAR_AGENT_ACCOUNT_COMPATIBILITY,
        onchain,
        offchain: {
            ...input.offchain,
            profileId: input.profileId,
            listingId: input.listingId,
            displayName: input.displayName,
            summary: input.summary,
            description: input.description,
            catalogRefs: input.offchain.catalogRefs ?? [],
            sourceRefs: input.offchain.sourceRefs ?? [],
            authRequirements: input.offchain.authRequirements ?? [],
            evidenceRefs: input.offchain.evidenceRefs ?? [],
            receiptRefs: input.offchain.receiptRefs ?? [],
            trustBadges: input.offchain.trustBadges ?? [],
            capabilities: input.offchain.capabilities ?? [],
            tags: input.offchain.tags ?? [],
            groups: input.offchain.groups ?? [],
            riskDiagnostics: input.offchain.riskDiagnostics ?? [],
            reviewStates: input.offchain.reviewStates ?? [],
        },
        blockedReasons,
        reasonCodes: reasonCodesFor(input, registrationStatus),
        guardrails: {
            richMetadataOnchain: false,
            auddCustodyOnchain: false,
            endpointOnchain: false,
            evidencePayloadOnchain: false,
            trustBadgeOnchain: false,
            instructionBuilt: false,
            walletSigning: false,
            rpcCall: false,
            programDeploy: false,
            livePaymentExecuted: false,
        },
    };
}
function deriveAgentType(role) {
    if (role?.callable && role.attestation)
        return 'Both';
    if (role?.attestation)
        return 'Attestation';
    return 'Primary';
}
function fallbackModel(input) {
    const source = input.displayName || input.listingId || 'static-fixture';
    const compact = source.toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').replace(/^-+|-+$/g, '');
    return compact.slice(0, QUASAR_AGENT_ACCOUNT_COMPATIBILITY.modelMaxBytes) || 'static-fixture';
}
function normalizeAggregates(input) {
    if (!input)
        return { source: 'not_available' };
    return {
        source: 'decoded_quasar_account',
        reputationScore: input.reputationScore,
        jobsCompleted: input.jobsCompleted === undefined ? undefined : toUnsignedIntegerString(input.jobsCompleted),
        jobsFailed: input.jobsFailed === undefined ? undefined : toUnsignedIntegerString(input.jobsFailed),
        createdAt: input.createdAt === undefined ? undefined : toSignedIntegerString(input.createdAt),
        attestationAccuracy: input.attestationAccuracy,
    };
}
function blockedReasonsFor(input, onchain, registrationIntent) {
    const reasons = [
        isNonEmptyString(input.listingId) ? undefined : 'missing_listing_id',
        utf8ByteLength(onchain.model) <= QUASAR_AGENT_ACCOUNT_COMPATIBILITY.modelMaxBytes ? undefined : 'model_too_long_for_quasar_account',
        isUint8(onchain.minReputation) ? undefined : 'invalid_min_reputation',
        onchain.aggregates.reputationScore === undefined || isBasisPointLike(onchain.aggregates.reputationScore) ? undefined : 'invalid_reputation_score',
        onchain.aggregates.attestationAccuracy === undefined || isBasisPointLike(onchain.aggregates.attestationAccuracy) ? undefined : 'invalid_attestation_accuracy',
        registrationIntent === 'metadata_only' || isSolanaPublicKey(input.owner) ? undefined : 'missing_or_invalid_owner',
        registrationIntent === 'metadata_only' || isU64String(onchain.rateLamports) ? undefined : 'missing_native_sol_rate_lamports',
        isNonEmptyString(input.displayName) ? undefined : 'missing_display_name',
    ];
    return reasons.filter(isNonEmptyString);
}
function reasonCodesFor(input, registrationStatus) {
    const reasonCodes = [
        registrationStatus,
        'rich_metadata_offchain',
        'audd_terms_offchain',
        'no_instruction_built',
        input.nativeSolRateLamports === undefined ? 'native_lamports_rate_missing' : undefined,
        input.owner === undefined ? 'owner_missing' : undefined,
    ];
    return reasonCodes.filter(isNonEmptyString);
}
function toUnsignedIntegerString(value) {
    if (typeof value === 'bigint')
        return value >= 0n ? value.toString() : '-1';
    if (typeof value === 'number')
        return Number.isSafeInteger(value) && value >= 0 ? String(value) : '-1';
    return /^[0-9]+$/.test(value) ? value : '-1';
}
function toSignedIntegerString(value) {
    if (typeof value === 'bigint')
        return value.toString();
    if (typeof value === 'number')
        return Number.isSafeInteger(value) ? String(value) : '0';
    return /^-?[0-9]+$/.test(value) ? value : '0';
}
function isU64String(value) {
    if (typeof value !== 'string' || !/^[0-9]+$/.test(value))
        return false;
    return BigInt(value) <= U64_MAX;
}
function isUint8(value) {
    return Number.isInteger(value) && value >= 0 && value <= 255;
}
function isBasisPointLike(value) {
    return Number.isInteger(value) && value >= 0 && value <= 10000;
}
function isSolanaPublicKey(value) {
    return typeof value === 'string' && decodeBase58(value)?.length === 32;
}
function decodeBase58(value) {
    if (value.length === 0)
        return undefined;
    const bytes = [0];
    for (const char of value) {
        const alphabetIndex = BASE58_ALPHABET.indexOf(char);
        if (alphabetIndex === -1)
            return undefined;
        let carry = alphabetIndex;
        for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
            carry += bytes[byteIndex] * 58;
            bytes[byteIndex] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }
    for (const char of value) {
        if (char !== '1')
            break;
        bytes.push(0);
    }
    return Uint8Array.from(bytes.reverse());
}
function utf8ByteLength(value) {
    return new TextEncoder().encode(value).length;
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
