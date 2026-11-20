import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../src/delegation-audit.js";
import { MockOpenRouterClient } from "../src/openrouter.js";
import { getProfile, specialistProfiles, validateProfileRegistry } from "../src/profiles/index.js";
import {
  buildDryRunDelegationPlan,
  buildDeploymentReadinessReport,
  candidatesFromWalletManifest,
  createRuntimeConfig,
  evaluateAttestation,
  handleAttestationEvaluation,
  handleChatCompletions,
  handleDelegationPlanning,
  handleRuntimeRequest,
  marketplaceMetadata,
  ManifestMarketplaceDiscoveryClient,
  rankMarketplaceCandidates,
  type WalletManifest,
  type LiveDelegationExecutor,
  type LiveDelegationExecutorInput,
  type RuntimeConfig,
} from "../src/index.js";

const config: RuntimeConfig = {
  profileId: "planning-agent",
  endpointBaseUrl: "https://planning.example.test",
  openRouterBaseUrl: "https://openrouter.ai/api/v1",
  mockOpenRouter: true,
  requirePayment: true,
  allowDemoPayment: false,
};

const walletManifest = JSON.parse(readFileSync(join(process.cwd(), "public/wallet-manifest.json"), "utf8")) as WalletManifest;

test("profile registry has all 30 unique valid profiles with required marketplace metadata", () => {
  assert.deepEqual(validateProfileRegistry(), []);
  assert.equal(specialistProfiles.length, 30);
  assert.deepEqual(
    specialistProfiles.slice(0, 5).map((profile) => profile.id),
    ["planning-agent", "document-intelligence-agent", "verification-validation-agent", "code-generation-agent", "conversational-agent"],
  );
  assert.deepEqual(
    specialistProfiles.map((profile) => profile.id).sort(),
    [
      "agentic-workflow-system",
      "audio-processing-agent",
      "autonomous-decision-agent",
      "code-generation-agent",
      "collective-intelligence-agent",
      "content-creation-agent",
      "conversational-agent",
      "data-analysis-agent",
      "document-intelligence-agent",
      "domain-transforming-integration-agent",
      "education-intelligence-agent",
      "embodied-intelligence-agent",
      "ethical-reasoning-agent",
      "explainable-agent",
      "financial-advisory-agent",
      "general-problem-solver-agent",
      "healthcare-intelligence-agent",
      "knowledge-retrieval-agent",
      "legal-intelligence-agent",
      "memory-augmented-agent",
      "physical-world-sensing-agent",
      "planning-agent",
      "recommendation-agent",
      "scientific-discovery-agent",
      "scientific-research-agent",
      "security-hardened-agent",
      "self-improving-agent",
      "tool-using-agent",
      "verification-validation-agent",
      "vision-language-agent",
    ],
  );
  for (const attestorId of ["verification-validation-agent", "security-hardened-agent", "ethical-reasoning-agent", "explainable-agent"]) {
    assert.ok(getProfile(attestorId)?.roles.includes("attestor"), `${attestorId} must be attestor-capable`);
  }
  const profileIds = new Set(specialistProfiles.map((profile) => profile.id));
  const attestorIds = new Set(specialistProfiles.filter((profile) => profile.roles.includes("attestor")).map((profile) => profile.id));
  for (const profile of specialistProfiles) {
    for (const attestorId of profile.preferredAttestors) {
      assert.ok(profileIds.has(attestorId), `${profile.id} references unknown attestor ${attestorId}`);
      assert.ok(attestorIds.has(attestorId), `${profile.id} references non-attestor profile ${attestorId}`);
    }
  }
});

test("OpenRouter mock mode is explicit opt-in only", () => {
  assert.equal(createRuntimeConfig({}).mockOpenRouter, false);
  assert.equal(createRuntimeConfig({ OPENROUTER_MOCK: "true" }).mockOpenRouter, true);
  assert.equal(createRuntimeConfig({}).enableAgentToAgentCalls, false);
  assert.equal(createRuntimeConfig({}).enableLiveDelegationExecutor, false);
  assert.equal(createRuntimeConfig({ ENABLE_AGENT_TO_AGENT_CALLS: "true", MAX_DOWNSTREAM_CALLS: "2", MAX_DOWNSTREAM_LAMPORTS: "5000" }).enableAgentToAgentCalls, true);
  assert.equal(createRuntimeConfig({ ENABLE_LIVE_DELEGATION_EXECUTOR: "true" }).enableLiveDelegationExecutor, true);
  assert.equal(createRuntimeConfig({ ENABLE_AGENT_TO_AGENT_CALLS: "true", MAX_DOWNSTREAM_CALLS: "2", MAX_DOWNSTREAM_LAMPORTS: "5000" }).maxDownstreamCalls, 2);
});

test("unpaid completion returns 402 challenge before OpenRouter client call", async () => {
  const client = new MockOpenRouterClient();
  const response = await handleChatCompletions({
    headers: new Headers(),
    body: { messages: [{ role: "user", content: "Build a plan" }] },
    config,
    client,
  });

  assert.equal(response.status, 402);
  assert.equal(client.callCount, 0);
  assert.ok(response.headers["x402-request"]);
  assert.equal((response.body.error as { code: string }).code, "payment_required");
});

test("demo payment remains fail-closed without explicit ALLOW_DEMO_X402_PAYMENT", async () => {
  const client = new MockOpenRouterClient();
  const response = await handleChatCompletions({
    headers: new Headers({ "x402-payment": "demo:paid" }),
    body: { messages: [{ role: "user", content: "Build a plan" }] },
    config,
    client,
  });

  assert.equal(response.status, 402);
  assert.equal(client.callCount, 0);
  assert.equal((response.body.error as { code: string }).code, "demo_payment_disabled");
});

test("paid completion invokes OpenRouter mock with explicit demo flag, profile guardrails, and Reddi metadata", async () => {
  const client = new MockOpenRouterClient();
  const demoConfig = { ...config, allowDemoPayment: true };
  const profile = getProfile("planning-agent");
  assert.ok(profile);
  const response = await handleChatCompletions({
    headers: new Headers({ "x402-payment": "demo:nonce-paid-1" }),
    body: { messages: [{ role: "user", content: "Build a plan" }] },
    config: demoConfig,
    client,
  });

  assert.equal(response.status, 200);
  assert.equal(client.callCount, 1);
  assert.equal(client.lastRequest?.model, getProfile("planning-agent")?.model);
  assert.equal(client.lastRequest?.messages[0]?.role, "system");
  assert.equal(client.lastRequest?.messages[0]?.content, getProfile("planning-agent")?.systemPrompt);
  assert.deepEqual(response.body.reddi, {
    profileId: "planning-agent",
    requestId: (response.body.reddi as { requestId: string }).requestId,
    model: getProfile("planning-agent")?.model,
    paymentSatisfied: true,
    safetyMode: "standard",
    mockOpenRouter: true,
    downstreamDisclosureLedger: (response.body.reddi as { downstreamDisclosureLedger: unknown }).downstreamDisclosureLedger,
  });
  const noDownstreamLedger = (response.body.reddi as { downstreamDisclosureLedger: { disclosureScope: string; entries: unknown[] } }).downstreamDisclosureLedger;
  assert.equal(noDownstreamLedger.disclosureScope, "no_downstream_calls");
  assert.deepEqual(noDownstreamLedger.entries, []);
  assert.match((response.body.reddi as { requestId: string }).requestId, /^[0-9a-f-]{36}$/);
});

test("HTTP runtime rejects duplicate demo receipt nonces", async () => {
  const client = new MockOpenRouterClient();
  const demoConfig = { ...config, allowDemoPayment: true };
  const request = () =>
    new Request("https://planning.example.test/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "x402-payment": "demo:nonce-http-replay-1" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    });

  const first = await handleRuntimeRequest(request(), demoConfig, client);
  const second = await handleRuntimeRequest(request(), demoConfig, client);

  assert.equal(first.status, 200);
  assert.equal(second.status, 402);
  const body = (await second.json()) as { error: { code: string } };
  assert.equal(body.error.code, "duplicate_nonce");
});

test("empty demo receipt nonce returns controlled 402", async () => {
  const client = new MockOpenRouterClient();
  const response = await handleChatCompletions({
    headers: new Headers({ "x402-payment": "demo:" }),
    body: { messages: [{ role: "user", content: "Build a plan" }] },
    config: { ...config, allowDemoPayment: true },
    client,
  });

  assert.equal(response.status, 402);
  assert.equal(client.callCount, 0);
  assert.equal((response.body.error as { code: string }).code, "invalid_nonce");
});

test("caller-authored structured demo receipts are rejected", async () => {
  const client = new MockOpenRouterClient();
  const profile = getProfile("planning-agent");
  assert.ok(profile);
  const response = await handleChatCompletions({
    headers: new Headers({
      "x402-payment": JSON.stringify({
        demo: true,
        network: "solana-devnet",
        payTo: profile.walletAddress,
        amount: profile.price.amount,
        currency: profile.price.currency,
        nonce: "nonce-structured-demo",
      }),
    }),
    body: { messages: [{ role: "user", content: "Build a plan" }] },
    config: { ...config, allowDemoPayment: true },
    client,
  });

  assert.equal(response.status, 402);
  assert.equal(client.callCount, 0);
  assert.equal((response.body.error as { code: string }).code, "payment_required");

  const tokenResponse = await handleChatCompletions({
    headers: new Headers({
      "x402-payment": JSON.stringify({ demo: true, token: "demo:nonce-structured-token", nonce: "nonce-structured-token" }),
    }),
    body: { messages: [{ role: "user", content: "Build a plan" }] },
    config: { ...config, allowDemoPayment: true },
    client,
  });

  assert.equal(tokenResponse.status, 402);
  assert.equal(client.callCount, 0);
  assert.equal((tokenResponse.body.error as { code: string }).code, "payment_required");
});

test("well-known metadata includes RAP marketplace fields", async () => {
  const profile = getProfile("planning-agent");
  assert.ok(profile);
  const metadata = marketplaceMetadata(profile, config) as Record<string, unknown>;

  for (const field of ["profileId", "displayName", "walletAddress", "endpoint", "capabilities", "roles", "price", "safetyMode", "preferredAttestors", "dependencyDisclosure", "tools", "skills", "marketplaceAgentCalls", "externalMcpServers", "nonMarketplaceAgentCalls", "disclosurePolicy"]) {
    assert.ok(metadata[field], `missing ${field}`);
  }
  assert.equal(metadata.profileId, "planning-agent");
  assert.equal(metadata.endpoint, "https://planning.example.test/v1/chat/completions");
  const dependencyDisclosure = metadata.dependencyDisclosure as {
    schemaVersion: string;
    tools: string[];
    skills: string[];
    marketplaceAgentCalls: string[];
    externalMcpServers: string[];
    nonMarketplaceAgentCalls: string[];
    disclosurePolicy: string;
  };
  assert.equal(dependencyDisclosure.schemaVersion, "reddi.agent-dependency-manifest.v1");
  assert.ok(dependencyDisclosure.tools.includes("chat_completion"));
  assert.ok(dependencyDisclosure.tools.includes("marketplace_discovery"));
  assert.ok(dependencyDisclosure.tools.includes("x402_specialist_call"));
  assert.ok(dependencyDisclosure.skills.includes("planning"));
  assert.ok(dependencyDisclosure.marketplaceAgentCalls.includes("verification-validation-agent"));
  assert.ok(dependencyDisclosure.nonMarketplaceAgentCalls.includes("openrouter:openai/gpt-4.1-mini"));
  assert.match(dependencyDisclosure.disclosurePolicy, /downstream-disclosure-ledger/);
  assert.deepEqual(metadata.tools, dependencyDisclosure.tools);
  assert.deepEqual(metadata.skills, dependencyDisclosure.skills);
  assert.deepEqual(metadata.marketplaceAgentCalls, dependencyDisclosure.marketplaceAgentCalls);
  assert.deepEqual(metadata.externalMcpServers, dependencyDisclosure.externalMcpServers);
  assert.deepEqual(metadata.nonMarketplaceAgentCalls, dependencyDisclosure.nonMarketplaceAgentCalls);
  assert.equal(metadata.disclosurePolicy, dependencyDisclosure.disclosurePolicy);
  const disclosure = metadata.agenticWorkflowDisclosure as {
    schemaVersion: string;
    mayCallMarketplaceAgents: boolean;
    disclosureRequiredBeforePurchase: boolean;
    expectedDownstreamCapabilities: string[];
    budgetPolicy: { spendGuardRequired: boolean; liveCallsEnabled: boolean };
    payloadDisclosurePolicy: { mustDiscloseCalledAgentIdentity: boolean; mustDisclosePayloadSummaryOrHash: boolean; mustDisclosePaymentEvidence: boolean; mustDiscloseAttestationLinks: boolean; returnedValueAddMayBeObfuscatedForMoatProtection: boolean; obfuscationReasonRequired: boolean };
  };
  assert.equal(disclosure.schemaVersion, "reddi.agentic-workflow-disclosure.v1");
  assert.equal(disclosure.mayCallMarketplaceAgents, true);
  assert.equal(disclosure.disclosureRequiredBeforePurchase, true);
  assert.ok(disclosure.expectedDownstreamCapabilities.includes("marketplace-discovery"));
  assert.equal(disclosure.budgetPolicy.spendGuardRequired, true);
  assert.equal(disclosure.budgetPolicy.liveCallsEnabled, false);
  assert.equal(disclosure.payloadDisclosurePolicy.mustDiscloseCalledAgentIdentity, true);
  assert.equal(disclosure.payloadDisclosurePolicy.mustDisclosePayloadSummaryOrHash, true);
  assert.equal(disclosure.payloadDisclosurePolicy.mustDisclosePaymentEvidence, true);
  assert.equal(disclosure.payloadDisclosurePolicy.mustDiscloseAttestationLinks, true);
  assert.equal(disclosure.payloadDisclosurePolicy.returnedValueAddMayBeObfuscatedForMoatProtection, true);
  assert.equal(disclosure.payloadDisclosurePolicy.obfuscationReasonRequired, true);
});

test("attestor route returns structured release verdict for sample specialist output and receipt chain", async () => {
  const client = new MockOpenRouterClient();
  const response = await handleAttestationEvaluation({
    headers: new Headers({ "x402-payment": "demo:attestation-release-1" }),
    body: {
      mode: "attestation",
      subjectProfileId: "planning-agent",
      specialistOutput:
        "Execution plan includes evidence, validation gates, artifact references, and clear risks. Receipt confirms paid specialist work and the output stays within constraints.",
      receiptChain: [
        { id: "challenge-1", type: "x402-challenge", status: "issued", amount: "0.03", currency: "USDC" },
        { id: "receipt-1", type: "x402-payment", status: "satisfied", amount: "0.03", currency: "USDC", txSignature: "demo-signature" },
      ],
      domain: "general operations",
    },
    config: { ...config, profileId: "verification-validation-agent", allowDemoPayment: true },
    client,
  });

  assert.equal(response.status, 200);
  assert.equal(client.callCount, 1);
  assert.equal(response.body.verdictSource, "deterministic_local_evaluator");
  assert.equal(client.lastRequest?.metadata.mode, "attestation");
  assert.equal(client.lastRequest?.messages[0]?.role, "system");
  assert.match(client.lastRequest?.messages[0]?.content ?? "", /Verdict semantics: release=pay specialist, refund=return funds/);
  const verdict = response.body.verdict as { schemaVersion: string; score: number; recommendedAction: string; checks: unknown[]; summary: string; caveats: string[] };
  assert.equal(verdict.schemaVersion, "reddi.attestation.v1");
  assert.equal(verdict.recommendedAction, "release");
  assert.ok(verdict.score >= 0.8);
  assert.ok(verdict.checks.length >= 4);
  assert.match(verdict.summary, /Recommend release/);
  assert.ok(verdict.caveats.some((caveat) => caveat.includes("not professional certification")));
});

test("attestation request mode on chat completions uses attestation envelope", async () => {
  const client = new MockOpenRouterClient();
  const response = await handleChatCompletions({
    headers: new Headers({ "x402-payment": "demo:attestation-chat-mode-1" }),
    body: {
      metadata: {
        mode: "attestation",
        attestation: {
          subjectProfileId: "document-intelligence-agent",
          specialistOutput: "Short summary with no receipt evidence.",
          receiptChain: [],
        },
      },
    },
    config: { ...config, profileId: "verification-validation-agent", allowDemoPayment: true },
    client,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.object, "reddi.attestation.verdict");
  assert.equal((response.body.verdict as { recommendedAction: string }).recommendedAction, "refund");
});

test("regulated-domain caveat is preserved and borderline verdict disputes", () => {
  const verdict = evaluateAttestation(
    {
      mode: "attestation",
      subjectProfileId: "conversational-agent",
      specialistOutput: "Financial explanation with evidence but should remain informational only.",
      receiptChain: [{ id: "receipt-1", type: "x402-payment", status: "paid", amount: "0.015", currency: "USDC" }],
      domain: "financial planning",
    },
    "verification-validation-agent",
  );

  assert.equal(verdict.recommendedAction, "dispute");
  assert.ok(verdict.caveats.some((caveat) => caveat.includes("Regulated-domain caveat")));
  assert.ok(verdict.semantics.release.includes("Recommend release"));
  assert.ok(verdict.semantics.refund.includes("Recommend refund"));
  assert.ok(verdict.semantics.dispute.includes("Recommend dispute"));
});

test("non-attestor profile cannot evaluate attestations", async () => {
  const client = new MockOpenRouterClient();
  const response = await handleAttestationEvaluation({
    headers: new Headers({ "x402-payment": "demo:not-attestor-1" }),
    body: { mode: "attestation", specialistOutput: "hello", receiptChain: [] },
    config: { ...config, allowDemoPayment: true },
    client,
  });

  assert.equal(response.status, 403);
  assert.equal(client.callCount, 0);
  assert.equal((response.body.error as { code: string }).code, "profile_not_attestor");
});

test("dry-run marketplace delegation ranks candidates deterministically without downstream paid calls", async () => {
  const client = new MockOpenRouterClient();
  const response = await handleChatCompletions({
    headers: new Headers({ "x402-payment": "demo:delegation-dry-run-1" }),
    body: {
      messages: [{ role: "user", content: "Plan a launch that needs document evidence extraction and code implementation." }],
      metadata: {
        mode: "delegation_plan",
        delegation: {
          requiredCapabilities: ["document-analysis", "code-generation"],
          maxCandidates: 3,
        },
      },
    },
    config: { ...config, allowDemoPayment: true },
    client,
  });

  assert.equal(response.status, 200);
  assert.equal(client.callCount, 0);
  assert.equal(response.body.object, "reddi.delegation.plan");
  const plan = response.body.plan as {
    mode: string;
    liveCallsEnabled: boolean;
    downstreamCallsExecuted: number;
    requiredCapabilities: string[];
    candidates: Array<{ profileId: string; matchedCapabilities: string[]; rankScore: number }>;
    selectedCandidate: { profileId: string };
    estimatedCost: { amount: string; currency: string };
    requiredAttestor: string;
    guardrails: string[];
  };
  assert.equal(plan.mode, "dry_run");
  assert.equal(plan.liveCallsEnabled, false);
  assert.equal(plan.downstreamCallsExecuted, 0);
  assert.deepEqual(plan.requiredCapabilities, ["code-generation", "document-analysis"]);
  assert.deepEqual(
    plan.candidates.map((candidate) => candidate.profileId),
    ["code-generation-agent", "document-intelligence-agent"],
  );
  assert.equal(plan.selectedCandidate.profileId, "code-generation-agent");
  assert.deepEqual(plan.candidates.map((candidate) => candidate.rankScore), [...plan.candidates.map((candidate) => candidate.rankScore)].sort((a, b) => b - a));
  assert.equal(plan.estimatedCost.currency, "USDC");
  assert.equal(plan.requiredAttestor, "verification-validation-agent");
  assert.ok(plan.guardrails.some((guardrail) => guardrail.includes("no devnet SOL spent")));
  assert.equal((response.body.reddi as { downstreamCallsExecuted: number; liveCallsEnabled: boolean }).downstreamCallsExecuted, 0);
  assert.equal((response.body.reddi as { downstreamCallsExecuted: number; liveCallsEnabled: boolean }).liveCallsEnabled, false);
});

test("dry-run marketplace ranking is deterministic for sample candidates", async () => {
  const plan = await buildDryRunDelegationPlan({
    request: {
      requesterProfileId: "planning-agent",
      task: "Need code and tests",
      requiredCapabilities: ["code-generation"],
      maxCandidates: 3,
    },
  });
  assert.equal(plan.candidates[0]?.profileId, "code-generation-agent");
  assert.equal(plan.selectedCandidate?.profileId, "code-generation-agent");

  const ranked = rankMarketplaceCandidates(
    [
      {
        profileId: "b-agent",
        displayName: "B",
        endpointPath: "/v1/chat/completions",
        capabilities: ["code-generation"],
        roles: ["specialist"],
        price: { currency: "USDC", amount: "0.02", unit: "request" },
        reputationScore: 0.8,
        freshnessScore: 0.8,
        preferredAttestors: ["verification-validation-agent"],
        safetyMode: "standard",
      },
      {
        profileId: "a-agent",
        displayName: "A",
        endpointPath: "/v1/chat/completions",
        capabilities: ["code-generation"],
        roles: ["specialist"],
        price: { currency: "USDC", amount: "0.02", unit: "request" },
        reputationScore: 0.8,
        freshnessScore: 0.8,
        preferredAttestors: ["verification-validation-agent"],
        safetyMode: "standard",
      },
    ],
    ["code-generation"],
  );
  assert.deepEqual(
    ranked.map((candidate) => candidate.profileId),
    ["a-agent", "b-agent"],
  );
});

test("manifest marketplace discovery matches deterministic all-profile ranking", async () => {
  const discoveryClient = new ManifestMarketplaceDiscoveryClient(walletManifest);
  const plan = await buildDryRunDelegationPlan({
    request: {
      requesterProfileId: "planning-agent",
      task: "Need document evidence and code implementation",
      requiredCapabilities: ["document-analysis", "code-generation"],
      maxCandidates: 3,
    },
    discoveryClient,
  });

  assert.deepEqual(plan.discoveryDiagnostics?.excluded, []);
  assert.deepEqual(
    plan.discoveryDiagnostics?.includedProfileIds,
    walletManifest.profiles.map((profile) => profile.profileId).sort(),
  );
  assert.deepEqual(
    plan.candidates.map((candidate) => candidate.profileId),
    ["code-generation-agent", "document-intelligence-agent"],
  );
  assert.equal(plan.selectedCandidate?.walletAddress, getProfile("code-generation-agent")?.walletAddress);
});

test("manifest discovery excludes malformed candidates with explicit reasons", () => {
  const malformedManifest: WalletManifest = {
    ...walletManifest,
    profiles: [
      ...walletManifest.profiles,
      { profileId: "ghost-agent", displayName: "Ghost", publicKey: "not-a-public-key" },
      { profileId: "planning-agent", displayName: "Duplicate Planning", publicKey: walletManifest.profiles[0]?.publicKey ?? "" },
    ],
  };
  const result = candidatesFromWalletManifest(malformedManifest);
  const ghost = result.excluded.find((entry) => entry.profileId === "ghost-agent");
  const duplicate = result.excluded.find((entry) => entry.profileId === "planning-agent");
  assert.ok(ghost?.reasons.includes("profile not found in specialist registry"));
  assert.ok(ghost?.reasons.includes("invalid Solana public key"));
  assert.ok(duplicate?.reasons.includes("duplicate profileId in wallet manifest"));
  assert.ok(duplicate?.reasons.includes("duplicate public key in wallet manifest"));
});

test("deployment readiness report is public-data-only and blocks missing funding/deployment", () => {
  const report = buildDeploymentReadinessReport({
    manifest: walletManifest,
    endpointBaseUrl: "https://planning.example.test",
    fundedProfileIds: [],
    deployedProfileIds: [],
    generatedAt: "2026-05-04T00:00:00.000Z",
  });

  assert.equal(report.schemaVersion, "reddi.openrouter.deployment-readiness.v1");
  assert.equal(report.status, "blocked");
  assert.equal(report.entries.length, 30);
  assert.ok(report.guardrails.includes("no private keys or signer material inspected"));
  assert.ok(report.guardrails.includes("no devnet SOL spent"));
  assert.ok(report.nextApprovalRequired.some((item) => item.includes("all 30 specialist profiles")));
  assert.ok(report.nextApprovalRequired.some((item) => item.includes("funder-only devnet wallet")));
  assert.ok(!report.nextApprovalRequired.some((item) => item.includes("first five specialist profiles")));
  assert.ok(report.entries.every((entry) => entry.endpoint?.startsWith("https://planning.example.test/")));
  assert.ok(report.entries.every((entry) => entry.blockers.includes("funding not confirmed; approval/funding required")));
  assert.ok(report.entries.every((entry) => entry.blockers.includes("Coolify deployment not confirmed")));
});

test("live delegation mode fails closed before any downstream paid call executor exists", async () => {
  const client = new MockOpenRouterClient();
  const budgetPolicy = {
    maxLamportsPerRequest: 1_000,
    maxLamportsPerSession: 5_000,
    maxLamportsPerAgent: 10_000,
    maxDownstreamCallsPerSession: 2,
  };
  const response = await handleChatCompletions({
    headers: new Headers({ "x402-payment": "demo:delegation-live-fail-closed-1" }),
    body: {
      messages: [{ role: "user", content: "Hire a code agent for this task." }],
      metadata: { mode: "delegation_live", delegation: { dryRun: false, requiredCapabilities: ["code-generation"], estimatedLamports: 500, budgetPolicy } },
    },
    config: { ...config, allowDemoPayment: true, enableAgentToAgentCalls: true, maxDownstreamCalls: 1, maxDownstreamLamports: 1000 },
    client,
  });

  assert.equal(response.status, 501);
  assert.equal(client.callCount, 0);
  assert.equal((response.body.error as { code: string }).code, "live_delegation_not_implemented");
  assert.equal((response.body.reddi as { downstreamCallsExecuted: number }).downstreamCallsExecuted, 0);
  assert.equal(((response.body.reddi as { budget: { allowed: boolean } }).budget).allowed, true);
  const intentPlan = (response.body.reddi as { intentPlan: { schemaVersion: string; executionStatus: string; selectedCandidate?: { profileId: string }; guardrails: { downstreamCallsExecuted: number; noDownstreamX402Executed: boolean }; estimatedLamports: number } }).intentPlan;
  assert.equal(intentPlan.schemaVersion, "reddi.live-delegation-intent.v1");
  assert.equal(intentPlan.executionStatus, "not_executed");
  assert.equal(intentPlan.selectedCandidate?.profileId, "code-generation-agent");
  assert.equal(intentPlan.estimatedLamports, 500);
  assert.equal(intentPlan.guardrails.downstreamCallsExecuted, 0);
  assert.equal(intentPlan.guardrails.noDownstreamX402Executed, true);
  const auditEnvelope = (response.body.reddi as { auditEnvelope: { schemaVersion: string; hashAlgorithm: string; envelopeHash: string; canonicalJson: string; signatureStatus: string; persistenceStatus: string; executionStatus: string; guardrails: { noSignerMaterialUsed: boolean; noExternalPersistence: boolean; noDownstreamX402Executed: boolean } } }).auditEnvelope;
  assert.equal(auditEnvelope.schemaVersion, "reddi.live-delegation-audit-envelope.v1");
  assert.equal(auditEnvelope.hashAlgorithm, "sha256");
  assert.match(auditEnvelope.envelopeHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(auditEnvelope.signatureStatus, "unsigned");
  assert.equal(auditEnvelope.persistenceStatus, "not_persisted");
  assert.equal(auditEnvelope.executionStatus, "not_executed");
  assert.equal(auditEnvelope.guardrails.noSignerMaterialUsed, true);
  assert.equal(auditEnvelope.guardrails.noExternalPersistence, true);
  assert.equal(auditEnvelope.guardrails.noDownstreamX402Executed, true);
  assert.equal(auditEnvelope.canonicalJson, canonicalJson(JSON.parse(auditEnvelope.canonicalJson)));
  const executorEvidence = (response.body.reddi as { executorEvidence: { schemaVersion: string; executorId: string; executionStatus: string; auditEnvelopeHash: string; downstreamCallsExecuted: number; guardrails: { noNetworkCallAttempted: boolean; noSignerMaterialUsed: boolean; noSignatureAttempted: boolean; noExternalPersistence: boolean; noDevnetTransferExecuted: boolean; noDownstreamX402Executed: boolean } } }).executorEvidence;
  assert.equal(executorEvidence.schemaVersion, "reddi.live-delegation-executor-evidence.v1");
  assert.equal(executorEvidence.executorId, "disabled-live-delegation-executor-gate");
  assert.equal(executorEvidence.executionStatus, "not_executed");
  assert.equal(executorEvidence.auditEnvelopeHash, auditEnvelope.envelopeHash);
  assert.equal(executorEvidence.downstreamCallsExecuted, 0);
  assert.equal(executorEvidence.guardrails.noNetworkCallAttempted, true);
  assert.equal(executorEvidence.guardrails.noSignerMaterialUsed, true);
  assert.equal(executorEvidence.guardrails.noSignatureAttempted, true);
  assert.equal(executorEvidence.guardrails.noExternalPersistence, true);
  assert.equal(executorEvidence.guardrails.noDevnetTransferExecuted, true);
  assert.equal(executorEvidence.guardrails.noDownstreamX402Executed, true);
  const disclosureLedger = (response.body.reddi as { downstreamDisclosureLedger: { schemaVersion: string; disclosureScope: string; entries: Array<{ calledProfileId: string; payloadSummary: string; x402: { amount: string; currency: string; challengeOrReceiptState: string; evidenceRef: string }; attestorLinks: string[]; obfuscation?: { returnedDetailsObfuscated: boolean; reason?: string } }>; transparencyGuarantees: string[] } }).downstreamDisclosureLedger;
  assert.equal(disclosureLedger.schemaVersion, "reddi.downstream-disclosure-ledger.v1");
  assert.equal(disclosureLedger.disclosureScope, "planned_downstream_calls");
  assert.equal(disclosureLedger.entries[0]?.calledProfileId, "code-generation-agent");
  assert.match(disclosureLedger.entries[0]?.payloadSummary ?? "", /Hire a code agent/);
  assert.equal(disclosureLedger.entries[0]?.x402.amount, "0.05");
  assert.equal(disclosureLedger.entries[0]?.x402.currency, "USDC");
  assert.equal(disclosureLedger.entries[0]?.x402.challengeOrReceiptState, "not_attempted");
  assert.equal(disclosureLedger.entries[0]?.x402.evidenceRef, auditEnvelope.envelopeHash);
  assert.ok(disclosureLedger.entries[0]?.attestorLinks.includes("verification-validation-agent"));
  assert.equal(disclosureLedger.entries[0]?.obfuscation?.returnedDetailsObfuscated, false);
  assert.ok(disclosureLedger.transparencyGuarantees.some((item) => item.includes("called-agent identity")));

  const liveWithoutBudgetPolicy = await handleChatCompletions({
    headers: new Headers({ "x402-payment": "demo:delegation-live-fail-closed-2" }),
    body: {
      messages: [{ role: "user", content: "Hire another agent live." }],
      metadata: { mode: "delegation_live" },
    },
    config: { ...config, allowDemoPayment: true, enableAgentToAgentCalls: true },
    client,
  });
  assert.equal(liveWithoutBudgetPolicy.status, 403);
  assert.equal(client.callCount, 0);
  assert.equal((liveWithoutBudgetPolicy.body.error as { code: string }).code, "budget_policy_required");
  assert.equal((liveWithoutBudgetPolicy.body.reddi as { downstreamCallsExecuted: number; intentPlan?: unknown; auditEnvelope?: unknown; executorEvidence?: unknown }).downstreamCallsExecuted, 0);
  assert.equal((liveWithoutBudgetPolicy.body.reddi as { intentPlan?: unknown }).intentPlan, undefined);
  assert.equal((liveWithoutBudgetPolicy.body.reddi as { auditEnvelope?: unknown }).auditEnvelope, undefined);
  assert.equal((liveWithoutBudgetPolicy.body.reddi as { executorEvidence?: unknown }).executorEvidence, undefined);

  const liveWithCallsDisabled = await handleChatCompletions({
    headers: new Headers({ "x402-payment": "demo:delegation-live-fail-closed-3" }),
    body: {
      messages: [{ role: "user", content: "Hire another agent live." }],
      metadata: { mode: "delegation_live", delegation: { dryRun: false, requiredCapabilities: ["code-generation"], estimatedLamports: 500, budgetPolicy } },
    },
    config: { ...config, allowDemoPayment: true, enableAgentToAgentCalls: false },
    client,
  });
  assert.equal(liveWithCallsDisabled.status, 403);
  assert.equal(client.callCount, 0);
  assert.equal((liveWithCallsDisabled.body.error as { code: string }).code, "live_delegation_disabled");
  assert.equal((liveWithCallsDisabled.body.reddi as { downstreamCallsExecuted: number }).downstreamCallsExecuted, 0);

  const liveOverBudget = await handleChatCompletions({
    headers: new Headers({ "x402-payment": "demo:delegation-live-fail-closed-4" }),
    body: {
      messages: [{ role: "user", content: "Hire another agent live." }],
      metadata: { mode: "delegation_live", delegation: { dryRun: false, requiredCapabilities: ["code-generation"], estimatedLamports: 2_000, budgetPolicy } },
    },
    config: { ...config, allowDemoPayment: true, enableAgentToAgentCalls: true },
    client,
  });
  assert.equal(liveOverBudget.status, 403);
  assert.equal(client.callCount, 0);
  assert.equal((liveOverBudget.body.error as { code: string }).code, "request_budget_exceeded");
  assert.equal((liveOverBudget.body.reddi as { downstreamCallsExecuted: number }).downstreamCallsExecuted, 0);
});

test("live delegation executor gate controls invocation and remains fail-closed", async () => {
  const budgetPolicy = {
    maxLamportsPerRequest: 1_000,
    maxLamportsPerSession: 5_000,
    maxLamportsPerAgent: 10_000,
    maxDownstreamCallsPerSession: 2,
  };
  let executorCalls = 0;
  const trackingExecutor: LiveDelegationExecutor = {
    async execute(input: LiveDelegationExecutorInput) {
      executorCalls += 1;
      return {
        schemaVersion: "reddi.live-delegation-executor-evidence.v1",
        executorId: "noop-live-delegation-executor",
        executionStatus: "not_executed",
        reason: "executor_not_implemented",
        message: "tracking no-op executor was invoked",
        intentId: input.intentPlan.intentId,
        auditEnvelopeHash: input.auditEnvelope.envelopeHash,
        downstreamCallsExecuted: 0,
        guardrails: {
          noNetworkCallAttempted: true,
          noSignerMaterialUsed: true,
          noSignatureAttempted: true,
          noExternalPersistence: true,
          noDevnetTransferExecuted: true,
          noDownstreamX402Executed: true,
        },
      };
    },
  };

  const disabledGate = await handleDelegationPlanning({
    headers: new Headers({ "x402-payment": "demo:delegation-executor-gate-disabled" }),
    body: {
      messages: [{ role: "user", content: "Hire a code agent for this task." }],
      metadata: { mode: "delegation_live", delegation: { dryRun: false, requiredCapabilities: ["code-generation"], estimatedLamports: 500, budgetPolicy } },
    },
    config: { ...config, allowDemoPayment: true, enableAgentToAgentCalls: true, enableLiveDelegationExecutor: false, maxDownstreamCalls: 1, maxDownstreamLamports: 1000 },
    liveDelegationExecutor: trackingExecutor,
  });
  assert.equal(disabledGate.status, 501);
  assert.equal(executorCalls, 0);
  const disabledEvidence = (disabledGate.body.reddi as { executorEvidence: { executorId: string; reason: string; downstreamCallsExecuted: number } }).executorEvidence;
  assert.equal(disabledEvidence.executorId, "disabled-live-delegation-executor-gate");
  assert.equal(disabledEvidence.reason, "executor_disabled");
  assert.equal(disabledEvidence.downstreamCallsExecuted, 0);

  const enabledNoop = await handleDelegationPlanning({
    headers: new Headers({ "x402-payment": "demo:delegation-executor-gate-enabled" }),
    body: {
      messages: [{ role: "user", content: "Hire a code agent for this task." }],
      metadata: { mode: "delegation_live", delegation: { dryRun: false, requiredCapabilities: ["code-generation"], estimatedLamports: 500, budgetPolicy } },
    },
    config: { ...config, allowDemoPayment: true, enableAgentToAgentCalls: true, enableLiveDelegationExecutor: true, maxDownstreamCalls: 1, maxDownstreamLamports: 1000 },
    liveDelegationExecutor: trackingExecutor,
  });
  assert.equal(enabledNoop.status, 501);
  assert.equal(executorCalls, 1);
  const enabledEvidence = (enabledNoop.body.reddi as { executorEvidence: { executorId: string; reason: string; executionStatus: string; downstreamCallsExecuted: number } }).executorEvidence;
  assert.equal(enabledEvidence.executorId, "noop-live-delegation-executor");
  assert.equal(enabledEvidence.reason, "executor_not_implemented");
  assert.equal(enabledEvidence.executionStatus, "not_executed");
  assert.equal(enabledEvidence.downstreamCallsExecuted, 0);
  const enabledDisclosureLedger = (enabledNoop.body.reddi as { downstreamDisclosureLedger: { disclosureScope: string; entries: Array<{ calledProfileId: string; x402: { challengeOrReceiptState: string } }> } }).downstreamDisclosureLedger;
  assert.equal(enabledDisclosureLedger.disclosureScope, "planned_downstream_calls");
  assert.equal(enabledDisclosureLedger.entries[0]?.calledProfileId, "code-generation-agent");
  assert.equal(enabledDisclosureLedger.entries[0]?.x402.challengeOrReceiptState, "not_attempted");

  const denied = await handleDelegationPlanning({
    headers: new Headers({ "x402-payment": "demo:delegation-executor-gate-denied" }),
    body: {
      messages: [{ role: "user", content: "Hire a code agent for this task." }],
      metadata: { mode: "delegation_live", delegation: { dryRun: false, requiredCapabilities: ["code-generation"], estimatedLamports: 2_000, budgetPolicy } },
    },
    config: { ...config, allowDemoPayment: true, enableAgentToAgentCalls: true, enableLiveDelegationExecutor: true, maxDownstreamCalls: 1, maxDownstreamLamports: 1000 },
    liveDelegationExecutor: trackingExecutor,
  });
  assert.equal(denied.status, 403);
  assert.equal(executorCalls, 1);
  assert.equal((denied.body.reddi as { intentPlan?: unknown; auditEnvelope?: unknown; executorEvidence?: unknown }).intentPlan, undefined);
  assert.equal((denied.body.reddi as { auditEnvelope?: unknown }).auditEnvelope, undefined);
  assert.equal((denied.body.reddi as { executorEvidence?: unknown }).executorEvidence, undefined);
});

test("HTTP core routes expose health, models, tags, metadata, attestation, and chat", async () => {
  const client = new MockOpenRouterClient();
  for (const path of ["/healthz", "/x402/health", "/v1/models", "/api/tags", "/.well-known/reddi-agent.json"]) {
    const response = await handleRuntimeRequest(new Request(`https://planning.example.test${path}`), config, client);
    assert.equal(response.status, 200, path);
  }

  const unpaid = await handleRuntimeRequest(
    new Request("https://planning.example.test/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    }),
    config,
    client,
  );
  assert.equal(unpaid.status, 402);
  assert.equal(client.callCount, 0);

  const unpaidAttestation = await handleRuntimeRequest(
    new Request("https://planning.example.test/v1/attestations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "attestation", specialistOutput: "hello", receiptChain: [] }),
    }),
    { ...config, profileId: "verification-validation-agent", allowDemoPayment: true },
    client,
  );
  assert.equal(unpaidAttestation.status, 402);
  const unpaidAttestationChallenge = JSON.parse(unpaidAttestation.headers.get("x402-request") ?? "{}") as { endpoint?: string; memo?: string };
  assert.equal(unpaidAttestationChallenge.endpoint, "https://planning.example.test/v1/attestations");
  assert.equal(unpaidAttestationChallenge.memo, "reddi:verification-validation-agent:/v1/attestations");

  const attestation = await handleRuntimeRequest(
    new Request("https://planning.example.test/v1/attestations", {
      method: "POST",
      headers: { "content-type": "application/json", "x402-payment": "demo:http-attestation-route-1" },
      body: JSON.stringify({
        mode: "attestation",
        subjectProfileId: "planning-agent",
        specialistOutput: "Plan includes validation artifacts, test evidence, receipt references, risks, and clear settlement recommendation input.",
        receiptChain: [{ id: "receipt-http-1", type: "x402-payment", status: "satisfied", amount: "0.03", currency: "USDC" }],
      }),
    }),
    { ...config, profileId: "verification-validation-agent", allowDemoPayment: true },
    client,
  );
  assert.equal(attestation.status, 200);
  const attestationBody = (await attestation.json()) as { object: string; verdictSource: string; verdict: { recommendedAction: string }; reddi: { downstreamDisclosureLedger: { disclosureScope: string; entries: unknown[] } } };
  assert.equal(attestationBody.object, "reddi.attestation.verdict");
  assert.equal(attestationBody.verdictSource, "deterministic_local_evaluator");
  assert.equal(attestationBody.verdict.recommendedAction, "release");
  assert.equal(attestationBody.reddi.downstreamDisclosureLedger.disclosureScope, "no_downstream_calls");
  assert.deepEqual(attestationBody.reddi.downstreamDisclosureLedger.entries, []);
});

test("402 challenge states the protocol fee split only when a treasury is configured", async () => {
  const treasury = "BeybScaYnvJEL8i3s1TL3a2GRpiD3KTbu2Cfsxx5oX6H";
  const unpaid = (runtimeConfig: RuntimeConfig) => handleChatCompletions({
    headers: new Headers(),
    body: { messages: [{ role: "user", content: "Build a plan" }] },
    config: runtimeConfig,
    client: new MockOpenRouterClient(),
  });

  const without = await unpaid(config);
  assert.equal(without.status, 402);
  assert.equal((without.body.x402 as { fee?: unknown }).fee, undefined);

  const withFee = await unpaid({ ...config, protocolFeeTreasury: treasury });
  assert.equal(withFee.status, 402);
  const challenge = withFee.body.x402 as { amount: string | number; fee: { bps: number; payTo: string; amount: string; providerAmount: string } };
  assert.equal(challenge.fee.bps, 250);
  assert.equal(challenge.fee.payTo, treasury);
  // The buyer pays the listed amount in total: provider share plus fee equals the price.
  assert.ok(Math.abs(Number(challenge.fee.amount) + Number(challenge.fee.providerAmount) - Number(challenge.amount)) < 1e-12);
  assert.equal(JSON.parse(withFee.headers["x402-request"]).fee.payTo, treasury);

  assert.equal(createRuntimeConfig({ X402_PROTOCOL_FEE_TREASURY: treasury }).protocolFeeTreasury, treasury);
  assert.equal(createRuntimeConfig({}).protocolFeeTreasury, undefined);
  assert.deepEqual(createRuntimeConfig({}).paymentMints, {});
  assert.deepEqual(
    createRuntimeConfig({ X402_AUDD_MINT: " audd-mint ", X402_PYUSD_MINT: "pyusd-mint", X402_USDG_MINT: "", X402_EURC_MINT: "ignored" }).paymentMints,
    { AUDD: "audd-mint", PYUSD: "pyusd-mint" },
  );
});
