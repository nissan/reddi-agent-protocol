import { Connection } from "@solana/web3.js";
import {
  challengeFromX402RequestHeader,
  createSolanaDevnetUsdcPaymentClient,
  executeDevnetUsdcPayment,
  prepareDevnetUsdcPayment,
  type DevnetUsdcPaymentClient,
} from "@reddi/x402-solana";
import type { BridgeConfig } from "../config.js";
import { sha256Json } from "../hash.js";
import type { BridgeStore, X402SpecialistReceipt } from "../store.js";

export type PrepareX402SpecialistCallArgs = {
  x402RequestHeader: string;
  maxUsdcMicroUnits?: number;
};

export type ExecuteX402SpecialistCallArgs = {
  endpoint: string;
  body: Record<string, unknown>;
  idempotencyKey: string;
  maxUsdcMicroUnits: number;
  expectedPayTo?: string;
  approvalPhrase: "EXECUTE_DEVNET_X402_SPECIALIST_CALL";
};

export type FetchLike = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string }) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

function assertLiveSpecialistConfig(config: BridgeConfig) {
  if (config.policyMode !== "devnet") throw new Error("devnet_mode_not_enabled");
  if (!config.devnetProofApproved) throw new Error("devnet_x402_requires_RAP_MCP_DEVNET_PROOF_APPROVED=1");
  if (!config.allowSpecialistInvoke) throw new Error("specialist_invoke_requires_RAP_MCP_ALLOW_SPECIALIST_INVOKE=1");
  if (!config.devnetWalletKeypairPath) throw new Error("devnet_x402_requires_RAP_MCP_DEVNET_WALLET_KEYPAIR");
  if (!config.devnetUsdcMint) throw new Error("devnet_x402_requires_RAP_MCP_DEVNET_USDC_MINT");
  if (config.specialistEndpointAllowlist.length === 0) throw new Error("specialist_endpoint_allowlist_required");
}

function paymentConfig(config: BridgeConfig, maxUsdcMicroUnits?: number) {
  const devnetUsdcMint = config.devnetUsdcMint;
  const devnetWalletKeypairPath = config.devnetWalletKeypairPath;
  if (!devnetUsdcMint || !devnetWalletKeypairPath) throw new Error("devnet_x402_config_missing");
  return {
    rpcUrl: config.devnetRpcUrl,
    usdcMint: devnetUsdcMint,
    walletKeypairPath: devnetWalletKeypairPath,
    endpointAllowlist: config.specialistEndpointAllowlist,
    maxUsdcMicroUnits: Math.min(maxUsdcMicroUnits ?? config.devnetMaxUsdcMicroUnits, config.devnetMaxUsdcMicroUnits),
  };
}

export async function prepareX402SpecialistCall(args: PrepareX402SpecialistCallArgs, config: BridgeConfig, client?: DevnetUsdcPaymentClient) {
  assertLiveSpecialistConfig(config);
  const challenge = challengeFromX402RequestHeader(args.x402RequestHeader);
  const paymentClient = client ?? createSolanaDevnetUsdcPaymentClient(new Connection(config.devnetRpcUrl, "confirmed"));
  return prepareDevnetUsdcPayment({ challenge, config: paymentConfig(config, args.maxUsdcMicroUnits), client: paymentClient });
}

export function verifyX402SpecialistReceipt(args: { receiptId?: string; idempotencyKey?: string }, store: BridgeStore) {
  const receipt = args.receiptId
    ? store.getX402SpecialistReceipt(args.receiptId)
    : args.idempotencyKey
      ? store.getX402SpecialistReceiptByIdempotency(args.idempotencyKey)?.receipt
      : undefined;
  return {
    schemaVersion: "reddi.rap-mcp-bridge.x402-specialist-call-verification.v1",
    verified: Boolean(receipt && receipt.verification.specialistHttpCompletion === "pass"),
    boundary: "solana-devnet-only-no-mainnet",
    mainnetSettlement: "not_applicable",
    receipt: receipt ?? null,
  };
}

export async function executeX402SpecialistCall(args: ExecuteX402SpecialistCallArgs, config: BridgeConfig, store: BridgeStore, deps?: { client?: DevnetUsdcPaymentClient; fetch?: FetchLike }): Promise<X402SpecialistReceipt> {
  assertLiveSpecialistConfig(config);
  const requestBodyJson = JSON.stringify(args.body);
  const requestHash = sha256Json({ endpoint: args.endpoint, body: JSON.parse(requestBodyJson), maxUsdcMicroUnits: args.maxUsdcMicroUnits });
  const existing = store.getX402SpecialistReceiptByIdempotency(args.idempotencyKey);
  if (existing) {
    if (existing.requestHash !== requestHash) throw new Error("idempotency_key_conflict");
    const storedPayTo = String(existing.receipt.paymentReceipt.payTo ?? "");
    if (args.expectedPayTo && storedPayTo !== args.expectedPayTo) {
      throw new Error(`x402_stored_receipt_payee_mismatch:${storedPayTo}`);
    }
    return existing.receipt;
  }
  const fetcher = deps?.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetcher) throw new Error("fetch_unavailable");
  const body = requestBodyJson;
  const unpaid = await fetcher(args.endpoint, { method: "POST", headers: { "content-type": "application/json" }, body });
  if (unpaid.status !== 402) throw new Error(`expected_x402_challenge_status_402:${unpaid.status}`);
  const x402RequestHeader = unpaid.headers.get("x402-request");
  if (!x402RequestHeader) throw new Error("missing_x402_request_header");
  const challenge = challengeFromX402RequestHeader(x402RequestHeader);
  if (args.expectedPayTo && challenge.payTo !== args.expectedPayTo) {
    throw new Error(`x402_challenge_payee_mismatch:${challenge.payTo}`);
  }
  const paymentClient = deps?.client ?? createSolanaDevnetUsdcPaymentClient(new Connection(config.devnetRpcUrl, "confirmed"));
  const receipt = await executeDevnetUsdcPayment({ challenge, config: paymentConfig(config, args.maxUsdcMicroUnits), client: paymentClient, approvalPhrase: args.approvalPhrase });
  const paid = await fetcher(args.endpoint, { method: "POST", headers: { "content-type": "application/json", "x402-payment": JSON.stringify(receipt) }, body });
  if (paid.status !== 200) throw new Error(`specialist_paid_retry_failed:${paid.status}`);
  const responseText = await paid.text();
  const bridgeReceipt: X402SpecialistReceipt = {
    schemaVersion: "reddi.rap-mcp-bridge.x402-specialist-call-receipt.v1",
    receiptId: `x402_specialist_${sha256Json({ requestHash, signature: receipt.signature ?? receipt.txSignature }).slice("sha256:".length, "sha256:".length + 24)}`,
    createdAt: new Date().toISOString(),
    boundary: "solana-devnet-only-no-mainnet",
    endpoint: args.endpoint,
    requestHash,
    paymentReceipt: receipt as unknown as Record<string, unknown>,
    response: { status: 200, bodyHash: sha256Json({ responseText }), outputPreview: responseText.slice(0, 500) },
    verification: { specialistHttpCompletion: "pass", mainnetSettlement: "not_applicable" },
  };
  return store.upsertX402SpecialistReceipt(args.idempotencyKey, requestHash, bridgeReceipt);
}
