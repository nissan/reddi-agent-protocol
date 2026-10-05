#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const endpoint = process.env.TESTING_SPECIALIST_ENDPOINT || process.argv[2] || "http://127.0.0.1:8080";
const outRoot = process.env.ARTIFACT_DIR || path.join("artifacts", "demo-testing-specialists", new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"));
const screenDir = path.join(outRoot, "screens");
fs.mkdirSync(screenDir, { recursive: true });

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[ch]);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await page.goto(`${endpoint}/healthz`);
  await page.screenshot({ path: path.join(screenDir, "01-healthz.png"), fullPage: true });

  const result = await page.evaluate(async (baseUrl) => {
    const health = await fetch(`${baseUrl}/healthz`).then((r) => r.json());
    const models = await fetch(`${baseUrl}/v1/models`).then((r) => r.json());
    const promptByProfile = {
      "qa-security": "Audit unpaid completion bypass without x402",
      "ux-usability": "Find specialist onboarding friction before registration",
      "integration-tester": "Create a Coolify VPS smoke plan for the protected endpoint",
    };
    const prompt = promptByProfile[health?.profile] || "Audit unpaid completion bypass without x402";
    const body = { model: models?.data?.[0]?.id, messages: [{ role: "user", content: prompt }] };
    const unpaid = await fetch(`${baseUrl}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const x402Request = unpaid.headers.get("x402-request");
    const unpaidBody = await unpaid.json();
    const paid = await fetch(`${baseUrl}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", "x402-payment": JSON.stringify({ txSignature: "demo-capture", network: "solana-devnet" }) }, body: JSON.stringify(body) });
    const paidBody = await paid.json();
    return { health, models, prompt, unpaid: { status: unpaid.status, x402Request: x402Request ? JSON.parse(x402Request) : null, body: unpaidBody }, paid: { status: paid.status, body: paidBody } };
  }, endpoint);

  const checks = [
    { name: "unpaid call returns 402", ok: result.unpaid.status === 402 },
    { name: "unpaid call includes x402-request", ok: Boolean(result.unpaid.x402Request) },
    { name: "paid retry returns 200", ok: result.paid.status === 200 },
    { name: "paid retry has high confidence", ok: (result.paid.body?.reddi_demo?.matchConfidence || 0) >= 0.9 },
  ];
  const failed = checks.filter((check) => !check.ok);
  fs.writeFileSync(path.join(outRoot, "capture-flow.json"), JSON.stringify({ ...result, checks }, null, 2));
  if (failed.length > 0) {
    fs.writeFileSync(path.join(outRoot, "CAPTURE-FAILED.md"), failed.map((check) => `- ${check.name}`).join("\n"));
    throw new Error(`capture assertions failed: ${failed.map((check) => check.name).join(", ")}`);
  }

  await page.setContent(`<!doctype html>
<html><head><meta charset="utf-8"><title>reddi-x402 testing specialist capture</title>
<style>
body{font-family:Inter,ui-sans-serif,system-ui;background:#0b1020;color:#eef2ff;margin:0;padding:40px} .card{background:#111936;border:1px solid #2d3b70;border-radius:18px;padding:24px;margin:0 0 24px;box-shadow:0 20px 60px #0005} h1{font-size:34px;margin:0 0 8px}.ok{color:#75f0b1}.warn{color:#ffd166} pre{white-space:pre-wrap;background:#050816;padding:18px;border-radius:12px;overflow:auto}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.pill{display:inline-block;padding:6px 10px;border-radius:999px;background:#19315f;margin-right:8px}</style>
</head><body>
<h1>`reddi-x402` protected testing specialist</h1>
<p><span class="pill">${esc(endpoint)}</span><span class="pill">${esc(result.health?.profile || "unknown-profile")}</span><span class="pill">Solana devnet</span><span class="pill">mock runtime, real fail-closed rail</span></p>
<div class="grid">
  <section class="card"><h2 class="warn">1. Unpaid call is blocked</h2><p>HTTP ${result.unpaid.status} with <code>x402-request</code>.</p><pre>${esc(JSON.stringify(result.unpaid.x402Request, null, 2))}</pre></section>
  <section class="card"><h2 class="ok">2. Paid retry returns specialist answer</h2><p>HTTP ${result.paid.status}; match confidence ${esc(result.paid.body?.reddi_demo?.matchConfidence)}; reputation ${esc(result.paid.body?.reddi_demo?.reputationScore)}/100.</p><pre>${esc(JSON.stringify(result.paid.body?.reddi_demo, null, 2))}</pre></section>
</div>
<section class="card"><h2>Prompt</h2><pre>${esc(result.prompt || "")}</pre></section>
<section class="card"><h2>Assistant payload</h2><pre>${esc(result.paid.body?.choices?.[0]?.message?.content || "")}</pre></section>
</body></html>`);
  await page.screenshot({ path: path.join(screenDir, "02-x402-paid-flow.png"), fullPage: true });
  await browser.close();

  fs.writeFileSync(path.join(outRoot, "CAPTURE-SUMMARY.md"), `# Testing specialist capture\n\nEndpoint: ${endpoint}\n\nScreens:\n\n- screens/01-healthz.png\n- screens/02-x402-paid-flow.png\n\nJSON: capture-flow.json\n`);
  console.log(`CAPTURED ${outRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
