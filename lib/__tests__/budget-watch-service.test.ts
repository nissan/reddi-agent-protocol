import { PublicKey } from "@solana/web3.js";
import type { AlertSender } from "@/lib/budget/alerts";
import { GENESIS_HASH, MemoryBudgetCustodyStore, SupabaseBudgetCustodyStore, type SpenderRecord } from "@/lib/budget/store";
import type { BudgetChainReader } from "@/lib/budget/watch";
import { WATCH_ALERT_PROMISE_MS, handleWatchCron, handleWatchHealth, watcherNetwork, watcherProblem, type WatcherContext } from "@/lib/budget/watch-service";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore the Worker is plain JavaScript
import worker from "@/ops/budget-watch-worker/worker.js";

const PROGRAM = new PublicKey("DcfW3CxtZ6GnDU9xgA3sB7X4iFSvKRneYJ2Kvgdj5Ucu");
const NOW = Date.parse("2026-11-27T00:00:00Z");
const SECRET = "s".repeat(40);
const ENV = { BUDGET_WATCH_CRON_SECRET: SECRET, RESEND_API_KEY: "re_x", BUDGET_ALERT_FROM: "RAP <alerts@example.com>", BUDGET_OPS_EMAIL: "ops@example.com" };

function ctx(over: Partial<WatcherContext> = {}, genesis = GENESIS_HASH["solana-mainnet-beta"]): WatcherContext & { store: MemoryBudgetCustodyStore; sent: string[] } {
  const sent: string[] = [];
  const sender: AlertSender = { email: async (to) => (sent.push(to), "sent"), webhook: async () => "sent" };
  const chain: BudgetChainReader = { readAccount: async () => null, reservations: async () => [], slot: async () => BigInt(1000), genesisHash: async () => genesis };
  return { network: "solana-mainnet-beta", programId: PROGRAM, chain, store: new MemoryBudgetCustodyStore(), sender, origin: "https://app.example.com", env: ENV, nowMs: NOW, sent, ...over } as never;
}
const call = (c: WatcherContext, auth = `Bearer ${SECRET}`) => handleWatchCron(new Request("https://watch.example.com/api/cron/watch", { headers: { authorization: auth } }), c);

describe("Budget watcher as its own deployment (#1208)", () => {
  it("reads its network from its own setting and refuses anything else", () => {
    expect(watcherNetwork({})).toBe("solana-devnet");
    expect(watcherNetwork({ BUDGET_WATCH_NETWORK: "solana-mainnet-beta" })).toBe("solana-mainnet-beta");
    expect(watcherNetwork({ BUDGET_WATCH_NETWORK: "mainnet" })).toBeUndefined();
  });

  it("names the missing setting, never a value", () => {
    expect(watcherProblem(ctx())).toBeUndefined();
    expect(watcherProblem(ctx({ programId: undefined }))).toMatch(/BUDGET_WATCH_PROGRAM_ID/);
    expect(watcherProblem(ctx({ chain: undefined }))).toMatch(/BUDGET_WATCH_RPC_URL/);
    expect(watcherProblem(ctx({ env: { ...ENV, RESEND_API_KEY: "" } }))).toMatch(/RESEND_API_KEY/);
    expect(watcherProblem(ctx({ env: { ...ENV, BUDGET_OPS_EMAIL: "" } }))).toMatch(/BUDGET_OPS_EMAIL/);
    expect(watcherProblem(ctx({ env: { ...ENV, RESEND_API_KEY: "" } }))).not.toContain("re_x");
  });

  it("runs only with its own cron secret", async () => {
    expect((await call(ctx({ env: { ...ENV, BUDGET_WATCH_CRON_SECRET: "" } }))).status).toBe(503);
    expect((await call(ctx(), "Bearer wrong")).status).toBe(401);
    expect((await call(ctx(), "")).status).toBe(401);
  });

  it("refuses to watch when it is not fully set up or its RPC is on another cluster", async () => {
    const unset = await call(ctx({ env: { ...ENV, RESEND_API_KEY: "" } }));
    expect(unset.status).toBe(503);
    expect(await unset.json()).toMatchObject({ ok: false, code: "not_configured" });
    const devnetRpc = ctx({}, GENESIS_HASH["solana-devnet"]);
    const wrong = await call(devnetRpc);
    expect(wrong.status).toBe(503);
    expect(await wrong.json()).toMatchObject({ ok: false, code: "wrong_cluster" });
    expect(await devnetRpc.store.watchedAt("solana-mainnet-beta")).toBeUndefined();
    const down = await call(ctx({ chain: { ...ctx().chain!, genesisHash: async () => Promise.reject(new Error("down")) } }));
    expect(await down.json()).toMatchObject({ ok: false, code: "rpc_unavailable" });
  });

  it("a complete pass marks only its own network's time", async () => {
    const c = ctx();
    const res = await call(c);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, network: "solana-mainnet-beta", complete: true, budgets: 0 });
    expect(await c.store.watchedAt("solana-mainnet-beta")).toBe(new Date(NOW).toISOString());
    expect(await c.store.watchedAt("solana-devnet")).toBeUndefined();
    expect(await c.store.watchedAt()).toBeUndefined();
  });

  it("watches only its own network's Budgets", async () => {
    const c = ctx();
    const devnetRecord = { id: "a".repeat(32), network: "solana-devnet", status: "open", budget: "CcSH3XrYivZhbeGnEWx498dWa6A4fUNPwEsUyJotBWCy", version: 1 } as unknown as SpenderRecord;
    c.store.records.set(devnetRecord.id, devnetRecord);
    const res = await call(c);
    // The devnet record is neither watched nor reported as on the wrong cluster.
    expect(await res.json()).toMatchObject({ ok: true, budgets: 0, errors: 0 });
    expect(c.sent).toEqual([]);
  });

  it("RAP-MB6-S2: health is green inside the promise and red once the watcher has stopped", async () => {
    const c = ctx();
    const never = await handleWatchHealth(c);
    expect(never.status).toBe(503);
    expect(await never.json()).toMatchObject({ ok: false, lastCompletePassAgeSeconds: null, promiseSeconds: 600 });
    await c.store.markWatched(new Date(NOW - WATCH_ALERT_PROMISE_MS).toISOString(), "solana-mainnet-beta");
    expect((await handleWatchHealth(c)).status).toBe(200);
    await c.store.markWatched(new Date(NOW - 15 * 60_000).toISOString(), "solana-mainnet-beta");
    const late = await handleWatchHealth(c);
    expect(late.status).toBe(503);
    expect(await late.json()).toMatchObject({ ok: false, lastCompletePassAgeSeconds: 900 });
    // The other network's fresh pass does not make this one look healthy.
    await c.store.markWatched(new Date(NOW).toISOString(), "solana-devnet");
    expect((await handleWatchHealth(c)).status).toBe(503);
    const noStore = await handleWatchHealth(ctx({ store: undefined }));
    expect(await noStore.json()).toMatchObject({ ok: false, problem: expect.stringMatching(/SUPABASE/) });
  });

  it("the Supabase store keeps a time per network and fails when the network has no row", async () => {
    const calls: { path: string; method: string; body?: string }[] = [];
    let patched: unknown[] = [{ network: "solana-mainnet-beta" }];
    const fetchImpl = async (url: string, init: { method: string; body?: string }) => {
      calls.push({ path: url.split("/rest/v1/")[1], method: init.method, body: init.body });
      const body = init.method === "PATCH" ? patched : [{ watched_at: "2026-11-27T00:00:00.000Z" }];
      return { ok: true, status: 200, json: async () => body } as never;
    };
    const store = new SupabaseBudgetCustodyStore({ url: "https://x.supabase.co", serviceKey: "k", fetchImpl: fetchImpl as never });
    expect(await store.watchedAt("solana-mainnet-beta")).toBe("2026-11-27T00:00:00.000Z");
    expect(calls[0].path).toBe("budget_watch_passes?network=eq.solana-mainnet-beta&select=watched_at");
    expect(await store.markWatched("2026-11-27T00:05:00.000Z", "solana-mainnet-beta")).toBe(true);
    expect(calls[1]).toMatchObject({ path: "budget_watch_passes?network=eq.solana-mainnet-beta", method: "PATCH" });
    patched = [];
    expect(await store.markWatched("2026-11-27T00:10:00.000Z", "solana-mainnet-beta")).toBe(false);
    patched = [{ id: 1 }];
    expect(await store.markWatched("2026-11-27T00:10:00.000Z")).toBe(true);
    expect(calls.at(-1)!.path).toBe("budget_controls?id=eq.1");
  });
});

describe("Budget watcher timer and outside monitor (Cloudflare Worker)", () => {
  const { passes, monitors, shouldPage, page, run, httpsOrigin } = worker.internals;
  const TOPIC = "rap-budget-monitor-0123456789abcdef";

  it("calls a watcher project only when both its origin and its secret are set, over https", () => {
    expect(passes({ CRON_SECRET: "a" }).map((p: string[]) => p[0])).toEqual(["app watcher", "sandbox sweep"]);
    expect(passes({ CRON_SECRET: "a", WATCH_ORIGIN: "https://w.example.com" })).toHaveLength(2);
    expect(passes({ CRON_SECRET: "a", WATCH_MAINNET_ORIGIN: "https://m.example.com/x", WATCH_MAINNET_CRON_SECRET: "b" }).at(-1)).toEqual(["mainnet watcher", "https://m.example.com/api/cron/watch", "b"]);
    expect(httpsOrigin("http://w.example.com")).toBe("");
    expect(monitors({ WATCH_MAINNET_ORIGIN: "https://m.example.com" }).map((m: string[]) => m[1])).toEqual(["https://app.agent-protocol.reddi.tech/api/cron/budget-watch/health", "https://m.example.com/api/v1/health"]);
  });

  it("pages once when a watcher falls behind, then once an hour", () => {
    const at = (ageSeconds: number) => shouldPage({ ok: false, ageSeconds, promiseSeconds: 600 }, 0);
    expect(shouldPage({ ok: true, ageSeconds: 5, promiseSeconds: 600 }, 0)).toBe(false);
    expect(at(600)).toBe(true);
    expect(at(899)).toBe(true);
    expect(at(900)).toBe(false);
    expect(at(600 + 3599)).toBe(false);
    expect(at(600 + 3600)).toBe(true);
    // No age (never passed, or unreadable): every half hour by the clock.
    expect(shouldPage({ ok: false, ageSeconds: null, promiseSeconds: null }, 0)).toBe(true);
    expect(shouldPage({ ok: false, ageSeconds: null, promiseSeconds: null }, 300_000)).toBe(false);
    expect(shouldPage({ ok: false, ageSeconds: null, promiseSeconds: null }, 1_800_000)).toBe(true);
  });

  it("tells the owner by phone push and by email, and says which channels took it", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => (seen.push({ url, init }), { ok: true } as Response);
    const env = { NTFY_TOPIC: TOPIC, RESEND_API_KEY: "re_x", MONITOR_EMAIL_TO: "owner@example.com", MONITOR_EMAIL_FROM: "RAP <alerts@example.com>" };
    expect(await page(env, "subject", "text", fetchImpl)).toEqual(["push", "email"]);
    expect(seen[0].url).toBe(`https://ntfy.sh/${TOPIC}`);
    expect(seen[1].url).toBe("https://api.resend.com/emails");
    expect(await page({ NTFY_TOPIC: "short" }, "s", "t", fetchImpl)).toEqual([]);
    expect(await page(env, "s", "t", async () => ({ ok: false }) as Response)).toEqual([]);
  });

  it("RAP-MB6-S2: a stalled watcher fails the run and pages the owner", async () => {
    const pages: string[] = [];
    const fetchImpl = async (url: string) => {
      if (url.includes("ntfy.sh")) return pages.push(url), ({ ok: true } as Response);
      if (url.endsWith("/api/v1/health")) return { status: 503, json: async () => ({ ok: false, lastCompletePassAgeSeconds: 900 - 60, promiseSeconds: 600 }) } as Response;
      return { status: 200, json: async () => ({ ok: true, lastCompletePassAgeSeconds: 10 }) } as Response;
    };
    const env = { CRON_SECRET: "a", WATCH_MAINNET_ORIGIN: "https://m.example.com", WATCH_MAINNET_CRON_SECRET: "b", NTFY_TOPIC: TOPIC };
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(run(env, 0, fetchImpl)).rejects.toThrow(/mainnet watcher health 503/);
    expect(pages).toHaveLength(1);
    // A page nobody received is itself a failure.
    await expect(run({ ...env, NTFY_TOPIC: "" }, 0, fetchImpl)).rejects.toThrow(/page not delivered/);
    // All green: nothing thrown, nobody paged.
    pages.length = 0;
    await run(env, 0, async () => ({ status: 200, json: async () => ({ ok: true, lastCompletePassAgeSeconds: 10, promiseSeconds: 600 }) }) as Response);
    expect(pages).toEqual([]);
    await expect(run({}, 0, fetchImpl)).rejects.toThrow(/no pass is configured/);
    log.mockRestore();
  });
});
