export const QUASAR_REGISTRY_COMPATIBILITY_SCHEMA_VERSION = 'reddi.quasar-registry-compatibility.v1' as const;
const U64_MAX = 18_446_744_073_709_551_615n;
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
} as const;

export type QuasarRegistryAgentType = 'Primary' | 'Attestation' | 'Both';
export type QuasarRegistryRegistrationIntent = 'metadata_only' | 'register' | 'update';
export type QuasarRegistryRegistrationStatus = 'metadata_only' | 'registerable' | 'blocked';

export type QuasarRegistryCompatibilityInput = {
  profileId?: string;
  listingId: string;
  displayName: string;
  summary?: string;
  description?: string;
  owner?: string;
  role?: {
    callable?: boolean;
    attestation?: boolean;
  };
  model?: string;
  nativeSolRateLamports?: string | bigint | number;
  minReputation?: number;
  registrationIntent?: QuasarRegistryRegistrationIntent;
  active?: boolean;
  decodedAggregates?: {
    reputationScore?: number;
    jobsCompleted?: string | bigint | number;
    jobsFailed?: string | bigint | number;
    createdAt?: string | bigint | number;
    attestationAccuracy?: number;
  };
  offchain: {
    buyerPreview?: string;
    endpoint?: {
      url?: string;
      bindingRef?: string;
      healthStatus?: 'not_probed' | 'healthy' | 'unhealthy' | 'unknown';
    };
    ardUrl?: string;
    catalogRefs?: string[];
    sourceRefs?: string[];
    authRequirements?: string[];
    auddTerms?: {
      asset: string;
      network: string;
      amount?: string;
      paymentPlanRef?: string;
      quoteRef?: string;
      settlementAccount?: string;
      refundPolicy?: string;
      failurePolicy?: string;
    };
    evidenceRefs?: string[];
    receiptRefs?: string[];
    trustBadges?: string[];
    providerTrustStatus?: 'unverified' | 'self_attested' | 'external_attested' | 'reddi_attested' | 'verified';
    capabilities?: string[];
    tags?: string[];
    groups?: string[];
    riskDiagnostics?: string[];
    reviewStates?: string[];
    operatorApprovalEvidenceRef?: string;
  };
};

export type QuasarRegistryCompatibilityReport = {
  schemaVersion: typeof QUASAR_REGISTRY_COMPATIBILITY_SCHEMA_VERSION;
  profileId?: string;
  listingId: string;
  registrationStatus: QuasarRegistryRegistrationStatus;
  account: typeof QUASAR_AGENT_ACCOUNT_COMPATIBILITY;
  onchain: {
    owner?: string;
    agentType: QuasarRegistryAgentType;
    model: string;
    rateLamports?: string;
    minReputation: number;
    active: boolean;
    aggregates: {
      source: 'decoded_quasar_account' | 'not_available';
      reputationScore?: number;
      jobsCompleted?: string;
      jobsFailed?: string;
      createdAt?: string;
      attestationAccuracy?: number;
    };
  };
  offchain: QuasarRegistryCompatibilityInput['offchain'] & {
    profileId?: string;
    listingId: string;
    displayName: string;
    summary?: string;
    description?: string;
  };
  blockedReasons: string[];
  reasonCodes: string[];
  guardrails: {
    richMetadataOnchain: false;
    auddCustodyOnchain: false;
    endpointOnchain: false;
    evidencePayloadOnchain: false;
    trustBadgeOnchain: false;
    instructionBuilt: false;
    walletSigning: false;
    rpcCall: false;
    programDeploy: false;
    livePaymentExecuted: false;
  };
};

export function deriveQuasarRegistryCompatibility(
  input: QuasarRegistryCompatibilityInput,
): QuasarRegistryCompatibilityReport {
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
  const registrationStatus: QuasarRegistryRegistrationStatus = blockedReasons.length > 0
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

function deriveAgentType(role: QuasarRegistryCompatibilityInput['role']): QuasarRegistryAgentType {
  if (role?.callable && role.attestation) return 'Both';
  if (role?.attestation) return 'Attestation';
  return 'Primary';
}

function fallbackModel(input: QuasarRegistryCompatibilityInput): string {
  const source = input.displayName || input.listingId || 'static-fixture';
  const compact = source.toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').replace(/^-+|-+$/g, '');
  return compact.slice(0, QUASAR_AGENT_ACCOUNT_COMPATIBILITY.modelMaxBytes) || 'static-fixture';
}

function normalizeAggregates(input: QuasarRegistryCompatibilityInput['decodedAggregates']): QuasarRegistryCompatibilityReport['onchain']['aggregates'] {
  if (!input) return { source: 'not_available' };
  return {
    source: 'decoded_quasar_account',
    reputationScore: input.reputationScore,
    jobsCompleted: input.jobsCompleted === undefined ? undefined : toUnsignedIntegerString(input.jobsCompleted),
    jobsFailed: input.jobsFailed === undefined ? undefined : toUnsignedIntegerString(input.jobsFailed),
    createdAt: input.createdAt === undefined ? undefined : toSignedIntegerString(input.createdAt),
    attestationAccuracy: input.attestationAccuracy,
  };
}

function blockedReasonsFor(
  input: QuasarRegistryCompatibilityInput,
  onchain: QuasarRegistryCompatibilityReport['onchain'],
  registrationIntent: QuasarRegistryRegistrationIntent,
): string[] {
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

function reasonCodesFor(
  input: QuasarRegistryCompatibilityInput,
  registrationStatus: QuasarRegistryRegistrationStatus,
): string[] {
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

function toUnsignedIntegerString(value: string | bigint | number): string {
  if (typeof value === 'bigint') return value >= 0n ? value.toString() : '-1';
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : '-1';
  return /^[0-9]+$/.test(value) ? value : '-1';
}

function toSignedIntegerString(value: string | bigint | number): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : '0';
  return /^-?[0-9]+$/.test(value) ? value : '0';
}

function isU64String(value: string | undefined): value is string {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) return false;
  return BigInt(value) <= U64_MAX;
}

function isUint8(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

function isBasisPointLike(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 10000;
}

function isSolanaPublicKey(value: string | undefined): value is string {
  return typeof value === 'string' && decodeBase58(value)?.length === 32;
}

function decodeBase58(value: string): Uint8Array | undefined {
  if (value.length === 0) return undefined;
  const bytes = [0];
  for (const char of value) {
    const alphabetIndex = BASE58_ALPHABET.indexOf(char);
    if (alphabetIndex === -1) return undefined;
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
    if (char !== '1') break;
    bytes.push(0);
  }

  return Uint8Array.from(bytes.reverse());
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
