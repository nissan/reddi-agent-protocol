/**
 * Legacy, demo and file-store routes answer 404 in production builds and on mainnet
 * (security audit round 1: S2-claude-01/-02/-03, condition C3). Cron auth fails closed
 * and compares in constant time (S2-claude-06). The devnet cluster check refuses other
 * clusters (S2-claude-01).
 */
import fs from "fs";
import path from "path";

const GATED_ROUTES = [
  "bake-trace",
  "generate",
  "generate-live",
  "heartbeat",
  "dogfood/consumer-run",
  "dogfood/seed",
  "dogfood/search",
  "dogfood/testing-attestor",
  "dogfood/testing-specialist",
  "onboarding/wallet",
  "onboarding/capabilities",
  "onboarding/healthcheck",
  "onboarding/endpoint",
  "onboarding/runtime",
  "onboarding/preflight",
  "orchestrator/policy",
  "planner/tools/release",
  "planner/tools/register-consumer",
  "planner/tools/signal",
  "planner/runs",
  "onboarding/consumers",
  "onboarding/audit",
  "onboarding/planner/reveal",
  "onboarding/planner/feedback",
  "onboarding/operator-key",
  "onboarding/attestation-operator",
  "onboarding/attestation",
  "torque/event",
];

describe("legacy route gate", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...saved };
    delete process.env.NETWORK_PROFILE;
    delete process.env.NEXT_PUBLIC_NETWORK_PROFILE;
    delete process.env.NEXT_PUBLIC_BUILD_NETWORK_PROFILE;
  });
  afterAll(() => {
    process.env = saved;
  });

  it("is open in tests and development on devnet, closed in production and on mainnet", async () => {
    const { legacyRoutesEnabled } = await import("@/lib/http/route-gates");
    expect(legacyRoutesEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(legacyRoutesEnabled({ NODE_ENV: "test" })).toBe(true);
    expect(legacyRoutesEnabled({ NODE_ENV: "production" })).toBe(false);
    process.env.NETWORK_PROFILE = "mainnet";
    expect(legacyRoutesEnabled({ NODE_ENV: "development" })).toBe(false);
  });

  it.each(GATED_ROUTES)("gates every handler of app/api/%s", (route) => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/api", route, "route.ts"), "utf8");
    const handlers = source.match(/export (async )?function (GET|POST|PUT|PATCH|DELETE)\s*\(/g) ?? [];
    const gates = source.match(/const gated = legacyRouteGate\(\);\n\s*if \(gated\) return gated;/g) ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    expect(gates.length).toBe(handlers.length);
  });

  it("gates only the run listing (GET) of the planner execute route; the paid POST stays", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/api/onboarding/planner/execute/route.ts"), "utf8");
    const get = source.slice(source.indexOf("export async function GET"), source.indexOf("export async function POST"));
    const post = source.slice(source.indexOf("export async function POST"));
    expect(get).toContain("legacyRouteGate()");
    expect(post).not.toContain("legacyRouteGate()");
  });

  it.each([
    ["generate-live", "POST", { brief: "x", ollamaUrl: "http://127.0.0.1:9/" }],
    ["onboarding/wallet", "POST", { action: "create" }],
    ["orchestrator/policy", "POST", { dailyBudgetUsd: 1 }],
    ["planner/runs", "GET", undefined],
  ] as const)("%s answers 404 on mainnet before doing anything", async (route, method, body) => {
    process.env.NETWORK_PROFILE = "mainnet";
    const mod = (await import(`@/app/api/${route}/route`)) as Record<string, (req: Request) => Promise<Response>>;
    const req = new Request(`http://localhost/api/${route}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const res = await mod[method](req);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "Not found." });
  });
});

describe("cron bearer check", () => {
  it("matches only the exact bearer secret", async () => {
    const { bearerMatchesSecret } = await import("@/lib/http/cron-auth");
    expect(bearerMatchesSecret("Bearer s3cret", "s3cret")).toBe(true);
    expect(bearerMatchesSecret("Bearer s3cre", "s3cret")).toBe(false);
    expect(bearerMatchesSecret("s3cret", "s3cret")).toBe(false);
    expect(bearerMatchesSecret(null, "s3cret")).toBe(false);
    expect(bearerMatchesSecret("Bearer ", "")).toBe(false);
  });
});

describe("devnet cluster check", () => {
  it("accepts devnet's genesis hash only, and refuses on an RPC error", async () => {
    const { isDevnetConnection, DEVNET_GENESIS_HASH } = await import("@/lib/sandbox/devnet-genesis");
    expect(await isDevnetConnection({ getGenesisHash: async () => DEVNET_GENESIS_HASH })).toBe(true);
    expect(await isDevnetConnection({ getGenesisHash: async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" })).toBe(false);
    expect(await isDevnetConnection({ getGenesisHash: async () => { throw new Error("down"); } })).toBe(false);
  });
});

describe("operator key status", () => {
  it("never quotes the secret value in its parse error (S2-claude-07)", async () => {
    const saved = process.env.ONBOARDING_ATTEST_OPERATOR_SECRET_KEY;
    process.env.ONBOARDING_ATTEST_OPERATOR_SECRET_KEY = "Kd3wBqpZM9notjson";
    const { checkOperatorKeyStatus } = await import("@/lib/onboarding/operator-key");
    const result = checkOperatorKeyStatus();
    expect(result.state).toBe("invalid");
    expect(result.error ?? "").not.toContain("Kd3w");
    if (saved === undefined) delete process.env.ONBOARDING_ATTEST_OPERATOR_SECRET_KEY;
    else process.env.ONBOARDING_ATTEST_OPERATOR_SECRET_KEY = saved;
  });
});
