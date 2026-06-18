import { type ReddiPolicyDecision } from './policy.js';
export type ReddiReceiptAttestationStatus = 'not_requested' | 'pending' | 'attested' | 'failed' | 'rejected';
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
export type ReddiReceiptValidationErrorCode = 'malformed_receipt' | 'payment_proof_missing' | 'unsupported_network_asset' | 'credential_leakage_rejected';
export type ReddiReceiptValidationError = {
    code: ReddiReceiptValidationErrorCode;
    path: string;
    message: string;
};
export type ReddiReceiptValidationResult = {
    ok: true;
    receipt: ReddiReceipt;
} | {
    ok: false;
    errors: ReddiReceiptValidationError[];
};
export declare function createReddiReceipt(input: ReddiReceipt): ReddiReceipt;
export declare function validateReddiReceipt(input: unknown): ReddiReceiptValidationResult;
