import { randomUUID } from "node:crypto";
import {
  buildX402Challenge,
  defaultNonceReplayStore,
  DemoPaymentVerifier,
  parseX402PaymentHeader,
  SolanaReceiptVerifier,
  type NonceReplayStore,
  type ReceiptVerificationResult,
  type X402Challenge,
} from "@reddi/x402-solana";
import { Connection } from "@solana/web3.js";
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
    protocolFeeTreasury: env.X402_PROTOCOL_FEE_TREASURY || undefined,
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

export async function handleRuntimeRequest(request: Request, config = createRuntimeConfig(), client = createOpenRouterClient(config)): Promise<Response> {
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
    return toResponse(await handleAttestationEvaluation({ headers: request.headers, body, config, client, replayStore: defaultNonceReplayStore, endpointPath: "/v1/attestations" }));
  }
  if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
    const body = (await request.json().catch(() => ({}))) as ChatCompletionRequest;
    return toResponse(await handleChatCompletions({ headers: request.headers, body, config, client, replayStore: defaultNonceReplayStore }));
  }
  return toResponse({ status: 404, headers: JSON_HEADERS, body: { error: { code: "not_found" } } });
}

export function toResponse(runtimeResponse: RuntimeResponse): Response {
  return new Response(JSON.stringify(runtimeResponse.body), {
    status: runtimeResponse.status,
    headers: runtimeResponse.headers,
  });
}
