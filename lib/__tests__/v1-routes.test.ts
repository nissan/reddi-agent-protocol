import { readdirSync, statSync } from "fs";
import { join } from "path";
import { isV1Path, v1RoutesOnly, V1_API_PREFIXES, V1_PAGE_PREFIXES } from "../v1-routes";
import { LEGACY_PAGE_REPLACEMENTS } from "../legacy-pages";

function routes(dir: string, file: string, base = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routes(full, file, `${base}/${name}`));
    else if (name === file) out.push(base || "/");
  }
  return out;
}

const APP = join(__dirname, "..", "..", "app");
const pages = routes(APP, "page.tsx").filter((p) => !p.startsWith("/api"));
const apis = routes(join(APP, "api"), "route.ts", "/api");

describe("V1 launch surface (#1149)", () => {
  it("serves the V1 pages", () => {
    for (const path of ["/", "/budget", "/try", "/pass", "/agent-setup", "/agents", "/agents/SomeWallet111", "/register", "/jobs", "/dashboard", "/sandbox", "/start", "/planner", "/docs", "/faq", "/adl", "/terms", "/privacy"]) {
      expect([path, isV1Path(path)]).toEqual([path, true]);
    }
  });

  it("serves agent files and markdown aliases", () => {
    for (const path of ["/llms.txt", "/llms-full.txt", "/skill.md", "/provider.md", "/pricing.md", "/adl.md", "/register.md", "/agent-setup.md"]) expect(isV1Path(path)).toBe(true);
  });

  it("refuses every legacy page", () => {
    for (const path of ["/whitepaper", "/circle-x402", "/judge-replication", "/mcp-bridge-demo", "/playbook", "/customize", "/tour", "/spec", "/leaderboard", "/setup", "/feedback", "/manager", "/manager/discovery", "/dogfood", "/testers", "/onboarding/intake", "/onboarding/profile-editor", "/agents/candidates/x", "/budgetx", "/features", "/updates"]) {
      expect([path, isV1Path(path)]).toEqual([path, false]);
    }
  });

  it("refuses legacy API routes and serves the V1 ones", () => {
    for (const path of ["/api/manager/readiness", "/api/torque/leaderboard", "/api/hosted-rap/search", "/api/generate", "/api/generate-live", "/api/dogfood/seed", "/api/onboarding/wallet", "/api/onboarding/operator-key", "/api/bake-trace", "/api/source-adapters/pay-sh", "/api/orchestrator/policy", "/api/planner/runs", "/api/heartbeat"]) {
      expect([path, isV1Path(path)]).toEqual([path, false]);
    }
    for (const path of ["/api/budget/v1/chat/completions", "/api/try/v1/pay", "/api/pass/v1/start", "/api/cron/budget-watch/health", "/api/rpc", "/api/listings/abc/adl", "/api/auth/session", "/api/jobs"]) {
      expect([path, isV1Path(path)]).toEqual([path, true]);
    }
  });

  it("every allowed prefix names something that exists in app/", () => {
    for (const prefix of V1_PAGE_PREFIXES) expect([prefix, pages.some((p) => p === prefix || p.startsWith(`${prefix}/`))]).toEqual([prefix, true]);
    for (const prefix of V1_API_PREFIXES) expect([prefix, apis.some((p) => p === prefix || p.startsWith(`${prefix}/`))]).toEqual([prefix, true]);
  });

  it("no legacy redirect points at a page that is off", () => {
    for (const target of Object.values(LEGACY_PAGE_REPLACEMENTS)) expect([target, isV1Path(target)]).toEqual([target, true]);
  });

  it("holds the count of pages outside V1, so a new page is a deliberate choice", () => {
    const served = pages.filter((p) => isV1Path(p.replace(/\[[^\]]+\]/g, "x")));
    expect(served.sort()).toMatchSnapshot();
  });

  it("is on in production and can be forced either way", () => {
    expect(v1RoutesOnly({ NODE_ENV: "production" })).toBe(true);
    expect(v1RoutesOnly({ NODE_ENV: "development" })).toBe(false);
    expect(v1RoutesOnly({ NODE_ENV: "development", V1_ROUTES_ONLY: "1" })).toBe(true);
    expect(v1RoutesOnly({ NODE_ENV: "production", V1_ROUTES_ONLY: "0" })).toBe(true);
  });
});
