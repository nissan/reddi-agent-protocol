import type { ReddiPaymentEligibilityLabel, ReddiPaymentEnvironmentLabel } from './payment-records.js';

export const AUDD_RAIL_CONFIG_SCHEMA_VERSION = 'reddi.audd-rail-config.v1' as const;
export const AUDD_ASSET = 'AUDD' as const;
export const AUDD_DECIMALS = 6 as const;
export const AUDD_DETERMINISTIC_FIXTURE_MINT = 'AUDDdev111111111111111111111111111111111111' as const;
export const AUDD_OFFICIAL_SOLANA_MAINNET_MINT = 'AUDDttiEpCydTm7joUMbYddm72jAWXZnCpPZtDoxqBSw' as const;
export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as const;

export const SOLANA_MAINNET_BETA_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
export const SOLANA_DEVNET_CAIP2 = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as const;
export const SOLANA_TESTNET_CAIP2 = 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z' as const;

export type AuddRailEnvironment =
  | 'deterministic-fixture'
  | 'local-test-mint'
  | 'devnet-unverified'
  | 'mainnet-gated';

export type AuddRailStatus =
  | 'deterministic-fixture-only'
  | 'generated-local-test-mint'
  | 'unverified-blocked-devnet'
  | 'gated-mainnet-disabled-by-default';

export type AuddRailIdentityValidationReasonCode =
  | 'audd_rail_identity_allowed'
  | 'malformed_audd_rail_identity'
  | 'unknown_audd_rail_environment'
  | 'wrong_network'
  | 'wrong_caip2_network'
  | 'wrong_mint'
  | 'wrong_token_program'
  | 'wrong_decimals'
  | 'local_test_mint_required'
  | 'devnet_unverified_blocked'
  | 'mainnet_audd_disabled_by_default';

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

export type AuddRailIdentityValidationResult =
  | { ok: true; identity: AuddRailIdentity; reasonCodes: ['audd_rail_identity_allowed']; auditNotes: string[] }
  | { ok: false; identity?: AuddRailIdentity; reasonCodes: AuddRailIdentityValidationReasonCode[]; auditNotes: string[] };

export const AUDD_RAIL_CONFIG: AuddRailConfig = {
  schemaVersion: AUDD_RAIL_CONFIG_SCHEMA_VERSION,
  asset: AUDD_ASSET,
  decimals: AUDD_DECIMALS,
  tokenPrograms: {
    splToken: SPL_TOKEN_PROGRAM_ID,
  },
  caip2Networks: {
    'solana-devnet': SOLANA_DEVNET_CAIP2,
    'solana-mainnet-beta': SOLANA_MAINNET_BETA_CAIP2,
    'solana-testnet': SOLANA_TESTNET_CAIP2,
  },
  environments: {
    'deterministic-fixture': {
      environment: 'deterministic-fixture',
      status: 'deterministic-fixture-only',
      networkAlias: 'solana-devnet',
      caip2: SOLANA_DEVNET_CAIP2,
      defaultEnabled: true,
      grantEligibility: 'non_eligible',
      evidenceEnvironment: 'deterministic-fixture',
      mint: AUDD_DETERMINISTIC_FIXTURE_MINT,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      decimals: AUDD_DECIMALS,
      provenance: [
        {
          verifiedAt: '2026-09-01T00:00:00.000Z',
          confidence: 'fixture',
          sources: ['data/audd-solana-implementation-design/report.md §5.1'],
          facts: [
            'Deterministic AUDD fixture sentinel for unit tests only.',
            'The sentinel mint must never be presented as an official AUDD devnet mint or sent to live RPC.',
          ],
        },
      ],
      notes: [
        'Offline deterministic fixture rail only; it is not a devnet settlement asset.',
        'Grant-volume eligibility is always false for fixture evidence.',
      ],
    },
    'local-test-mint': {
      environment: 'local-test-mint',
      status: 'generated-local-test-mint',
      networkAlias: 'local-surfpool',
      defaultEnabled: true,
      grantEligibility: 'non_eligible',
      evidenceEnvironment: 'local-test-mint',
      mintPolicy: 'Generated per local test run as AUDD_TEST with six decimals; not an AUDD official mint.',
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      decimals: AUDD_DECIMALS,
      provenance: [
        {
          verifiedAt: '2026-09-01T00:00:00.000Z',
          confidence: 'local-generated',
          sources: ['data/audd-solana-implementation-design/report.md §5.1'],
          facts: ['Local generated mints are test assets and are ineligible for grant volume.'],
        },
      ],
      notes: ['Use only for local validator/LiteSVM/Surfpool style tests with generated token accounts.'],
    },
    'devnet-unverified': {
      environment: 'devnet-unverified',
      status: 'unverified-blocked-devnet',
      networkAlias: 'solana-devnet',
      caip2: SOLANA_DEVNET_CAIP2,
      defaultEnabled: false,
      grantEligibility: 'non_eligible',
      evidenceEnvironment: 'devnet-unverified',
      mints: [],
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      decimals: AUDD_DECIMALS,
      provenance: [
        {
          verifiedAt: '2026-09-01T00:00:00.000Z',
          confidence: 'unverified',
          sources: ['data/audd-solana-implementation-design/report.md §2.7, §5.1'],
          facts: ['No official AUDD devnet mint was verified; no devnet mint is implied by this config.'],
        },
      ],
      activationRequires: ['written AUDD/partner source for a test mint', 'captain approval', 'operator approval'],
      notes: ['Devnet AUDD is explicitly blocked until an exact test mint is approved with provenance.'],
    },
    'mainnet-gated': {
      environment: 'mainnet-gated',
      status: 'gated-mainnet-disabled-by-default',
      networkAlias: 'solana-mainnet-beta',
      caip2: SOLANA_MAINNET_BETA_CAIP2,
      defaultEnabled: false,
      grantEligibility: 'pending_partner_acceptance',
      evidenceEnvironment: 'mainnet-gated',
      mint: AUDD_OFFICIAL_SOLANA_MAINNET_MINT,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      decimals: AUDD_DECIMALS,
      provenance: [
        {
          verifiedAt: '2026-09-01T00:00:00.000Z',
          confidence: 'verified-public-mainnet',
          sources: [
            'https://www.audd.digital/faq/',
            'read-only Solana mainnet RPC getAccountInfo/getTokenSupply recorded in data/audd-solana-implementation-design/report.md §2.7',
          ],
          facts: [
            `Official AUDD Solana mainnet mint: ${AUDD_OFFICIAL_SOLANA_MAINNET_MINT}`,
            `Mint account owner / SPL Token program: ${SPL_TOKEN_PROGRAM_ID}`,
            'Decimals: 6',
          ],
        },
      ],
      activationRequires: [
        'separate exact captain approval naming mainnet AUDD',
        'operator signer approval and spend caps',
        'legal/compliance review',
        'written AUDD milestone/evidence alignment',
        'readiness/audit gates including the PR #646 workback',
      ],
      notes: [
        'Public token identity only. Mainnet is disabled by default and this config does not authorize live transfers.',
        'Grant eligibility remains pending partner acceptance even after a future approved live observation.',
      ],
    },
  },
};

export function isKnownAuddMint(mint: unknown): boolean {
  if (typeof mint !== 'string') return false;
  const candidate = mint.trim().toLowerCase();
  return candidate === AUDD_OFFICIAL_SOLANA_MAINNET_MINT.toLowerCase()
    || candidate === AUDD_DETERMINISTIC_FIXTURE_MINT.toLowerCase();
}

export function canonicalSolanaNetworkAlias(network: unknown): string | undefined {
  if (typeof network !== 'string') return undefined;
  const alias = network.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(AUDD_RAIL_CONFIG.caip2Networks, alias) ? alias : undefined;
}

export function caip2ForSolanaNetwork(network: string): string | undefined {
  const alias = canonicalSolanaNetworkAlias(network);
  return alias === undefined
    ? undefined
    : AUDD_RAIL_CONFIG.caip2Networks[alias as keyof AuddRailConfig['caip2Networks']];
}

export function networkAliasForCaip2(caip2: string): string | undefined {
  for (const [alias, value] of Object.entries(AUDD_RAIL_CONFIG.caip2Networks)) {
    if (value === caip2) return alias;
  }
  return undefined;
}

export function getAuddRailEnvironmentConfig(environment: AuddRailEnvironment): AuddRailEnvironmentConfig {
  return AUDD_RAIL_CONFIG.environments[environment];
}

export function auddRailIdentityTargetsMainnet(input: AuddRailIdentityRefInput): boolean {
  return canonicalSolanaNetworkAlias(input.network) === 'solana-mainnet-beta'
    || input.caip2Network === SOLANA_MAINNET_BETA_CAIP2
    || (typeof input.mint === 'string' && normalized(input.mint) === normalized(AUDD_OFFICIAL_SOLANA_MAINNET_MINT));
}

export function deriveCanonicalAuddRailEnvironment(input: AuddRailIdentityRefInput): AuddRailEnvironment | undefined {
  if (auddRailIdentityTargetsMainnet(input)) return 'mainnet-gated';
  if (typeof input.mint === 'string' && normalized(input.mint) === normalized(AUDD_DETERMINISTIC_FIXTURE_MINT)) return 'deterministic-fixture';
  const alias = canonicalSolanaNetworkAlias(input.network);
  if (alias === 'solana-devnet' || input.caip2Network === SOLANA_DEVNET_CAIP2) return 'devnet-unverified';
  if (typeof input.network === 'string' && normalized(input.network) === getAuddRailEnvironmentConfig('local-test-mint').networkAlias) return 'local-test-mint';
  return undefined;
}

export function validateAuddRailIdentity(input: AuddRailIdentityInput): AuddRailIdentityValidationResult {
  const errors: AuddRailIdentityValidationReasonCode[] = [];
  const auditNotes: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      reasonCodes: ['malformed_audd_rail_identity'],
      auditNotes: ['Denied: AUDD rail identity input must be an object.'],
    };
  }
  if (!isAuddRailEnvironment(input.environment)) {
    return {
      ok: false,
      reasonCodes: ['unknown_audd_rail_environment'],
      auditNotes: [`Denied: ${String(input.environment)} is not a known AUDD rail environment.`],
    };
  }

  const config = AUDD_RAIL_CONFIG.environments[input.environment];
  const identity = buildIdentity(config, input);

  if (input.network !== undefined && input.network !== config.networkAlias) {
    errors.push('wrong_network');
    auditNotes.push(`Denied: network ${input.network} does not match ${config.networkAlias} for ${config.environment}.`);
  }
  if (input.caip2 !== undefined && input.caip2 !== config.caip2) {
    errors.push('wrong_caip2_network');
    auditNotes.push(`Denied: CAIP-2 network ${input.caip2} does not match ${config.caip2 ?? 'none'} for ${config.environment}.`);
  }
  if (input.decimals !== undefined && input.decimals !== AUDD_DECIMALS) {
    errors.push('wrong_decimals');
    auditNotes.push('Denied: AUDD rail identity must use six decimals.');
  }

  switch (config.environment) {
    case 'deterministic-fixture':
      if (input.mint !== undefined && input.mint !== AUDD_DETERMINISTIC_FIXTURE_MINT) {
        errors.push('wrong_mint');
        auditNotes.push('Denied: deterministic fixture identity must use the AUDD fixture sentinel mint.');
      }
      if (input.tokenProgram !== undefined && input.tokenProgram !== null && input.tokenProgram !== SPL_TOKEN_PROGRAM_ID) {
        errors.push('wrong_token_program');
        auditNotes.push('Denied: deterministic SPL fixtures must name the SPL Token program when a token program is present.');
      }
      break;
    case 'local-test-mint':
      if (!isNonEmptyString(input.mint)) {
        errors.push('local_test_mint_required');
        auditNotes.push('Denied: local-test-mint identity requires the generated test mint address for this run.');
      } else if (input.mint === AUDD_OFFICIAL_SOLANA_MAINNET_MINT || input.mint === AUDD_DETERMINISTIC_FIXTURE_MINT) {
        errors.push('wrong_mint');
        auditNotes.push('Denied: local test mints must be generated per run and must not reuse the official or fixture AUDD mint.');
      }
      if (input.tokenProgram !== undefined && input.tokenProgram !== SPL_TOKEN_PROGRAM_ID) {
        errors.push('wrong_token_program');
        auditNotes.push('Denied: local test mints must use the SPL Token program.');
      }
      break;
    case 'devnet-unverified':
      errors.push('devnet_unverified_blocked');
      auditNotes.push('Denied: no official AUDD devnet mint is configured or implied; devnet AUDD remains blocked.');
      break;
    case 'mainnet-gated':
      if (input.mint !== undefined && input.mint !== AUDD_OFFICIAL_SOLANA_MAINNET_MINT) {
        errors.push('wrong_mint');
        auditNotes.push('Denied: mainnet-gated AUDD identity must use the verified official AUDD Solana mint.');
      }
      if (input.tokenProgram !== undefined && input.tokenProgram !== SPL_TOKEN_PROGRAM_ID) {
        errors.push('wrong_token_program');
        auditNotes.push('Denied: mainnet-gated AUDD identity must use the SPL Token program recorded in provenance.');
      }
      if (input.enableGatedMainnet !== true) {
        errors.push('mainnet_audd_disabled_by_default');
        auditNotes.push('Denied: mainnet AUDD identity is public configuration only and is disabled by default.');
      }
      break;
  }

  if (errors.length > 0) return { ok: false, identity, reasonCodes: unique(errors), auditNotes };
  return {
    ok: true,
    identity,
    reasonCodes: ['audd_rail_identity_allowed'],
    auditNotes: [`Allowed: ${config.environment} AUDD rail identity is valid for non-live configuration use.`],
  };
}

function buildIdentity(config: AuddRailEnvironmentConfig, input: AuddRailIdentityInput): AuddRailIdentity {
  return {
    asset: AUDD_ASSET,
    environment: config.environment,
    status: config.status,
    network: config.networkAlias,
    caip2: config.caip2,
    mint: input.mint ?? config.mint,
    tokenProgram: input.tokenProgram ?? config.tokenProgram,
    decimals: AUDD_DECIMALS,
    defaultEnabled: config.defaultEnabled,
    grantEligibility: config.grantEligibility,
    evidenceEnvironment: config.evidenceEnvironment,
    provenance: config.provenance,
    activationRequires: config.activationRequires,
    notes: config.notes,
  };
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function isAuddRailEnvironment(value: unknown): value is AuddRailEnvironment {
  return ['deterministic-fixture', 'local-test-mint', 'devnet-unverified', 'mainnet-gated'].includes(String(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
