import http from "node:http";
import crypto from "node:crypto";
import { createX402Header } from "@redditech/x402-solana";

type SpecialistProfileId = "qa-security" | "ux-usability" | "integration-tester";

type DemoCase = {
  id: string;
  title: string;
  triggers: string[];
  answer: string;
  evidence: string[];
};

type SpecialistProfile = {
  id: SpecialistProfileId;
  name: string;
  model: string;
  role: string;
  capabilities: string[];
  cases: DemoCase[];
};

type CompletionBody = {
  model?: string;
  messages?: Array<{ role?: string; content?: string | Array<{ type?: string; text?: string }> }>;
  prompt?: string;
};

const profiles: Record<SpecialistProfileId, SpecialistProfile> = {
  "qa-security": {
    id: "qa-security",
    name: "Reddi QA Sentinel",
    model: "reddi-demo/qa-security-sentinel",
    role: "Security and endpoint-compliance tester",
    capabilities: ["x402_fail_closed_audit", "endpoint_security", "negative_path_testing"],
    cases: [
      {
        id: "insecure-open-completion",
        title: "Detect an unpaid completion bypass",
        triggers: ["unpaid completion", "insecure endpoint", "open completion", "without x402", "bypass"],
        answer:
          "Finding: the specialist endpoint is unsafe if `/v1/chat/completions` returns a 200 response before an `x402-payment` receipt is supplied. Fix: fail closed with HTTP 402 and an `x402-request` challenge, then allow exactly one paid retry. Demo verdict: block registration until the probe observes 402 + x402-request.",
        evidence: ["probe:/v1/chat/completions", "expected_status:402", "required_header:x402-request"],
      },
      {
        id: "replay-nonce",
        title: "Replay/nonce protection review",
        triggers: ["replay", "nonce", "duplicate payment", "same receipt", "re-use"],
        answer:
          "Finding: payment receipts need nonce and route binding. A duplicate nonce or receipt replay should be rejected before model execution. Demo verdict: accept fresh paid calls, reject duplicate nonce attempts, and preserve requestId in the receipt trail.",
        evidence: ["field:nonce", "field:requestId", "policy:single_use_payment"],
      },
    ],
  },
  "ux-usability": {
    id: "ux-usability",
    name: "Reddi UX Inspector",
    model: "reddi-demo/ux-usability-inspector",
    role: "Onboarding and demo-flow usability tester",
    capabilities: ["onboarding_review", "copy_clarity", "demo_flow_testing"],
    cases: [
      {
        id: "specialist-onboarding-friction",
        title: "Specialist onboarding friction audit",
        triggers: ["onboarding", "specialist setup", "register specialist", "confusing", "friction"],
        answer:
          "Usability review: keep the specialist operator path to four visible checks — wallet funded, endpoint online, x402 challenge observed, registration transaction confirmed. The highest-risk friction is unclear endpoint failure messaging, so show the active RPC/program, probe result, and exact next command.",
        evidence: ["screen:/testers", "screen:/register", "check:x402_probe", "check:wallet_network"],
      },
      {
        id: "manager-evidence-review",
        title: "Manager evidence review flow",
        triggers: ["manager", "evidence pack", "judge", "demo video", "screenshots"],
        answer:
          "Demo-flow review: start at Manager evidence, open Specialist readiness, then show Consumer paid-call receipt and Attestor release/refund controls. This sequence makes Reddi Agent Protocol's value obvious: discovery, payment protection, escrow/reputation, and replayable evidence.",
        evidence: ["screen:/manager", "screen:/specialist", "screen:/planner", "screen:/attestation"],
      },
    ],
  },
  "integration-tester": {
    id: "integration-tester",
    name: "Reddi Integration Runner",
    model: "reddi-demo/integration-runner",
    role: "End-to-end integration test specialist",
    capabilities: ["playwright_capture", "devnet_registration", "coolify_smoke"],
    cases: [
      {
        id: "vps-coolify-smoke",
        title: "Coolify deployment smoke plan",
        triggers: ["coolify", "vps", "deploy", "healthcheck", "smoke"],
        answer:
          "Integration plan: deploy one container per specialist profile with `SPECIALIST_PROFILE`, `SPECIALIST_WALLET`, and `PUBLIC_BASE_URL` set. Smoke sequence: GET /healthz, GET /v1/models, unpaid POST /v1/chat/completions expecting 402 + x402-request, then paid retry with x402-payment expecting matched response metadata.",
        evidence: ["env:SPECIALIST_PROFILE", "env:SPECIALIST_WALLET", "route:/healthz", "route:/v1/chat/completions"],
      },
      {
        id: "devnet-registration-recording",
        title: "Devnet registration and recording checklist",
        triggers: ["devnet registration", "record", "playwright", "screenshot", "wallet"],
        answer:
          "Recording checklist: capture endpoint smoke first, then registration with the dev wallet on Solana devnet, then planner resolution and a paid invocation. Save screenshots and JSON receipts under `artifacts/demo-testing-specialists/<timestamp>/` so the demo video can replay the exact evidence chain.",
        evidence: ["artifact:screens", "artifact:receipts", "chain:solana-devnet", "wallet:dev"],
      },
    ],
  },
};

const profileId = parseProfile(process.env.SPECIALIST_PROFILE || "qa-security");
const profile = profiles[profileId];
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "127.0.0.1";
const specialistWallet = process.env.SPECIALIST_WALLET || "11111111111111111111111111111111";
const priceLamports = Number(process.env.PRICE_LAMPORTS || 1_000_000);
const network = process.env.X402_NETWORK || "solana-devnet";
const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://${host}:${port}`;

function parseProfile(raw: string): SpecialistProfileId {
  if (raw === "ux-usability" || raw === "integration-tester" || raw === "qa-security") return raw;
  return "qa-security";
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(payload, null, 2));
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

function extractPrompt(body: CompletionBody): string {
  if (typeof body.prompt === "string") return body.prompt;
  const parts: string[] = [];
  for (const message of body.messages || []) {
    if (typeof message.content === "string") parts.push(message.content);
    if (Array.isArray(message.content)) {
      for (const item of message.content) if (typeof item.text === "string") parts.push(item.text);
    }
  }
  return parts.join("\n");
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().replace(/[^a-z0-9/:-]+/g, " ").split(/\s+/).filter(Boolean));
}

function scoreCase(prompt: string, demoCase: DemoCase): number {
  const promptLower = prompt.toLowerCase();
  let score = 0;
  for (const trigger of demoCase.triggers) {
    if (promptLower.includes(trigger.toLowerCase())) score += 3;
  }
  const promptTokens = tokenize(prompt);
  const caseTokens = tokenize([...demoCase.triggers, demoCase.title].join(" "));
  let overlap = 0;
  for (const token of caseTokens) if (promptTokens.has(token)) overlap += 1;
  return score + overlap / Math.max(caseTokens.size, 1);
}

function chooseResponse(prompt: string) {
  const ranked = profile.cases
    .map((demoCase) => ({ demoCase, score: scoreCase(prompt, demoCase) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const predefinedMatch = Boolean(best && best.score >= 3);
  const partialMatch = Boolean(best && best.score >= 0.2);
  const confidence = predefinedMatch ? 0.97 : partialMatch ? 0.58 : 0.24;
  const reputationScore = predefinedMatch ? 96 : partialMatch ? 58 : 24;
  const selected = best?.demoCase;

  if (selected && (predefinedMatch || partialMatch)) {
    return {
      content: `${selected.answer}\n\nMatch confidence: ${confidence.toFixed(2)}. Reputation signal: ${reputationScore}/100.`,
      selected,
      predefinedMatch,
      confidence,
      reputationScore,
    };
  }

  return {
    content:
      `I do not have a predefined high-confidence answer for that exact testing query. Best effort from ${profile.name}: verify the endpoint fails closed with 402 + x402-request before any mock specialist response, then record the paid retry receipt and matching confidence in the demo artifact.\n\nMatch confidence: ${confidence.toFixed(2)}. Reputation signal: ${reputationScore}/100.`,
    selected: undefined,
    predefinedMatch: false,
    confidence,
    reputationScore,
  };
}

function x402Challenge() {
  const nonce = crypto.randomBytes(16).toString("hex");
  const challenge = createX402Header(priceLamports, specialistWallet, nonce, "SOL");
  const parsed = JSON.parse(challenge);
  return JSON.stringify({
    ...parsed,
    chain: network,
    route: "/v1/chat/completions",
    payee: specialistWallet,
    specialistProfile: profile.id,
    publicBaseUrl,
    memo: `reddi-demo-testing-specialist:${profile.id}`,
  });
}

function parseDemoPaymentHeader(payment: string) {
  try {
    const parsed = JSON.parse(payment);
    const txSignature = typeof parsed.txSignature === "string" ? parsed.txSignature.trim() : "";
    if (!txSignature) return undefined;
    return {
      txSignature,
      network: typeof parsed.network === "string" ? parsed.network : network,
      demoOnly: parsed.demoOnly !== false,
    };
  } catch {
    return undefined;
  }
}

function modelPayload() {
  return {
    object: "list",
    data: [
      {
        id: profile.model,
        object: "model",
        owned_by: "reddi-agent-protocol-demo",
        metadata: {
          specialistProfile: profile.id,
          name: profile.name,
          role: profile.role,
          capabilities: profile.capabilities,
          x402Protected: true,
          mockRuntime: true,
        },
      },
    ],
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/healthz" || url.pathname === "/x402/health")) {
    return sendJson(res, 200, {
      ok: true,
      service: "reddi-demo-testing-specialist",
      profile: profile.id,
      name: profile.name,
      model: profile.model,
      role: profile.role,
      capabilities: profile.capabilities,
      x402: {
        protectedRoutes: ["/v1/chat/completions"],
        unpaidBehavior: "402 + x402-request",
        network,
        priceLamports,
        specialistWallet,
      },
    });
  }

  if (req.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/api/tags")) {
    if (url.pathname === "/api/tags") {
      return sendJson(res, 200, { models: [{ name: profile.model, model: profile.model }] });
    }
    return sendJson(res, 200, modelPayload());
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    const payment = req.headers["x402-payment"];
    if (!payment || Array.isArray(payment)) {
      return sendJson(
        res,
        402,
        { error: "payment_required", detail: "retry with x402-payment to execute mock testing specialist" },
        { "x402-request": x402Challenge() },
      );
    }

    const demoPayment = parseDemoPaymentHeader(payment);
    if (!demoPayment) {
      return sendJson(res, 400, {
        error: "invalid_demo_x402_payment",
        detail: "demo mock requires JSON x402-payment with a non-empty txSignature; this service does not perform production payment verification",
      });
    }

    let parsed: CompletionBody = {};
    try {
      const raw = await readBody(req);
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      return sendJson(res, 400, { error: "invalid_json" });
    }

    const prompt = extractPrompt(parsed);
    const response = chooseResponse(prompt);
    const requestId = `reddi_demo_${crypto.randomBytes(8).toString("hex")}`;

    return sendJson(res, 200, {
      id: requestId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: parsed.model || profile.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: response.content },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: tokenize(prompt).size, completion_tokens: tokenize(response.content).size, total_tokens: tokenize(prompt).size + tokenize(response.content).size },
      reddi_demo: {
        specialistProfile: profile.id,
        specialistName: profile.name,
        predefinedMatch: response.predefinedMatch,
        matchedCaseId: response.selected?.id || null,
        matchedCaseTitle: response.selected?.title || null,
        matchConfidence: response.confidence,
        reputationScore: response.reputationScore,
        paymentStatus: "demo_x402_payment_header_shape_accepted_not_production_verified",
        paymentReceipt: demoPayment,
        evidence: response.selected?.evidence || [],
        requestId,
      },
    });
  }

  return sendJson(res, 404, { error: "not_found" });
});

if (require.main === module) {
  server.listen(port, host, () => {
    console.log(`${profile.name} listening on http://${host}:${port}`);
    console.log(`Profile=${profile.id} Model=${profile.model} Wallet=${specialistWallet}`);
  });
}

export { server, profiles, chooseResponse };
