// Check of the live site, run on a schedule by .github/workflows/marketing-uptime.yml (set LIVE_ORIGIN to point it
// elsewhere). It reads public pages only: no bearer, no form post, nothing written. It checks what a visitor would
// notice first: the health report, each main page, indexing, the sandbox hand-off to the developer app, and that the
// cron endpoint still refuses a caller without the bearer.
const origin = (process.env.LIVE_ORIGIN ?? "https://agent-protocol.reddi.tech").replace(/\/$/, "");
const problems = [];
const check = (ok, what) => { if (!ok) problems.push(what); };
const get = async (path, init) => {
  for (let attempt = 1; ; attempt++) {
    try { return await fetch(origin + path, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { "user-agent": "rap-marketing-live-check" }, ...init }); }
    catch (error) { if (attempt === 3) { problems.push(`${path}: no answer (${error instanceof Error ? error.name : "error"})`); return null; } await new Promise((r) => setTimeout(r, 5_000 * attempt)); }
  }
};

const health = await get("/api/health");
const report = health ? await health.json().catch(() => ({})) : {};
check(health?.status === 200 && report.status === "ok", `/api/health: status ${health?.status}`);
check(report.build?.environment === "production", `/api/health: environment is ${report.build?.environment}`);
check(report.indexable === true, "/api/health: the site is not indexable");
check(report.newsletter?.enabled === true && report.newsletter?.signupForm === true, "/api/health: newsletter signup is switched off");

const pages = { "/": "Get the receipt", "/status": "What we do not claim", "/market": "Solana", "/sandbox": "Devnet tokens have no value", "/updates": "What has been built", "/watch": "See it explained", "/privacy": "confirmed opt-in", "/terms": "No financial or investment advice" };
for (const [path, phrase] of Object.entries(pages)) {
  const res = await get(path);
  if (!res) continue;
  const html = await res.text();
  check(res.status === 200, `${path}: status ${res.status}`);
  check(html.includes(phrase), `${path}: missing "${phrase}"`);
  check(/nothing is on mainnet yet/i.test(html), `${path}: stage line missing`);
  check(!/noindex/.test(res.headers.get("x-robots-tag") ?? ""), `${path}: carries noindex`);
}

const robots = await get("/robots.txt");
check(robots?.status === 200 && /Sitemap: /.test(await robots.text()), "robots.txt: no sitemap line");
const sitemap = await get("/sitemap.xml");
check(sitemap?.status === 200 && (await sitemap.text()).includes(`${origin}/status`), "sitemap.xml: missing or names another host");

const hop = await get("/sandbox?scenario=try-to-cheat");
const target = hop?.headers.get("location") ?? "";
check(hop && hop.status >= 300 && hop.status < 400 && /^https:\/\/[^/]+\/sandbox\?scenario=try-to-cheat$/.test(target), `/sandbox?scenario=: status ${hop?.status}, location "${target}"`);
if (target.startsWith("https://")) {
  try { const app = await fetch(target, { signal: AbortSignal.timeout(30_000) }); check(app.status === 200, `developer app sandbox: status ${app.status}`); }
  catch { problems.push("developer app sandbox: no answer"); }
}

const cron = await get("/api/newsletter/issues");
check(cron?.status === 401, `/api/newsletter/issues without a bearer: status ${cron?.status}, expected 401`);
check((await get("/nope"))?.status === 404, "/nope: not 404");

if (problems.length) { for (const p of problems) console.error(`FAIL ${p}`); process.exit(1); }
console.log(`live ok: ${origin}, build ${report.build?.commit}, ${Object.keys(pages).length} pages, ${report.updates?.published} updates, ${report.videos?.published} videos`);
