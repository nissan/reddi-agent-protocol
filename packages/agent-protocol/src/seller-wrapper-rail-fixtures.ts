import {
  createAuddPaymentChallenge,
  createAuddSolanaPaymentPlan,
  evaluateAuddPaymentPlanPreflight,
  type AuddPaymentPlanPreflightDecision,
  type AuddSolanaPaymentPlan,
} from './audd-payment-plan.js';
import { handlePaidSpecialistRequest, type SellerResponse } from './buyer-seller.js';

export const SELLER_WRAPPER_RAIL_FIXTURE_SCHEMA_VERSION = 'reddi.seller-wrapper-rail-fixture.v1' as const;

export type SellerWrapperRailState =
  | 'fixture'
  | 'dry-run'
  | 'proof-metadata-only'
  | 'devnet-gated'
  | 'live-gated'
  | 'custody-supported'
  | 'unsupported';

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

const AUDD_DEVNET_MINT = 'AUDDdev111111111111111111111111111111111111';
const SELLER_PAYEE = 'solana:SellerWrapperDemoPayee111111111111111111111';
const SELLER_SETTLEMENT_ACCOUNT = 'solana:SellerWrapperDemoSettlement11111111111111111';

const auddPaymentPlan = createAuddSolanaPaymentPlan({
  network: 'solana-devnet',
  mint: AUDD_DEVNET_MINT,
  payee: SELLER_PAYEE,
  settlementAccount: SELLER_SETTLEMENT_ACCOUNT,
  amount: '2500000',
  quoteExpiresAt: '2026-07-01T00:00:00.000Z',
  failurePolicy: {
    mode: 'no_charge_on_failure',
    description: 'Dry-run seller-wrapper failures do not charge the buyer.',
  },
  refundPolicy: {
    mode: 'manual_review',
    description: 'Future live refunds require operator review before settlement.',
  },
  evidenceRequired: true,
  paymentMode: 'dry-run',
});

export const sellerWrapperRailFixture: SellerWrapperRailFixture = {
  schemaVersion: SELLER_WRAPPER_RAIL_FIXTURE_SCHEMA_VERSION,
  issue: 529,
  sourceContract: {
    railParityIssue: 525,
    railParityPullRequest: 528,
    sellerWrapperIssue: 375,
  },
  endpoints: [
    {
      kind: 'http-openapi',
      endpointId: 'seller-wrapper:listing-writer:http',
      displayName: 'Listing writer seller wrapper fixture',
      transport: {
        url: 'http://localhost:4021/specialist/listing-writer',
        auth: 'none',
      },
      rails: [
        {
          id: 'rail:solana-devnet-sol',
          asset: 'SOL',
          network: 'solana-devnet',
          state: 'devnet-gated',
          amountUnits: 'lamports',
          payee: 'solana:SellerWrapperDemoSolPayee111111111111111111',
          evidenceRequired: true,
          approvalRequired: true,
          livePaymentApproved: false,
          custodySupported: true,
          notes: ['SOL custody exists only through audited/promotion-gated contract lanes.'],
        },
        {
          id: 'rail:solana-devnet-usdc',
          asset: 'USDC',
          network: 'solana-devnet',
          state: 'dry-run',
          amountUnits: 'base-units',
          payee: 'solana:SellerWrapperDemoUsdcPayee11111111111111111',
          settlementAccount: 'solana:SellerWrapperDemoUsdcSettlement111111111111',
          evidenceRequired: true,
          approvalRequired: true,
          livePaymentApproved: false,
          custodySupported: false,
          notes: ['USDC is represented as quote/receipt/proof metadata in this fixture.'],
        },
        {
          id: 'rail:solana-devnet-audd',
          asset: 'AUDD',
          network: 'solana-devnet',
          state: 'proof-metadata-only',
          amountUnits: 'base-units',
          payee: SELLER_PAYEE,
          settlementAccount: SELLER_SETTLEMENT_ACCOUNT,
          evidenceRequired: true,
          approvalRequired: true,
          livePaymentApproved: false,
          custodySupported: false,
          auddPaymentPlan,
          notes: [
            'AUDD is first-class payment-plan/proof metadata beside SOL and USDC.',
            'AUDD custody or settlement-finality claims require a later audited custody workstream.',
          ],
        },
      ],
    },
  ],
  guardrails: {
    noSecrets: true,
    noLivePayment: true,
    noWalletSigning: true,
    noRpcCall: true,
    noCustodyClaim: true,
    noSettlementFinalityClaim: true,
  },
};

const CREDENTIAL_KEYS = new Set([
  'api_key',
  'apikey',
  'access_token',
  'auth_token',
  'authorization',
  'bearer',
  'credential',
  'mnemonic',
  'password',
  'private_key',
  'secret',
  'seed',
  'token',
]);
const CREDENTIAL_VALUE_PATTERN = /bearer\s+[a-z0-9._-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[a-z0-9_-]+/i;

function normalizedKey(value: string): string {
  return value.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`).replace(/[-\s]+/g, '_').replace(/^_+/, '').toLowerCase();
}

export function sellerWrapperFixtureHasCredentialMaterial(value: unknown): boolean {
  if (typeof value === 'string') return CREDENTIAL_VALUE_PATTERN.test(value);
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(sellerWrapperFixtureHasCredentialMaterial);
  return Object.entries(value).some(([key, item]) => (
    CREDENTIAL_KEYS.has(normalizedKey(key)) || sellerWrapperFixtureHasCredentialMaterial(item)
  ));
}

export function getSellerWrapperRail(
  fixture: SellerWrapperRailFixture,
  asset: SellerWrapperRailConfig['asset'],
  network: string,
): SellerWrapperRailConfig | undefined {
  return fixture.endpoints
    .flatMap((endpoint) => endpoint.rails)
    .find((rail) => rail.asset === asset && rail.network === network);
}

export async function runAuddSellerWrapperNoSpendFlow(input: {
  fixture?: SellerWrapperRailFixture;
  now?: string;
  approvalState?: 'approved' | 'denied' | 'requires_operator_approval';
  allowedMint?: string;
  allowedPayee?: string;
  allowedSettlementAccount?: string;
  approveLivePayment?: boolean;
  forceLiveChallenge?: boolean;
} = {}): Promise<AuddSellerWrapperNoSpendFlow> {
  const fixture = input.fixture ?? sellerWrapperRailFixture;
  if (sellerWrapperFixtureHasCredentialMaterial(fixture)) {
    throw new Error('seller_wrapper_fixture_contains_credentials');
  }

  const auddRail = getSellerWrapperRail(fixture, 'AUDD', 'solana-devnet');
  if (!auddRail?.auddPaymentPlan) throw new Error('audd_seller_wrapper_rail_missing');

  const paymentPlan = input.forceLiveChallenge
    ? createAuddSolanaPaymentPlan({ ...auddRail.auddPaymentPlan, paymentMode: 'live' })
    : auddRail.auddPaymentPlan;
  const challenge = createAuddPaymentChallenge({
    mode: paymentPlan.paymentMode,
    paymentPlan,
    quote: {
      source: 'source:seller-wrapper-fixture',
      specialist: 'specialist:listing-writer',
    },
    nonce: 'audd-seller-wrapper-001',
    endpoint: fixture.endpoints[0].transport.url,
  });
  const preflight = evaluateAuddPaymentPlanPreflight(challenge, {
    allowedNetworks: ['solana-devnet'],
    allowedMints: [input.allowedMint ?? paymentPlan.mint],
    allowedPayees: [input.allowedPayee ?? paymentPlan.payee],
    allowedSettlementAccounts: [input.allowedSettlementAccount ?? paymentPlan.settlementAccount],
    maxAmount: paymentPlan.amount,
    requireEvidence: true,
    approvalState: input.approvalState ?? 'approved',
    approveLivePayment: input.approveLivePayment,
    paymentProofRef: 'dry-run:audd-seller-wrapper-001',
    now: input.now ?? '2026-06-24T00:00:00.000Z',
  });

  const sellerResponse = preflight.allowed
    ? await handlePaidSpecialistRequest({
      challenge,
      request: {
        body: { task: 'draft-listing', rail: 'AUDD' },
        paymentProofRef: preflight.paymentProofRef,
      },
      policyDecision: preflight.policyDecision,
      createdAt: '2026-06-24T00:01:00.000Z',
      specialist: (body) => ({ ok: true, body, mode: 'mocked-invocation' }),
    })
    : undefined;

  return {
    fixture,
    auddRail,
    preflight,
    sellerResponse,
    guardrails: fixture.guardrails,
  };
}
