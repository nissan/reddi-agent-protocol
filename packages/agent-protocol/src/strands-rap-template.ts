import {
  frameworkTemplateFixtures,
  validateFrameworkTemplateContract,
  type FrameworkTemplateContract,
  type FrameworkTemplateScenarioKind,
} from './framework-template-contract.js';
import { runFrameworkTemplateNoLiveConformanceCheck } from './framework-template-conformance.js';
import { sellerWrapperFixtureHasCredentialMaterial } from './seller-wrapper-rail-fixtures.js';

export const STRANDS_RAP_TEMPLATE_SCHEMA_VERSION = 'reddi.strands-rap-template.v1' as const;

export type StrandsRapTemplateScenario =
  | 'allowed-no-live-invocation'
  | 'policy-denial'
  | 'missing-approval'
  | 'malformed-quote-payment-plan'
  | 'credential-shaped-output'
  | 'unsafe-live-custody-provider-claim';

export type StrandsRapToolStep =
  | 'discover'
  | 'quote'
  | 'buyerPolicyPreflight'
  | 'operatorApproval'
  | 'invokePaidAgent'
  | 'bindReceiptEvidence'
  | 'sellerWrapperEndpoint';

export type StrandsRapTemplateState = {
  toolPluginId: string;
  scenario: StrandsRapTemplateScenario;
  steps: StrandsRapToolStep[];
  hooks: {
    buyerPolicy: boolean;
    receiptEvidence: boolean;
    sellerWrapper: boolean;
  };
  contracts: Record<FrameworkTemplateScenarioKind, FrameworkTemplateContract>;
  selectedContract: FrameworkTemplateContract;
  sellerWrapperEndpointHelper: {
    endpointId: string;
    quoteRoute: string;
    policyPreflightRoute: string;
    invocationRoute: string;
    receiptHook: string;
    evidenceHook: string;
  };
  toolState: {
    discoveryRef: string;
    quoteRef: string;
    buyerPolicyRef: string;
    operatorApprovalRef?: string;
    invocationRef?: string;
    receiptRef?: string;
    evidenceRef?: string;
    denialReasonCodes: string[];
    failureMode?: string;
  };
  expectedAllowed: boolean;
  notes: string[];
};

export type StrandsRapTemplateValidationReasonCode =
  | 'strands_rap_template_valid'
  | 'strands_template_malformed'
  | 'framework_contract_invalid'
  | 'framework_conformance_invalid'
  | 'missing_required_tool_step'
  | 'missing_required_hook'
  | 'missing_seller_wrapper_endpoint_helper'
  | 'missing_receipt_evidence_refs'
  | 'missing_operator_approval'
  | 'malformed_quote_payment_plan'
  | 'template_contains_credentials'
  | 'unsafe_live_custody_provider_claim';

export type StrandsRapTemplateValidationResult = {
  valid: boolean;
  reasonCodes: StrandsRapTemplateValidationReasonCode[];
  auditNotes: string[];
};

const REQUIRED_STEPS: StrandsRapToolStep[] = [
  'discover',
  'quote',
  'buyerPolicyPreflight',
  'operatorApproval',
  'invokePaidAgent',
  'bindReceiptEvidence',
  'sellerWrapperEndpoint',
];
const REQUIRED_CONTRACTS: FrameworkTemplateScenarioKind[] = [
  'discovery',
  'quote',
  'preflight',
  'operator-approval',
  'invocation',
  'receipt-evidence',
  'denial',
  'failure',
];
const UNSAFE_LIVE_PATTERN = /\bhttps?:\/\/[^\s"]*(rpc|alchemy|helius|quicknode|api\.(mainnet-beta|devnet|testnet)\.solana\.com)[^\s"]*|\b(wallet|provider|sign|transfer|broadcast)\b.*\b(payment|transaction|audd|usdc|sol)\b/i;
const CUSTODY_FINALITY_PATTERN = /\b(custody|custodied|escrowed|settlement finality|final settlement)\b/i;

function cloneContract(contract: FrameworkTemplateContract): FrameworkTemplateContract {
  return structuredClone(contract) as FrameworkTemplateContract;
}

function textContains(value: unknown, pattern: RegExp): boolean {
  if (typeof value === 'string') return pattern.test(value);
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => textContains(item, pattern));
  return Object.values(value).some((item) => textContains(item, pattern));
}

function contractMap(): Record<FrameworkTemplateScenarioKind, FrameworkTemplateContract> {
  return {
    discovery: cloneContract(frameworkTemplateFixtures.discovery.contract),
    quote: cloneContract(frameworkTemplateFixtures.quote.contract),
    preflight: cloneContract(frameworkTemplateFixtures.preflight.contract),
    'operator-approval': cloneContract(frameworkTemplateFixtures['operator-approval'].contract),
    invocation: cloneContract(frameworkTemplateFixtures.invocation.contract),
    'receipt-evidence': cloneContract(frameworkTemplateFixtures['receipt-evidence'].contract),
    denial: cloneContract(frameworkTemplateFixtures.denial.contract),
    failure: cloneContract(frameworkTemplateFixtures.failure.contract),
  };
}

export function createStrandsRapTemplateFixture(input: {
  scenario?: StrandsRapTemplateScenario;
} = {}): StrandsRapTemplateState {
  const scenario = input.scenario ?? 'allowed-no-live-invocation';
  const contracts = contractMap();
  const selectedContract = scenario === 'policy-denial'
    ? contracts.denial
    : scenario === 'missing-approval'
      ? contracts['operator-approval']
      : scenario === 'malformed-quote-payment-plan'
        ? contracts.quote
        : scenario === 'unsafe-live-custody-provider-claim'
          ? contracts.preflight
          : contracts.invocation;
  if (!selectedContract.sellerProfile) throw new Error('strands_template_missing_seller_profile');
  const fixture: StrandsRapTemplateState = {
    toolPluginId: 'strands:rap-template:listing-writer',
    scenario,
    steps: [...REQUIRED_STEPS],
    hooks: {
      buyerPolicy: true,
      receiptEvidence: true,
      sellerWrapper: true,
    },
    contracts,
    selectedContract: cloneContract(selectedContract),
    sellerWrapperEndpointHelper: {
      endpointId: selectedContract.sellerProfile.endpointId,
      quoteRoute: selectedContract.sellerProfile.quoteRoute,
      policyPreflightRoute: selectedContract.sellerProfile.policyPreflightRoute,
      invocationRoute: selectedContract.sellerProfile.invocationRoute,
      receiptHook: selectedContract.sellerProfile.receiptHook,
      evidenceHook: selectedContract.sellerProfile.evidenceHook,
    },
    toolState: {
      discoveryRef: 'local-fixture:strands:discovery',
      quoteRef: 'local-fixture:strands:quote',
      buyerPolicyRef: 'local-fixture:strands:buyer-policy',
      operatorApprovalRef: 'local-fixture:strands:operator-approval',
      invocationRef: 'local-fixture:strands:invocation',
      receiptRef: 'local-fixture:receipt:listing-writer',
      evidenceRef: 'local-fixture:evidence:listing-writer',
      denialReasonCodes: scenario === 'policy-denial' ? ['policy_denied'] : [],
      failureMode: scenario === 'malformed-quote-payment-plan' ? 'malformed_quote_payment_plan' : undefined,
    },
    expectedAllowed: scenario === 'allowed-no-live-invocation',
    notes: [
      'This is a local/static Strands tool-plugin template fixture, not a Strands package scaffold.',
      'Tool state stores framework-neutral RAP refs only; external services and live rails stay disabled.',
    ],
  };

  if (scenario === 'policy-denial') {
    fixture.expectedAllowed = false;
    fixture.toolState.denialReasonCodes = ['policy_denied'];
    fixture.toolState.operatorApprovalRef = undefined;
    fixture.toolState.invocationRef = undefined;
    fixture.toolState.receiptRef = undefined;
    fixture.toolState.evidenceRef = undefined;
  }
  if (scenario === 'missing-approval') {
    fixture.expectedAllowed = false;
    fixture.toolState.operatorApprovalRef = undefined;
  }
  if (scenario === 'malformed-quote-payment-plan') {
    fixture.expectedAllowed = false;
    fixture.toolState.quoteRef = '';
  }
  if (scenario === 'credential-shaped-output') {
    fixture.expectedAllowed = false;
    fixture.notes.push('Rejected fixture output contains providerSecret=sk-test-secret.');
  }
  if (scenario === 'unsafe-live-custody-provider-claim') {
    fixture.expectedAllowed = false;
    fixture.notes.push('Rejected fixture attempts https://api.mainnet-beta.solana.com and claims AUDD custody.');
  }
  return fixture;
}

function isStructuredTemplate(value: unknown): value is StrandsRapTemplateState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<StrandsRapTemplateState>;
  return typeof candidate.toolPluginId === 'string'
    && typeof candidate.scenario === 'string'
    && Array.isArray(candidate.steps)
    && !!candidate.hooks
    && !!candidate.contracts
    && !!candidate.selectedContract
    && !!candidate.sellerWrapperEndpointHelper
    && !!candidate.toolState
    && Array.isArray(candidate.notes);
}

export function validateStrandsRapTemplate(template: unknown): StrandsRapTemplateValidationResult {
  if (!isStructuredTemplate(template)) {
    return {
      valid: false,
      reasonCodes: ['strands_template_malformed'],
      auditNotes: ['Denied: Strands RAP template fixture is malformed.'],
    };
  }

  const reasonCodes: StrandsRapTemplateValidationReasonCode[] = [];
  const auditNotes: string[] = [];
  for (const step of REQUIRED_STEPS) {
    if (!template.steps.includes(step)) {
      reasonCodes.push('missing_required_tool_step');
      auditNotes.push(`Denied: missing Strands tool step ${step}.`);
      break;
    }
  }
  if (!template.hooks.buyerPolicy || !template.hooks.receiptEvidence || !template.hooks.sellerWrapper) {
    reasonCodes.push('missing_required_hook');
    auditNotes.push('Denied: buyer policy, receipt/evidence, and seller-wrapper hooks are required.');
  }
  for (const key of REQUIRED_CONTRACTS) {
    const contract = template.contracts[key];
    if (!contract || !validateFrameworkTemplateContract(contract).valid) {
      reasonCodes.push('framework_contract_invalid');
      auditNotes.push(`Denied: ${key} framework contract is invalid.`);
      break;
    }
  }
  if (!validateFrameworkTemplateContract(template.selectedContract).valid) {
    reasonCodes.push('framework_contract_invalid');
    auditNotes.push('Denied: selected framework contract is invalid.');
  }
  const conformance = runFrameworkTemplateNoLiveConformanceCheck();
  if (!conformance.valid) {
    reasonCodes.push('framework_conformance_invalid');
    auditNotes.push(`Denied: shared framework conformance failed: ${conformance.reasonCodes.join(',')}.`);
  }
  if (
    !template.sellerWrapperEndpointHelper.endpointId
    || !template.sellerWrapperEndpointHelper.quoteRoute
    || !template.sellerWrapperEndpointHelper.policyPreflightRoute
    || !template.sellerWrapperEndpointHelper.invocationRoute
    || !template.sellerWrapperEndpointHelper.receiptHook
    || !template.sellerWrapperEndpointHelper.evidenceHook
  ) {
    reasonCodes.push('missing_seller_wrapper_endpoint_helper');
    auditNotes.push('Denied: seller-wrapper endpoint helper routes are required.');
  }
  if (template.scenario === 'allowed-no-live-invocation' && (!template.toolState.receiptRef || !template.toolState.evidenceRef)) {
    reasonCodes.push('missing_receipt_evidence_refs');
    auditNotes.push('Denied: allowed no-live invocation requires receipt and evidence refs.');
  }
  if (
    template.scenario === 'policy-denial'
    && (
      template.toolState.operatorApprovalRef
      || template.toolState.invocationRef
      || template.toolState.receiptRef
      || template.toolState.evidenceRef
    )
  ) {
    reasonCodes.push('missing_operator_approval');
    auditNotes.push('Denied: policy-denial case must stop before approval, invocation, receipt, and evidence refs.');
  }
  if (template.scenario === 'missing-approval' && !template.toolState.operatorApprovalRef) {
    reasonCodes.push('missing_operator_approval');
    auditNotes.push('Denied: operator approval ref is required before paid-agent invocation.');
  }
  if (template.scenario === 'malformed-quote-payment-plan' && !template.toolState.quoteRef) {
    reasonCodes.push('malformed_quote_payment_plan');
    auditNotes.push('Denied: quote/payment-plan ref is malformed or missing.');
  }
  if (sellerWrapperFixtureHasCredentialMaterial(template)) {
    reasonCodes.push('template_contains_credentials');
    auditNotes.push('Denied: Strands RAP template contains credential-shaped material.');
  }
  const templateBoundaryText = {
    toolPluginId: template.toolPluginId,
    scenario: template.scenario,
    steps: template.steps,
    hooks: template.hooks,
    sellerWrapperEndpointHelper: template.sellerWrapperEndpointHelper,
    toolState: template.toolState,
    notes: template.notes,
  };
  if (textContains(templateBoundaryText, UNSAFE_LIVE_PATTERN) || textContains(templateBoundaryText, CUSTODY_FINALITY_PATTERN)) {
    reasonCodes.push('unsafe_live_custody_provider_claim');
    auditNotes.push('Denied: Strands RAP template contains unsafe live, provider, custody, transfer, or finality material.');
  }

  if (reasonCodes.length > 0) return { valid: false, reasonCodes: [...new Set(reasonCodes)], auditNotes };
  return {
    valid: true,
    reasonCodes: ['strands_rap_template_valid'],
    auditNotes: ['Allowed: Strands RAP template fixture is local, no-live, and consumes shared RAP framework contracts.'],
  };
}
