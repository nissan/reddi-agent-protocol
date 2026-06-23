import { z } from "zod";

export const MAX_TASK_CHARS = 8000;
export const MAX_SUMMARY_CHARS = 2000;
export const MAX_EVIDENCE_REFS = 32;
export const MAX_EVIDENCE_REF_CHARS = 512;
export const MAX_LEDGER_ENTRIES = 100;

export const payloadClassSchema = z.enum(["prompt_summary", "structured_json_summary"]);

export const discoverInputSchema = {
  task: z.string().min(1).max(MAX_TASK_CHARS),
  taskTypeHint: z.string().max(128).optional(),
  maxPerCallUsd: z.number().nonnegative().optional(),
  requireAttestation: z.boolean().optional(),
  limit: z.number().int().min(1).max(10).optional(),
};

export const requestQuoteInputSchema = {
  taskSummary: z.string().min(1).max(MAX_SUMMARY_CHARS),
  taskTypeHint: z.string().max(128).optional(),
  specialistWallet: z.string().max(128).optional(),
  capability: z.string().max(128).default("custom"),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/).default("0"),
  currency: z.string().max(12).default("USDC"),
  network: z.string().max(64).default("demo"),
  payloadClass: payloadClassSchema.default("prompt_summary"),
  evidenceRefs: z.array(z.string().max(MAX_EVIDENCE_REF_CHARS)).max(MAX_EVIDENCE_REFS).default([]),
  idempotencyKey: z.string().max(128).optional(),
};

export const verifyReceiptInputSchema = {
  quoteId: z.string().max(160).optional(),
  termsHash: z.string().max(160).optional(),
};

export const exportDisclosureLedgerInputSchema = {
  quoteIds: z.array(z.string().max(160)).max(MAX_LEDGER_ENTRIES).default([]),
  x402ReceiptIds: z.array(z.string().max(160)).max(MAX_LEDGER_ENTRIES).default([]),
};

export const prepareDevnetPaymentInputSchema = {
  quoteId: z.string().max(160),
  maxTotalDebitLamports: z.number().int().positive().max(10_000_000).optional(),
};

export const executeDevnetPaymentInputSchema = {
  quoteId: z.string().max(160),
  idempotencyKey: z.string().min(1).max(128),
  maxTotalDebitLamports: z.number().int().positive().max(10_000_000),
  approvalPhrase: z.literal("EXECUTE_DEVNET_RAP_PAYMENT"),
};

export const verifyDevnetReceiptInputSchema = {
  quoteId: z.string().max(160),
};

export const prepareX402SpecialistCallInputSchema = {
  x402RequestHeader: z.string().min(1).max(4096),
  maxUsdcMicroUnits: z.number().int().positive().max(1_000_000).optional(),
};

export const executeX402SpecialistCallInputSchema = {
  endpoint: z.string().url().max(512),
  body: z.record(z.unknown()),
  idempotencyKey: z.string().min(1).max(128),
  maxUsdcMicroUnits: z.number().int().positive().max(1_000_000),
  expectedPayTo: z.string().max(128).optional(),
  approvalPhrase: z.literal("EXECUTE_DEVNET_X402_SPECIALIST_CALL"),
};

export const verifyX402SpecialistReceiptInputSchema = {
  receiptId: z.string().max(160).optional(),
  idempotencyKey: z.string().max(128).optional(),
};

export type ReddiQuote = {
  schemaVersion: "reddi.quote.v1";
  quoteId: string;
  quoteStatus: "active";
  quoteAuthority: "bridge_synthetic";
  binding: false;
  createdAt: string;
  specialist: {
    walletAddress: string;
    capability: string;
  };
  task: {
    taskHash: string;
    taskSummaryHash: string;
    payloadClass: "prompt_summary" | "structured_json_summary";
  };
  terms: {
    amount: string;
    currency: string;
    network: string;
    requiredEvidence: string[];
  };
  termsHash: string;
};
