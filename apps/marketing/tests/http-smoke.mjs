// HTTP smoke against a running server (default http://127.0.0.1:3000; set SMOKE_ORIGIN to change). Checks the default,
// everything-off state: pages answer, carry noindex, load nothing from X, and the newsletter endpoints are closed.
const origin = (process.env.SMOKE_ORIGIN ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const problems = [];
const check = (ok, what) => { if (!ok) problems.push(what); };
const pages = { "/": "Get the receipt", "/status": "Where things stand", "/sandbox": "Devnet tokens have no value", "/privacy": "confirmed opt-in", "/terms": "No financial or investment advice", "/updates": "What has been built", "/watch": "See it explained", "/newsletter/closed": "does not collect email addresses yet", "/newsletter/confirm": "NEWSLETTER" };
for (const [path, phrase] of Object.entries(pages)) {
  const res = await fetch(origin + path);
  const html = await res.text();
  check(res.status === 200, `${path}: status ${res.status}`);
  check(html.includes(phrase), `${path}: missing "${phrase}"`);
  check(/noindex/.test(res.headers.get("x-robots-tag") ?? ""), `${path}: no X-Robots-Tag noindex`);
  check(res.headers.get("x-frame-options") === "DENY", `${path}: no X-Frame-Options`);
  check(!/platform\.twitter\.com|<iframe/i.test(html), `${path}: third-party embed present before any click`);
  check(/mainnet is coming soon/i.test(html), `${path}: stage line missing`);
}
const home = await (await fetch(origin + "/")).text();
check(/<input[^>]*disabled[^>]*id="newsletter-email"|<input[^>]*id="newsletter-email"[^>]*disabled/.test(home), "/: signup input is not disabled");
check(home.includes("Opens soon") || home.includes("Tell me when the sandbox opens"), "/: sandbox closed state missing");
const robots = await (await fetch(origin + "/robots.txt")).text();
check(/Disallow: \/\s*$/m.test(robots), "robots.txt does not disallow everything");
const sub = await fetch(origin + "/api/subscribe", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ email: "someone@example.com" }) });
check(sub.status === 503, `POST /api/subscribe: status ${sub.status}, expected 503`);
for (const action of ["confirm", "unsubscribe"]) {
  const res = await fetch(`${origin}/api/newsletter/${action}`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ t: "x" }) });
  const body = await res.json().catch(() => ({}));
  check(body.state === "closed", `POST /api/newsletter/${action}: state ${body.state}, expected closed`);
}
const issues = await fetch(origin + "/api/newsletter/issues");
check(issues.status === 401 || issues.status === 503, `GET /api/newsletter/issues without a bearer: status ${issues.status}`);
const health = await fetch(origin + "/api/health");
const report = await health.json().catch(() => ({}));
check(health.status === 200 && report.status === "ok" && report.site === "rap-marketing", `GET /api/health: status ${health.status}`);
check(report.indexable === false && report.newsletter?.enabled === false && report.newsletter?.autosend === false, "/api/health: a switch reads on in the everything-off state");
check(!/@|re_[A-Za-z0-9]|Bearer/.test(JSON.stringify(report)), "/api/health: something that looks like an address or a key");
const prune = await fetch(origin + "/api/newsletter/prune");
check(prune.status === 401 || prune.status === 503 || prune.status === 200, `GET /api/newsletter/prune: status ${prune.status}`);
check((await fetch(origin + "/nope")).status === 404, "/nope: not 404");
if (problems.length) { for (const p of problems) console.error(`FAIL ${p}`); process.exit(1); }
console.log(`smoke ok: ${Object.keys(pages).length} pages, closed newsletter endpoints, health, robots, 404`);
