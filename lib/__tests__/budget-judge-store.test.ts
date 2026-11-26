/** @jest-environment node */
import { readFileSync } from "fs";
import { join } from "path";
import { judgeStore, judgeStoreConfig, SupabaseJudgeStore } from "@/lib/budget/judge/store";

const token = (role: string) => `h.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.s`;
const slice = { budget: "9Zv4HWNRt5WzSjBkbmJnGPtAT7vrcG8NxTzcd2iGF576", createdSlot: "42", payee: "J5zeR6m9ZSdyjqPeS7QNFkqvpLQRPMqKfwCWX43W5kdt" };
const base = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" };

describe("RAP judge store per network (#1210)", () => {
  it("devnet uses the service role key and the public tables", () => {
    expect(judgeStoreConfig({ ...base, SUPABASE_SERVICE_ROLE_KEY: "svc" }, "solana-devnet")).toEqual({ ok: true, config: { url: "https://example.supabase.co", serviceKey: "svc" } });
    expect(judgeStoreConfig(base, "solana-devnet")).toEqual({ ok: false, problem: "SUPABASE_SERVICE_ROLE_KEY is not set" });
  });

  it("mainnet never uses the service role key: it needs a role token for the mainnet schema", () => {
    const withService = { ...base, SUPABASE_SERVICE_ROLE_KEY: "svc" };
    expect(judgeStoreConfig(withService, "solana-mainnet-beta").ok).toBe(false);
    expect(judgeStore(withService, "solana-mainnet-beta")).toBeUndefined();
    const judge = judgeStoreConfig({ ...withService, BUDGET_JUDGE_ROLE_TOKEN: token("budget_mainnet_judge") }, "solana-mainnet-beta");
    expect(judge).toEqual({ ok: true, config: { url: "https://example.supabase.co", schema: "budget_mainnet", apiKey: "anon", roleToken: token("budget_mainnet_judge") } });
    const app = judgeStoreConfig({ ...base, BUDGET_CUSTODY_ROLE_TOKEN: token("budget_mainnet_app") }, "solana-mainnet-beta");
    expect(app.ok && "roleToken" in app.config && app.config.roleToken).toBe(token("budget_mainnet_app"));
  });

  it("refuses a token for another role, a missing API key or a bad URL", () => {
    const problem = (env: Record<string, string | undefined>) => {
      const read = judgeStoreConfig(env, "solana-mainnet-beta");
      return read.ok ? undefined : read.problem;
    };
    expect(problem({ ...base, BUDGET_JUDGE_ROLE_TOKEN: token("budget_mainnet_app") })).toMatch(/BUDGET_JUDGE_ROLE_TOKEN must be a token for budget_mainnet_judge/);
    expect(problem({ ...base, BUDGET_JUDGE_ROLE_TOKEN: token("service_role") })).toMatch(/budget_mainnet_judge/);
    expect(problem({ ...base, BUDGET_CUSTODY_ROLE_TOKEN: token("budget_mainnet_signer") })).toMatch(/BUDGET_CUSTODY_ROLE_TOKEN must be a token for budget_mainnet_app/);
    expect(problem({ ...base, BUDGET_CUSTODY_ROLE_TOKEN: "not-a-token" })).toMatch(/budget_mainnet_app/);
    expect(problem({ ...base, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, BUDGET_JUDGE_ROLE_TOKEN: token("budget_mainnet_judge") })).toMatch(/ANON_KEY/);
    expect(problem({ ...base, NEXT_PUBLIC_SUPABASE_URL: "http://example.supabase.co", BUDGET_JUDGE_ROLE_TOKEN: token("budget_mainnet_judge") })).toMatch(/SUPABASE_URL/);
  });

  it("sends mainnet requests to the mainnet schema as the role, and devnet ones with the service key", async () => {
    const seen: { url: string; headers: Record<string, string>; body?: string }[] = [];
    const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      seen.push({ url, headers: init.headers, body: init.body });
      return { ok: true, status: 200, json: async () => [] };
    };
    const mainnet = new SupabaseJudgeStore({ url: "https://example.supabase.co", schema: "budget_mainnet", apiKey: "anon", roleToken: "role-token", fetchImpl });
    expect(await mainnet.addReceipt(slice, "relay", "receipt")).toBe(true);
    await mainnet.receipts(slice, 10);
    for (const call of seen) {
      expect(call.headers).toMatchObject({ apikey: "anon", authorization: "Bearer role-token", "accept-profile": "budget_mainnet", "content-profile": "budget_mainnet" });
    }
    expect(seen[0].url).toBe("https://example.supabase.co/rest/v1/budget_call_receipts");
    // The app's role cannot read the table back, so an insert must not ask for the row.
    expect(seen[0].headers.prefer).toBe("return=minimal");
    seen.length = 0;
    const devnet = new SupabaseJudgeStore({ url: "https://example.supabase.co", serviceKey: "svc", fetchImpl });
    await devnet.addReceipt(slice, "relay", "receipt");
    expect(seen[0].headers).toMatchObject({ apikey: "svc", authorization: "Bearer svc" });
    expect(seen[0].headers["accept-profile"]).toBeUndefined();
  });

  it("the migration gives each mainnet role only its part", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261127100000_budget_mainnet_judge.sql"), "utf8").replace(/--.*$/gm, "");
    // The app adds relay receipts and nothing else; it reads neither table and never writes the log.
    expect(sql).toMatch(/for insert to budget_mainnet_app with check \(source = 'relay'\)/);
    expect(sql).not.toMatch(/grant select[^;]*to[^;]*budget_mainnet_app/);
    expect(sql).not.toMatch(/budget_judge_log[^;]*to[^;]*budget_mainnet_app/);
    // The judge cannot add a receipt as the relay, and cannot write the relay's records.
    expect(sql).toMatch(/for insert to budget_mainnet_judge with check \(source = 'provider'\)/);
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]*budget_mainnet\.budget_spender/);
    // Nobody else, the service role included, has any right on the two tables.
    expect(sql).toMatch(/revoke all on budget_mainnet\.budget_call_receipts, budget_mainnet\.budget_judge_log\s+from public, anon, authenticated, service_role, budget_mainnet_signer, budget_mainnet_app/);
    expect(sql).not.toMatch(/grant[^;]*to[^;]*(service_role|anon|authenticated|budget_mainnet_signer)/);
    for (const table of ["budget_call_receipts", "budget_judge_log"]) {
      expect(sql).toContain(`alter table budget_mainnet.${table} enable row level security`);
      expect(sql).toContain(`create trigger ${table}_no_update before update or delete on budget_mainnet.${table}`);
      expect(sql).toContain(`create trigger ${table}_no_truncate before truncate on budget_mainnet.${table}`);
    }
  });
});
