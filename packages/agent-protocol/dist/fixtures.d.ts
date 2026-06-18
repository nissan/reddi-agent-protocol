import type { ReddiReceipt, ReddiReceiptValidationErrorCode } from './receipts.js';
export declare const reddiReceiptFixtures: Record<string, ReddiReceipt>;
export type ReddiReceiptFixtureCase = {
    description: string;
    receipt: unknown;
    expectedValid: boolean;
    expectedErrorCodes: ReddiReceiptValidationErrorCode[];
};
export declare const reddiReceiptFixtureCases: Record<string, ReddiReceiptFixtureCase>;
