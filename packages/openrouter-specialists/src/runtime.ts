import { createHash, randomUUID } from "node:crypto";
import {
  buildX402Challenge,
  decimalToBaseUnits,
  defaultNonceReplayStore,
  directPaymentCurrency,
  DemoPaymentVerifier,
  ESCROW_PROTOCOL_TREASURY,
  tokenCostBaseUnits,
  parseX402PaymentHeader,
  SolanaReceiptVerifier,
  type NonceReplayStore,
  type ReceiptVerificationResult,
  type X402Challenge,
} from "@reddi/x402-solana";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  estimateInputTokens,
  meteredOffer,
  meteredSettlement,
  meteredTerms,
  outputLimit,
  readMeteredPaymentHeader,
  usageFrom,
  verifyMeteredLock,
  type AccountReader,
  type SlotReader,
  type MeteredSettleSigner,
} from "./metered-payment.js";
import { buildAgentDependencyManifestDisclosure, buildAgenticWorkflowManifestDisclosure, buildDownstreamDisclosureLedger, buildNoDownstreamDisclosureLedger } from "./agentic-workflow-disclosure.js";
import { buildAttestationPromptEnvelope, evaluateAttestation, normalizeAttestationRequest } from "./attestation.js";
import { buildLiveDelegationAuditEnvelope } from "./delegation-audit.js";
import { evaluateDelegationBudget } from "./delegation-budget.js";
import { buildDisabledLiveDelegationExecutorEvidence, NoopLiveDelegationExecutor, type LiveDelegationExecutor } from "./delegation-executor.js";
import { buildLiveDelegationIntentPlan } from "./delegation-intent.js";
import { buildDryRunDelegationPlan, inferRequiredCapabilities } from "./marketplace-client.js";
import { getProfile, specialistProfiles, validateProfileRegistry } from "./profiles/index.js";
import { FetchOpenRouterClient, MockOpenRouterClient } from "./openrouter.js";
import type { AttestationRequest, ChatCompletionRequest, OpenRouterClient, RuntimeConfig, RuntimeResponse, SpecialistProfile } from "./types.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const PAYMENT_NETWORK = "solana-devnet" as const;

/** Reads X402_USDC_MINT, X402_AUDD_MINT, X402_PYUSD_MINT and X402_USDG_MINT. Unset currencies stay unaccepted. */
function paymentMintsFromEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const mints: Record<string, string> = {};
  for (const currency of ["USDC", "AUDD", "PYUSD", "USDG"]) {
    const value = env[`X402_${currency}_MINT`]?.trim();
    if (value) mints[currency] = value;
  }
  return mints;
}

export function createRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    profileId: env.SPECIALIST_PROFILE_ID ?? "planning-agent",
    endpointBaseUrl: env.PUBLIC_BASE_URL ?? "http://localhost:8787",
    openRouterApiKey: env.OPENROUTER_API_KEY,
    openRouterBaseUrl: env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    mockOpenRouter: env.OPENROUTER_MOCK === "1" || env.OPENROUTER_MOCK === "true",
    requirePayment: env.REQUIRE_X402_PAYMENT !== "false",
    allowDemoPayment: env.ALLOW_DEMO_X402_PAYMENT === "1" || env.ALLOW_DEMO_X402_PAYMENT === "true",
    allowRealPayment: env.ALLOW_REAL_X402_PAYMENT === "1" || env.ALLOW_REAL_X402_PAYMENT === "true",
    solanaRpcUrl: env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
    usdcDevnetMint: env.X402_USDC_DEVNET_MINT,
    paymentMints: paymentMintsFromEnv(env),
    protocolFeeTreasury: env.X402_PROTOCOL_FEE_TREASURY || undefined,
    meteredPrice:
      env.X402_INPUT_PER_MILLION && env.X402_OUTPUT_PER_MILLION
        ? {
            inputPerMillion: env.X402_INPUT_PER_MILLION,
            outputPerMillion: env.X402_OUTPUT_PER_MILLION,
            ...(env.X402_MAX_OUTPUT_TOKENS ? { maxOutputTokens: Number.parseInt(env.X402_MAX_OUTPUT_TOKENS, 10) } : {}),
          }
        : undefined,
    escrowProgramId: env.X402_ESCROW_PROGRAM_ID || undefined,
    enableAgentToAgentCalls: env.ENABLE_AGENT_TO_AGENT_CALLS === "1" || env.ENABLE_AGENT_TO_AGENT_CALLS === "true",
    enableLiveDelegationExecutor: env.ENABLE_LIVE_DELEGATION_EXECUTOR === "1" || env.ENABLE_LIVE_DELEGATION_EXECUTOR === "true",
    maxDownstreamCalls: env.MAX_DOWNSTREAM_CALLS ? Number.parseInt(env.MAX_DOWNSTREAM_CALLS, 10) : 0,
    maxDownstreamLamports: env.MAX_DOWNSTREAM_LAMPORTS ? Number.parseInt(env.MAX_DOWNSTREAM_LAMPORTS, 10) : 0,
  };
}

export function createOpenRouterClient(config: RuntimeConfig): OpenRouterClient {
  if (config.mockOpenRouter) return new MockOpenRouterClient();
  if (!config.openRouterApiKey) throw new Error("OPENROUTER_API_KEY is required when mock mode is disabled");
  return new FetchOpenRouterClient(config.openRouterApiKey, config.openRouterBaseUrl);
}

export function buildProfileChallenge(profile: SpecialistProfile, config: RuntimeConfig, nonce: string = randomUUID(), endpointPath = profile.endpointPath): X402Challenge {
  return buildX402Challenge({
    version: "1",
    network: PAYMENT_NETWORK,
    payTo: profile.walletAddress,
    amount: profile.price.amount,
    currency: profile.price.currency,
    endpoint: `${config.endpointBaseUrl}${endpointPath}`,
    nonce,
    memo: `reddi:${profile.id}:${endpointPath}`,
  }, config.protocolFeeTreasury ? { protocolFee: { treasury: config.protocolFeeTreasury } } : {});
}

function paymentRequired(challenge: X402Challenge): RuntimeResponse {
  return {
    status: 402,
    headers: {
      ...JSON_HEADERS,
      "x402-request": JSON.stringify(challenge),
    },
    body: {
      error: {
        code: "payment_required",
        message: "x402 payment is required before specialist execution.",
      },
      x402: challenge,
    },
  };
}

export function x402Challenge(profile: SpecialistProfile, config: RuntimeConfig, endpointPath = profile.endpointPath): RuntimeResponse {
  return paymentRequired(buildProfileChallenge(profile, config, randomUUID(), endpointPath));
}

export async function verifyPayment(input: {
  headers: Headers;
  profile: SpecialistProfile;
  config: RuntimeConfig;
  replayStore?: NonceReplayStore;
  endpointPath?: string;
}): Promise<ReceiptVerificationResult> {
  const value = input.headers.get("x402-payment") ?? input.headers.get("x-payment");
  if (!value) return { ok: false, reason: "invalid_receipt", message: "missing x402-payment header" };

  const parsed = parseX402PaymentHeader(value);
  const receiptNonce =
    typeof parsed === "string" && parsed.startsWith("demo:")
      ? parsed.slice("demo:".length)
      : parsed && typeof parsed === "object" && "nonce" in parsed && typeof (parsed as { nonce?: unknown }).nonce === "string"
        ? (parsed as { nonce: string }).nonce
        : randomUUID();
  if (!receiptNonce) return { ok: false, reason: "invalid_nonce", message: "x402 payment nonce is required" };
  const challenge = buildProfileChallenge(input.profile, input.config, receiptNonce, input.endpointPath);
  const demoResult = await new DemoPaymentVerifier(input.config.allowDemoPayment === true).verifyReceipt(parsed, challenge, input.replayStore);
  if (demoResult.ok || !input.config.allowRealPayment) return demoResult;

  const realVerifier = new SolanaReceiptVerifier({
    allowRealPayment: true,
    connection: new Connection(input.config.solanaRpcUrl ?? "https://api.devnet.solana.com"),
    usdcMint: input.config.usdcDevnetMint,
    mints: input.config.paymentMints,
    protocolFee: input.config.protocolFeeTreasury ? { treasury: input.config.protocolFeeTreasury } : undefined,
  });
  return realVerifier.verifyReceipt(parsed, challenge, input.replayStore);
}

export function marketplaceMetadata(profile: SpecialistProfile, config: RuntimeConfig): Record<string, unknown> {
  const dependencyDisclosure = buildAgentDependencyManifestDisclosure(profile);
  return {
    protocol: "reddi-agent-protocol",
    version: "0.1.0",
    profileId: profile.id,
    displayName: profile.displayName,
    description: profile.description,
    walletAddress: profile.walletAddress,
    endpoint: `${config.endpointBaseUrl}${profile.endpointPath}`,
    capabilities: profile.capabilities,
    roles: profile.roles,
    price: profile.price,
    safetyMode: profile.safetyMode,
    preferredAttestors: profile.preferredAttestors,
    model: profile.model,
    dependencyDisclosure,
    tools: dependencyDisclosure.tools,
    skills: dependencyDisclosure.skills,
    marketplaceAgentCalls: dependencyDisclosure.marketplaceAgentCalls,
    externalMcpServers: dependencyDisclosure.externalMcpServers,
    nonMarketplaceAgentCalls: dependencyDisclosure.nonMarketplaceAgentCalls,
    disclosurePolicy: dependencyDisclosure.disclosurePolicy,
    agenticWorkflowDisclosure: buildAgenticWorkflowManifestDisclosure(profile, config),
  };
}

export function modelsResponse(): RuntimeResponse {
  return {
    status: 200,
    headers: JSON_HEADERS,
    body: {
      object: "list",
      data: specialistProfiles.map((profile) => ({
        id: profile.id,
        object: "model",
        owned_by: "reddi",
        display_name: profile.displayName,
        openrouter_model: profile.model,
        capabilities: profile.capabilities,
      })),
    },
  };
}

export function tagsResponse(): RuntimeResponse {
  const tags = [...new Set(specialistProfiles.flatMap((profile) => profile.tags))].sort();
  return { status: 200, headers: JSON_HEADERS, body: { tags } };
}

export async function ensurePaid(input: {
  headers: Headers;
  profile: SpecialistProfile;
  config: RuntimeConfig;
  replayStore?: NonceReplayStore;
  endpointPath?: string;
}): Promise<RuntimeResponse | undefined> {
  if (!input.config.requirePayment) return undefined;
  const payment = await verifyPayment({ headers: input.headers, profile: input.profile, config: input.config, replayStore: input.replayStore, endpointPath: input.endpointPath });
  if (payment.ok) return undefined;
  const response = paymentRequired(buildProfileChallenge(input.profile, input.config, randomUUID(), input.endpointPath));
  response.body.error = {
    code: payment.reason === "invalid_receipt" ? "payment_required" : payment.reason,
    message: payment.message,
  };
  return response;
}

export function isAttestationMode(body: ChatCompletionRequest): boolean {
  return body.metadata?.mode === "attestation" || body.metadata?.attestation !== undefined;
}

export function isDelegationMode(body: ChatCompletionRequest): boolean {
  return body.metadata?.mode === "delegation_plan" || body.metadata?.mode === "delegation_dry_run" || body.metadata?.mode === "delegation_live" || body.metadata?.delegation !== undefined;
}

export async function handleDelegationPlanning(input: {
  headers: Headers;
  body: ChatCompletionRequest;
  config: RuntimeConfig;
  replayStore?: NonceReplayStore;
  liveDelegationExecutor?: LiveDelegationExecutor;
}): Promise<RuntimeResponse> {
  const profile = getProfile(input.config.profileId);
  if (!profile) return { status: 500, headers: JSON_HEADERS, body: { error: { code: "unknown_profile" } } };
  if (!profile.roles.includes("consumer")) {
    return { status: 403, headers: JSON_HEADERS, body: { error: { code: "profile_not_consumer", message: `${profile.id} cannot plan downstream marketplace delegation.` } } };
  }

  const unpaid = await ensurePaid({ headers: input.headers, profile, config: input.config, replayStore: input.replayStore });
  if (unpaid) return unpaid;

  const metadata = input.body.metadata ?? {};
  const delegation = typeof metadata.delegation === "object" && metadata.delegation !== null ? (metadata.delegation as Record<string, unknown>) : {};
  const task =
    typeof delegation.task === "string"
      ? delegation.task
      : input.body.messages
          ?.filter((message) => message.role === "user")
          .map((message) => message.content)
          .join("\n")
          .trim() || "";
  const explicitCapabilities = Array.isArray(delegation.requiredCapabilities) ? delegation.requiredCapabilities.filter((value): value is string => typeof value === "string") : [];
  const requiredCapabilities = explicitCapabilities.length > 0 ? explicitCapabilities : inferRequiredCapabilities(task);
  const maxCandidates = typeof delegation.maxCandidates === "number" && Number.isFinite(delegation.maxCandidates) ? Math.max(1, Math.floor(delegation.maxCandidates)) : 3;
  const dryRun = delegation.dryRun !== false && metadata.mode !== "delegation_live";
  if (!dryRun) {
    if (!input.config.enableAgentToAgentCalls) {
      return {
        status: 403,
        headers: JSON_HEADERS,
        body: {
          error: {
            code: "live_delegation_disabled",
            message: "Live agent-to-agent x402 calls are disabled until spend guards and operator approval are configured.",
          },
          reddi: {
            profileId: profile.id,
            liveCallsEnabled: false,
            downstreamCallsExecuted: 0,
            maxDownstreamCalls: input.config.maxDownstreamCalls ?? 0,
            maxDownstreamLamports: input.config.maxDownstreamLamports ?? 0,
          },
        },
      };
    }

    const budgetPolicy = typeof delegation.budgetPolicy === "object" && delegation.budgetPolicy !== null ? delegation.budgetPolicy : undefined;
    const budgetDecision = evaluateDelegationBudget({
      policy: budgetPolicy,
      estimatedLamports: budgetPolicy ? (typeof delegation.estimatedLamports === "number" ? delegation.estimatedLamports : Number.NaN) : 0,
      usage: typeof delegation.budgetUsage === "object" && delegation.budgetUsage !== null ? delegation.budgetUsage : undefined,
    });
    if (!budgetDecision.allowed) {
      return {
        status: 403,
        headers: JSON_HEADERS,
        body: {
          error: {
            code: budgetDecision.reason,
            message: budgetDecision.message,
            details: budgetDecision.details,
          },
          reddi: {
            profileId: profile.id,
            liveCallsEnabled: true,
            downstreamCallsExecuted: 0,
            maxDownstreamCalls: input.config.maxDownstreamCalls ?? 0,
            maxDownstreamLamports: input.config.maxDownstreamLamports ?? 0,
          },
        },
      };
    }

    const plan = await buildDryRunDelegationPlan({
      request: {
        task,
        requesterProfileId: profile.id,
        requiredCapabilities,
        maxCandidates,
      },
    });
    const intentPlan = buildLiveDelegationIntentPlan({
      requesterProfileId: profile.id,
      task,
      requiredCapabilities,
      selectedCandidate: plan.selectedCandidate,
      delegationPlan: plan,
      budget: budgetDecision,
      maxDownstreamCalls: input.config.maxDownstreamCalls ?? 0,
      maxDownstreamLamports: input.config.maxDownstreamLamports ?? 0,
    });
    const auditEnvelope = buildLiveDelegationAuditEnvelope(intentPlan);
    const executorEvidence = input.config.enableLiveDelegationExecutor
      ? await (input.liveDelegationExecutor ?? new NoopLiveDelegationExecutor()).execute({ intentPlan, auditEnvelope })
      : buildDisabledLiveDelegationExecutorEvidence({ intentPlan, auditEnvelope });
    const downstreamDisclosureLedger = buildDownstreamDisclosureLedger({ intentPlan, executorEvidence });

    return {
      status: 501,
      headers: JSON_HEADERS,
      body: {
        error: {
          code: "live_delegation_not_implemented",
          message: "Live agent-to-agent x402 calls are intentionally fail-closed until the guarded live-call iteration.",
        },
        reddi: {
          profileId: profile.id,
          liveCallsEnabled: true,
          downstreamCallsExecuted: 0,
          maxDownstreamCalls: input.config.maxDownstreamCalls ?? 0,
          maxDownstreamLamports: input.config.maxDownstreamLamports ?? 0,
          budget: budgetDecision,
          intentPlan,
          auditEnvelope,
          executorEvidence,
          downstreamDisclosureLedger,
        },
      },
    };
  }

  const plan = await buildDryRunDelegationPlan({
    request: {
      task,
      requesterProfileId: profile.id,
      requiredCapabilities,
      maxCandidates,
    },
  });
  const requestId = randomUUID();

  return {
    status: 200,
    headers: JSON_HEADERS,
    body: {
      object: "reddi.delegation.plan",
      plan,
      reddi: {
        profileId: profile.id,
        requestId,
        mode: "delegation_dry_run",
        paymentSatisfied: input.config.requirePayment,
        liveCallsEnabled: false,
        downstreamCallsExecuted: 0,
        requiredAttestor: plan.requiredAttestor,
        downstreamDisclosureLedger: buildNoDownstreamDisclosureLedger(),
      },
    },
  };
}

export async function handleAttestationEvaluation(input: {
  headers: Headers;
  body: AttestationRequest | ChatCompletionRequest | Record<string, unknown>;
  config: RuntimeConfig;
  client: OpenRouterClient;
  replayStore?: NonceReplayStore;
  endpointPath?: string;
}): Promise<RuntimeResponse> {
  const profile = getProfile(input.config.profileId);
  if (!profile) return { status: 500, headers: JSON_HEADERS, body: { error: { code: "unknown_profile" } } };
  if (!profile.roles.includes("attestor")) {
    return { status: 403, headers: JSON_HEADERS, body: { error: { code: "profile_not_attestor", message: `${profile.id} is not configured for attestation.` } } };
  }

  const unpaid = await ensurePaid({ headers: input.headers, profile, config: input.config, replayStore: input.replayStore, endpointPath: input.endpointPath ?? "/v1/attestations" });
  if (unpaid) return unpaid;

  const requestId = randomUUID();
  const attestationRequest = normalizeAttestationRequest(input.body);
  const promptEnvelope = buildAttestationPromptEnvelope(profile, attestationRequest);
  const reddi = {
    profileId: profile.id,
    requestId,
    model: profile.model,
    paymentSatisfied: input.config.requirePayment,
    safetyMode: profile.safetyMode,
    mockOpenRouter: input.config.mockOpenRouter,
    mode: "attestation",
    schemaVersion: promptEnvelope.schemaVersion,
    downstreamDisclosureLedger: buildNoDownstreamDisclosureLedger(),
  };
  const upstream = await input.client.createChatCompletion({
    model: profile.model,
    messages: promptEnvelope.messages,
    temperature: 0,
    max_tokens: 600,
    metadata: reddi,
  });
  return {
    status: 200,
    headers: JSON_HEADERS,
    body: {
      object: "reddi.attestation.verdict",
      verdictSource: "deterministic_local_evaluator",
      verdict: evaluateAttestation(attestationRequest, profile.id),
      promptEnvelope,
      upstream,
      reddi,
    },
  };
}

export async function handleChatCompletions(input: {
  headers: Headers;
  body: ChatCompletionRequest;
  config: RuntimeConfig;
  client: OpenRouterClient;
  replayStore?: NonceReplayStore;
}): Promise<RuntimeResponse> {
  if (isAttestationMode(input.body)) return handleAttestationEvaluation({ ...input, endpointPath: "/v1/chat/completions" });
  if (isDelegationMode(input.body)) return handleDelegationPlanning(input);

  const profile = getProfile(input.config.profileId);
  if (!profile) return { status: 500, headers: JSON_HEADERS, body: { error: { code: "unknown_profile" } } };

  const unpaid = await ensurePaid({ headers: input.headers, profile, config: input.config, replayStore: input.replayStore });
  if (unpaid) return unpaid;

  const requestId = randomUUID();
  const messages = input.body.messages ?? [];
  const guardedMessages = [{ role: "system" as const, content: profile.systemPrompt }, ...messages.filter((m) => m.role !== "system")];
  const reddi = {
    profileId: profile.id,
    requestId,
    model: profile.model,
    paymentSatisfied: input.config.requirePayment,
    safetyMode: profile.safetyMode,
    mockOpenRouter: input.config.mockOpenRouter,
    downstreamDisclosureLedger: buildNoDownstreamDisclosureLedger(),
  };
  const upstream = await input.client.createChatCompletion({
    model: profile.model,
    messages: guardedMessages,
    temperature: input.body.temperature,
    max_tokens: input.body.max_tokens,
    metadata: reddi,
  });
  return {
    status: 200,
    headers: JSON_HEADERS,
    body: {
      ...upstream,
      reddi,
    },
  };
}

/** True for the error a durable replay store raises when it cannot answer. */
function isReplayStoreFailure(error: unknown): boolean {
  return error instanceof Error && /^replay store /.test(error.message);
}

const REPLAY_UNAVAILABLE: RuntimeResponse = {
  status: 503,
  headers: JSON_HEADERS,
  // Nothing was accepted or recorded, so the same receipt can be presented again.
  body: { error: { code: "payment_check_unavailable", message: "The payment could not be checked right now. Nothing was accepted; present the same receipt again." } },
};

/** Response header that carries the provider's signed receipt, as base64url JSON. */
export const PROVIDER_RECEIPT_HEADER = "x-reddi-provider-receipt";
export const REDDI_RECEIPT_V2_VERSION = "reddi.receipt.v2" as const;
const MAX_PROVIDER_RECEIPT_HEADER_CHARS = 4096;
const TX_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const WALLET_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * What this provider states about one paid call. Same shape as
 * `ReddiReceiptV2` in `@reddi/agent-protocol`. The model is the one
 * this runtime is configured to call: a declaration, not proof of execution.
 */
export interface ProviderReceiptStatement {
  schemaVersion: typeof REDDI_RECEIPT_V2_VERSION;
  providerId: string;
  declaredModel: string;
  requestHash: string;
  responseHash: string;
  payment: {
    network: typeof PAYMENT_NETWORK;
    txSignature: string;
    currency: string;
    /** Absent for SOL. */
    mint?: string;
    /** Listed price in the currency's smallest unit. */
    amount: string;
    fee: { amount: string; treasury?: string };
    /** Present when the payment named its payer, which the payment check then matched to the transaction. */
    payer?: string;
    /** `direct` names the buyer's transfer; `metered-escrow` names the provider's settle transaction. */
    settlement: "direct" | "metered-escrow";
    /** On a metered call: the tokens the model reported, the locked maximum and what went back to the buyer, in base units. */
    metered?: { inputTokens: string; outputTokens: string; maxAmount: string; refunded: string };
  };
  issuedAt: string;
}

export interface RuntimeDeps {
  /** Where accepted payments are remembered. Defaults to the in-memory store. */
  replayStore?: NonceReplayStore;
  /**
   * Signs a receipt statement with the provider wallet's key and returns the
   * signed receipt (`signReddiReceiptV2` from `@reddi/agent-protocol`
   * does this). The key stays with the operator; this runtime never reads one.
   * When absent, no receipt is issued.
   */
  signProviderReceipt?: (statement: ProviderReceiptStatement) => Promise<unknown> | unknown;
  /**
   * Signs a metered escrow's settle instruction with the provider wallet's
   * key, sends it and returns the confirmed signature. The key stays with the
   * operator. When absent, metered payment is not offered.
   */
  settleMeteredEscrow?: MeteredSettleSigner;
  /** Reads chain accounts for a metered lock. Defaults to the configured RPC. */
  readAccount?: AccountReader;
  /** Reads the current slot for a metered lock. Defaults to the configured RPC. */
  readSlot?: SlotReader;
  now?: () => Date;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

/**
 * The transaction a real, verified payment was made with. Undefined whenever
 * demo payments are possible, so a receipt never names an unchecked transaction.
 */
function verifiedPaymentReference(headers: Headers, config: RuntimeConfig): { txSignature: string; payer?: string } | undefined {
  if (!config.requirePayment || !config.allowRealPayment || config.allowDemoPayment) return undefined;
  const value = headers.get("x402-payment") ?? headers.get("x-payment");
  if (!value) return undefined;
  const parsed = parseX402PaymentHeader(value);
  if (!parsed || typeof parsed !== "object") return undefined;
  const receipt = parsed as { signature?: unknown; txSignature?: unknown; payer?: unknown };
  const signature = typeof receipt.signature === "string" ? receipt.signature : typeof receipt.txSignature === "string" ? receipt.txSignature : "";
  if (!TX_SIGNATURE.test(signature)) return undefined;
  return typeof receipt.payer === "string" && WALLET_ADDRESS.test(receipt.payer) ? { txSignature: signature, payer: receipt.payer } : { txSignature: signature };
}

/**
 * What this provider charges for a call, from its own configuration: the
 * listed price, the mint it accepts for that currency and the protocol fee.
 * Undefined when any part is missing, so a receipt never states a guess.
 */
function statedPaymentTerms(profile: SpecialistProfile, config: RuntimeConfig): Pick<ProviderReceiptStatement["payment"], "currency" | "mint" | "amount" | "fee"> | undefined {
  const challenge = buildProfileChallenge(profile, config);
  const currency = directPaymentCurrency(challenge.currency);
  if (!currency) return undefined;
  const amount = decimalToBaseUnits(challenge.amount, currency.decimals);
  if (amount === undefined || amount <= BigInt(0)) return undefined;
  const isToken = currency.tokenProgram !== undefined;
  const mint = isToken ? config.paymentMints?.[challenge.currency] ?? (challenge.currency === "USDC" ? config.usdcDevnetMint : undefined) : undefined;
  if (isToken && !mint) return undefined;
  let fee: ProviderReceiptStatement["payment"]["fee"] = { amount: "0" };
  if (challenge.fee) {
    const feeUnits = decimalToBaseUnits(challenge.fee.amount, currency.decimals);
    if (feeUnits === undefined) return undefined;
    fee = feeUnits > BigInt(0) ? { amount: feeUnits.toString(), treasury: challenge.fee.payTo } : { amount: "0" };
  }
  return { currency: challenge.currency, ...(mint ? { mint } : {}), amount: amount.toString(), fee };
}

/**
 * Builds the receipt header for a delivered, paid call. Any failure yields no
 * header: the buyer still gets the answer they paid for.
 */
export async function buildProviderReceiptHeader(input: {
  headers: Headers;
  config: RuntimeConfig;
  profile: SpecialistProfile;
  requestText: string;
  responseText: string;
  deps: RuntimeDeps;
}): Promise<string | undefined> {
  if (!input.deps.signProviderReceipt) return undefined;
  const paid = verifiedPaymentReference(input.headers, input.config);
  if (!paid) return undefined;
  try {
    const terms = statedPaymentTerms(input.profile, input.config);
    if (!terms) return undefined;
    const signed = await input.deps.signProviderReceipt({
      schemaVersion: REDDI_RECEIPT_V2_VERSION,
      providerId: input.profile.walletAddress,
      declaredModel: input.profile.model,
      requestHash: sha256Hex(input.requestText),
      responseHash: sha256Hex(input.responseText),
      payment: { network: PAYMENT_NETWORK, txSignature: paid.txSignature, ...terms, ...(paid.payer ? { payer: paid.payer } : {}), settlement: "direct" },
      issuedAt: (input.deps.now?.() ?? new Date()).toISOString(),
    });
    if (!signed || typeof signed !== "object") return undefined;
    const header = Buffer.from(JSON.stringify(signed), "utf8").toString("base64url");
    return header.length <= MAX_PROVIDER_RECEIPT_HEADER_CHARS ? header : undefined;
  } catch {
    return undefined;
  }
}

export async function handleRuntimeRequest(request: Request, config = createRuntimeConfig(), client = createOpenRouterClient(config), deps: RuntimeDeps = {}): Promise<Response> {
  const replayStore = deps.replayStore ?? defaultNonceReplayStore;
  const url = new URL(request.url);
  const profile = getProfile(config.profileId);
  if (!profile) return toResponse({ status: 500, headers: JSON_HEADERS, body: { error: { code: "unknown_profile" } } });

  if (request.method === "GET" && url.pathname === "/healthz") {
    const registryErrors = validateProfileRegistry();
    return toResponse({ status: registryErrors.length ? 500 : 200, headers: JSON_HEADERS, body: { ok: registryErrors.length === 0, profileId: profile.id, registryErrors } });
  }
  if (request.method === "GET" && url.pathname === "/x402/health") {
    return toResponse({ status: 200, headers: JSON_HEADERS, body: { ok: true, failClosed: config.requirePayment, network: PAYMENT_NETWORK, demoPaymentsEnabled: config.allowDemoPayment === true } });
  }
  if (request.method === "GET" && url.pathname === "/v1/models") return toResponse(modelsResponse());
  if (request.method === "GET" && url.pathname === "/api/tags") return toResponse(tagsResponse());
  if (request.method === "GET" && url.pathname === "/.well-known/reddi-agent.json") return toResponse({ status: 200, headers: JSON_HEADERS, body: marketplaceMetadata(profile, config) });
  if (request.method === "POST" && url.pathname === "/v1/attestations") {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      return toResponse(await handleAttestationEvaluation({ headers: request.headers, body, config, client, replayStore, endpointPath: "/v1/attestations" }));
    } catch (error) {
      if (isReplayStoreFailure(error)) return toResponse(REPLAY_UNAVAILABLE);
      throw error;
    }
  }
  if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
    const requestText = await request.text().catch(() => "");
    let body: ChatCompletionRequest = {} as ChatCompletionRequest;
    try {
      const parsed: unknown = JSON.parse(requestText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as ChatCompletionRequest;
    } catch {
      // An unreadable body is handled as an empty request, as before.
    }
    try {
      if (readMeteredPaymentHeader(request.headers) !== undefined) {
        return await handleMeteredChatCompletion({ headers: request.headers, body, config, client, replayStore, deps, requestText, profile });
      }
      const result = await handleChatCompletions({ headers: request.headers, body, config, client, replayStore });
      if (result.status === 402) {
        const terms = deps.settleMeteredEscrow && config.allowRealPayment ? meteredTerms(profile, config) : undefined;
        if (terms) result.body.metered = meteredOffer(terms, body.messages ?? [], body.max_tokens);
      }
      if (result.status !== 200) return toResponse(result);
      // The receipt names the exact bytes sent, so the body is serialised once and reused.
      const responseText = JSON.stringify(result.body);
      const receipt = await buildProviderReceiptHeader({ headers: request.headers, config, profile, requestText, responseText, deps });
      return new Response(responseText, { status: 200, headers: receipt ? { ...result.headers, [PROVIDER_RECEIPT_HEADER]: receipt } : result.headers });
    } catch (error) {
      if (isReplayStoreFailure(error)) return toResponse(REPLAY_UNAVAILABLE);
      throw error;
    }
  }
  return toResponse({ status: 404, headers: JSON_HEADERS, body: { error: { code: "not_found" } } });
}

/**
 * A chat call paid with a metered token escrow: verify the lock, run the
 * call, settle the actual tokens, then answer with a receipt naming the settle.
 */
async function handleMeteredChatCompletion(input: {
  headers: Headers;
  body: ChatCompletionRequest;
  config: RuntimeConfig;
  client: OpenRouterClient;
  replayStore: NonceReplayStore;
  deps: RuntimeDeps;
  requestText: string;
  profile: SpecialistProfile;
}): Promise<Response> {
  const { config, profile, deps, body } = input;
  const refuse = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
    toResponse({ status, headers: JSON_HEADERS, body: { error: { code, message }, ...extra } });
  if (isAttestationMode(body) || isDelegationMode(body)) return refuse(400, "metered_not_supported", "Metered payment is for chat calls only.");
  const terms = config.requirePayment && config.allowRealPayment && deps.settleMeteredEscrow ? meteredTerms(profile, config) : undefined;
  if (!terms || !deps.settleMeteredEscrow) return refuse(402, "metered_not_offered", "This provider does not take metered payment. Nothing was taken; cancel the lock for a refund.");
  const header = readMeteredPaymentHeader(input.headers);
  if (!header || "error" in header) return refuse(402, "invalid_receipt", header && "error" in header ? header.error : "Unreadable metered payment.");
  const messages = body.messages ?? [];
  const outputTokens = outputLimit(terms, body.max_tokens);
  const inputEstimate = estimateInputTokens(messages);
  const minimum = tokenCostBaseUnits(terms.price, { inputTokens: inputEstimate, outputTokens });
  const connection = new Connection(config.solanaRpcUrl ?? "https://api.devnet.solana.com", "confirmed");
  const readAccount: AccountReader =
    deps.readAccount ??
    (async (address: PublicKey) => {
      const info = await connection.getAccountInfo(address, "confirmed");
      return info ? { owner: info.owner, data: new Uint8Array(info.data) } : null;
    });
  const readSlot: SlotReader = deps.readSlot ?? (() => connection.getSlot("confirmed"));
  const lock = await verifyMeteredLock({ header, terms, minimum, readAccount, readSlot, replayStore: input.replayStore });
  if (!lock.ok) {
    return refuse(lock.reason === "payment_check_unavailable" ? 503 : lock.reason === "duplicate_nonce" ? 409 : 402, lock.reason, lock.message, { metered: meteredOffer(terms, messages, body.max_tokens) });
  }

  const requestId = randomUUID();
  const guardedMessages = [{ role: "system" as const, content: profile.systemPrompt }, ...messages.filter((m) => m.role !== "system")];
  const reddi: Record<string, unknown> = {
    profileId: profile.id,
    requestId,
    model: profile.model,
    paymentSatisfied: true,
    safetyMode: profile.safetyMode,
    mockOpenRouter: config.mockOpenRouter,
    downstreamDisclosureLedger: buildNoDownstreamDisclosureLedger(),
  };
  const upstream = await input.client.createChatCompletion({ model: profile.model, messages: guardedMessages, temperature: body.temperature, max_tokens: outputTokens, metadata: reddi });
  const usage = usageFrom(upstream, inputEstimate);
  let settled: ReturnType<typeof meteredSettlement>;
  let settleSignature: string;
  try {
    settled = meteredSettlement(terms, lock, usage);
    settleSignature = await deps.settleMeteredEscrow(settled.instruction);
  } catch {
    return refuse(502, "settle_failed", `The settle could not be sent. Nothing was charged; your maximum stays locked in escrow ${header.escrow.toBase58()} and can be cancelled for a full refund once the cancel window opens.`, { charged: false, escrow: header.escrow.toBase58() });
  }
  const s = settled.settlement;
  reddi.metered = { inputTokens: s.inputTokens, outputTokens: s.outputTokens, currency: s.currency, charged: s.charged, fee: s.fee, provider: s.provider, refund: s.refund, capped: s.capped, settleSignature };
  const responseText = JSON.stringify({ ...upstream, reddi });

  let receiptHeader: string | undefined;
  if (deps.signProviderReceipt) {
    try {
      const decimals = directPaymentCurrency(s.currency)!.decimals;
      const fee = decimalToBaseUnits(s.fee, decimals) ?? BigInt(0);
      const refunded = decimalToBaseUnits(s.refund, decimals) ?? BigInt(0);
      const signed = await deps.signProviderReceipt({
        schemaVersion: REDDI_RECEIPT_V2_VERSION,
        providerId: profile.walletAddress,
        declaredModel: profile.model,
        requestHash: sha256Hex(input.requestText),
        responseHash: sha256Hex(responseText),
        payment: {
          network: PAYMENT_NETWORK,
          txSignature: settleSignature,
          currency: s.currency,
          mint: terms.mint.toBase58(),
          amount: s.chargedBaseUnits.toString(),
          fee: fee > BigInt(0) ? { amount: fee.toString(), treasury: ESCROW_PROTOCOL_TREASURY.toBase58() } : { amount: "0" },
          payer: lock.payer.toBase58(),
          settlement: "metered-escrow",
          metered: { inputTokens: String(s.inputTokens), outputTokens: String(s.outputTokens), maxAmount: lock.maxBaseUnits.toString(), refunded: refunded.toString() },
        },
        issuedAt: (deps.now?.() ?? new Date()).toISOString(),
      });
      if (signed && typeof signed === "object") {
        const encoded = Buffer.from(JSON.stringify(signed), "utf8").toString("base64url");
        if (encoded.length <= MAX_PROVIDER_RECEIPT_HEADER_CHARS) receiptHeader = encoded;
      }
    } catch {
      // The buyer still gets the answer the settle paid for.
    }
  }
  return new Response(responseText, { status: 200, headers: receiptHeader ? { ...JSON_HEADERS, [PROVIDER_RECEIPT_HEADER]: receiptHeader } : JSON_HEADERS });
}

export function toResponse(runtimeResponse: RuntimeResponse): Response {
  return new Response(JSON.stringify(runtimeResponse.body), {
    status: runtimeResponse.status,
    headers: runtimeResponse.headers,
  });
}
