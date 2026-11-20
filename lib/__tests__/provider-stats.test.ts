jest.mock("server-only", () => ({}));

import { refreshProviderStats, totalFromContentRange } from "@/lib/jobs/provider-stats";

const PROVIDER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const URL = "https://project.supabase.example";
const SERVICE_KEY = "test-service-role-key";

type Call = { url: string; init: { method: string; headers: Record<string, string>; body?: string } };

function store(options: { ranges?: Record<string, string | null>; countStatus?: number; writeStatus?: number } = {}) {
  const calls: Call[] = [];
  const ranges: Record<string, string | null> = {
    "jobs:delivered": "0-0/7",
    "jobs:failed": "*/0",
    "attestations:pass": "0-0/3",
    "attestations:fail": "0-0/1",
    ...options.ranges,
  };
  const fetchImpl = jest.fn(async (url: string, init: Call["init"]) => {
    calls.push({ url, init });
    if (init.method === "HEAD") {
      const table = url.includes("/rest/v1/jobs?") ? "jobs" : "attestations";
      const value = /(?:status|outcome)=eq\.(\w+)/.exec(url)?.[1] ?? "";
      const status = options.countStatus ?? 200;
      return { ok: status < 300, status, headers: { get: () => ranges[`${table}:${value}`] ?? null } };
    }
    const status = options.writeStatus ?? 201;
    return { ok: status < 300, status, headers: { get: () => null } };
  });
  return { calls, deps: { url: URL, serviceKey: SERVICE_KEY, fetchImpl } };
}

describe("provider stats (#740)", () => {
  it("reads the total from a PostgREST content range", () => {
    expect(totalFromContentRange("0-0/42")).toBe(42);
    expect(totalFromContentRange("0-24/25")).toBe(25);
    expect(totalFromContentRange("*/0")).toBe(0);
    expect(totalFromContentRange("0-0/*")).toBeUndefined();
    expect(totalFromContentRange("")).toBeUndefined();
    expect(totalFromContentRange(null)).toBeUndefined();
    expect(totalFromContentRange("0-0/-1")).toBeUndefined();
  });

  it("recounts the provider's rows and writes the whole row with the service key", async () => {
    const { calls, deps } = store();
    const outcome = await refreshProviderStats(PROVIDER, deps);
    expect(outcome).toEqual({ updated: true, stats: { jobsDelivered: 7, jobsFailed: 0, attestationsPass: 3, attestationsFail: 1 } });

    const counts = calls.filter((c) => c.init.method === "HEAD");
    expect(counts).toHaveLength(4);
    for (const call of counts) {
      expect(call.url).toContain(`provider_wallet=eq.${PROVIDER}`);
      expect(call.init.headers.prefer).toBe("count=exact");
      expect(call.init.headers.authorization).toBe(`Bearer ${SERVICE_KEY}`);
    }

    const write = calls.find((c) => c.init.method === "POST");
    expect(write?.url).toBe(`${URL}/rest/v1/provider_stats?on_conflict=provider_wallet`);
    expect(write?.init.headers.prefer).toContain("resolution=merge-duplicates");
    expect(JSON.parse(write?.init.body ?? "{}")).toEqual({
      provider_wallet: PROVIDER, jobs_delivered: 7, jobs_failed: 0, attestations_pass: 3, attestations_fail: 1,
    });
  });

  it("writes nothing when a count cannot be read", async () => {
    const missing = store({ ranges: { "jobs:failed": null } });
    expect(await refreshProviderStats(PROVIDER, missing.deps)).toEqual({ updated: false, reason: "count_unreadable" });
    expect(missing.calls.some((c) => c.init.method === "POST")).toBe(false);

    const refused = store({ countStatus: 401 });
    expect(await refreshProviderStats(PROVIDER, refused.deps)).toEqual({ updated: false, reason: "store_unavailable" });
    expect(refused.calls.some((c) => c.init.method === "POST")).toBe(false);
  });

  it("reports a refused write", async () => {
    const { deps } = store({ writeStatus: 409 });
    expect(await refreshProviderStats(PROVIDER, deps)).toEqual({ updated: false, reason: "store_unavailable" });
  });

  it("refuses a wallet that is not an address before any request", async () => {
    const { calls, deps } = store();
    expect(await refreshProviderStats(`${PROVIDER}&status=eq.failed`, deps)).toEqual({ updated: false, reason: "invalid_provider" });
    expect(calls).toHaveLength(0);
  });

  it("does nothing without a database or a service key", async () => {
    const { calls, deps } = store();
    expect(await refreshProviderStats(PROVIDER, { ...deps, serviceKey: " " })).toEqual({ updated: false, reason: "store_unavailable" });
    expect(await refreshProviderStats(PROVIDER, { ...deps, url: "not a url" })).toEqual({ updated: false, reason: "store_unavailable" });
    expect(calls).toHaveLength(0);
  });

  it("treats a network failure as unavailable", async () => {
    const fetchImpl = jest.fn(async () => { throw new Error("offline"); });
    expect(await refreshProviderStats(PROVIDER, { url: URL, serviceKey: SERVICE_KEY, fetchImpl })).toEqual({ updated: false, reason: "store_unavailable" });
  });
});
