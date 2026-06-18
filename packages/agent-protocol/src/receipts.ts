import type { ReddiPolicyDecision } from './policy.js';

export type ReddiReceiptAttestationStatus =
  | 'not_requested'
  | 'pending'
  | 'attested'
  | 'failed'
  | 'rejected';

export type ReddiReceipt = {
  schemaVersion: 'reddi.receipt.v1';
  job: {
    id: string;
    type?: string;
  };
  source: {
    id: string;
    type?: string;
    uri?: string;
  };
  payer: {
    id: string;
    address?: string;
  };
  specialist: {
    id: string;
    endpoint?: string;
  };
  protocol: {
    name: 'Reddi Agent Protocol';
    version: string;
  };
  payment: {
    network: string;
    asset: string;
    amount: string;
    paymentProofRef: string;
  };
  requestHash: string;
  responseHash: string;
  evidenceRef: string;
  policyDecision: ReddiPolicyDecision;
  attestationStatus: ReddiReceiptAttestationStatus;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type ReddiReceiptValidationErrorCode =
  | 'malformed_receipt'
  | 'payment_proof_missing'
  | 'unsupported_network_asset'
  | 'credential_leakage_rejected';

export type ReddiReceiptValidationError = {
  code: ReddiReceiptValidationErrorCode;
  path: string;
  message: string;
};

export type ReddiReceiptValidationResult =
  | { ok: true; receipt: ReddiReceipt }
  | { ok: false; errors: ReddiReceiptValidationError[] };

const SUPPORTED_NETWORK_ASSETS = new Set([
  'solana-devnet:USDC',
  'solana-devnet:SOL',
  'solana-testnet:USDC',
  'solana-testnet:SOL',
  'solana-mainnet-beta:USDC',
  'solana-mainnet-beta:SOL',
]);

const SENSITIVE_KEY_PATTERN = /(^|[_-])(api[_-]?key|authorization|bearer|cookie|credential|mnemonic|password|private[_-]?key|refresh[_-]?token|secret|seed|session[_-]?token|token)([_-]|$)|apiKey|accessToken|refreshToken|sessionToken|privateKey/i;
const SENSITIVE_VALUE_PATTERN = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|authorization:\s*bearer\s+|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,})/i;

export function createReddiReceipt(input: ReddiReceipt): ReddiReceipt {
  const result = validateReddiReceipt(input);
  if (!result.ok) {
    throw new Error(`invalid_reddi_receipt:${result.errors.map((error) => `${error.code}:${error.path}`).join(',')}`);
  }
  return result.receipt;
}

export function validateReddiReceipt(input: unknown): ReddiReceiptValidationResult {
  const errors: ReddiReceiptValidationError[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [error('malformed_receipt', '$', 'receipt must be a plain object')] };
  }

  const receipt = input as ReddiReceipt;
  requireLiteral(receipt.schemaVersion, 'reddi.receipt.v1', '$.schemaVersion', errors);
  requireString(receipt.job?.id, '$.job.id', errors);
  requireString(receipt.source?.id, '$.source.id', errors);
  requireString(receipt.payer?.id, '$.payer.id', errors);
  requireString(receipt.specialist?.id, '$.specialist.id', errors);
  requireLiteral(receipt.protocol?.name, 'Reddi Agent Protocol', '$.protocol.name', errors);
  requireString(receipt.protocol?.version, '$.protocol.version', errors);
  requireString(receipt.payment?.network, '$.payment.network', errors);
  requireString(receipt.payment?.asset, '$.payment.asset', errors);
  requirePositiveIntegerString(receipt.payment?.amount, '$.payment.amount', errors);
  if (!isNonEmptyString(receipt.payment?.paymentProofRef)) {
    errors.push(error('payment_proof_missing', '$.payment.paymentProofRef', 'payment proof reference is required'));
  }
  requireString(receipt.requestHash, '$.requestHash', errors);
  requireString(receipt.responseHash, '$.responseHash', errors);
  requireString(receipt.evidenceRef, '$.evidenceRef', errors);
  validatePolicyDecision(receipt.policyDecision, errors);
  validateAttestationStatus(receipt.attestationStatus, errors);
  validateTimestamp(receipt.createdAt, errors);

  const assetNetwork = `${receipt.payment?.network}:${normalizeAsset(receipt.payment?.asset)}`;
  if (isNonEmptyString(receipt.payment?.network) && isNonEmptyString(receipt.payment?.asset) && !SUPPORTED_NETWORK_ASSETS.has(assetNetwork)) {
    errors.push(error('unsupported_network_asset', '$.payment', `${receipt.payment.asset} on ${receipt.payment.network} is not supported by Reddi receipt v1 fixtures`));
  }

  const credentialPath = findCredentialMaterial(receipt);
  if (credentialPath) {
    errors.push(error('credential_leakage_rejected', credentialPath, 'receipt contains credential-bearing auth metadata, signer material, or provider secret text'));
  }

  return errors.length === 0 ? { ok: true, receipt } : { ok: false, errors };
}

function validatePolicyDecision(value: unknown, errors: ReddiReceiptValidationError[]): void {
  if (!isPlainObject(value)) {
    errors.push(error('malformed_receipt', '$.policyDecision', 'policyDecision must be a plain object'));
    return;
  }
  const decision = value as ReddiPolicyDecision;
  requireLiteral(decision.schemaVersion, 'reddi.policy-decision.v1', '$.policyDecision.schemaVersion', errors);
  if (typeof decision.allowed !== 'boolean') errors.push(error('malformed_receipt', '$.policyDecision.allowed', 'allowed must be boolean'));
  if (!Array.isArray(decision.reasonCodes) || decision.reasonCodes.some((code) => typeof code !== 'string')) {
    errors.push(error('malformed_receipt', '$.policyDecision.reasonCodes', 'reasonCodes must be string array'));
  }
  requireString(decision.asset, '$.policyDecision.asset', errors);
  requireString(decision.network, '$.policyDecision.network', errors);
  if (!['approved', 'denied', 'requires_operator_approval'].includes(decision.approvalState)) {
    errors.push(error('malformed_receipt', '$.policyDecision.approvalState', 'approvalState is invalid'));
  }
  if (!Array.isArray(decision.auditNotes) || decision.auditNotes.some((note) => typeof note !== 'string')) {
    errors.push(error('malformed_receipt', '$.policyDecision.auditNotes', 'auditNotes must be string array'));
  }
}

function validateAttestationStatus(value: unknown, errors: ReddiReceiptValidationError[]): void {
  if (!['not_requested', 'pending', 'attested', 'failed', 'rejected'].includes(String(value))) {
    errors.push(error('malformed_receipt', '$.attestationStatus', 'attestationStatus is invalid'));
  }
}

function validateTimestamp(value: unknown, errors: ReddiReceiptValidationError[]): void {
  if (!isNonEmptyString(value) || Number.isNaN(Date.parse(value))) {
    errors.push(error('malformed_receipt', '$.createdAt', 'createdAt must be an ISO timestamp'));
  }
}

function requireLiteral(value: unknown, expected: string, path: string, errors: ReddiReceiptValidationError[]): void {
  if (value !== expected) errors.push(error('malformed_receipt', path, `expected ${expected}`));
}

function requireString(value: unknown, path: string, errors: ReddiReceiptValidationError[]): void {
  if (!isNonEmptyString(value)) errors.push(error('malformed_receipt', path, 'required string is missing'));
}

function requirePositiveIntegerString(value: unknown, path: string, errors: ReddiReceiptValidationError[]): void {
  if (!isNonEmptyString(value) || !/^[1-9]\d*$/.test(value)) {
    errors.push(error('malformed_receipt', path, 'amount must be a positive integer string in the asset smallest unit'));
  }
}

function findCredentialMaterial(value: unknown, path = '$'): string | undefined {
  if (typeof value === 'string') return SENSITIVE_VALUE_PATTERN.test(value) ? path : undefined;
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findCredentialMaterial(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (SENSITIVE_KEY_PATTERN.test(key)) return nextPath;
    const found = findCredentialMaterial(nested, nextPath);
    if (found) return found;
  }
  return undefined;
}

function error(code: ReddiReceiptValidationErrorCode, path: string, message: string): ReddiReceiptValidationError {
  return { code, path, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeAsset(asset: unknown): string {
  return String(asset ?? '').trim().toUpperCase();
}
