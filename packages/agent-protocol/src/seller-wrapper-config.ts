import type { AuddSolanaPaymentPlan } from './audd-payment-plan.js';
import {
  SELLER_WRAPPER_RAIL_FIXTURE_SCHEMA_VERSION,
  getSellerWrapperRail,
  runAuddSellerWrapperNoSpendFlow,
  sellerWrapperFixtureHasCredentialMaterial,
  sellerWrapperRailFixture,
  type SellerWrapperEndpointFixture,
  type SellerWrapperRailConfig,
  type SellerWrapperRailFixture,
  type SellerWrapperRailState,
} from './seller-wrapper-rail-fixtures.js';

export const SELLER_WRAPPER_CONFIG_SCHEMA_VERSION = 'reddi.seller-wrapper-config.v1' as const;

export type SellerWrapperRuntimeState =
  | 'local-dry-run'
  | 'devnet-gated'
  | 'proof-metadata-only'
  | 'live-gated'
  | 'custody-supported'
  | 'unsupported'
  | 'live-payment-approved';

export type SellerWrapperRailConfigExample = {
  id: string;
  asset: SellerWrapperRailConfig['asset'];
  network: string;
  fixtureState: SellerWrapperRailState;
  runtimeState: SellerWrapperRuntimeState;
  amountUnits: string;
  payee: string;
  settlementAccount?: string;
  evidenceRequired: boolean;
  approvalRequired: boolean;
  livePaymentApproved: boolean;
  custodySupported: boolean;
  quote: {
    amount: string;
    expiresAt?: string;
    paymentMode: 'dry-run' | 'live';
  };
  audd?: {
    mint: string;
    failurePolicy: AuddSolanaPaymentPlan['failurePolicy'];
    refundPolicy: AuddSolanaPaymentPlan['refundPolicy'];
  };
  notes: string[];
};

export type SellerWrapperEndpointConfigExample = {
  kind: SellerWrapperEndpointFixture['kind'];
  endpointId: string;
  displayName: string;
  transport: SellerWrapperEndpointFixture['transport'];
  wrapper: {
    quoteRoute: string;
    policyPreflightRoute: string;
    invocationRoute: string;
    receiptHook: string;
    evidenceHook: string;
  };
  rails: SellerWrapperRailConfigExample[];
};

export type SellerWrapperConfigExamples = {
  schemaVersion: typeof SELLER_WRAPPER_CONFIG_SCHEMA_VERSION;
  issue: 535;
  sourceContract: SellerWrapperRailFixture['sourceContract'] & {
    configIssue: 535;
    railFixtureIssue: SellerWrapperRailFixture['issue'];
    railFixtureSchemaVersion: typeof SELLER_WRAPPER_RAIL_FIXTURE_SCHEMA_VERSION;
  };
  generatedMode: 'no-spend-config-examples';
  endpoints: SellerWrapperEndpointConfigExample[];
  guardrails: SellerWrapperRailFixture['guardrails'] & {
    noSecrets: true;
    noProviderCredentials: true;
    noLivePaymentInstructions: true;
  };
};

export type SellerWrapperConfigValidationReasonCode =
  | 'seller_wrapper_config_valid'
  | 'config_malformed'
  | 'fixture_contains_credentials'
  | 'config_contains_credentials'
  | 'missing_audd_rail'
  | 'missing_audd_payment_plan'
  | 'missing_wrapper_hooks'
  | 'live_payment_not_approved'
  | 'live_payment_instruction_rejected'
  | 'custody_claim_rejected'
  | 'settlement_finality_claim_rejected';

export type SellerWrapperConfigValidationResult = {
  valid: boolean;
  reasonCodes: SellerWrapperConfigValidationReasonCode[];
  auditNotes: string[];
};

const REQUIRED_WRAPPER_HOOKS = [
  'quoteRoute',
  'policyPreflightRoute',
  'invocationRoute',
  'receiptHook',
  'evidenceHook',
] as const;

const LIVE_PAYMENT_INSTRUCTION_PATTERN = /\b(submit|sign|transfer|settle|broadcast)\b.*\b(transaction|payment|audd|usdc|sol)\b|\bwallet\s+sign|\brpc\b/i;
const CUSTODY_CLAIM_PATTERN = /\b(audd|usdc|sol)\b.*\b(is|are|was|were|will be|held|escrowed)\b.*\b(custody|custodied|escrowed|held)\b|\bheld\s+in\s+custody\b/i;
const SETTLEMENT_FINALITY_PATTERN = /\bsettlement\s+finality\b|\bfinal\s+settlement\b/i;

function endpointSlug(endpointId: string): string {
  return endpointId.replace(/^seller-wrapper:/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}

function amountForRail(rail: SellerWrapperRailConfig): string {
  if (rail.auddPaymentPlan) return rail.auddPaymentPlan.amount;
  if (rail.asset === 'SOL') return '1000000';
  return '2500000';
}

function runtimeStateForRail(rail: SellerWrapperRailConfig): SellerWrapperRuntimeState {
  if (rail.livePaymentApproved) return 'live-payment-approved';
  if (rail.state === 'dry-run' || rail.state === 'fixture') return 'local-dry-run';
  if (rail.state === 'custody-supported') return 'custody-supported';
  if (rail.state === 'proof-metadata-only') return 'proof-metadata-only';
  if (rail.state === 'devnet-gated') return 'devnet-gated';
  if (rail.state === 'live-gated') return 'live-gated';
  return 'unsupported';
}

function railConfigExample(rail: SellerWrapperRailConfig): SellerWrapperRailConfigExample {
  return {
    id: rail.id,
    asset: rail.asset,
    network: rail.network,
    fixtureState: rail.state,
    runtimeState: runtimeStateForRail(rail),
    amountUnits: rail.amountUnits,
    payee: rail.payee,
    settlementAccount: rail.settlementAccount,
    evidenceRequired: rail.evidenceRequired,
    approvalRequired: rail.approvalRequired,
    livePaymentApproved: rail.livePaymentApproved,
    custodySupported: rail.custodySupported,
    quote: {
      amount: amountForRail(rail),
      expiresAt: rail.auddPaymentPlan?.quoteExpiresAt,
      paymentMode: rail.auddPaymentPlan?.paymentMode ?? 'dry-run',
    },
    audd: rail.auddPaymentPlan
      ? {
        mint: rail.auddPaymentPlan.mint,
        failurePolicy: rail.auddPaymentPlan.failurePolicy,
        refundPolicy: rail.auddPaymentPlan.refundPolicy,
      }
      : undefined,
    notes: rail.notes,
  };
}

function endpointConfigExample(endpoint: SellerWrapperEndpointFixture): SellerWrapperEndpointConfigExample {
  const slug = endpointSlug(endpoint.endpointId);
  return {
    kind: endpoint.kind,
    endpointId: endpoint.endpointId,
    displayName: endpoint.displayName,
    transport: endpoint.transport,
    wrapper: {
      quoteRoute: `/seller-wrapper/${slug}/quote`,
      policyPreflightRoute: `/seller-wrapper/${slug}/policy-preflight`,
      invocationRoute: `/seller-wrapper/${slug}/invoke-mock`,
      receiptHook: `/seller-wrapper/${slug}/receipt`,
      evidenceHook: `/seller-wrapper/${slug}/evidence`,
    },
    rails: endpoint.rails.map(railConfigExample),
  };
}

function generatedEndpoints(fixture: SellerWrapperRailFixture): SellerWrapperEndpointFixture[] {
  if (fixture.endpoints.some((endpoint) => endpoint.kind === 'mcp')) return fixture.endpoints;
  const first = fixture.endpoints[0];
  if (!first) return [];
  return [
    ...fixture.endpoints,
    {
      ...first,
      kind: 'mcp',
      endpointId: `${first.endpointId}:mcp`,
      displayName: `${first.displayName} MCP bridge`,
      transport: {
        url: 'mcp://local/seller-wrapper/listing-writer',
        auth: 'none',
      },
    },
  ];
}

function textContains(value: unknown, pattern: RegExp): boolean {
  if (typeof value === 'string') return pattern.test(value);
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => textContains(item, pattern));
  return Object.values(value).some((item) => textContains(item, pattern));
}

function configLooksStructured(config: unknown): config is SellerWrapperConfigExamples {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const candidate = config as Partial<SellerWrapperConfigExamples>;
  return candidate.schemaVersion === SELLER_WRAPPER_CONFIG_SCHEMA_VERSION
    && candidate.issue === 535
    && candidate.generatedMode === 'no-spend-config-examples'
    && Array.isArray(candidate.endpoints)
    && !!candidate.guardrails
    && typeof candidate.guardrails === 'object';
}

export function generateSellerWrapperConfigExamples(input: {
  fixture?: SellerWrapperRailFixture;
} = {}): SellerWrapperConfigExamples {
  const fixture = input.fixture ?? sellerWrapperRailFixture;
  if (sellerWrapperFixtureHasCredentialMaterial(fixture)) {
    throw new Error('seller_wrapper_fixture_contains_credentials');
  }

  const auddRail = getSellerWrapperRail(fixture, 'AUDD', 'solana-devnet');
  if (!auddRail) throw new Error('seller_wrapper_config_missing_audd_rail');
  if (!auddRail.auddPaymentPlan) throw new Error('seller_wrapper_config_missing_audd_payment_plan');

  const config: SellerWrapperConfigExamples = {
    schemaVersion: SELLER_WRAPPER_CONFIG_SCHEMA_VERSION,
    issue: 535,
    sourceContract: {
      ...fixture.sourceContract,
      configIssue: 535,
      railFixtureIssue: fixture.issue,
      railFixtureSchemaVersion: SELLER_WRAPPER_RAIL_FIXTURE_SCHEMA_VERSION,
    },
    generatedMode: 'no-spend-config-examples',
    endpoints: generatedEndpoints(fixture).map(endpointConfigExample),
    guardrails: {
      ...fixture.guardrails,
      noProviderCredentials: true,
      noLivePaymentInstructions: true,
    },
  };

  const validation = validateSellerWrapperConfigExamples(config);
  if (!validation.valid) {
    throw new Error(`seller_wrapper_config_invalid:${validation.reasonCodes.join(',')}`);
  }
  return config;
}

export function validateSellerWrapperConfigExamples(config: unknown): SellerWrapperConfigValidationResult {
  const reasonCodes: SellerWrapperConfigValidationReasonCode[] = [];
  const auditNotes: string[] = [];

  if (!configLooksStructured(config)) {
    return {
      valid: false,
      reasonCodes: ['config_malformed'],
      auditNotes: ['Denied: seller-wrapper config is malformed.'],
    };
  }

  if (sellerWrapperFixtureHasCredentialMaterial(config)) {
    reasonCodes.push('config_contains_credentials');
    auditNotes.push('Denied: generated config contains credential-like material.');
  }

  const auddRail = config.endpoints.flatMap((endpoint) => endpoint.rails).find((rail) => (
    rail.asset === 'AUDD' && rail.network === 'solana-devnet'
  ));
  if (!auddRail) {
    reasonCodes.push('missing_audd_rail');
    auditNotes.push('Denied: AUDD solana-devnet rail is missing from generated config.');
  } else if (!auddRail.audd) {
    reasonCodes.push('missing_audd_payment_plan');
    auditNotes.push('Denied: AUDD payment-plan metadata is missing from generated config.');
  }

  const missingHooks = config.endpoints.some((endpoint) => REQUIRED_WRAPPER_HOOKS.some((hook) => (
    typeof endpoint.wrapper[hook] !== 'string' || endpoint.wrapper[hook].trim().length === 0
  )));
  if (missingHooks) {
    reasonCodes.push('missing_wrapper_hooks');
    auditNotes.push('Denied: quote, policy, invocation, receipt, and evidence hooks are all required.');
  }

  if (config.endpoints.some((endpoint) => endpoint.rails.some((rail) => rail.livePaymentApproved))) {
    reasonCodes.push('live_payment_not_approved');
    auditNotes.push('Denied: generated examples must not approve live payment.');
  }
  if (textContains(config, LIVE_PAYMENT_INSTRUCTION_PATTERN)) {
    reasonCodes.push('live_payment_instruction_rejected');
    auditNotes.push('Denied: generated examples must not include wallet, RPC, signing, transfer, broadcast, or settlement instructions.');
  }
  if (textContains(config, CUSTODY_CLAIM_PATTERN)) {
    reasonCodes.push('custody_claim_rejected');
    auditNotes.push('Denied: generated examples must not claim AUDD/USDC/SOL custody.');
  }
  if (textContains(config, SETTLEMENT_FINALITY_PATTERN)) {
    reasonCodes.push('settlement_finality_claim_rejected');
    auditNotes.push('Denied: generated examples must not claim settlement finality.');
  }

  if (reasonCodes.length > 0) {
    return { valid: false, reasonCodes, auditNotes };
  }
  return {
    valid: true,
    reasonCodes: ['seller_wrapper_config_valid'],
    auditNotes: ['Allowed: seller-wrapper config examples are non-secret, no-spend, and include required wrapper hooks.'],
  };
}

export async function runSellerWrapperConfigNoSpendCheck(input: {
  fixture?: SellerWrapperRailFixture;
} = {}) {
  const fixture = input.fixture ?? sellerWrapperRailFixture;
  const config = generateSellerWrapperConfigExamples({ fixture });
  const validation = validateSellerWrapperConfigExamples(config);
  const auddFlow = await runAuddSellerWrapperNoSpendFlow({ fixture });
  return {
    config,
    validation,
    auddFlow,
    guardrails: config.guardrails,
  };
}
